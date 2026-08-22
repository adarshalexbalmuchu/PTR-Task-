# Smart Forester

A field task management app for Palamau Tiger Reserve — task assignment and
closed-loop tracking, incident reporting with geotagged photos, patrol map,
audit log, and web push notifications. Backed by Supabase (Postgres + Auth +
Storage + Realtime + Edge Functions) with row-level security enforcing
director / range-officer / guard visibility server-side.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/) in your browser.

Create a `.env.local` with your Supabase project's credentials first:

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_VAPID_PUBLIC_KEY=<vapid-public-key>   # optional — enables web push
```

Accounts are provisioned by a director from inside the app (or via
`supabase/seed.sql` for the first director) — there are no built-in demo
logins, and no credentials are committed to this repo.

## Features

### Director
- Dashboard with metric cards + per-range workload chart (Recharts), backed by
  RLS-scoped Postgres views
- Full task list with search, filters (staff / status / priority / overdue), and sort
- Create, edit, delete tasks — primary assignee plus optional co-assignees
- Approve (archive) tasks or request changes with a revision note when a task is marked Done
- User management (create/delete users) via director-only Edge Functions
- Audit log of task actions; incident review; patrol map

### Range Officer
- Same task tooling scoped to their range (enforced by RLS, not the UI)
- Range-scoped audit log and incident management

### Guard (Field)
- Mobile-first "My Tasks" list — only sees tasks assigned to them
- **Acknowledge & Start** on new tasks (closed-loop handshake)
- Geotagged progress updates; **Mark as Done** — notifies the task creator
- Report incidents with compressed, geotagged photos
- Upload images / PDF / Excel as attachments; comment on tasks

### Shared
- Realtime updates (Supabase Realtime) — task/notification changes appear without refresh
- Web push notifications at the OS level via a Postgres trigger → Edge Function,
  delivered even when the app (tab or installed PWA) is fully closed. Subscriptions
  self-heal: the app silently re-subscribes on load if the browser rotated or
  expired one, and the service worker re-registers on the `pushsubscriptionchange`
  event so a device that never reopens the app keeps receiving alerts
- Deadline reminders (pg_cron, IST-aware): assignees are notified the day before
  a task is due, the morning it's due, and — along with the task's creator — once
  it's overdue. Exactly-once per deadline; rescheduling a task re-arms them; no
  sends during night hours
- Offline-capable PWA: app shell precached, last-loaded data readable with no
  signal, offline mutations queued and replayed (TanStack Query persistence)
- Overdue detection — red due dates and "Overdue" badge past due date

## Database

`supabase/schema.sql` is the idempotent source of truth (tables, RLS policies,
indexes, triggers, storage buckets/policies, dashboard views). Apply it in the
Supabase SQL Editor. `supabase/tests/` contains a local RLS correctness and
load-testing harness — see `supabase/tests/README.md` for benchmarks and how to
re-run them.

## Deploy to Vercel

1. Push this repo to GitHub
2. Import into [vercel.com](https://vercel.com) — Vite is auto-detected
3. Set the `VITE_*` environment variables listed above; build command is
   `npm run build`, output is `dist/` (security headers ship in `vercel.json`)

## Edge Functions

Deployed with the Supabase CLI:

```bash
supabase functions deploy create-user delete-user send-push sync-subscription
```

`send-push` additionally needs `PUSH_WEBHOOK_SECRET`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` (and optionally `ALLOWED_ORIGIN` for the other two) set via
`supabase secrets set` — see the comments in `supabase/schema.sql` for the
matching Vault secret.

### Push notification setup & troubleshooting

Generate ONE VAPID key pair (`npx web-push generate-vapid-keys`) and use it in
both places — the public key set as `VITE_VAPID_PUBLIC_KEY` (Vercel) must be
the exact partner of `VAPID_PRIVATE_KEY` (Supabase Edge secrets), or the push
service rejects every send with `403 invalid JWT`. Secrets are trimmed
server-side, so stray whitespace from dashboard pasting can't corrupt them.
After changing `VITE_VAPID_PUBLIC_KEY`, redeploy the frontend (the key is baked
in at build time) and re-enable notifications on each device.

To verify the whole path end to end, use **Profile → Notifications → Send test
notification** in the app: it fires a real push through the Edge Function to
your own devices and reports per-device delivery — including whether the
configured VAPID public/private keys are actually a matching pair (the
function derives one from the other and compares).

## Tech Stack

- React 19 + Vite 8 + TypeScript
- Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) via supabase-js v2
- TanStack Query v5 (with offline persistence) + Zustand v5
- Tailwind CSS 3, React Router v7, Recharts v3, Leaflet, date-fns v4, lucide-react
- PWA via vite-plugin-pwa + Workbox (custom service worker in `src/sw.ts`)
