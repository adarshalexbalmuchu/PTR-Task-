/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
cleanupOutdatedCaches();

// Without this, a newly activated service worker only controls tabs opened
// AFTER activation — any tab that was already open (the overwhelmingly
// common case on a phone that's just been left running) keeps being served
// by the OLD worker until the user does a full reload. Claiming clients here
// means the new worker takes over immediately, so main.tsx's
// `controllerchange` listener can reload the page once and every open tab
// picks up the new deploy without anyone needing to know to hard-refresh.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// App shell (JS/CSS/HTML) is precached so the app itself opens offline.
precacheAndRoute(self.__WB_MANIFEST);

// Supabase API responses are cached separately at runtime (GET only —
// Workbox never caches mutating requests) so a guard can still see their
// last-loaded tasks with no signal. Matching on origin, not just the
// pathname, so a request to any OTHER host whose path happens to start
// with /rest/v1/ can never poison or read this cache. The cacheName must
// stay in sync with SW_API_CACHE_NAME in src/contexts/AuthContext.tsx,
// which deletes this cache on sign-out.
const SUPABASE_ORIGIN = new URL(import.meta.env.VITE_SUPABASE_URL as string).origin;
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

// Web Push wants the VAPID public key as raw bytes; it's shipped as base64url.
// (Duplicated from src/utils/push.ts on purpose — that module pulls in the
// browser Supabase client, which has no place in the worker bundle.)
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
registerRoute(
  ({ url }) => url.origin === SUPABASE_ORIGIN && url.pathname.startsWith('/rest/v1/'),
  new NetworkFirst({
    cacheName: 'ptr-api-cache',
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 })],
  }),
);

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  type?: string;
  priority?: string;
}

// Only ever navigate to a same-origin path. The send-push Edge Function
// builds relative "/tasks/<uuid>" URLs, but the push payload is still
// external input to this worker — never let it steer a notification click
// to another origin ("//evil.example" would otherwise parse as
// protocol-relative).
function sanitizeNotificationUrl(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

// Fired when the send-push Edge Function delivers a message — this is
// what makes a notification show up on the device/OS even when the app
// isn't open in a tab.
self.addEventListener('push', (event) => {
  let payload: PushPayload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title ?? 'Smart Forester';
  const url = sanitizeNotificationUrl(payload.url);
  // Critical/High priority tasks (and changes-requested / overdue reminders,
  // which always need action) get a stronger vibration and stay on screen
  // until dismissed instead of disappearing after a few seconds.
  const isUrgent = payload.priority === 'Critical' || payload.priority === 'High'
    || payload.type === 'changes_requested' || payload.type === 'task_overdue';

  // TS's WebWorker lib types lag behind the real Notifications API spec —
  // renotify/vibrate/actions are all valid, widely-supported options that
  // just aren't in the shipped .d.ts. Building the object as a loosely
  // typed variable (instead of an inline literal) sidesteps the excess
  // property check without disabling type checking anywhere else.
  const options: NotificationOptions & Record<string, unknown> = {
    body: payload.body ?? '',
    icon: '/notification-icon.png',
    badge: '/notification-icon.png',
    data: { url },
    tag: url, // a second notification for the same task replaces the first
    renotify: true, // ...but still re-alerts (sound/vibrate) instead of updating silently
    requireInteraction: isUrgent,
    vibrate: isUrgent ? [200, 100, 200, 100, 200] : [150, 75, 150],
    timestamp: Date.now(),
    actions: [{ action: 'view', title: 'View Task' }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// The browser can rotate or expire a push subscription at any time — Chrome
// does so periodically, and always after clearing site data or a long idle —
// and fires this event in the worker. It's the ONLY chance to react while the
// app itself is closed; without it the device silently stops receiving
// notifications until the user next opens the app. We re-subscribe with the
// same VAPID key and hand the old + new subscription to the sync-subscription
// Edge Function, which moves the stored row to the new endpoint. The worker
// has no user session, so possession of the *old* subscription's keys is what
// authorizes the move server-side.
self.addEventListener('pushsubscriptionchange', (event) => {
  const evt = event as ExtendableEvent & {
    oldSubscription?: PushSubscription | null;
    newSubscription?: PushSubscription | null;
  };
  event.waitUntil(rotateSubscription(evt.oldSubscription ?? null, evt.newSubscription ?? null));
});

async function rotateSubscription(
  oldSub: PushSubscription | null,
  providedNew: PushSubscription | null,
): Promise<void> {
  if (!VAPID_PUBLIC_KEY) return;

  // Without the old keys we can't prove ownership of the row to move, so there
  // is nothing safe to do here — the on-load self-heal (ensurePushSubscription)
  // will re-create the subscription the next time the app is opened.
  const oldJson = oldSub?.toJSON();
  if (!oldJson?.endpoint || !oldJson.keys?.p256dh || !oldJson.keys?.auth) return;

  try {
    let newSub = providedNew;
    if (!newSub) {
      newSub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }
    const newJson = newSub.toJSON();
    if (!newJson.endpoint || !newJson.keys?.p256dh || !newJson.keys?.auth) return;

    await fetch(`${SUPABASE_ORIGIN}/functions/v1/sync-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old: { endpoint: oldJson.endpoint, p256dh: oldJson.keys.p256dh, auth: oldJson.keys.auth },
        new: { endpoint: newJson.endpoint, p256dh: newJson.keys.p256dh, auth: newJson.keys.auth },
      }),
    });
  } catch {
    // Best-effort — a failed rotation is recovered by the on-load self-heal.
  }
}

// Focuses an already-open tab (navigating it to the task) instead of
// always spawning a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          void (client as WindowClient).navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
