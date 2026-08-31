import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

// Secrets pasted into the dashboard routinely pick up a trailing newline or
// space, which silently corrupts VAPID signatures — the push service then
// rejects every send with 403 "invalid JWT" while the keys *look* correct.
// Trimming here makes that entire failure class impossible.
function env(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value ? value : undefined;
}

// Compare two secrets without early exit: hashing both first means the
// byte-by-byte comparison always runs over equal-length digests, so
// response timing can't be used to guess the secret one byte at a time.
async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

interface SendOutcome {
  sent: number;
  total: number;
  failures: { endpoint: string; statusCode?: number; message?: string }[];
}

// Sends `payload` to every stored subscription for `userId`, pruning rows the
// push service reports as permanently gone (404/410).
async function sendToUser(
  admin: ReturnType<typeof createClient>,
  userId: string,
  payload: string,
): Promise<SendOutcome> {
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (error) throw error;

  const results = await Promise.allSettled(
    (subs ?? []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err) {
        // 404/410 = the browser/OS invalidated this subscription
        // (uninstalled, permission revoked, device reset) — stop trying it.
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
        }
        throw err;
      }
    }),
  );

  const failures = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === 'rejected')
    .map(({ r, i }) => {
      const reason = (r as PromiseRejectedResult).reason as {
        statusCode?: number;
        body?: string;
        message?: string;
      };
      return {
        endpoint: subs![i].endpoint.slice(0, 60),
        statusCode: reason?.statusCode,
        message: reason?.body ?? reason?.message ?? String(reason),
      };
    });
  for (const f of failures) {
    console.error(`[send-push] delivery failed status=${f.statusCode} endpoint=${f.endpoint} message=${f.message}`);
  }
  return { sent: results.filter((r) => r.status === 'fulfilled').length, total: results.length, failures };
}

// Called by the notifications_push_trigger Postgres trigger (see schema.sql)
// on every insert into `notifications` — not by the browser directly, so this
// has verify_jwt = false in config.toml and authenticates the caller with its
// own shared secret (x-webhook-secret) instead of a user JWT.
// Body: { user_id, title, message, task_id, type?, priority? }.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const webhookSecret = env('PUSH_WEBHOOK_SECRET');
    const providedSecret = req.headers.get('x-webhook-secret');
    if (!webhookSecret || !providedSecret || !(await secretsMatch(providedSecret, webhookSecret))) {
      return json(401, { error: 'Unauthorized' });
    }

    const vapidPublicKey = env('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = env('VAPID_PRIVATE_KEY');
    if (!vapidPublicKey || !vapidPrivateKey) throw new Error('VAPID keys are not configured');
    webpush.setVapidDetails(env('VAPID_SUBJECT') ?? 'mailto:ptr-tiger-cell@example.com', vapidPublicKey, vapidPrivateKey);

    const { user_id, title, message, task_id, type, priority } = await req.json() as {
      user_id: string;
      title: string;
      message: string;
      task_id: string | null;
      type?: string | null;
      priority?: string | null;
    };
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!user_id || typeof user_id !== 'string' || !UUID_RE.test(user_id)) {
      throw new Error('a valid user_id is required');
    }
    if (task_id != null && (typeof task_id !== 'string' || !UUID_RE.test(task_id))) {
      throw new Error('task_id must be a UUID when present');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const payload = JSON.stringify({
      title,
      body: message,
      url: task_id ? `/tasks/${task_id}` : '/',
      type: type ?? undefined,
      priority: priority ?? undefined,
    });

    // Surfaced for operational debugging only — this endpoint is never
    // reachable without the shared webhook secret, so it's safe to include
    // failure detail (status/message, no stack traces). The trigger discards
    // the response body, but pg_net records it in net._http_response, so a
    // delivery problem stays diagnosable from that table.
    const outcome = await sendToUser(admin, user_id, payload);
    return json(200, outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error(`[send-push] error: ${message}`);
    return json(400, { error: message });
  }
});
