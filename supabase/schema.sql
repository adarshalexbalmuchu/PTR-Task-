-- PTR Tiger Cell Task Management System — Database Schema
-- Run this in the Supabase SQL Editor

-- ─────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────
create extension if not exists "uuid-ossp";
-- Lets a Postgres trigger make an outbound HTTP call (used to fire the
-- send-push Edge Function the instant a notification row is inserted,
-- regardless of which code path created it).
create extension if not exists pg_net with schema extensions;

-- ─────────────────────────────────────────────
-- Enums (idempotent)
-- ─────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('director', 'range_officer', 'guard', 'range_office', 'tiger_cell');
exception when duplicate_object then null; end $$;

-- range_office and tiger_cell were added after the type's initial creation
-- above, so an already-deployed database needs these ALTER statements to
-- pick them up (the do-block above only fires create on a fresh database).
alter type user_role add value if not exists 'range_office';
alter type user_role add value if not exists 'tiger_cell';
alter type user_role add value if not exists 'divisional_office';
-- DEPRECATED (2026-07): Inventory access is no longer a separate role.
-- It's now a capability any existing guard can be granted via an active
-- inventory_location_staff assignment (see get_my_inventory_location_ids()
-- and the inventory RLS section near the end of this file) — a guard keeps
-- their full Field Ops access and gains Inventory as an addition, not a
-- separate account/role. This enum value is kept only because a live
-- Postgres enum value can't be safely dropped; no new user should ever be
-- assigned it (enforced in the create-user Edge Function and every
-- role-selection UI), and no profile currently holds it.
alter type user_role add value if not exists 'inventory_staff';

-- Postgres runs this whole pasted script as one implicit transaction, and a
-- newly-added enum value can't be referenced until that transaction commits
-- ("unsafe use of new value of enum type") -- is_field_role() further down
-- compares against 'range_office'/'tiger_cell' directly, so commit here to
-- close out the ALTER TYPE statements before anything reads the new values.
commit;

do $$ begin
  create type task_status as enum ('NotStarted', 'InProgress', 'Completed', 'Archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('Critical', 'High', 'Medium', 'Low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_category as enum ('Patrol', 'Camera Trap', 'Survey', 'Maintenance', 'Admin', 'Other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_type as enum ('task_assigned', 'task_updated', 'task_completed', 'changes_requested', 'task_archived', 'task_due_soon', 'task_due_today', 'task_overdue');
exception when duplicate_object then null; end $$;

-- Deadline-reminder types appended after the enum's initial rollout; no-ops
-- on a fresh database where create type above already includes them. A new
-- enum value can't be referenced until the transaction that added it commits
-- ("unsafe use of new value of enum type"), and send_task_deadline_reminders
-- below inserts these literals — commit now so an already-deployed database
-- can run this whole file in one paste.
alter type notification_type add value if not exists 'task_due_soon';
alter type notification_type add value if not exists 'task_due_today';
alter type notification_type add value if not exists 'task_overdue';
-- Fired when a guard/officer/director reports a field incident — see
-- notify_on_incident_insert() further down.
alter type notification_type add value if not exists 'incident_reported';
-- Hospitality Inventory Management module (see the dedicated section near
-- the end of this file).
alter type notification_type add value if not exists 'inventory_request_submitted';
alter type notification_type add value if not exists 'inventory_request_approved';
alter type notification_type add value if not exists 'inventory_request_rejected';
alter type notification_type add value if not exists 'inventory_stock_issued';
commit;

do $$ begin
  create type incident_type as enum ('human_attack', 'livestock_attack', 'crop_damage', 'property_damage', 'poaching_sign', 'wildlife_sighting', 'road_kill', 'other');
exception when duplicate_object then null; end $$;

-- Values appended to incident_type after the initial rollout; no-ops on a
-- fresh database where create type above already includes them.
alter type incident_type add value if not exists 'road_kill' before 'other';

-- Per-category "Other" catch-alls, added when the incident type dropdown
-- was grouped into Human-Wildlife Conflict / Protection / Wildlife Sighting
-- categories — 'other' remains Protection's catch-all.
alter type incident_type add value if not exists 'conflict_other' before 'poaching_sign';
alter type incident_type add value if not exists 'sighting_other' after 'wildlife_sighting';

-- Protection category grew beyond just Poaching Sign / Road Kill.
alter type incident_type add value if not exists 'animal_injury' after 'road_kill';
alter type incident_type add value if not exists 'tree_felling' after 'animal_injury';

do $$ begin
  create type incident_severity as enum ('Low', 'Medium', 'High', 'Critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type incident_status as enum ('Open', 'Resolved');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────

create table if not exists ranges (
  id   uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists areas (
  id       uuid primary key default uuid_generate_v4(),
  range_id uuid not null references ranges(id) on delete cascade,
  name     text not null,
  created_at timestamptz not null default now(),
  unique (range_id, name)
);

-- Extends auth.users — one row per authenticated user
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  role            user_role not null default 'guard',
  email           text not null unique,
  phone           text,
  avatar_initials text not null default '',
  designation     text not null default '',
  range_id        uuid references ranges(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Extra ranges for officers who hold charge of MORE than one range (e.g. a
-- Range Officer in charge of Chhipadohar East + West + Kutku). A user's
-- effective range set is profiles.range_id UNION these rows — see
-- get_my_range_ids(). Single-range users need no rows here; guards keep
-- using profiles.range_id alone.
create table if not exists officer_ranges (
  user_id    uuid not null references profiles(id) on delete cascade,
  range_id   uuid not null references ranges(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, range_id)
);

create table if not exists tasks (
  id                    uuid primary key default uuid_generate_v4(),
  title                 text not null,
  description           text not null default '',
  assignee_id           uuid not null references profiles(id) on delete restrict,
  created_by_id         uuid not null references profiles(id) on delete restrict,
  range_id              uuid not null references ranges(id) on delete restrict,
  area_id               uuid references areas(id) on delete set null,
  status                task_status not null default 'NotStarted',
  priority              task_priority not null default 'Medium',
  category              task_category not null default 'Patrol',
  due_date              date not null,
  completion_percentage int not null default 0 check (completion_percentage between 0 and 100),
  acknowledged_at       timestamptz,
  completed_at          timestamptz,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Free-text label for tasks whose category is 'Other' — lets the creator
-- say what the "Other" work actually is. Null for the fixed categories.
-- Idempotent so re-running against an existing database just adds it.
alter table tasks add column if not exists category_other text;

-- Groups the individual task rows created from a single "assign to several
-- people at once" submission in TaskForm — each assignee gets their own
-- fully independent task row (own status/progress/due date), but the UI
-- still shows them together as one card. Null for a task created with a
-- single assignee, or any task from before this column existed.
alter table tasks add column if not exists batch_id uuid;
create index if not exists tasks_batch_id_idx on tasks(batch_id) where batch_id is not null;

create table if not exists task_updates (
  id                  uuid primary key default uuid_generate_v4(),
  task_id             uuid not null references tasks(id) on delete cascade,
  user_id             uuid not null references profiles(id) on delete restrict,
  note                text not null,
  progress_percentage int not null default 0 check (progress_percentage between 0 and 100),
  lat                 double precision,
  lng                 double precision,
  created_at          timestamptz not null default now()
);

-- Idempotent for databases where task_updates already existed before geotagging was added.
alter table task_updates add column if not exists lat double precision;
alter table task_updates add column if not exists lng double precision;

create table if not exists comments (
  id         uuid primary key default uuid_generate_v4(),
  task_id    uuid not null references tasks(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete restrict,
  content    text not null,
  created_at timestamptz not null default now()
);

create table if not exists attachments (
  id         uuid primary key default uuid_generate_v4(),
  task_id    uuid not null references tasks(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete restrict,
  name       text not null,
  url        text not null,
  size       bigint not null default 0,
  mime_type  text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references profiles(id) on delete cascade,
  type       notification_type not null,
  title      text not null,
  message    text not null,
  task_id    uuid references tasks(id) on delete cascade,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

-- A notification is now either about a task OR an incident, not always a
-- task — task_id above was NOT NULL until incident_reported notifications
-- needed to point somewhere else. Idempotent for a database that already
-- has this column from before incident notifications existed. The
-- incident_id FK/index/check are added further down, once the incidents
-- table this column references actually exists.
alter table notifications alter column task_id drop not null;

-- Additional assignees beyond tasks.assignee_id (the "primary" assignee).
-- A director/officer can add as many collaborators to a task as needed;
-- everyone listed here gets the same guard-level read/update access to the
-- task as the primary assignee (see RLS below).
create table if not exists task_assignees (
  task_id    uuid not null references tasks(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

-- Current live location of a field-role user, ONE row per user (upserted,
-- not a history log) while they hold an active patrol task. This is a
-- disclosed feature: the app shows the field user a persistent on-screen
-- indicator whenever this is being written (see useLocationSharing in
-- src/hooks/useLiveLocation.ts) — there is no hidden/background variant.
-- Visible only to the director and to range officers of the task's range
-- (see RLS below); never to other guards.
create table if not exists live_locations (
  user_id    uuid primary key references profiles(id) on delete cascade,
  task_id    uuid not null references tasks(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  updated_at timestamptz not null default now()
);

-- One row per browser/device push subscription. endpoint is globally
-- unique (it identifies the device's push channel), so re-subscribing the
-- same device — even as a different user after a logout/login — updates
-- the existing row instead of creating a duplicate.
create table if not exists push_subscriptions (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- Bookkeeping for send_task_deadline_reminders(): one row per reminder
-- actually sent, keyed on (task, recipient, kind, the due date it was about).
-- The composite PK is what makes the hourly cron idempotent — a reminder can
-- never repeat for the same deadline, but moving a task's due date changes
-- due_date here, so the reschedule correctly re-arms all three reminder
-- kinds for the new date. Not a user-facing table: RLS is enabled with no
-- policies (only the SECURITY DEFINER reminder function writes it).
create table if not exists task_reminders_sent (
  task_id  uuid not null references tasks(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  kind     text not null check (kind in ('due_soon', 'due_today', 'overdue')),
  due_date date not null,
  sent_at  timestamptz not null default now(),
  primary key (task_id, user_id, kind, due_date)
);

create table if not exists daily_reports (
  id               uuid primary key default uuid_generate_v4(),
  report_date      date not null unique,
  generated_by     uuid not null references profiles(id) on delete restrict,
  total_tasks      int not null default 0,
  completed_count  int not null default 0,
  in_progress_count int not null default 0,
  not_started_count int not null default 0,
  overdue_count    int not null default 0,
  range_breakdown  jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);

-- Human-wildlife conflict / field observation log, modeled on the "conflict
-- module" of India's own NTCA M-STrIPES tiger reserve monitoring system.
create table if not exists incidents (
  id            uuid primary key default uuid_generate_v4(),
  type          incident_type not null,
  severity      incident_severity not null default 'Medium',
  description   text not null,
  range_id      uuid not null references ranges(id) on delete restrict,
  area_id       uuid references areas(id) on delete set null,
  lat           double precision,
  lng           double precision,
  reported_by   uuid not null references profiles(id) on delete restrict,
  incident_date timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- Free-text label for incidents whose type is one of the per-category
-- "Other" catch-alls — lets the reporter say what it actually is. Null for
-- the fixed subcategories. Idempotent so re-running against an existing
-- database just adds it.
alter table incidents add column if not exists type_other text;

-- Incident response tracking: who is handling an incident and whether it
-- has been resolved. status defaults to 'Open' so every existing row is
-- treated as still open; assigned_to is nullable (an incident can sit
-- unassigned). assigned_at/resolved_at record when each transition
-- happened, mirroring the acknowledged_at/completed_at/archived_at pattern
-- already used on tasks. UPDATE access is already covered by the existing
-- "incidents_director" / "incidents_tiger_cell" management policies
-- (for all) further down, so no new RLS policy is needed.
alter table incidents add column if not exists status incident_status not null default 'Open';
alter table incidents add column if not exists assigned_to uuid references profiles(id) on delete set null;
alter table incidents add column if not exists assigned_at timestamptz;
alter table incidents add column if not exists resolved_at timestamptz;

-- Now that incidents exists, wire up notifications.incident_id (see the
-- notifications table above) — an incident_reported notification points
-- here instead of at a task.
alter table notifications add column if not exists incident_id uuid references incidents(id) on delete cascade;
create index if not exists notifications_incident_id_idx on notifications(incident_id) where incident_id is not null;

do $$ begin
  alter table notifications add constraint notifications_task_or_incident_chk
    check ((task_id is not null) <> (incident_id is not null));
exception when duplicate_object then null; end $$;

-- Photos attached to an incident report. Compressed client-side before
-- upload (see src/lib/incidentPhotos.ts) — this table only ever stores the
-- already-optimized file, same as attachments does for tasks.
create table if not exists incident_photos (
  id          uuid primary key default uuid_generate_v4(),
  incident_id uuid not null references incidents(id) on delete cascade,
  uploaded_by uuid not null references profiles(id) on delete restrict,
  path        text not null,
  size        bigint not null default 0,
  mime_type   text not null default 'image/jpeg',
  created_at  timestamptz not null default now()
);

-- Accountability log for significant task changes (reassignment, status
-- transitions, deletion). range_id/task_title are denormalized so entries
-- stay meaningful and range-scoped even after the source task is deleted.
create table if not exists audit_log (
  id         uuid primary key default uuid_generate_v4(),
  task_id    uuid references tasks(id) on delete set null,
  task_title text not null default '',
  range_id   uuid references ranges(id) on delete set null,
  actor_id   uuid not null references profiles(id) on delete restrict,
  action     text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────
create index if not exists tasks_assignee_id_idx    on tasks(assignee_id);
create index if not exists tasks_range_id_idx       on tasks(range_id);
create index if not exists tasks_status_idx         on tasks(status);
create index if not exists tasks_created_at_idx     on tasks(created_at desc);
create index if not exists tasks_due_date_idx       on tasks(due_date);
create index if not exists task_assignees_user_id_idx on task_assignees(user_id);
create index if not exists audit_log_created_at_idx on audit_log(created_at desc);
create index if not exists notifications_user_id_idx on notifications(user_id);
create index if not exists notifications_read_idx   on notifications(read) where not read;
create index if not exists push_subscriptions_user_id_idx on push_subscriptions(user_id);
create index if not exists task_updates_task_id_idx on task_updates(task_id);
create index if not exists comments_task_id_idx     on comments(task_id);
create index if not exists incidents_range_id_idx   on incidents(range_id);
create index if not exists incidents_type_idx       on incidents(type);
create index if not exists incidents_status_idx     on incidents(status);
create index if not exists incidents_assigned_to_idx on incidents(assigned_to) where assigned_to is not null;
create index if not exists incidents_date_idx       on incidents(incident_date);
create index if not exists incident_photos_incident_id_idx on incident_photos(incident_id);
create index if not exists audit_log_range_id_idx   on audit_log(range_id);
create index if not exists audit_log_task_id_idx    on audit_log(task_id);

-- ─────────────────────────────────────────────
-- Length limits (defense in depth — the app already limits input, this
-- guards against a malformed/malicious direct API call flooding a text
-- column). Wrapped in DO/EXCEPTION so re-running this file is safe.
-- ─────────────────────────────────────────────
do $$ begin
  alter table tasks add constraint tasks_title_len check (char_length(title) <= 300);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table tasks add constraint tasks_description_len check (char_length(description) <= 5000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table tasks add constraint tasks_category_other_len check (char_length(category_other) <= 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table incidents add constraint incidents_type_other_len check (char_length(type_other) <= 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table task_updates add constraint task_updates_note_len check (char_length(note) <= 2000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table comments add constraint comments_content_len check (char_length(content) <= 2000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table incidents add constraint incidents_description_len check (char_length(description) <= 3000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table audit_log add constraint audit_log_detail_len check (char_length(detail) <= 1000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table notifications add constraint notifications_title_len check (char_length(title) <= 200);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table notifications add constraint notifications_message_len check (char_length(message) <= 1000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table attachments add constraint attachments_name_len check (char_length(name) <= 300);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────
-- All functions pin search_path so a role that can create objects in a
-- schema earlier on the path can't shadow a table/function these bodies
-- reference (search-path hijacking). Especially critical for the two
-- SECURITY DEFINER helpers below, which run with the owner's privileges.
create or replace function set_updated_at()
returns trigger language plpgsql
set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

drop trigger if exists tasks_updated_at on tasks;
create trigger tasks_updated_at before update on tasks
  for each row execute function set_updated_at();

drop trigger if exists live_locations_updated_at on live_locations;
create trigger live_locations_updated_at before update on live_locations
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────
-- Helper: get current user's role / range
-- ─────────────────────────────────────────────
create or replace function get_my_role()
returns user_role language sql security definer stable
set search_path = '' as $$
  select role from public.profiles where id = auth.uid();
$$;

-- range_office, tiger_cell, and divisional_office hold the same access
-- level as guard (field staff scoped to their own assigned tasks/
-- incidents) — just a different personnel label. Every RLS policy and
-- trigger that used to check `get_my_role() = 'guard'` calls this instead,
-- so the four stay in sync.
create or replace function is_field_role()
returns boolean language sql security invoker stable
set search_path = '' as $$
  select (select public.get_my_role()) in ('guard', 'range_office', 'tiger_cell', 'divisional_office');
$$;

create or replace function get_my_range_id()
returns uuid language sql security definer stable
set search_path = '' as $$
  select range_id from public.profiles where id = auth.uid();
$$;

-- All ranges the current user holds: profiles.range_id plus any extra
-- officer_ranges rows. Returns an ARRAY (not a set) so RLS policies can use
-- `range_id = any ((select get_my_range_ids())::uuid[])` — the wrapping (select ...)
-- becomes a one-time InitPlan and `= any(<array>)` stays index-driven,
-- preserving the RLS performance fix documented above the policy section.
create or replace function get_my_range_ids()
returns uuid[] language sql security definer stable
set search_path = '' as $$
  select coalesce(array_agg(range_id), '{}'::uuid[]) from (
    select range_id from public.profiles
      where id = auth.uid() and range_id is not null
    union
    select range_id from public.officer_ranges where user_id = auth.uid()
  ) r;
$$;

-- Is the current user a co-assignee of this task? SECURITY DEFINER is
-- load-bearing here, not just a convenience: policies on tasks need to
-- consult task_assignees, and policies on task_assignees need to consult
-- tasks. If either side referenced the other table DIRECTLY, the rewriter
-- would expand RLS policies in a loop and every guard task query would fail
-- with "infinite recursion detected in policy" (42P17). Routing one
-- direction through an owner-privileged function keeps it opaque to the
-- rewriter and breaks the cycle. Cost is unchanged vs the correlated EXISTS
-- it replaces: one primary-key probe per row checked.
create or replace function is_task_assignee(t_id uuid)
returns boolean language sql security definer stable
set search_path = '' as $$
  select exists (
    select 1 from public.task_assignees
    where task_id = t_id and user_id = auth.uid()
  );
$$;

-- ─────────────────────────────────────────────
-- Column-level guards
-- RLS policies (USING/WITH CHECK) can only gate row visibility, not which
-- columns change on an UPDATE. These triggers close that gap for the two
-- places a broad "for update using (...)" policy would otherwise let a
-- lower-privileged role write to fields it should never touch.
-- ─────────────────────────────────────────────

-- Without this, profiles_self_update (id = auth.uid()) lets ANY user set
-- their own role to 'director' or move themselves to another range via a
-- direct API call — a full privilege escalation. Policy decision (matches
-- the Profile page in the app): a non-director may self-edit ONLY their
-- phone number. Name, email, designation, initials, role, and range are
-- service-record fields maintained by the director's office.
create or replace function enforce_profile_self_update()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if auth.uid() = new.id and public.get_my_role() <> 'director' then
    if new.role is distinct from old.role or new.range_id is distinct from old.range_id then
      raise exception 'Only a director can change role or range assignment';
    end if;
    if new.name is distinct from old.name
      or new.email is distinct from old.email
      or new.designation is distinct from old.designation
      or new.avatar_initials is distinct from old.avatar_initials
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Only your phone number can be changed here — other details are managed by the director''s office';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_self_update_guard on profiles;
create trigger profiles_self_update_guard
  before update on profiles
  for each row execute function enforce_profile_self_update();

-- Without this, tasks_guard_update (assignee_id = auth.uid()) lets a guard
-- change ANY column on their assigned task via a direct API call —
-- reassigning it, editing its priority/due date, or setting status
-- straight to 'Archived' and bypassing officer/director review entirely.
-- A guard may only move status forward through the normal flow and touch
-- the progress/acknowledgement fields the app's own mutations use.
create or replace function enforce_guard_task_update()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if public.is_field_role() then
    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.assignee_id is distinct from old.assignee_id
      or new.created_by_id is distinct from old.created_by_id
      or new.range_id is distinct from old.range_id
      or new.area_id is distinct from old.area_id
      or new.priority is distinct from old.priority
      or new.category is distinct from old.category
      or new.due_date is distinct from old.due_date
      or new.archived_at is distinct from old.archived_at
    then
      raise exception 'Guards may only update status/progress fields on their own tasks';
    end if;
    if new.status is distinct from old.status and new.status = 'Archived' then
      raise exception 'Only a range officer or director can archive a task';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard_update_guard on tasks;
create trigger tasks_guard_update_guard
  before update on tasks
  for each row execute function enforce_guard_task_update();

-- Fires the send-push Edge Function for every new in-app notification, so
-- a device notification shows up no matter which client code path wrote
-- the row. The function itself has verify_jwt = false (see
-- supabase/config.toml) and instead checks the x-webhook-secret header
-- against its own PUSH_WEBHOOK_SECRET env var.
--
-- The shared secret is NOT stored in this file (a secret committed to git
-- is not a secret). It lives in Supabase Vault; set the SAME value in both
-- places:
--   select vault.create_secret('<a-random-string>', 'push_webhook_secret');
--   supabase secrets set PUSH_WEBHOOK_SECRET=<the-same-random-string>
-- If the vault secret is absent, the trigger silently skips push delivery —
-- it never blocks the notification insert itself.
--
-- SECURITY DEFINER (owner: postgres) so the vault read works and so
-- ordinary clients don't need any direct grant on net.http_post.
-- If this project is ever recreated, update the project ref in the URL too.
create or replace function notify_push_on_notification_insert()
returns trigger language plpgsql security definer
set search_path = '' as $$
declare
  secret text;
  task_priority text;
begin
  begin
    select decrypted_secret into secret
      from vault.decrypted_secrets
     where name = 'push_webhook_secret'
     limit 1;
  exception when others then
    secret := null; -- vault not installed / not readable
  end;

  if secret is null then
    return new;
  end if;

  -- Drives the device vibration pattern in src/sw.ts — task notifications
  -- key it off the task's priority; an incident_reported notification has
  -- no task_id, so fall back to the incident's severity (same four
  -- values: Critical/High/Medium/Low) so a Critical incident still buzzes
  -- as urgently as a Critical task.
  if new.task_id is not null then
    select priority::text into task_priority from public.tasks where id = new.task_id;
  elsif new.incident_id is not null then
    select severity::text into task_priority from public.incidents where id = new.incident_id;
  end if;

  begin
    perform net.http_post(
      url := 'https://hsaqgpuvdbyrineknwzf.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', secret
      ),
      body := jsonb_build_object(
        'user_id', new.user_id,
        'title', new.title,
        'message', new.message,
        'task_id', new.task_id,
        'type', new.type,
        'priority', task_priority
      )
    );
  exception when others then
    null; -- push delivery is best-effort; never fail the insert
  end;
  return new;
end;
$$;

drop trigger if exists notifications_push_trigger on notifications;
create trigger notifications_push_trigger
  after insert on notifications
  for each row execute function notify_push_on_notification_insert();

-- Notifies the director(s) and every user stationed in (or holding charge
-- of) the incident's range the moment it's reported — director, range
-- officer, guard, range office, and tiger cell alike, not just the
-- director/range-officer pair. SECURITY DEFINER is load-bearing here, not
-- just convenience: the reporter is very often a guard, and a guard's own
-- RLS can't see other users' officer_ranges rows (needed to find a
-- MULTI-range officer) or other profiles' range_id — resolving recipients
-- from the client would silently miss people. This runs as the table owner
-- instead, so it sees every candidate regardless of who's reporting. The
-- three-way UNION also de-duplicates automatically (UNION, not UNION ALL)
-- if someone somehow matches more than one arm.
create or replace function notify_on_incident_insert()
returns trigger language plpgsql security definer
set search_path = '' as $$
declare
  recipient record;
  range_name text;
begin
  select name into range_name from public.ranges where id = new.range_id;

  for recipient in
    select id as user_id from public.profiles

      where role = 'director' and id <> new.reported_by
    union
    select id as user_id from public.profiles
      where range_id = new.range_id and id <> new.reported_by
    union
    select user_id from public.officer_ranges
      where range_id = new.range_id and user_id <> new.reported_by
  loop
    insert into public.notifications (user_id, type, title, message, incident_id)
    values (
      recipient.user_id,
      'incident_reported',
      new.severity::text || ' severity incident reported',
      coalesce(range_name, 'Unknown range') || ' — ' || left(new.description, 150),
      new.id
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists incidents_notify_insert on incidents;
create trigger incidents_notify_insert
  after insert on incidents
  for each row execute function notify_on_incident_insert();

-- ─────────────────────────────────────────────
-- Task deadline reminders
--
-- Inserts ordinary `notifications` rows — which the push trigger above then
-- delivers to devices — for three moments in a task's life:
--   due_soon:  the day before due_date        → every assignee
--   due_today: the morning of due_date        → every assignee
--   overdue:   past due_date and still open   → every assignee + the creator
-- "Assignees" = tasks.assignee_id UNION task_assignees. Only NotStarted /
-- InProgress tasks remind (a task marked Completed and awaiting approval
-- shouldn't nag anyone).
--
-- Dates are computed in IST (Asia/Kolkata — the reserve's timezone), and the
-- function refuses to send outside 08:00–20:00 IST so the date flipping at
-- midnight never buzzes a phone at night; the hourly cron job simply
-- delivers the pending reminders on its first run after 8 AM. Pass
-- p_ignore_quiet_hours := true to bypass the gate when testing by hand:
--   select send_task_deadline_reminders(true);
--
-- task_reminders_sent (see above) makes every send exactly-once per
-- (task, user, kind, due date): the insert into it is the gate, and only
-- rows that actually landed there produce a notification.
create or replace function send_task_deadline_reminders(p_ignore_quiet_hours boolean default false)
returns void language plpgsql security definer
set search_path = '' as $$
declare
  today    date := (now() at time zone 'Asia/Kolkata')::date;
  hour_ist int  := extract(hour from now() at time zone 'Asia/Kolkata');
begin
  if not p_ignore_quiet_hours and (hour_ist < 8 or hour_ist >= 20) then
    return;
  end if;

  -- due tomorrow → assignees
  with recipients as (
    select t.id as task_id, t.title, t.due_date, t.assignee_id as user_id
      from public.tasks t
     where t.status in ('NotStarted', 'InProgress') and t.due_date = today + 1
    union
    select t.id, t.title, t.due_date, ta.user_id
      from public.tasks t
      join public.task_assignees ta on ta.task_id = t.id
     where t.status in ('NotStarted', 'InProgress') and t.due_date = today + 1
  ), marked as (
    insert into public.task_reminders_sent (task_id, user_id, kind, due_date)
    select task_id, user_id, 'due_soon', due_date from recipients
    on conflict do nothing
    returning task_id, user_id
  )
  insert into public.notifications (user_id, type, title, message, task_id)
  select m.user_id, 'task_due_soon', 'Reminder: Task Due Tomorrow',
         'Your task "' || left(r.title, 150) || '" is due tomorrow (' || to_char(r.due_date, 'DD Mon') || ').',
         m.task_id
    from marked m
    join recipients r on r.task_id = m.task_id and r.user_id = m.user_id;

  -- due today → assignees
  with recipients as (
    select t.id as task_id, t.title, t.due_date, t.assignee_id as user_id
      from public.tasks t
     where t.status in ('NotStarted', 'InProgress') and t.due_date = today
    union
    select t.id, t.title, t.due_date, ta.user_id
      from public.tasks t
      join public.task_assignees ta on ta.task_id = t.id
     where t.status in ('NotStarted', 'InProgress') and t.due_date = today
  ), marked as (
    insert into public.task_reminders_sent (task_id, user_id, kind, due_date)
    select task_id, user_id, 'due_today', due_date from recipients
    on conflict do nothing
    returning task_id, user_id
  )
  insert into public.notifications (user_id, type, title, message, task_id)
  select m.user_id, 'task_due_today', 'Reminder: Task Due Today',
         'Your task "' || left(r.title, 150) || '" is due today. Update progress or mark it done.',
         m.task_id
    from marked m
    join recipients r on r.task_id = m.task_id and r.user_id = m.user_id;

  -- overdue → assignees + creator (the creator runs the closed loop, so they
  -- should know a deadline slipped without opening the dashboard)
  with recipients as (
    select t.id as task_id, t.title, t.due_date, t.assignee_id as user_id
      from public.tasks t
     where t.status in ('NotStarted', 'InProgress') and t.due_date < today
    union
    select t.id, t.title, t.due_date, ta.user_id
      from public.tasks t
      join public.task_assignees ta on ta.task_id = t.id
     where t.status in ('NotStarted', 'InProgress') and t.due_date < today
    union
    select t.id, t.title, t.due_date, t.created_by_id
      from public.tasks t
     where t.status in ('NotStarted', 'InProgress') and t.due_date < today
  ), marked as (
    insert into public.task_reminders_sent (task_id, user_id, kind, due_date)
    select task_id, user_id, 'overdue', due_date from recipients
    on conflict do nothing
    returning task_id, user_id
  )
  insert into public.notifications (user_id, type, title, message, task_id)
  select m.user_id, 'task_overdue', 'Task Overdue',
         'Task "' || left(r.title, 150) || '" was due on ' || to_char(r.due_date, 'DD Mon') || ' and is still open.',
         m.task_id
    from marked m
    join recipients r on r.task_id = m.task_id and r.user_id = m.user_id;
end;
$$;

revoke all on function send_task_deadline_reminders(boolean) from public;

-- Hourly via pg_cron; the function's own quiet-hours/dedup logic makes every
-- run a cheap no-op when there's nothing new to say. Both steps are wrapped
-- so this file still applies where pg_cron isn't installable (the local test
-- shim) — on real Supabase, enable the pg_cron extension and re-run this
-- block if the do-blocks report nothing scheduled.
do $$ begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron unavailable; deadline reminders not scheduled';
end $$;

do $$ begin
  perform cron.unschedule('task-deadline-reminders')
    from cron.job where jobname = 'task-deadline-reminders';
  perform cron.schedule('task-deadline-reminders', '0 * * * *',
                        'select public.send_task_deadline_reminders()');
exception when others then
  raise notice 'pg_cron unavailable; deadline reminders not scheduled';
end $$;

-- ─────────────────────────────────────────────
-- Row Level Security
--
-- get_my_role()/get_my_range_id()/auth.uid() calls below are wrapped in
-- `(select ...)`. Without that wrapper, Postgres re-evaluates the function
-- (each a subquery against profiles) once per row scanned, and — because
-- tasks has multiple permissive SELECT policies that get OR'd together —
-- the planner can't push range_id/assignee_id through the range_id/
-- assignee_id indexes either, forcing a full table scan even for a
-- single-range officer. Wrapping in `(select ...)` turns each call into a
-- one-time InitPlan instead of a per-row filter. Measured on a 50k-row
-- local benchmark: an officer's task list went from ~1000ms to ~7ms.
-- ─────────────────────────────────────────────
alter table profiles      enable row level security;
alter table ranges        enable row level security;
alter table areas         enable row level security;
alter table tasks         enable row level security;
alter table task_updates  enable row level security;
alter table comments      enable row level security;
alter table attachments   enable row level security;
alter table task_assignees enable row level security;
alter table notifications enable row level security;
-- No policies on purpose: only the SECURITY DEFINER reminder function
-- touches this table, so every client role is locked out entirely.
alter table task_reminders_sent enable row level security;
alter table daily_reports enable row level security;
alter table incidents     enable row level security;
alter table incident_photos enable row level security;
alter table audit_log     enable row level security;
alter table push_subscriptions enable row level security;
alter table officer_ranges enable row level security;
alter table live_locations enable row level security;

-- Drop all policies before recreating (idempotent)
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- ranges & areas: everyone authenticated can read
create policy "ranges_read" on ranges for select using ((select auth.uid()) is not null);
create policy "ranges_write" on ranges for all using ((select get_my_role()) = 'director');

create policy "areas_read" on areas for select using ((select auth.uid()) is not null);
create policy "areas_write" on areas for all using ((select get_my_role()) = 'director');

-- profiles: everyone can read their own row and any director's (directors
-- create tasks reserve-wide, so their name needs to resolve everywhere);
-- otherwise readable only within the caller's own range(s) — officers and
-- guards have no legitimate reason to read another range's roster.
create policy "profiles_read" on profiles for select using (
  (select auth.uid()) is not null and (
    id = (select auth.uid())
    or role = 'director'
    or range_id = any ((select get_my_range_ids())::uuid[])
  )
);
create policy "profiles_self_update" on profiles for update using (id = (select auth.uid()));
create policy "profiles_director" on profiles for all using ((select get_my_role()) = 'director');

-- tasks
create policy "tasks_director" on tasks
  for all using ((select get_my_role()) = 'director');

create policy "tasks_officer_read" on tasks
  for select using (
    (select get_my_role()) = 'range_officer' and range_id = any ((select get_my_range_ids())::uuid[])
  );

create policy "tasks_officer_write" on tasks
  for all using (
    (select get_my_role()) = 'range_officer' and range_id = any ((select get_my_range_ids())::uuid[])
  );

create policy "tasks_guard_read" on tasks
  for select using (
    (select is_field_role()) and (
      assignee_id = (select auth.uid())
      or is_task_assignee(tasks.id)
    )
  );

create policy "tasks_guard_update" on tasks
  for update using (
    (select is_field_role()) and (
      assignee_id = (select auth.uid())
      or is_task_assignee(tasks.id)
    )
  );

-- task_updates
create policy "task_updates_director" on task_updates
  for all using ((select get_my_role()) = 'director');

create policy "task_updates_officer" on task_updates
  for all using (
    (select get_my_role()) = 'range_officer' and
    exists (select 1 from tasks where tasks.id = task_updates.task_id and tasks.range_id = any ((select get_my_range_ids())::uuid[]))
  );

create policy "task_updates_guard_read" on task_updates
  for select using (
    (select is_field_role()) and
    exists (
      select 1 from tasks where tasks.id = task_updates.task_id and (
        tasks.assignee_id = (select auth.uid())
        or is_task_assignee(tasks.id)
      )
    )
  );

create policy "task_updates_guard_insert" on task_updates
  for insert with check (
    (select is_field_role()) and
    user_id = (select auth.uid()) and
    exists (
      select 1 from tasks where tasks.id = task_updates.task_id and (
        tasks.assignee_id = (select auth.uid())
        or is_task_assignee(tasks.id)
      )
    )
  );

-- comments
create policy "comments_director" on comments
  for all using ((select get_my_role()) = 'director');

create policy "comments_officer" on comments
  for all using (
    (select get_my_role()) = 'range_officer' and
    exists (select 1 from tasks where tasks.id = comments.task_id and tasks.range_id = any ((select get_my_range_ids())::uuid[]))
  );

create policy "comments_guard_read" on comments
  for select using (
    (select is_field_role()) and
    exists (
      select 1 from tasks where tasks.id = comments.task_id and (
        tasks.assignee_id = (select auth.uid())
        or is_task_assignee(tasks.id)
      )
    )
  );

create policy "comments_guard_insert" on comments
  for insert with check (
    (select is_field_role()) and
    user_id = (select auth.uid()) and
    exists (
      select 1 from tasks where tasks.id = comments.task_id and (
        tasks.assignee_id = (select auth.uid())
        or is_task_assignee(tasks.id)
      )
    )
  );

-- attachments — same as comments
create policy "attachments_director" on attachments
  for all using ((select get_my_role()) = 'director');

create policy "attachments_officer" on attachments
  for all using (
    (select get_my_role()) = 'range_officer' and
    exists (select 1 from tasks where tasks.id = attachments.task_id and tasks.range_id = any ((select get_my_range_ids())::uuid[]))
  );

create policy "attachments_guard_read" on attachments
  for select using (
    (select is_field_role()) and
    exists (
      select 1 from tasks where tasks.id = attachments.task_id and (
        tasks.assignee_id = (select auth.uid())
        or is_task_assignee(tasks.id)
      )
    )
  );

create policy "attachments_guard_insert" on attachments
  for insert with check (
    (select is_field_role()) and
    user_id = (select auth.uid()) and
    exists (
      select 1 from tasks where tasks.id = attachments.task_id and (
        tasks.assignee_id = (select auth.uid())
        or is_task_assignee(tasks.id)
      )
    )
  );

-- task_assignees: director full; officer full within their range's tasks;
-- guard can read the assignee roster of any task they're part of (as
-- primary or co-assignee), so the UI can show who else is working on it.
create policy "task_assignees_director" on task_assignees
  for all using ((select get_my_role()) = 'director')
  with check ((select get_my_role()) = 'director');

create policy "task_assignees_officer" on task_assignees
  for all using (
    (select get_my_role()) = 'range_officer' and
    exists (select 1 from tasks where tasks.id = task_assignees.task_id and tasks.range_id = any ((select get_my_range_ids())::uuid[]))
  )
  with check (
    (select get_my_role()) = 'range_officer' and
    exists (select 1 from tasks where tasks.id = task_assignees.task_id and tasks.range_id = any ((select get_my_range_ids())::uuid[]))
  );

create policy "task_assignees_guard_read" on task_assignees
  for select using (
    (select is_field_role()) and (
      exists (select 1 from tasks t where t.id = task_assignees.task_id and t.assignee_id = (select auth.uid()))
      or is_task_assignee(task_assignees.task_id)
    )
  );

-- notifications: everyone reads/updates/deletes only their own, but an
-- authenticated user can insert a notification for someone else — that's
-- the entire point of the feature (task assignment, completion, archive,
-- and changes-requested notifications are all written by someone other
-- than the recipient). A single "for all using (user_id = auth.uid())"
-- policy would implicitly reuse that USING clause as the INSERT check too,
-- blocking every one of those inserts with a 403.
--
-- The insert IS scoped to tasks the sender can see (the subquery runs
-- under the sender's own tasks RLS): every legitimate flow notifies about
-- a task visible to the actor, and without this check any signed-in user
-- could push arbitrary text to any other user's devices by picking a
-- random task_id.
create policy "notifications_read" on notifications
  for select using (user_id = (select auth.uid()));

create policy "notifications_insert" on notifications
  for insert with check (
    (select auth.uid()) is not null
    and (
      exists (select 1 from tasks where tasks.id = notifications.task_id)
      or exists (select 1 from incidents where incidents.id = notifications.incident_id)
    )
  );

create policy "notifications_update" on notifications
  for update using (user_id = (select auth.uid()));

create policy "notifications_delete" on notifications
  for delete using (user_id = (select auth.uid()));

-- push_subscriptions: a device's subscription belongs to whoever is
-- currently signed in on it. "for all" is safe here (unlike notifications)
-- because a user only ever writes their OWN row — there's no cross-user
-- insert case to worry about.
-- officer_ranges: a user must be able to read their OWN extra ranges (the
-- app loads them at login to drive the officer range switcher); directors
-- read and manage everyone's. get_my_range_ids() itself is SECURITY
-- DEFINER, so RLS here never blocks policy evaluation on other tables.
create policy "officer_ranges_own_read" on officer_ranges
  for select using (user_id = (select auth.uid()));

create policy "officer_ranges_director" on officer_ranges
  for all using ((select get_my_role()) = 'director');

create policy "push_subscriptions_own" on push_subscriptions
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Claim (upsert) this device's push subscription for the CURRENT user. The
-- client can't do this with a plain upsert on `endpoint`: on a SHARED device
-- the endpoint's row may still belong to whoever was signed in before, and the
-- "own row" policy above hides that row, so ON CONFLICT can neither see nor
-- update it (the insert then fails the unique constraint). This runs SECURITY
-- DEFINER to reassign the endpoint across users, but forces user_id to the
-- caller's own auth.uid() — so a caller can only ever claim a subscription for
-- themselves, never register or hijack one for someone else. Called by
-- subscribeToPush / ensurePushSubscription in src/utils/push.ts.
create or replace function claim_push_subscription(
  p_user_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_user_id is distinct from uid then
    raise exception 'cannot claim a push subscription for another user';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh  = excluded.p256dh,
        auth    = excluded.auth;
end;
$$;

revoke all on function claim_push_subscription(uuid, text, text, text) from public;
grant execute on function claim_push_subscription(uuid, text, text, text) to authenticated;

-- live_locations: a field-role user manages only their own row (the app
-- writes it only while an on-screen "sharing" indicator is visible to
-- them — see useLocationSharing). Director sees everyone; a range officer
-- sees only rows whose task falls in one of their ranges. No policy grants
-- guard-to-guard visibility.
create policy "live_locations_self" on live_locations
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "live_locations_director_read" on live_locations
  for select using ((select get_my_role()) = 'director');

create policy "live_locations_officer_read" on live_locations
  for select using (
    (select get_my_role()) = 'range_officer' and
    exists (select 1 from tasks t where t.id = live_locations.task_id and t.range_id = any ((select get_my_range_ids())::uuid[]))
  );

-- daily_reports: director full, others read-only
create policy "daily_reports_director" on daily_reports
  for all using ((select get_my_role()) = 'director');

create policy "daily_reports_read" on daily_reports
  for select using ((select get_my_role()) = 'range_officer' or (select is_field_role()));

-- incidents: the full log is management-only — director sees every
-- incident reserve-wide, and so does tiger_cell (Tiger Cell holds no
-- single range, same as director, so this isn't range-scoped) EXCEPT one
-- specific excluded profile (id below), who despite holding the tiger_cell
-- role is deliberately carved out and treated as an ordinary field
-- reporter — a named-person exception per product decision, not a role
-- rule (see internal records for who/why). If that profile is ever
-- deleted and recreated, this id must be updated to match. range_officer
-- no longer gets range-wide incident visibility (that moved to
-- tiger_cell) — range_officer, guard, range_office, divisional_office, and
-- the excluded profile can only read/insert incidents THEY personally
-- reported, never update/delete.
create policy "incidents_director" on incidents
  for all using ((select get_my_role()) = 'director');

create policy "incidents_tiger_cell" on incidents
  for all using (
    (select get_my_role()) = 'tiger_cell'
    and (select auth.uid()) <> '237e1f9b-cf77-4b83-ae43-7641af75f67f'::uuid -- excluded profile, see incidents_tiger_cell comment above
  );

create policy "incidents_read_own" on incidents
  for select using (
    ((select is_field_role()) or (select get_my_role()) = 'range_officer')
    and reported_by = (select auth.uid())
  );

create policy "incidents_report_insert" on incidents
  for insert with check (
    ((select is_field_role()) or (select get_my_role()) = 'range_officer')
    and reported_by = (select auth.uid())
  );

-- incident_photos: read/write follows the same scoping as incidents above.
create policy "incident_photos_director" on incident_photos
  for all using ((select get_my_role()) = 'director');

create policy "incident_photos_tiger_cell" on incident_photos
  for all using (
    (select get_my_role()) = 'tiger_cell'
    and (select auth.uid()) <> '237e1f9b-cf77-4b83-ae43-7641af75f67f'::uuid -- excluded profile, see incidents_tiger_cell comment above
  );

create policy "incident_photos_read_own" on incident_photos
  for select using (
    ((select is_field_role()) or (select get_my_role()) = 'range_officer') and
    exists (select 1 from incidents i where i.id = incident_photos.incident_id and i.reported_by = (select auth.uid()))
  );

create policy "incident_photos_report_insert" on incident_photos
  for insert with check (
    ((select is_field_role()) or (select get_my_role()) = 'range_officer') and
    uploaded_by = (select auth.uid()) and
    exists (select 1 from incidents i where i.id = incident_photos.incident_id and i.reported_by = (select auth.uid()))
  );

-- audit_log: management-only read (director all, officer their range);
-- insert is open to any authenticated user but only as themselves, since
-- guards also trigger logged actions (starting/completing their own tasks)
-- even though they can't read the log back.
create policy "audit_log_director_read" on audit_log
  for select using ((select get_my_role()) = 'director');

create policy "audit_log_officer_read" on audit_log
  for select using ((select get_my_role()) = 'range_officer' and range_id = any ((select get_my_range_ids())::uuid[]));

create policy "audit_log_insert" on audit_log
  for insert with check (actor_id = (select auth.uid()));

-- ─────────────────────────────────────────────
-- Storage bucket for attachments
-- ─────────────────────────────────────────────
-- Private bucket with a hard server-side size cap (25 MB) — the app also
-- checks before uploading, but only this stops a direct API call.
insert into storage.buckets (id, name, public, file_size_limit)
  values ('task-attachments', 'task-attachments', false, 26214400)
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit;

-- The public-schema policy DROP loop above only covers schemaname = 'public',
-- so storage.objects policies need their own explicit drops to stay idempotent.
drop policy if exists "attachments_upload" on storage.objects;
drop policy if exists "attachments_download" on storage.objects;
drop policy if exists "attachments_delete" on storage.objects;

-- Objects are stored under "<task-id>/<uuid>-<filename>" (see
-- uploadAttachment in src/hooks/useTask.ts). The EXISTS subqueries below
-- run under the caller's OWN tasks RLS, so storage access follows task
-- visibility exactly: directors everywhere, officers within their range,
-- guards only on tasks assigned to them. Without this scoping, any
-- authenticated user could enumerate/download (or delete) every file in
-- the bucket regardless of role.
create policy "attachments_upload" on storage.objects
  for insert with check (
    bucket_id = 'task-attachments'
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.tasks t
      where t.id::text = (storage.foldername(name))[1]
    )
  );

create policy "attachments_download" on storage.objects
  for select using (
    bucket_id = 'task-attachments'
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.tasks t
      where t.id::text = (storage.foldername(name))[1]
    )
  );

-- Delete mirrors the attachments-table policies: management only (the app
-- exposes attachment removal only to officers/directors; guards can't
-- delete attachment rows either).
create policy "attachments_delete" on storage.objects
  for delete using (
    bucket_id = 'task-attachments'
    and (select public.get_my_role()) in ('director', 'range_officer')
    and exists (
      select 1 from public.tasks t
      where t.id::text = (storage.foldername(name))[1]
    )
  );

-- ─────────────────────────────────────────────
-- Storage bucket for incident photos
-- ─────────────────────────────────────────────
-- Private bucket, 5 MB hard cap — photos are compressed client-side before
-- upload (see src/lib/incidentPhotos.ts), so anything still near this size
-- likely bypassed compression rather than being a legitimately large photo.
insert into storage.buckets (id, name, public, file_size_limit)
  values ('incident-photos', 'incident-photos', false, 5242880)
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "incident_photos_upload" on storage.objects;
drop policy if exists "incident_photos_download" on storage.objects;
drop policy if exists "incident_photos_object_delete" on storage.objects;

-- Objects are stored under "<incident-id>/<uuid>.jpg" (see
-- uploadIncidentPhoto in src/lib/incidentPhotos.ts). Same technique as
-- task-attachments: the EXISTS subquery runs under the caller's own
-- incidents RLS, so upload/download follow incident visibility exactly.
create policy "incident_photos_upload" on storage.objects
  for insert with check (
    bucket_id = 'incident-photos'
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.incidents i
      where i.id::text = (storage.foldername(name))[1]
    )
  );

create policy "incident_photos_download" on storage.objects
  for select using (
    bucket_id = 'incident-photos'
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.incidents i
      where i.id::text = (storage.foldername(name))[1]
    )
  );

-- Delete is management-only, same as the incident_photos table policy —
-- director or tiger_cell (excluding the excluded profile, see incidents_tiger_cell above).
create policy "incident_photos_object_delete" on storage.objects
  for delete using (
    bucket_id = 'incident-photos'
    and (
      (select public.get_my_role()) = 'director'
      or (
        (select public.get_my_role()) = 'tiger_cell'
        and (select auth.uid()) <> '237e1f9b-cf77-4b83-ae43-7641af75f67f'::uuid
      )
    )
    and exists (
      select 1 from public.incidents i
      where i.id::text = (storage.foldername(name))[1]
    )
  );

-- ─────────────────────────────────────────────
-- Dashboard aggregate views
-- security_invoker = true is required: without it, a view runs with the
-- view owner's privileges and BYPASSES the RLS policies on the underlying
-- tasks table, leaking every task to every role. With it, the view is
-- evaluated as the querying user, so RLS still scopes rows exactly as it
-- does for a direct `select * from tasks`.
-- ─────────────────────────────────────────────
create or replace view task_dashboard_stats
  with (security_invoker = true) as
  select
    count(*) as total_tasks,
    count(*) filter (where priority = 'Critical' and status <> 'Archived') as critical_count,
    count(*) filter (where status = 'InProgress') as in_progress_count,
    count(*) filter (where status = 'Completed') as completed_count,
    count(*) filter (where status = 'Archived') as archived_count,
    count(*) filter (where due_date < now() and status not in ('Completed', 'Archived')) as overdue_count
  from tasks;

create or replace view task_range_stats
  with (security_invoker = true) as
  select
    r.id as range_id,
    r.name as range_name,
    count(t.id) as total,
    count(t.id) filter (where t.status = 'NotStarted') as not_started_count,
    count(t.id) filter (where t.status = 'InProgress') as in_progress_count,
    count(t.id) filter (where t.status = 'Completed') as completed_count,
    
    count(t.id) filter (where t.status = 'Archived') as archived_count,
    count(t.id) filter (where t.status = 'Completed' or t.status = 'Archived') as completed,
    count(t.id) filter (where t.due_date < now() and t.status not in ('Completed', 'Archived')) as overdue
  from ranges r
  left join tasks t on t.range_id = r.id
  group by r.id, r.name;

grant select on task_dashboard_stats to authenticated;
grant select on task_range_stats to authenticated;

-- ═════════════════════════════════════════════
-- Hospitality Inventory Management module (Phase 1)
--
-- A domain module within the same app: full access for 'director', plus
-- an additional capability any existing guard can hold — Inventory access
-- to their actively-assigned location(s) — on top of their normal Field
-- Ops access (Tasks/Incidents/Map/Personnel/Audit are unaffected; this
-- module is additive, not a separate account type). Phase 1 scope: locations,
-- categories, units, items, stock balances, an immutable transaction
-- ledger, and the request → approval → issue workflow. Transfers,
-- consumption/return/damage recording, offline drafts, and procurement are
-- later phases and intentionally not modeled yet (see the app's inventory
-- implementation plan) — inventory_transactions.source_location_id /
-- destination_location_id below exist now so Phase 2 transfers don't need
-- a later column migration, but nothing writes them yet.
-- ═════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- Inventory enums (idempotent, same convention as the rest of this file)
-- ─────────────────────────────────────────────
do $$ begin
  create type inventory_location_type as enum (
    'central_warehouse', 'range_store', 'forest_office', 'resort',
    'hotel', 'guest_house', 'kitchen', 'housekeeping_store', 'other_facility'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type inventory_item_kind as enum ('consumable', 'reusable');
exception when duplicate_object then null; end $$;

-- Only the two transaction types Phase 1 actually produces. Transfer/
-- consumption/return/damage/adjustment/purchase-receipt types are added the
-- same way (alter type ... add value if not exists) when those phases land.
do $$ begin
  create type inventory_transaction_type as enum ('opening_balance', 'issued');
exception when duplicate_object then null; end $$;

-- 'UnderReview' is deliberately not a stored state: a Submitted request
-- being looked at by a director is a UI-only label, not a persisted
-- transition, so there's no separate write/RPC just to mark "someone
-- opened this." The director's approve/reject action moves a request
-- straight from Submitted to Approved/PartiallyApproved/Rejected.
do $$ begin
  create type inventory_request_status as enum (
    'Draft', 'Submitted', 'Approved', 'PartiallyApproved', 'Rejected',
    'PartiallyFulfilled', 'Fulfilled', 'Cancelled'
  );
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────
-- Inventory tables
-- ─────────────────────────────────────────────

create table if not exists inventory_locations (
  id                  uuid primary key default uuid_generate_v4(),
  name                text not null,
  type                inventory_location_type not null,
  range_id            uuid references ranges(id) on delete set null,
  address_description text not null default '',
  parent_location_id  uuid references inventory_locations(id) on delete set null,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Found while seeding real named locations (Betla, New Complex, ...): this
-- table had no unique constraint on name at all, unlike inventory_categories
-- /inventory_units (both `name text not null unique`). Without it, a seed
-- insert's `on conflict do nothing` is silently inert (nothing to conflict
-- on) and re-running it would insert duplicate rows every time. Same
-- duplicate_table exception class as the other UNIQUE-constraint fix
-- earlier in this file (42P07 on re-run, not 42710).
do $$ begin
  alter table inventory_locations add constraint inventory_locations_name_key unique (name);
exception when duplicate_object or duplicate_table then null; end $$;

-- Which users can see/act on which Inventory locations. Inventory access
-- is capability-based, not role-based: any user (in practice, an existing
-- guard) with an active row here gets Inventory access to that location;
-- the director always has full access regardless of this table. A
-- surrogate id + partial unique index (below) rather than a composite
-- primary key on (location_id, user_id) — the assignment needs to support
-- history (unassign now, reassign later), which a hard composite PK on the
-- pair would forbid re-inserting after the first deactivation.
create table if not exists inventory_location_staff (
  id              uuid primary key default uuid_generate_v4(),
  location_id     uuid not null references inventory_locations(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  active          boolean not null default true,
  assignment_type text not null default 'location_manager',
  assigned_by     uuid references profiles(id) on delete set null,
  assigned_at     timestamptz not null default now(),
  ended_at        timestamptz,
  created_at      timestamptz not null default now()
);

-- Access-architecture migration (2026-07): this table originally had a
-- composite primary key (location_id, user_id) with no active/history
-- columns, back when Inventory access was granted via a separate
-- inventory_staff role. Migrating an already-deployed database with that
-- older shape to the one declared above — safe/additive, no data loss (the
-- table was empty in production at the time of this change).
alter table inventory_location_staff add column if not exists id uuid default uuid_generate_v4();
update inventory_location_staff set id = uuid_generate_v4() where id is null;
alter table inventory_location_staff alter column id set not null;
alter table inventory_location_staff add column if not exists active boolean not null default true;
alter table inventory_location_staff add column if not exists assignment_type text not null default 'location_manager';
alter table inventory_location_staff add column if not exists assigned_by uuid references profiles(id) on delete set null;
alter table inventory_location_staff add column if not exists assigned_at timestamptz not null default now();
alter table inventory_location_staff add column if not exists ended_at timestamptz;
alter table inventory_location_staff drop constraint if exists inventory_location_staff_pkey;
do $$ begin
  alter table inventory_location_staff add constraint inventory_location_staff_pkey primary key (id);
exception when duplicate_object or duplicate_table then null; end $$;

-- The actual "no two simultaneous active assignments for the same
-- (user, location) pair" rule — a partial unique index since Postgres has
-- no WHERE clause on a plain table-level UNIQUE constraint.
create unique index if not exists inventory_location_staff_active_uniq
  on inventory_location_staff(user_id, location_id) where active;

-- Tables, not enums: the Director must be able to add new categories/units
-- without a schema migration (unlike inventory_location_type, which is a
-- fixed set of facility kinds that drives code branching).
create table if not exists inventory_categories (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists inventory_units (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null unique,
  abbreviation text not null default '',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Schema-driven fraction rule, replacing a hardcoded integer-only-unit-name
-- list in src/lib/inventoryQuantity.ts — a director-created custom unit can
-- now declare its own rule instead of silently defaulting forever.
--
-- Nullable-first backfill (not a blanket UPDATE keyed on abbreviation): the
-- column starts nullable with no default, gets backfilled ONLY where still
-- NULL, then NOT NULL + DEFAULT are applied. This makes the backfill run
-- exactly once, ever — a director who later flips a unit's fraction rule
-- keeps that choice across every future re-run, since no row can ever be
-- NULL again once the column is NOT NULL.
alter table inventory_units add column if not exists allows_fractional boolean;

update inventory_units set allows_fractional = (abbreviation not in ('pc', 'pkt', 'box', 'set', 'dz', 'roll'))
  where allows_fractional is null;

alter table inventory_units alter column allows_fractional set default true;
alter table inventory_units alter column allows_fractional set not null;

create table if not exists inventory_items (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  category_id   uuid not null references inventory_categories(id) on delete restrict,
  sku           text,
  description   text not null default '',
  unit_id       uuid not null references inventory_units(id) on delete restrict,
  kind          inventory_item_kind not null default 'consumable',
  min_stock     numeric not null default 0 check (min_stock >= 0),
  reorder_level numeric not null default 0 check (reorder_level >= 0),
  max_stock     numeric check (max_stock is null or max_stock >= 0),
  track_expiry  boolean not null default false,
  track_batch   boolean not null default false,
  active        boolean not null default true,
  photo_path    text,
  created_at    timestamptz not null default now()
);
create unique index if not exists inventory_items_sku_idx on inventory_items(sku) where sku is not null;

-- Derived stock balance per item/location — NEVER updated directly by
-- client code (no client-facing update/insert grant below). Every change
-- goes through a SECURITY DEFINER RPC (post_opening_balance/
-- issue_inventory_stock) that mutates this row and writes an
-- inventory_transactions row in the same atomic function call.
create table if not exists inventory_stock (
  id             uuid primary key default uuid_generate_v4(),
  item_id        uuid not null references inventory_items(id) on delete restrict,
  location_id    uuid not null references inventory_locations(id) on delete restrict,
  available_qty  numeric not null default 0 check (available_qty >= 0),
  reserved_qty   numeric not null default 0 check (reserved_qty >= 0),
  in_use_qty     numeric not null default 0 check (in_use_qty >= 0),
  damaged_qty    numeric not null default 0 check (damaged_qty >= 0),
  expired_qty    numeric not null default 0 check (expired_qty >= 0),
  updated_at     timestamptz not null default now(),
  unique (item_id, location_id)
);

-- Immutable ledger — no update/delete policy is granted below (insert-only
-- by omission, same convention as audit_log). Corrections are new rows,
-- never edits of a posted one. source_location_id/destination_location_id
-- are reserved for Phase 2 transfers; Phase 1 only ever sets location_id.
create table if not exists inventory_transactions (
  id                     uuid primary key default uuid_generate_v4(),
  item_id                uuid not null references inventory_items(id) on delete restrict,
  location_id            uuid not null references inventory_locations(id) on delete restrict,
  quantity               numeric not null check (quantity > 0),
  transaction_type       inventory_transaction_type not null,
  source_location_id     uuid references inventory_locations(id) on delete set null,
  destination_location_id uuid references inventory_locations(id) on delete set null,
  related_request_id    uuid,
  performed_by           uuid not null references profiles(id) on delete restrict,
  approved_by            uuid references profiles(id) on delete set null,
  notes                  text not null default '',
  attachment_path        text,
  previous_balance       numeric not null,
  new_balance            numeric not null,
  created_at             timestamptz not null default now()
);

-- Optional client-supplied idempotency key for issue_inventory_stock (spec
-- section 10): a retried call after a perceived timeout — the first call
-- actually succeeded server-side — would otherwise double-post, since two
-- partial-quantity issues within the approved cap are each individually
-- valid. A retried call reusing the same key is recognized and skipped.
alter table inventory_transactions add column if not exists idempotency_key uuid;
create unique index if not exists inventory_transactions_idempotency_key_uniq
  on inventory_transactions(idempotency_key) where idempotency_key is not null;

create table if not exists inventory_requests (
  id                   uuid primary key default uuid_generate_v4(),
  requesting_location_id uuid not null references inventory_locations(id) on delete restrict,
  requested_by         uuid not null references profiles(id) on delete restrict,
  status               inventory_request_status not null default 'Draft',
  required_by_date     date,
  priority             task_priority not null default 'Medium',
  reason               text not null default '',
  notes                text not null default '',
  reject_reason        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists inventory_request_items (
  id               uuid primary key default uuid_generate_v4(),
  request_id       uuid not null references inventory_requests(id) on delete cascade,
  item_id          uuid not null references inventory_items(id) on delete restrict,
  requested_qty    numeric not null check (requested_qty > 0),
  approved_qty     numeric check (approved_qty is null or approved_qty >= 0),
  fulfilled_qty    numeric not null default 0 check (fulfilled_qty >= 0),
  notes            text not null default ''
);

-- related_request_id has no inline `references` above because
-- inventory_requests doesn't exist yet at that point in the file (added as
-- a deferred ALTER once it does) — wrapped the same way every other
-- constraint in this file is, so re-running this script is a no-op here.
do $$ begin
  alter table inventory_transactions
    add constraint inventory_transactions_related_request_fkey
    foreign key (related_request_id) references inventory_requests(id) on delete set null;
exception when duplicate_object then null; end $$;

drop trigger if exists inventory_locations_updated_at on inventory_locations;
create trigger inventory_locations_updated_at before update on inventory_locations
  for each row execute function set_updated_at();

drop trigger if exists inventory_requests_updated_at on inventory_requests;
create trigger inventory_requests_updated_at before update on inventory_requests
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────
-- Inventory indexes
-- ─────────────────────────────────────────────
create index if not exists inventory_locations_range_id_idx on inventory_locations(range_id);
create index if not exists inventory_location_staff_user_id_idx on inventory_location_staff(user_id);
create index if not exists inventory_items_category_id_idx on inventory_items(category_id);
create index if not exists inventory_stock_location_id_idx on inventory_stock(location_id);
create index if not exists inventory_stock_item_id_idx on inventory_stock(item_id);
create index if not exists inventory_transactions_item_id_idx on inventory_transactions(item_id);
create index if not exists inventory_transactions_location_id_idx on inventory_transactions(location_id);
create index if not exists inventory_transactions_created_at_idx on inventory_transactions(created_at desc);
create index if not exists inventory_requests_requesting_location_id_idx on inventory_requests(requesting_location_id);
create index if not exists inventory_requests_status_idx on inventory_requests(status);
create index if not exists inventory_request_items_request_id_idx on inventory_request_items(request_id);

-- ─────────────────────────────────────────────
-- Length limits (defense in depth, same convention as the rest of this file)
-- ─────────────────────────────────────────────
do $$ begin
  alter table inventory_locations add constraint inventory_locations_name_len check (char_length(name) <= 200);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table inventory_items add constraint inventory_items_name_len check (char_length(name) <= 200);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table inventory_requests add constraint inventory_requests_reason_len check (char_length(reason) <= 1000);
exception when duplicate_object then null; end $$;

-- Request-item integrity guards found during the Phase 1 hardening pass
-- (spec section 7): nothing previously prevented the same item appearing
-- twice on one request, or an inactive/deactivated item being added to a
-- *new* request.
-- A UNIQUE constraint's exception class on re-run is duplicate_table
-- (42P07, "relation already exists" — from its implicit backing index),
-- not duplicate_object (42710) like every other constraint type in this
-- file. Found via the hardening pass's idempotent-reapply test: the
-- duplicate_object-only handler let this one raise a real error on a
-- second run.
do $$ begin
  alter table inventory_request_items
    add constraint inventory_request_items_request_item_unique unique (request_id, item_id);
exception when duplicate_object or duplicate_table then null; end $$;

-- Insert-only guard: an item that later becomes inactive must not block
-- new inserts against *existing* rows referencing it — historical requests
-- retain their item references regardless of the item's current active
-- state, so this only fires on INSERT, never on UPDATE.
create or replace function enforce_inventory_request_item_active_item()
returns trigger language plpgsql
set search_path = '' as $$
declare
  v_active boolean;
begin
  select active into v_active from public.inventory_items where id = new.item_id;
  if v_active is not true then
    raise exception 'Cannot add an inactive item to a request';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_request_items_active_item_guard on inventory_request_items;
create trigger inventory_request_items_active_item_guard before insert on inventory_request_items
  for each row execute function enforce_inventory_request_item_active_item();

-- ─────────────────────────────────────────────
-- Extend notifications/audit_log for inventory
-- ─────────────────────────────────────────────
alter table notifications add column if not exists inventory_request_id uuid references inventory_requests(id) on delete cascade;
create index if not exists notifications_inventory_request_id_idx on notifications(inventory_request_id) where inventory_request_id is not null;

-- Widen the "exactly one of these is set" check from two columns to three
-- (sum-of-booleans, since <> only expresses XOR for exactly two operands).
alter table notifications drop constraint if exists notifications_task_or_incident_chk;
alter table notifications add constraint notifications_task_or_incident_chk
  check (
    (case when task_id is not null then 1 else 0 end)
    + (case when incident_id is not null then 1 else 0 end)
    + (case when inventory_request_id is not null then 1 else 0 end) = 1
  );

-- audit_log stays task-shaped by name but gains nullable inventory columns
-- (Director explicitly wanted one unified audit timeline rather than a
-- second table) — logInventoryAction() in src/lib/audit.ts writes these.
alter table audit_log add column if not exists inventory_item_id uuid references inventory_items(id) on delete set null;
alter table audit_log add column if not exists inventory_transaction_id uuid references inventory_transactions(id) on delete set null;
create index if not exists audit_log_inventory_item_id_idx on audit_log(inventory_item_id) where inventory_item_id is not null;

-- Found during the hardening pass: request-lifecycle actions
-- (submitted/approved/rejected) had no structured entity reference at all
-- — only inventory_item_id/inventory_transaction_id existed, neither of
-- which applies to a request-level action. Detail text alone doesn't
-- satisfy "audit entries include entity type/ID."
alter table audit_log add column if not exists inventory_request_id uuid references inventory_requests(id) on delete set null;
create index if not exists audit_log_inventory_request_id_idx on audit_log(inventory_request_id) where inventory_request_id is not null;

-- ─────────────────────────────────────────────
-- Inventory helper functions
-- ─────────────────────────────────────────────
-- Access-architecture change: Inventory access is capability-based, not
-- role-based (there is no inventory_staff role in the new model). This
-- function never actually checked role — it just needed the `active`
-- filter now that the column exists, so it returns only currently-active
-- assignments (a deactivated/ended assignment must stop granting access
-- immediately, not linger until the row is deleted).
create or replace function get_my_inventory_location_ids()
returns uuid[] language sql security definer stable
set search_path = '' as $$
  select coalesce(array_agg(location_id), '{}'::uuid[])
  from public.inventory_location_staff where user_id = auth.uid() and active;
$$;
-- This project's public schema has an ALTER DEFAULT PRIVILEGES rule that
-- grants anon EXECUTE on every new function independently of PUBLIC — a
-- bare `revoke ... from public` does not remove anon's own direct grant,
-- and (the reverse gap) leaving PUBLIC's own implicit grant in place lets
-- every role inherit it regardless of an anon-specific revoke. Both must
-- be revoked; only authenticated needs this.
revoke all on function get_my_inventory_location_ids() from public;
grant execute on function get_my_inventory_location_ids() to authenticated;

-- Closes the same gap enforce_guard_task_update() closes for tasks: RLS
-- lets an assigned guard UPDATE their own Draft/Submitted request, but that
-- alone would also let them set status straight to 'Approved' or write
-- approved_qty/reject_reason on a direct API call. A director's session is
-- exempt; approve_inventory_request/reject_inventory_request (below) are
-- SECURITY DEFINER and bypass this trigger's own-role check entirely by
-- running as the table owner.
create or replace function enforce_inventory_request_staff_update()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if public.get_my_role() <> 'director' then
    if new.status not in ('Draft', 'Submitted', 'Cancelled') then
      raise exception 'Only a director can approve, reject, or fulfil a request';
    end if;
    if new.reject_reason is distinct from old.reject_reason then
      raise exception 'Only a director can set a rejection reason';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_requests_staff_guard on inventory_requests;
create trigger inventory_requests_staff_guard before update on inventory_requests
  for each row execute function enforce_inventory_request_staff_update();

create or replace function enforce_inventory_request_item_staff_update()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if public.get_my_role() <> 'director'
     and (new.approved_qty is distinct from old.approved_qty
          or new.fulfilled_qty is distinct from old.fulfilled_qty) then
    raise exception 'Only a director can set approved/fulfilled quantities';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_request_items_staff_guard on inventory_request_items;
create trigger inventory_request_items_staff_guard before update on inventory_request_items
  for each row execute function enforce_inventory_request_item_staff_update();

-- ─────────────────────────────────────────────
-- Inventory RLS
-- ─────────────────────────────────────────────
alter table inventory_locations enable row level security;
alter table inventory_location_staff enable row level security;
alter table inventory_categories enable row level security;
alter table inventory_units enable row level security;
alter table inventory_items enable row level security;
alter table inventory_stock enable row level security;
alter table inventory_transactions enable row level security;
alter table inventory_requests enable row level security;
alter table inventory_request_items enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename like 'inventory_%'
  loop
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "inventory_locations_director" on inventory_locations
  for all using ((select get_my_role()) = 'director');
create policy "inventory_locations_staff_read" on inventory_locations
  for select using (id = any ((select get_my_inventory_location_ids())::uuid[]));

create policy "inventory_location_staff_director" on inventory_location_staff
  for all using ((select get_my_role()) = 'director');
create policy "inventory_location_staff_own_read" on inventory_location_staff
  for select using (user_id = (select auth.uid()));

-- Catalog data (categories/units/items) is global-read for every user with
-- Inventory access — a request can only be raised for an item the
-- requester can see, and the full catalog isn't location-scoped.
-- Capability-based, not role-based: director OR any active
-- inventory_location_staff assignment (no inventory_staff role exists).
create policy "inventory_categories_director" on inventory_categories
  for all using ((select get_my_role()) = 'director');
create policy "inventory_categories_read" on inventory_categories
  for select using (
    (select get_my_role()) = 'director'
    or exists (select 1 from inventory_location_staff where user_id = (select auth.uid()) and active)
  );

create policy "inventory_units_director" on inventory_units
  for all using ((select get_my_role()) = 'director');
create policy "inventory_units_read" on inventory_units
  for select using (
    (select get_my_role()) = 'director'
    or exists (select 1 from inventory_location_staff where user_id = (select auth.uid()) and active)
  );

create policy "inventory_items_director" on inventory_items
  for all using ((select get_my_role()) = 'director');
create policy "inventory_items_read" on inventory_items
  for select using (
    (select get_my_role()) = 'director'
    or exists (select 1 from inventory_location_staff where user_id = (select auth.uid()) and active)
  );

create policy "inventory_stock_director" on inventory_stock
  for all using ((select get_my_role()) = 'director');
create policy "inventory_stock_staff_read" on inventory_stock
  for select using (location_id = any ((select get_my_inventory_location_ids())::uuid[]));

-- No insert/update/delete grant to an assigned guard OR director on the
-- transaction ledger — every write happens inside the SECURITY DEFINER
-- RPCs below, which run as the table owner and so bypass RLS on the write
-- itself. Director is deliberately restricted to SELECT here (not "for
-- all"): found during the hardening pass that a director's own client
-- session could otherwise directly UPDATE/DELETE posted transaction rows,
-- contradicting the ledger's documented immutability. Verified this has no
-- effect on any real write path — the client never writes to this table
-- directly (see useInventoryTransactions.ts), only through the RPCs.
create policy "inventory_transactions_director" on inventory_transactions
  for select using ((select get_my_role()) = 'director');
create policy "inventory_transactions_staff_read" on inventory_transactions
  for select using (location_id = any ((select get_my_inventory_location_ids())::uuid[]));

create policy "inventory_requests_director" on inventory_requests
  for all using ((select get_my_role()) = 'director');
create policy "inventory_requests_staff_read" on inventory_requests
  for select using (requesting_location_id = any ((select get_my_inventory_location_ids())::uuid[]));
-- Role check dropped (no inventory_staff role exists) — the
-- location-membership check via get_my_inventory_location_ids() is already
-- the real gate, and that function only ever returns active assignments.
-- Dropping the role check doesn't widen access: a director doesn't get
-- inventory_location_staff rows in this model, so they still only reach
-- inventory_requests through the separate "for all" director policy.
create policy "inventory_requests_staff_insert" on inventory_requests
  for insert with check (
    requested_by = (select auth.uid())
    and requesting_location_id = any ((select get_my_inventory_location_ids())::uuid[])
  );
-- Column-level restriction is enforced by the trigger above, not here —
-- RLS alone can gate row visibility, not which columns an UPDATE touches.
create policy "inventory_requests_staff_update" on inventory_requests
  for update using (
    requesting_location_id = any ((select get_my_inventory_location_ids())::uuid[])
  );

create policy "inventory_request_items_director" on inventory_request_items
  for all using ((select get_my_role()) = 'director');
create policy "inventory_request_items_staff_read" on inventory_request_items
  for select using (
    exists (
      select 1 from inventory_requests req
      where req.id = inventory_request_items.request_id
        and req.requesting_location_id = any ((select get_my_inventory_location_ids())::uuid[])
    )
  );
create policy "inventory_request_items_staff_insert" on inventory_request_items
  for insert with check (
    exists (
      select 1 from inventory_requests req
      where req.id = inventory_request_items.request_id
        and req.requested_by = (select auth.uid())
    )
  );
create policy "inventory_request_items_staff_update" on inventory_request_items
  for update using (
    exists (
      select 1 from inventory_requests req
      where req.id = inventory_request_items.request_id
        and req.requesting_location_id = any ((select get_my_inventory_location_ids())::uuid[])
    )
  );

-- Extend the notifications insert check (defense in depth — the RPCs below
-- are SECURITY DEFINER and bypass this anyway, but a direct client insert
-- referencing an inventory_request_id should still only succeed if that
-- request is visible to the inserting session, same principle as the
-- existing task/incident branches).
drop policy if exists "notifications_insert" on notifications;
create policy "notifications_insert" on notifications
  for insert with check (
    (select auth.uid()) is not null
    and (
      exists (select 1 from tasks where tasks.id = notifications.task_id)
      or exists (select 1 from incidents where incidents.id = notifications.incident_id)
      or exists (select 1 from inventory_requests where inventory_requests.id = notifications.inventory_request_id)
    )
  );

-- ─────────────────────────────────────────────
-- Inventory RPCs — the only way inventory_stock/inventory_transactions
-- ever change. Each is SECURITY DEFINER (runs as table owner, bypassing
-- RLS on its own writes) but re-checks the caller's role/authorization
-- from auth.uid() itself before doing anything, exactly like
-- claim_push_subscription above. revoke/grant locks down who may call each.
-- ─────────────────────────────────────────────

-- Director-only: seeds/adds to a location's starting balance for an item.
-- Returns whether this call actually applied the posting — false means a
-- retried call with the same p_idempotency_key was recognized as a
-- duplicate and safely skipped (mirrors issue_inventory_stock's pattern,
-- now that a real Opening Balance UI calls this). Also rejects inactive
-- items server-side, mirroring the same discipline already applied to
-- request items.
create or replace function post_opening_balance(
  p_item_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_notes text default '',
  p_idempotency_key uuid default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  prev numeric;
  v_item_active boolean;
begin
  if uid is null or public.get_my_role() is distinct from 'director' then
    raise exception 'Only a director can post an opening balance';
  end if;
  if p_quantity <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  if p_idempotency_key is not null and exists (
    select 1 from public.inventory_transactions where idempotency_key = p_idempotency_key
  ) then
    return false;
  end if;

  select active into v_item_active from public.inventory_items where id = p_item_id;
  if v_item_active is not true then
    raise exception 'Cannot post an opening balance for an inactive item';
  end if;

  insert into public.inventory_stock (item_id, location_id, available_qty)
    values (p_item_id, p_location_id, 0)
  on conflict (item_id, location_id) do nothing;

  select available_qty into prev from public.inventory_stock
    where item_id = p_item_id and location_id = p_location_id
    for update;

  update public.inventory_stock
    set available_qty = prev + p_quantity, updated_at = now()
    where item_id = p_item_id and location_id = p_location_id;

  insert into public.inventory_transactions
    (item_id, location_id, quantity, transaction_type, performed_by, notes, previous_balance, new_balance, idempotency_key)
  values
    (p_item_id, p_location_id, p_quantity, 'opening_balance', uid, p_notes, prev, prev + p_quantity, p_idempotency_key);

  return true;
end;
$$;
-- The 4-arg signature (before p_idempotency_key existed) is superseded;
-- drop it so PostgREST doesn't expose two overloads of the same RPC name.
drop function if exists post_opening_balance(uuid, uuid, numeric, text);
revoke all on function post_opening_balance(uuid, uuid, numeric, text, uuid) from public;
-- The bare revoke above only removes PUBLIC's grant; this project's default
-- privileges on the public schema separately grant anon EXECUTE on every
-- new function regardless of PUBLIC, so anon needs an explicit revoke too.
revoke execute on function post_opening_balance(uuid, uuid, numeric, text, uuid) from anon;
grant execute on function post_opening_balance(uuid, uuid, numeric, text, uuid) to authenticated;

-- An assigned guard creates a request and its item lines atomically.
-- Previously the client did this as two separate inserts (header, then
-- items); if the items insert failed for any reason (inactive item hitting
-- the trigger above, a duplicate item hitting the unique constraint), the
-- request header was left behind as a permanent zero-item Draft — found
-- during the Phase 1 hardening pass. Wrapping both in one SECURITY DEFINER
-- function makes them atomic: a single function invocation is one implicit
-- transaction, so any failure rolls back the header too.
-- Authorization is capability-based, not role-based: director OR an
-- active assignment to the requesting location (no inventory_staff role
-- exists). A director doesn't get inventory_location_staff rows in this
-- model, so in practice this preserves "only assigned guards create
-- requests" while matching the universal "Director OR active assignment"
-- authorization rule applied to every Inventory RPC.
create or replace function create_inventory_request(
  p_requesting_location_id uuid,
  p_items jsonb,
  p_required_by_date date default null,
  p_priority task_priority default 'Medium',
  p_reason text default ''
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_request_id uuid;
  item jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if (select public.get_my_role()) is distinct from 'director' and not exists (
    select 1 from public.inventory_location_staff
    where location_id = p_requesting_location_id and user_id = uid and active
  ) then
    raise exception 'You are not assigned to this location';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A request must include at least one item';
  end if;

  insert into public.inventory_requests (requesting_location_id, requested_by, required_by_date, priority, reason)
    values (p_requesting_location_id, uid, p_required_by_date, coalesce(p_priority, 'Medium'), coalesce(p_reason, ''))
    returning id into v_request_id;

  for item in select * from jsonb_array_elements(p_items) loop
    insert into public.inventory_request_items (request_id, item_id, requested_qty)
      values (v_request_id, (item->>'item_id')::uuid, (item->>'requested_qty')::numeric);
  end loop;

  return v_request_id;
end;
$$;
revoke all on function create_inventory_request(uuid, jsonb, date, task_priority, text) from public;
revoke execute on function create_inventory_request(uuid, jsonb, date, task_priority, text) from anon;
grant execute on function create_inventory_request(uuid, jsonb, date, task_priority, text) to authenticated;

-- Director-only: approves (fully or partially) the items on a Submitted
-- request. p_item_approvals is a jsonb array of
-- {"request_item_id": "<uuid>", "approved_qty": <number>}.
--
-- Two bugs found and fixed during the Phase 1 hardening pass:
-- (1) this had no guard on the request's current status at all, so a
-- director could re-"approve" an already-Rejected/Fulfilled/Cancelled
-- request; it's now restricted to requests currently 'Submitted'.
-- (2) approved_qty was written straight from client input with no upper
-- bound (only "not negative" was enforced, by the table check constraint),
-- so a client bug or direct RPC call could approve more than was
-- requested; now validated per item against requested_qty.
create or replace function approve_inventory_request(
  p_request_id uuid,
  p_item_approvals jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  approval jsonb;
  v_request_item_id uuid;
  v_approved_qty numeric;
  v_requested_qty numeric;
  v_status public.inventory_request_status;
  all_full boolean := true;
  any_approved boolean := false;
begin
  if uid is null or public.get_my_role() is distinct from 'director' then
    raise exception 'Only a director can approve a request';
  end if;

  select status into v_status from public.inventory_requests where id = p_request_id;
  if v_status is null then
    raise exception 'Request not found';
  end if;
  if v_status <> 'Submitted' then
    raise exception 'Only a submitted request can be approved';
  end if;

  for approval in select * from jsonb_array_elements(p_item_approvals) loop
    v_request_item_id := (approval->>'request_item_id')::uuid;
    v_approved_qty := (approval->>'approved_qty')::numeric;

    select requested_qty into v_requested_qty
      from public.inventory_request_items
      where id = v_request_item_id and request_id = p_request_id;
    if v_requested_qty is null then
      raise exception 'Request item does not belong to this request';
    end if;
    if v_approved_qty < 0 or v_approved_qty > v_requested_qty then
      raise exception 'Approved quantity must be between 0 and the requested quantity';
    end if;

    update public.inventory_request_items
      set approved_qty = v_approved_qty
      where id = v_request_item_id and request_id = p_request_id;
  end loop;

  select
    bool_and(coalesce(approved_qty, 0) >= requested_qty),
    bool_or(coalesce(approved_qty, 0) > 0)
  into all_full, any_approved
  from public.inventory_request_items where request_id = p_request_id;

  -- Explicit cast is required: with every CASE branch a bare string
  -- literal (no enum-typed branch to anchor resolution, unlike
  -- issue_inventory_stock's `else status` below), Postgres resolves the
  -- whole expression as `text` (confirmed via pg_typeof), and assigning
  -- that text to this enum column fails outright — this previously made
  -- approve_inventory_request fail on every single call.
  update public.inventory_requests
    set status = (case when all_full then 'Approved' when any_approved then 'PartiallyApproved' else 'Rejected' end)::public.inventory_request_status,
        updated_at = now()
    where id = p_request_id;
end;
$$;
revoke all on function approve_inventory_request(uuid, jsonb) from public;
revoke execute on function approve_inventory_request(uuid, jsonb) from anon;
grant execute on function approve_inventory_request(uuid, jsonb) to authenticated;

-- Director-only: rejects a request outright, with a required reason.
-- Restricted to requests currently 'Submitted' — previously had no status
-- guard, so a director could reject an already-Fulfilled/Cancelled request.
create or replace function reject_inventory_request(
  p_request_id uuid,
  p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_status public.inventory_request_status;
begin
  if uid is null or public.get_my_role() is distinct from 'director' then
    raise exception 'Only a director can reject a request';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A rejection reason is required';
  end if;

  select status into v_status from public.inventory_requests where id = p_request_id;
  if v_status is null then
    raise exception 'Request not found';
  end if;
  if v_status <> 'Submitted' then
    raise exception 'Only a submitted request can be rejected';
  end if;

  update public.inventory_requests
    set status = 'Rejected', reject_reason = p_reason, updated_at = now()
    where id = p_request_id;
end;
$$;
revoke all on function reject_inventory_request(uuid, text) from public;
revoke execute on function reject_inventory_request(uuid, text) from anon;
grant execute on function reject_inventory_request(uuid, text) to authenticated;

-- Director or an assigned guard at the issuing location: issues
-- stock against an approved request line, atomically decrementing the
-- balance and posting one immutable transaction row. Raises rather than
-- allowing negative stock. Returns whether this call actually applied the
-- issue — false means a retried call with the same p_idempotency_key was
-- recognized as a duplicate and safely skipped; callers must not re-send
-- notifications/audit entries for a skipped call.
create or replace function issue_inventory_stock(
  p_request_item_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_notes text default '',
  p_idempotency_key uuid default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  caller_role public.user_role;
  ritem record;
  prev numeric;
  new_fulfilled numeric;
  all_done boolean;
  any_done boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  if p_idempotency_key is not null and exists (
    select 1 from public.inventory_transactions where idempotency_key = p_idempotency_key
  ) then
    return false;
  end if;

  caller_role := public.get_my_role();

  select ri.*, r.status as request_status, r.requesting_location_id
    into ritem
    from public.inventory_request_items ri
    join public.inventory_requests r on r.id = ri.request_id
    where ri.id = p_request_item_id;
  if not found then raise exception 'Request line not found'; end if;
  -- 'PartiallyFulfilled' must be allowed here, not just 'Approved' /
  -- 'PartiallyApproved': issuing stock against any one item line flips the
  -- whole request to 'PartiallyFulfilled' (see the status update at the
  -- end of this function), so without it the very next issue call — same
  -- line's remaining quantity, or a different item line — would wrongly
  -- be rejected. Found live: issuing 12 of 30 approved units moved the
  -- request to PartiallyFulfilled, then issuing the remaining 18 failed
  -- with "must be approved" even though stock and approval both allowed it.
  if ritem.request_status not in ('Approved', 'PartiallyApproved', 'PartiallyFulfilled') then
    raise exception 'Request must be approved before stock can be issued';
  end if;

  -- IS DISTINCT FROM, not <>: if auth.uid() doesn't match any profiles row
  -- (e.g. a deleted account with a still-valid JWT), get_my_role() returns
  -- NULL, and NULL <> 'director' is NULL — `if NULL then` is treated as
  -- false in plpgsql, which would silently skip this whole check. IS
  -- DISTINCT FROM treats NULL as "not equal", closing that gap.
  if caller_role is distinct from 'director' and not exists (
    select 1 from public.inventory_location_staff
      where location_id = p_location_id and user_id = uid
  ) then
    raise exception 'You are not assigned to this location';
  end if;

  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  if ritem.fulfilled_qty + p_quantity > coalesce(ritem.approved_qty, 0) then
    raise exception 'Cannot issue more than the approved quantity';
  end if;

  select available_qty into prev from public.inventory_stock
    where item_id = ritem.item_id and location_id = p_location_id
    for update;
  if prev is null or prev < p_quantity then
    raise exception 'Insufficient stock at this location';
  end if;

  update public.inventory_stock
    set available_qty = prev - p_quantity, updated_at = now()
    where item_id = ritem.item_id and location_id = p_location_id;

  insert into public.inventory_transactions
    (item_id, location_id, quantity, transaction_type, related_request_id, performed_by, approved_by, notes, previous_balance, new_balance, idempotency_key)
  values
    (ritem.item_id, p_location_id, p_quantity, 'issued', ritem.request_id, uid, uid, p_notes, prev, prev - p_quantity, p_idempotency_key);

  new_fulfilled := ritem.fulfilled_qty + p_quantity;
  update public.inventory_request_items set fulfilled_qty = new_fulfilled where id = p_request_item_id;

  select bool_and(fulfilled_qty >= coalesce(approved_qty, requested_qty)),
         bool_or(fulfilled_qty > 0)
    into all_done, any_done
    from public.inventory_request_items where request_id = ritem.request_id;

  update public.inventory_requests
    set status = case when all_done then 'Fulfilled' when any_done then 'PartiallyFulfilled' else status end,
        updated_at = now()
    where id = ritem.request_id;

  return true;
end;
$$;
-- The 4-arg signature (before p_idempotency_key existed) is superseded;
-- drop it so PostgREST doesn't expose two overloads of the same RPC name.
drop function if exists issue_inventory_stock(uuid, uuid, numeric, text);
revoke all on function issue_inventory_stock(uuid, uuid, numeric, text, uuid) from public;
revoke execute on function issue_inventory_stock(uuid, uuid, numeric, text, uuid) from anon;
grant execute on function issue_inventory_stock(uuid, uuid, numeric, text, uuid) to authenticated;

-- ─────────────────────────────────────────────
-- Storage bucket for inventory item photos
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
  values ('inventory-photos', 'inventory-photos', false, 5242880)
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "inventory_photos_upload" on storage.objects;
drop policy if exists "inventory_photos_download" on storage.objects;
drop policy if exists "inventory_photos_delete" on storage.objects;

-- Objects stored under "<item-id>/<uuid>.jpg" — director manages the
-- catalog, so upload/delete is director-only; any inventory role can view.
create policy "inventory_photos_upload" on storage.objects
  for insert with check (
    bucket_id = 'inventory-photos'
    and (select public.get_my_role()) = 'director'
  );

create policy "inventory_photos_download" on storage.objects
  for select using (
    bucket_id = 'inventory-photos'
    and (
      (select public.get_my_role()) = 'director'
      or exists (select 1 from public.inventory_location_staff where user_id = (select auth.uid()) and active)
    )
  );

create policy "inventory_photos_delete" on storage.objects
  for delete using (
    bucket_id = 'inventory-photos'
    and (select public.get_my_role()) = 'director'
  );

-- ─────────────────────────────────────────────
-- Starter reference data — directors can add more later via the Inventory
-- module UI; these seed the suggested lists from the product spec so the
-- catalog isn't empty on first use.
-- ─────────────────────────────────────────────
insert into inventory_units (name, abbreviation) values
  ('Piece', 'pc'), ('Packet', 'pkt'), ('Box', 'box'), ('Set', 'set'),
  ('Kilogram', 'kg'), ('Gram', 'g'), ('Litre', 'L'), ('Millilitre', 'mL'),
  ('Metre', 'm'), ('Roll', 'roll'), ('Dozen', 'dz'), ('Other', '')
on conflict (name) do nothing;

insert into inventory_categories (name) values
  ('Toiletries'), ('Linen'), ('Bedding'), ('Groceries'),
  ('Housekeeping supplies'), ('Kitchen supplies'), ('Room appliances'),
  ('Utensils'), ('Maintenance materials'), ('Office supplies'),
  ('Safety equipment'), ('Other')
on conflict (name) do nothing;

-- ═════════════════════════════════════════════
-- Hospitality Inventory Management module — Phase 2
-- (Procurement + batch/expiry tracking + reports)
--
-- Adds the two data sources the Phase 1 comment above named as still
-- missing, plus the reports that depend on them: purchases (procurement)
-- and per-batch expiry tracking. Transfers, true point-of-use consumption/
-- return/damage recording, and offline drafts remain out of scope for this
-- phase — still reserved by inventory_transactions.source_location_id/
-- destination_location_id and the inventory_transaction_type comment below.
-- ═════════════════════════════════════════════

-- Only the value Phase 2 actually produces. transfer/consumption/return/
-- damage/adjustment are added the same way when those later phases land.
alter type inventory_transaction_type add value if not exists 'purchase_receipt';
commit;

-- Re-deploy with an optional per-item note accepted and stored — the
-- catalog launched empty (no starter items were ever seeded, only
-- categories/units), which blocked raising any request at all. The client
-- now offers a reserved "Other / not listed" catalog item alongside real
-- ones; picking it reveals a free-text field for what's actually needed,
-- carried through in this per-line `notes` column (already existed on
-- inventory_request_items, just never written to). Backward compatible —
-- item->>'notes' is optional, existing callers omitting it still work.
-- Signature/return type unchanged, so plain CREATE OR REPLACE applies.
create or replace function create_inventory_request(
  p_requesting_location_id uuid,
  p_items jsonb,
  p_required_by_date date default null,
  p_priority task_priority default 'Medium',
  p_reason text default ''
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_request_id uuid;
  item jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if (select public.get_my_role()) is distinct from 'director' and not exists (
    select 1 from public.inventory_location_staff
    where location_id = p_requesting_location_id and user_id = uid and active
  ) then
    raise exception 'You are not assigned to this location';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A request must include at least one item';
  end if;

  insert into public.inventory_requests (requesting_location_id, requested_by, required_by_date, priority, reason)
    values (p_requesting_location_id, uid, p_required_by_date, coalesce(p_priority, 'Medium'), coalesce(p_reason, ''))
    returning id into v_request_id;

  for item in select * from jsonb_array_elements(p_items) loop
    insert into public.inventory_request_items (request_id, item_id, requested_qty, notes)
      values (v_request_id, (item->>'item_id')::uuid, (item->>'requested_qty')::numeric, coalesce(item->>'notes', ''));
  end loop;

  return v_request_id;
end;
$$;
revoke all on function create_inventory_request(uuid, jsonb, date, task_priority, text) from public;
revoke execute on function create_inventory_request(uuid, jsonb, date, task_priority, text) from anon;
grant execute on function create_inventory_request(uuid, jsonb, date, task_priority, text) to authenticated;

create table if not exists inventory_purchases (
  id             uuid primary key default uuid_generate_v4(),
  location_id    uuid not null references inventory_locations(id) on delete restrict,
  supplier_name  text not null default '',
  invoice_number text,
  purchase_date  date not null,
  notes          text not null default '',
  created_by     uuid not null references profiles(id) on delete restrict,
  created_at     timestamptz not null default now()
);

-- Optional client-supplied idempotency key, same convention/purpose as
-- inventory_transactions.idempotency_key — a retried post_inventory_purchase
-- call after a perceived timeout must not double-post a whole purchase.
alter table inventory_purchases add column if not exists idempotency_key uuid;
create unique index if not exists inventory_purchases_idempotency_key_uniq
  on inventory_purchases(idempotency_key) where idempotency_key is not null;

do $$ begin
  alter table inventory_purchases add constraint inventory_purchases_supplier_len check (char_length(supplier_name) <= 200);
exception when duplicate_object then null; end $$;

-- Same pattern as inventory_request_id on this table (Phase 1): a nullable
-- FK so logInventoryAction() can attribute a purchase-recording entry to
-- the actual purchase row, not just free-text detail.
alter table audit_log add column if not exists inventory_purchase_id uuid references inventory_purchases(id) on delete set null;
create index if not exists audit_log_inventory_purchase_id_idx on audit_log(inventory_purchase_id) where inventory_purchase_id is not null;

-- No unique(purchase_id, item_id): unlike a request, a single delivery can
-- legitimately contain the same item twice under two different batches/
-- expiry dates (e.g. topping up an existing batch plus a fresh one in the
-- same drop).
create table if not exists inventory_purchase_items (
  id           uuid primary key default uuid_generate_v4(),
  purchase_id  uuid not null references inventory_purchases(id) on delete cascade,
  item_id      uuid not null references inventory_items(id) on delete restrict,
  quantity     numeric not null check (quantity > 0),
  unit_cost    numeric check (unit_cost is null or unit_cost >= 0),
  batch_number text,
  expiry_date  date,
  notes        text not null default ''
);

-- Per-batch remaining quantity, populated only for items with
-- track_batch/track_expiry (inventory_items) — items that don't opt into
-- batch tracking keep flowing straight into the aggregate inventory_stock
-- row only, same as Phase 1. issue_inventory_stock (redeployed below)
-- depletes these FEFO (soonest expiry first) when they exist.
create table if not exists inventory_batches (
  id                 uuid primary key default uuid_generate_v4(),
  item_id            uuid not null references inventory_items(id) on delete restrict,
  location_id        uuid not null references inventory_locations(id) on delete restrict,
  batch_number       text,
  expiry_date        date,
  received_qty       numeric not null check (received_qty > 0),
  remaining_qty      numeric not null check (remaining_qty >= 0),
  source_purchase_id uuid references inventory_purchases(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists inventory_purchases_location_id_idx on inventory_purchases(location_id);
create index if not exists inventory_purchase_items_purchase_id_idx on inventory_purchase_items(purchase_id);
create index if not exists inventory_batches_item_location_idx on inventory_batches(item_id, location_id);
create index if not exists inventory_batches_expiry_idx on inventory_batches(expiry_date) where remaining_qty > 0;

-- ─────────────────────────────────────────────
-- Phase 2 RLS — same shape as inventory_stock/inventory_transactions:
-- director full read, location staff read-only via
-- get_my_inventory_location_ids(). No insert/update/delete policy on any
-- of the three tables — all writes happen inside post_inventory_purchase
-- (SECURITY DEFINER), same discipline as the immutable ledger.
-- ─────────────────────────────────────────────
alter table inventory_purchases enable row level security;
alter table inventory_purchase_items enable row level security;
alter table inventory_batches enable row level security;

drop policy if exists "inventory_purchases_director" on inventory_purchases;
create policy "inventory_purchases_director" on inventory_purchases
  for select using ((select get_my_role()) = 'director');
drop policy if exists "inventory_purchases_staff_read" on inventory_purchases;
create policy "inventory_purchases_staff_read" on inventory_purchases
  for select using (location_id = any ((select get_my_inventory_location_ids())::uuid[]));

drop policy if exists "inventory_purchase_items_director" on inventory_purchase_items;
create policy "inventory_purchase_items_director" on inventory_purchase_items
  for select using ((select get_my_role()) = 'director');
drop policy if exists "inventory_purchase_items_staff_read" on inventory_purchase_items;
create policy "inventory_purchase_items_staff_read" on inventory_purchase_items
  for select using (
    exists (
      select 1 from inventory_purchases p
      where p.id = inventory_purchase_items.purchase_id
        and p.location_id = any ((select get_my_inventory_location_ids())::uuid[])
    )
  );

drop policy if exists "inventory_batches_director" on inventory_batches;
create policy "inventory_batches_director" on inventory_batches
  for select using ((select get_my_role()) = 'director');
drop policy if exists "inventory_batches_staff_read" on inventory_batches;
create policy "inventory_batches_staff_read" on inventory_batches
  for select using (location_id = any ((select get_my_inventory_location_ids())::uuid[]));

-- ─────────────────────────────────────────────
-- post_inventory_purchase — records a delivery: one purchase header, one
-- row per line item, an inventory_transactions ledger entry per line
-- (transaction_type = 'purchase_receipt'), and — only for items with
-- track_batch/track_expiry — one inventory_batches row per line. Modeled
-- directly on post_opening_balance (same upsert-then-lock-then-add stock
-- pattern, same idempotency-key convention) but callable by location staff
-- (like issue_inventory_stock), not director-only — recording a delivery
-- is a routine location-level action, unlike posting a system opening
-- balance.
-- p_items shape: [{"item_id":uuid,"quantity":numeric,"unit_cost":numeric|null,
--                   "batch_number":text|null,"expiry_date":"YYYY-MM-DD"|null}, ...]
-- ─────────────────────────────────────────────
-- Returns the new purchase's id, or null if a retried call with the same
-- p_idempotency_key was recognized as a duplicate and safely skipped (a
-- uuid return, not boolean, since — unlike post_opening_balance/
-- issue_inventory_stock, which mutate a row the caller already knows the
-- id of — this RPC creates a brand-new inventory_purchases row, and the
-- caller needs its id back to attribute the audit-log entry to it).
create or replace function post_inventory_purchase(
  p_location_id uuid,
  p_supplier_name text,
  p_invoice_number text,
  p_purchase_date date,
  p_notes text,
  p_items jsonb,
  p_idempotency_key uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  caller_role public.user_role;
  v_purchase_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_batch_number text;
  v_expiry_date date;
  v_item_active boolean;
  v_track_batch boolean;
  v_track_expiry boolean;
  prev numeric;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  if p_idempotency_key is not null and exists (
    select 1 from public.inventory_purchases where idempotency_key = p_idempotency_key
  ) then
    return null;
  end if;

  caller_role := public.get_my_role();
  if caller_role is distinct from 'director' and not exists (
    select 1 from public.inventory_location_staff
      where location_id = p_location_id and user_id = uid and active
  ) then
    raise exception 'You are not assigned to this location';
  end if;

  if p_purchase_date is null then raise exception 'Purchase date is required'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A purchase must have at least one item';
  end if;

  insert into public.inventory_purchases
    (location_id, supplier_name, invoice_number, purchase_date, notes, created_by, idempotency_key)
  values
    (p_location_id, coalesce(p_supplier_name, ''), p_invoice_number, p_purchase_date, coalesce(p_notes, ''), uid, p_idempotency_key)
  returning id into v_purchase_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item ->> 'item_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit_cost := nullif(v_item ->> 'unit_cost', '')::numeric;
    v_batch_number := nullif(v_item ->> 'batch_number', '');
    v_expiry_date := nullif(v_item ->> 'expiry_date', '')::date;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Each purchase line must have a positive quantity';
    end if;

    select active, track_batch, track_expiry into v_item_active, v_track_batch, v_track_expiry
      from public.inventory_items where id = v_item_id;
    if v_item_active is not true then
      raise exception 'Cannot record a purchase for an inactive item';
    end if;

    insert into public.inventory_stock (item_id, location_id, available_qty)
      values (v_item_id, p_location_id, 0)
    on conflict (item_id, location_id) do nothing;

    select available_qty into prev from public.inventory_stock
      where item_id = v_item_id and location_id = p_location_id
      for update;

    update public.inventory_stock
      set available_qty = prev + v_quantity, updated_at = now()
      where item_id = v_item_id and location_id = p_location_id;

    insert into public.inventory_transactions
      (item_id, location_id, quantity, transaction_type, related_request_id, performed_by, notes, previous_balance, new_balance)
    values
      (v_item_id, p_location_id, v_quantity, 'purchase_receipt', null, uid, p_notes, prev, prev + v_quantity);

    insert into public.inventory_purchase_items
      (purchase_id, item_id, quantity, unit_cost, batch_number, expiry_date, notes)
    values
      (v_purchase_id, v_item_id, v_quantity, v_unit_cost, v_batch_number, v_expiry_date, '');

    if v_track_batch or v_track_expiry then
      insert into public.inventory_batches
        (item_id, location_id, batch_number, expiry_date, received_qty, remaining_qty, source_purchase_id)
      values
        (v_item_id, p_location_id, v_batch_number, v_expiry_date, v_quantity, v_quantity, v_purchase_id);
    end if;
  end loop;

  return v_purchase_id;
end;
$$;
revoke all on function post_inventory_purchase(uuid, text, text, date, text, jsonb, uuid) from public;
revoke execute on function post_inventory_purchase(uuid, text, text, date, text, jsonb, uuid) from anon;
grant execute on function post_inventory_purchase(uuid, text, text, date, text, jsonb, uuid) to authenticated;

-- Bug found writing the Phase 2 test suite (never previously exercised —
-- Phase 1 shipped with zero inventory test coverage): issue_inventory_stock
-- is deliberately callable by a non-director assigned location guard, but
-- its own internal updates to inventory_request_items.fulfilled_qty and
-- inventory_requests.status are guarded by these two triggers below, which
-- block exactly that for any non-director caller. SECURITY DEFINER does
-- NOT make a function's writes trusted here — that only exempts *table
-- grants*/RLS (the table owner bypasses RLS), not a plpgsql trigger's own
-- get_my_role() check, which still resolves the real calling session's
-- role regardless of nesting. The schema comment on the original triggers
-- (Phase 1) claiming approve/reject_inventory_request "bypass this
-- trigger... by running as the table owner" was really just describing
-- that those two RPCs happen to already be director-only at their own top
-- level, not an actual bypass mechanism — issue_inventory_stock has no
-- such luck, since it's intentionally non-director-callable. Net effect in
-- production: no non-director staff member could ever successfully
-- complete an "issue stock" call — the RPC silently failed on its own
-- second write, after already decrementing inventory_stock, for anyone but
-- a director.
--
-- Fix: a transaction-local trusted flag, set only for the instant around
-- each of the two guarded writes, inside the one RPC intentionally allowed
-- to make them non-director. A direct client UPDATE (bypassing the RPC)
-- never sets this flag, so it's still blocked exactly as before — this
-- narrows the trigger's exemption to "written by this specific already-
-- self-authorizing RPC," not "any write in any transaction."
create or replace function enforce_inventory_request_staff_update()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if public.get_my_role() <> 'director'
     and coalesce(current_setting('app.inventory_rpc_trusted', true), 'false') <> 'true' then
    if new.status not in ('Draft', 'Submitted', 'Cancelled') then
      raise exception 'Only a director can approve, reject, or fulfil a request';
    end if;
    if new.reject_reason is distinct from old.reject_reason then
      raise exception 'Only a director can set a rejection reason';
    end if;
  end if;
  return new;
end;
$$;

create or replace function enforce_inventory_request_item_staff_update()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if public.get_my_role() <> 'director'
     and coalesce(current_setting('app.inventory_rpc_trusted', true), 'false') <> 'true'
     and (new.approved_qty is distinct from old.approved_qty
          or new.fulfilled_qty is distinct from old.fulfilled_qty) then
    raise exception 'Only a director can set approved/fulfilled quantities';
  end if;
  return new;
end;
$$;

-- Re-deploy with FEFO batch depletion added and the trusted-flag bracket
-- around its two guarded writes (see comment above) — everything else is
-- byte-identical to the Phase 1 version.
create or replace function issue_inventory_stock(
  p_request_item_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_notes text default '',
  p_idempotency_key uuid default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  caller_role public.user_role;
  ritem record;
  prev numeric;
  new_fulfilled numeric;
  all_done boolean;
  any_done boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  if p_idempotency_key is not null and exists (
    select 1 from public.inventory_transactions where idempotency_key = p_idempotency_key
  ) then
    return false;
  end if;

  caller_role := public.get_my_role();

  select ri.*, r.status as request_status, r.requesting_location_id
    into ritem
    from public.inventory_request_items ri
    join public.inventory_requests r on r.id = ri.request_id
    where ri.id = p_request_item_id;
  if not found then raise exception 'Request line not found'; end if;
  if ritem.request_status not in ('Approved', 'PartiallyApproved', 'PartiallyFulfilled') then
    raise exception 'Request must be approved before stock can be issued';
  end if;

  if caller_role is distinct from 'director' and not exists (
    select 1 from public.inventory_location_staff
      where location_id = p_location_id and user_id = uid
  ) then
    raise exception 'You are not assigned to this location';
  end if;

  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  if ritem.fulfilled_qty + p_quantity > coalesce(ritem.approved_qty, 0) then
    raise exception 'Cannot issue more than the approved quantity';
  end if;

  select available_qty into prev from public.inventory_stock
    where item_id = ritem.item_id and location_id = p_location_id
    for update;
  if prev is null or prev < p_quantity then
    raise exception 'Insufficient stock at this location';
  end if;

  update public.inventory_stock
    set available_qty = prev - p_quantity, updated_at = now()
    where item_id = ritem.item_id and location_id = p_location_id;

  -- FEFO batch depletion (Phase 2): only when the item opts into batch/
  -- expiry tracking AND already has at least one batch row here — an item
  -- flagged track_batch/track_expiry with zero batch rows predates Phase 2
  -- (its stock was posted before batching existed), so it silently falls
  -- back to aggregate-only, same as before this phase. Batches are
  -- depleted soonest-expiry-first; if they under-cover the issued quantity
  -- (drift between the aggregate and the batch breakdown), depletion is
  -- clamped at zero rather than raising — a data-hygiene gap here must not
  -- block a routine issue that the aggregate stock check above already
  -- proved is valid.
  if exists (
    select 1 from public.inventory_items
      where id = ritem.item_id and (track_batch or track_expiry)
  ) and exists (
    select 1 from public.inventory_batches
      where item_id = ritem.item_id and location_id = p_location_id
  ) then
    declare
      v_remaining_to_deplete numeric := p_quantity;
      v_batch record;
      v_take numeric;
    begin
      for v_batch in
        select id, remaining_qty from public.inventory_batches
          where item_id = ritem.item_id and location_id = p_location_id and remaining_qty > 0
          order by expiry_date asc nulls last, created_at asc
          for update
      loop
        exit when v_remaining_to_deplete <= 0;
        v_take := least(v_batch.remaining_qty, v_remaining_to_deplete);
        update public.inventory_batches set remaining_qty = remaining_qty - v_take where id = v_batch.id;
        v_remaining_to_deplete := v_remaining_to_deplete - v_take;
      end loop;
    end;
  end if;

  insert into public.inventory_transactions
    (item_id, location_id, quantity, transaction_type, related_request_id, performed_by, approved_by, notes, previous_balance, new_balance, idempotency_key)
  values
    (ritem.item_id, p_location_id, p_quantity, 'issued', ritem.request_id, uid, uid, p_notes, prev, prev - p_quantity, p_idempotency_key);

  new_fulfilled := ritem.fulfilled_qty + p_quantity;
  -- Trusted-flag bracket (see the redeploy comment above the two trigger
  -- functions preceding this one) — narrowly scoped to just these two
  -- writes, cleared immediately after, so nothing else in the caller's
  -- transaction is ever treated as trusted.
  perform set_config('app.inventory_rpc_trusted', 'true', true);
  update public.inventory_request_items set fulfilled_qty = new_fulfilled where id = p_request_item_id;

  select bool_and(fulfilled_qty >= coalesce(approved_qty, requested_qty)),
         bool_or(fulfilled_qty > 0)
    into all_done, any_done
    from public.inventory_request_items where request_id = ritem.request_id;

  update public.inventory_requests
    set status = case when all_done then 'Fulfilled' when any_done then 'PartiallyFulfilled' else status end,
        updated_at = now()
    where id = ritem.request_id;
  perform set_config('app.inventory_rpc_trusted', 'false', true);

  return true;
end;
$$;
revoke all on function issue_inventory_stock(uuid, uuid, numeric, text, uuid) from public;
revoke execute on function issue_inventory_stock(uuid, uuid, numeric, text, uuid) from anon;
grant execute on function issue_inventory_stock(uuid, uuid, numeric, text, uuid) to authenticated;

-- ─────────────────────────────────────────────
-- Reports: issuance-trend aggregate view. security_invoker = true so RLS on
-- the underlying inventory_transactions applies as the querying user, same
-- reasoning as task_dashboard_stats above. Named "issued", not
-- "consumption": Phase 1/2 only track stock leaving central inventory for
-- a location, not final point-of-use consumption at that location (that's
-- a separately-reserved later phase) — the UI must label this honestly.
-- ─────────────────────────────────────────────
create or replace view inventory_issued_monthly
  with (security_invoker = true) as
  select
    item_id,
    location_id,
    date_trunc('month', created_at)::date as month,
    sum(quantity) as issued_qty
  from inventory_transactions
  where transaction_type = 'issued'
  group by item_id, location_id, date_trunc('month', created_at);

grant select on inventory_issued_monthly to authenticated;

-- ─────────────────────────────────────────────
-- Optional photo attachments on a stock request — mirrors incident_photos
-- (same columns, same compress-client-side-then-upload convention, see
-- src/lib/inventoryRequestPhotos.ts) but scoped by the inventory module's
-- own ownership model: any active staff member at the request's
-- *location* (get_my_inventory_location_ids()), not just the specific
-- person who filed it — same as inventory_request_items' own RLS just
-- below, not incidents' reported_by-only pattern. Useful for "Other / not
-- listed" lines especially — a photo of what's actually needed.
-- ─────────────────────────────────────────────
create table if not exists inventory_request_photos (
  id          uuid primary key default uuid_generate_v4(),
  request_id  uuid not null references inventory_requests(id) on delete cascade,
  uploaded_by uuid not null references profiles(id) on delete restrict,
  path        text not null,
  size        bigint not null default 0,
  mime_type   text not null default 'image/jpeg',
  created_at  timestamptz not null default now()
);
create index if not exists inventory_request_photos_request_id_idx on inventory_request_photos(request_id);

alter table inventory_request_photos enable row level security;

drop policy if exists "inventory_request_photos_director" on inventory_request_photos;
create policy "inventory_request_photos_director" on inventory_request_photos
  for all using ((select get_my_role()) = 'director');

drop policy if exists "inventory_request_photos_staff_read" on inventory_request_photos;
create policy "inventory_request_photos_staff_read" on inventory_request_photos
  for select using (
    exists (
      select 1 from inventory_requests req
      where req.id = inventory_request_photos.request_id
        and req.requesting_location_id = any ((select get_my_inventory_location_ids())::uuid[])
    )
  );

drop policy if exists "inventory_request_photos_staff_insert" on inventory_request_photos;
create policy "inventory_request_photos_staff_insert" on inventory_request_photos
  for insert with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from inventory_requests req
      where req.id = inventory_request_photos.request_id
        and req.requesting_location_id = any ((select get_my_inventory_location_ids())::uuid[])
    )
  );

drop policy if exists "inventory_request_photos_staff_delete" on inventory_request_photos;
create policy "inventory_request_photos_staff_delete" on inventory_request_photos
  for delete using (
    exists (
      select 1 from inventory_requests req
      where req.id = inventory_request_photos.request_id
        and req.requesting_location_id = any ((select get_my_inventory_location_ids())::uuid[])
    )
  );

-- Private bucket, 5 MB hard cap — same convention as incident-photos.
insert into storage.buckets (id, name, public, file_size_limit)
  values ('inventory-request-photos', 'inventory-request-photos', false, 5242880)
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "inventory_request_photos_upload" on storage.objects;
drop policy if exists "inventory_request_photos_download" on storage.objects;
drop policy if exists "inventory_request_photos_object_delete" on storage.objects;

-- Objects stored under "<request-id>/<uuid>.jpg" — the EXISTS subquery
-- runs under the caller's own inventory_requests visibility, so upload/
-- download/delete all follow the same location-staff scoping as the
-- table policies above (same technique as incident-photos/task-attachments).
create policy "inventory_request_photos_upload" on storage.objects
  for insert with check (
    bucket_id = 'inventory-request-photos'
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.inventory_requests req
      where req.id::text = (storage.foldername(name))[1]
        and (
          (select public.get_my_role()) = 'director'
          or req.requesting_location_id = any ((select public.get_my_inventory_location_ids())::uuid[])
        )
    )
  );

create policy "inventory_request_photos_download" on storage.objects
  for select using (
    bucket_id = 'inventory-request-photos'
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.inventory_requests req
      where req.id::text = (storage.foldername(name))[1]
        and (
          (select public.get_my_role()) = 'director'
          or req.requesting_location_id = any ((select public.get_my_inventory_location_ids())::uuid[])
        )
    )
  );

create policy "inventory_request_photos_object_delete" on storage.objects
  for delete using (
    bucket_id = 'inventory-request-photos'
    and exists (
      select 1 from public.inventory_requests req
      where req.id::text = (storage.foldername(name))[1]
        and (
          (select public.get_my_role()) = 'director'
          or req.requesting_location_id = any ((select public.get_my_inventory_location_ids())::uuid[])
        )
    )
  );

-- ═════════════════════════════════════════════
-- Task Groups & Recurring Assignments — Phase 1
-- ═════════════════════════════════════════════
-- Persistent group layer on top of the existing tasks table. Additive
-- only: no existing table is dropped/rewritten, no existing column
-- changes type or nullability, no existing row is touched, batch_id is
-- unaffected. See the architecture note at the top of this section for
-- how this differs from batch_id (batch_id: frozen at creation, no
-- membership/recurrence/discussion; a Task Group: persistent roster,
-- reusable across many assignments, backs task_series, has its own
-- discussion, computes live progress).
--
-- Design decisions, so a future edit doesn't accidentally re-litigate
-- them without noticing they were deliberate:
--  - "Private task discussion" is NOT a task_conversations row — it's the
--    EXISTING `comments` table + CommentThread.tsx, unchanged. That
--    already is exactly a per-task discussion, already correctly RLS-
--    scoped, already has realtime. task_conversation_type therefore only
--    has 'group' and 'occurrence', not 'task_private'.
--  - An occurrence's member snapshot is NOT a separate table. The `tasks`
--    rows fanned out for it (occurrence_id + assignee_id, values copied
--    at creation time) ARE the snapshot — nothing about a past occurrence
--    is ever re-derived from the (possibly since-edited) group/series.
--  - A "coordinator" is a task_group_members.membership_role value, not a
--    separate table/column — a group can have zero or several.
--  - Range officer group authority requires task_groups.range_id to be
--    non-null AND in the officer's range set — a null-range group (e.g. a
--    reserve-wide Tiger Cell group) is director-only.
--  - task_series/task_occurrences exist as tables in Phase 1 so
--    tasks.series_id/occurrence_id have somewhere to point, but Phase 1
--    ships no recurrence UI and creates no series rows — see Phase 2.

do $$ begin
  create type task_group_type as enum ('permanent', 'temporary');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_group_status as enum ('active', 'paused', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type group_membership_role as enum ('member', 'coordinator');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_series_status as enum ('draft', 'active', 'paused', 'ended', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_series_recurrence as enum ('daily', 'weekly', 'weekdays', 'monthly', 'custom_interval');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_occurrence_status as enum ('scheduled', 'active', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_conversation_type as enum ('group', 'occurrence');
exception when duplicate_object then null; end $$;

alter type notification_type add value if not exists 'group_task_assigned';
alter type notification_type add value if not exists 'group_announcement';
commit;

-- ─────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────
create table if not exists task_groups (
  id               uuid primary key default uuid_generate_v4(),
  name             text not null,
  description      text not null default '',
  group_type       task_group_type not null,
  range_id         uuid references ranges(id) on delete set null,
  created_by       uuid not null references profiles(id) on delete restrict,
  status           task_group_status not null default 'active',
  auto_archive     boolean not null default false,
  archive_after_date date,
  members_can_reply boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz
);

create table if not exists task_group_members (
  id             uuid primary key default uuid_generate_v4(),
  group_id       uuid not null references task_groups(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete restrict,
  membership_role group_membership_role not null default 'member',
  active         boolean not null default true,
  joined_at      timestamptz not null default now(),
  removed_at     timestamptz,
  added_by       uuid not null references profiles(id) on delete restrict
);

create unique index if not exists task_group_members_active_uq
  on task_group_members(group_id, user_id) where active;

create table if not exists task_series (
  id                   uuid primary key default uuid_generate_v4(),
  group_id             uuid not null references task_groups(id) on delete cascade,
  title                text not null,
  description          text not null default '',
  category             task_category not null default 'Patrol',
  priority             task_priority not null default 'Medium',
  evidence_requirements text not null default '',
  recurrence_type      task_series_recurrence not null,
  recurrence_rule      jsonb not null default '{}'::jsonb,
  start_date           date not null,
  end_date             date,
  creation_time        time not null default '06:00',
  due_offset_days      int not null default 1,
  status               task_series_status not null default 'draft',
  created_by           uuid not null references profiles(id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Added in Phase 2 (recurring series) — NOT NULL is safe as a direct add
-- because this table shipped in Phase 1 with no UI to create rows in it,
-- so it is guaranteed empty on every database this migration runs against.
-- Required rather than defaulted from the group/member the way the
-- one-time create_group_occurrence RPC's p_range_id is: the generator
-- below runs unattended (no caller to prompt), so the range a recurring
-- series' tasks belong to must be pinned at series-creation time, not
-- guessed per member or left to the group's own (possibly null,
-- reserve-wide) range_id.
alter table task_series add column if not exists range_id uuid not null references ranges(id) on delete restrict;

create table if not exists task_occurrences (
  id              uuid primary key default uuid_generate_v4(),
  group_id        uuid not null references task_groups(id) on delete cascade,
  series_id       uuid references task_series(id) on delete set null,
  title           text not null,
  description     text not null default '',
  category        task_category not null default 'Patrol',
  priority        task_priority not null default 'Medium',
  scheduled_start timestamptz not null default now(),
  due_at          timestamptz not null,
  status          task_occurrence_status not null default 'scheduled',
  created_by      uuid not null references profiles(id) on delete restrict,
  created_at      timestamptz not null default now(),
  cancelled_at    timestamptz,
  completed_at    timestamptz
);

create unique index if not exists task_occurrences_series_due_uq
  on task_occurrences(series_id, due_at) where series_id is not null;

create table if not exists task_conversations (
  id             uuid primary key default uuid_generate_v4(),
  type           task_conversation_type not null,
  group_id       uuid references task_groups(id) on delete cascade,
  occurrence_id  uuid references task_occurrences(id) on delete cascade,
  created_at     timestamptz not null default now(),
  constraint task_conversations_target_chk check (
    (type = 'group' and group_id is not null and occurrence_id is null) or
    (type = 'occurrence' and occurrence_id is not null)
  )
);
create unique index if not exists task_conversations_group_uq
  on task_conversations(group_id) where type = 'group';
create unique index if not exists task_conversations_occurrence_uq
  on task_conversations(occurrence_id) where type = 'occurrence';

create table if not exists task_messages (
  id              uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references task_conversations(id) on delete cascade,
  sender_id       uuid not null references profiles(id) on delete restrict,
  body            text not null,
  attachment_path text,
  reply_to_id     uuid references task_messages(id) on delete set null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  redacted_at     timestamptz,
  redacted_by     uuid references profiles(id) on delete set null
);

create table if not exists task_message_reads (
  message_id uuid not null references task_messages(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Existing tasks table — additive only.
alter table tasks add column if not exists group_id      uuid references task_groups(id) on delete set null;
alter table tasks add column if not exists series_id     uuid references task_series(id) on delete set null;
alter table tasks add column if not exists occurrence_id uuid references task_occurrences(id) on delete set null;

create unique index if not exists tasks_occurrence_assignee_uq
  on tasks(occurrence_id, assignee_id) where occurrence_id is not null;

-- ─────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────
create index if not exists task_groups_range_id_idx on task_groups(range_id);
create index if not exists task_groups_status_idx on task_groups(status);
create index if not exists task_group_members_group_id_idx on task_group_members(group_id);
create index if not exists task_group_members_user_id_idx on task_group_members(user_id) where active;
create index if not exists task_series_group_id_idx on task_series(group_id);
create index if not exists task_occurrences_group_id_idx on task_occurrences(group_id);
create index if not exists task_occurrences_status_idx on task_occurrences(status);
create index if not exists task_conversations_group_id_idx on task_conversations(group_id);
create index if not exists task_conversations_occurrence_id_idx on task_conversations(occurrence_id);
create index if not exists task_messages_conversation_id_idx on task_messages(conversation_id, created_at);
create index if not exists tasks_group_id_idx on tasks(group_id);
create index if not exists tasks_occurrence_id_idx on tasks(occurrence_id);

-- ─────────────────────────────────────────────
-- Length limits
-- ─────────────────────────────────────────────
do $$ begin
  alter table task_groups add constraint task_groups_name_len check (char_length(name) <= 200);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table task_groups add constraint task_groups_description_len check (char_length(description) <= 3000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table task_occurrences add constraint task_occurrences_title_len check (char_length(title) <= 300);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table task_messages add constraint task_messages_body_len check (char_length(body) <= 4000);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────
-- RLS helper functions (same profile as get_my_range_ids()/is_task_assignee()
-- above: SECURITY DEFINER, stable, search_path pinned empty). EXECUTE is
-- revoked from BOTH public and anon explicitly — a bare "revoke from
-- public" alone does not remove anon's own direct default-privileges
-- grant in this project (see the note above get_my_inventory_location_ids()).
-- ─────────────────────────────────────────────
create or replace function is_group_member(g_id uuid)
returns boolean language sql security definer stable
set search_path = '' as $$
  select exists (
    select 1 from public.task_group_members
    where group_id = g_id and user_id = auth.uid() and active
  );
$$;

create or replace function is_group_coordinator(g_id uuid)
returns boolean language sql security definer stable
set search_path = '' as $$
  select exists (
    select 1 from public.task_group_members
    where group_id = g_id and user_id = auth.uid() and active and membership_role = 'coordinator'
  );
$$;

create or replace function get_my_group_ids()
returns uuid[] language sql security definer stable
set search_path = '' as $$
  select coalesce(array_agg(group_id), '{}'::uuid[])
  from public.task_group_members where user_id = auth.uid() and active;
$$;

-- A field-role user "participates" in an occurrence iff they (or their
-- co-assignee entry) hold one of the fanned-out member tasks under it.
create or replace function is_occurrence_participant(occ_id uuid)
returns boolean language sql security definer stable
set search_path = '' as $$
  select exists (
    select 1 from public.tasks
    where occurrence_id = occ_id
      and (assignee_id = auth.uid() or public.is_task_assignee(id))
  );
$$;

create or replace function can_officer_manage_group(g_id uuid)
returns boolean language sql security definer stable
set search_path = '' as $$
  select (select public.get_my_role()) = 'range_officer' and exists (
    select 1 from public.task_groups
    where id = g_id and range_id is not null and range_id = any((select public.get_my_range_ids())::uuid[])
  );
$$;

create or replace function can_officer_manage_occurrence(occ_id uuid)
returns boolean language sql security definer stable
set search_path = '' as $$
  select exists (
    select 1 from public.task_occurrences o
    where o.id = occ_id and public.can_officer_manage_group(o.group_id)
  );
$$;

create or replace function can_view_conversation(conv_id uuid)
returns boolean language sql security definer stable
set search_path = '' as $$
  select
    (select public.get_my_role()) = 'director'
    or exists (
      select 1 from public.task_conversations c
      where c.id = conv_id and (
        (c.type = 'group' and (public.can_officer_manage_group(c.group_id) or public.is_group_member(c.group_id)))
        or
        (c.type = 'occurrence' and (public.can_officer_manage_occurrence(c.occurrence_id) or public.is_occurrence_participant(c.occurrence_id)))
      )
    );
$$;

create or replace function can_post_to_conversation(conv_id uuid)
returns boolean language sql security definer stable
set search_path = '' as $$
  select
    (select public.get_my_role()) = 'director'
    or exists (
      select 1 from public.task_conversations c
      where c.id = conv_id and (
        (c.type = 'group' and (
          public.can_officer_manage_group(c.group_id)
          or public.is_group_coordinator(c.group_id)
          or (public.is_group_member(c.group_id) and (select members_can_reply from public.task_groups where id = c.group_id))
        ))
        or
        (c.type = 'occurrence' and (public.can_officer_manage_occurrence(c.occurrence_id) or public.is_occurrence_participant(c.occurrence_id)))
      )
    );
$$;

revoke all on function is_group_member(uuid) from public, anon;
revoke all on function is_group_coordinator(uuid) from public, anon;
revoke all on function get_my_group_ids() from public, anon;
revoke all on function is_occurrence_participant(uuid) from public, anon;
revoke all on function can_officer_manage_group(uuid) from public, anon;
revoke all on function can_officer_manage_occurrence(uuid) from public, anon;
revoke all on function can_view_conversation(uuid) from public, anon;
revoke all on function can_post_to_conversation(uuid) from public, anon;
grant execute on function is_group_member(uuid) to authenticated;
grant execute on function is_group_coordinator(uuid) to authenticated;
grant execute on function get_my_group_ids() to authenticated;
grant execute on function is_occurrence_participant(uuid) to authenticated;
grant execute on function can_officer_manage_group(uuid) to authenticated;
grant execute on function can_officer_manage_occurrence(uuid) to authenticated;
grant execute on function can_view_conversation(uuid) to authenticated;
grant execute on function can_post_to_conversation(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- RLS policies
-- ─────────────────────────────────────────────
alter table task_groups         enable row level security;
alter table task_group_members  enable row level security;
alter table task_series         enable row level security;
alter table task_occurrences    enable row level security;
alter table task_conversations  enable row level security;
alter table task_messages       enable row level security;
alter table task_message_reads  enable row level security;

create policy "task_groups_director" on task_groups
  for all using ((select get_my_role()) = 'director');
create policy "task_groups_officer" on task_groups
  for all using (
    (select get_my_role()) = 'range_officer'
    and range_id is not null
    and range_id = any ((select get_my_range_ids())::uuid[])
  );
create policy "task_groups_member_read" on task_groups
  for select using ((select is_group_member(id)));

create policy "task_group_members_director" on task_group_members
  for all using ((select get_my_role()) = 'director');
-- USING covers managing existing rows in groups within the officer's
-- range (e.g. removing a member). WITH CHECK is stricter for INSERT: the
-- group being in-range is not enough on its own — the member being added
-- must also be one of the officer's own people ("add members only from
-- permitted ranges"), otherwise an officer could staff their group with
-- anyone regardless of where that person is actually posted.
create policy "task_group_members_officer" on task_group_members
  for all using ((select can_officer_manage_group(group_id)))
  with check (
    (select can_officer_manage_group(group_id))
    and exists (
      select 1 from profiles p
      where p.id = user_id
        and p.range_id is not null
        and p.range_id = any ((select get_my_range_ids())::uuid[])
    )
  );
create policy "task_group_members_member_read" on task_group_members
  for select using ((select is_group_member(group_id)));

create policy "task_series_director" on task_series
  for all using ((select get_my_role()) = 'director');
create policy "task_series_officer" on task_series
  for all using ((select can_officer_manage_group(group_id)));
create policy "task_series_member_read" on task_series
  for select using ((select is_group_member(group_id)));

create policy "task_occurrences_director" on task_occurrences
  for all using ((select get_my_role()) = 'director');
create policy "task_occurrences_officer" on task_occurrences
  for all using ((select can_officer_manage_group(group_id)));
create policy "task_occurrences_participant_read" on task_occurrences
  for select using ((select is_occurrence_participant(id)));

create policy "task_conversations_director" on task_conversations
  for all using ((select get_my_role()) = 'director');
create policy "task_conversations_officer" on task_conversations
  for all using (
    (type = 'group' and (select can_officer_manage_group(group_id)))
    or (type = 'occurrence' and (select can_officer_manage_occurrence(occurrence_id)))
  );
create policy "task_conversations_participant_read" on task_conversations
  for select using (
    (type = 'group' and (select is_group_member(group_id)))
    or (type = 'occurrence' and (select is_occurrence_participant(occurrence_id)))
  );

create policy "task_messages_read" on task_messages
  for select using ((select can_view_conversation(conversation_id)));
create policy "task_messages_insert" on task_messages
  for insert with check (
    sender_id = (select auth.uid())
    and (select can_post_to_conversation(conversation_id))
  );
create policy "task_messages_update_own" on task_messages
  for update using (
    sender_id = (select auth.uid()) or (select get_my_role()) = 'director'
  );

create policy "task_message_reads_own" on task_message_reads
  for all using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from task_messages m where m.id = message_id and (select can_view_conversation(m.conversation_id)))
  );

-- ─────────────────────────────────────────────
-- create_group_occurrence — one-time group assignment RPC. Creates the
-- occurrence, its discussion, one task per active member (idempotent via
-- tasks_occurrence_assignee_uq), and one notification per newly-created
-- member task, as a single server-side transaction.
-- ─────────────────────────────────────────────
create or replace function create_group_occurrence(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_category task_category,
  p_priority task_priority,
  p_due_at timestamptz,
  p_range_id uuid
) returns uuid
language plpgsql security definer
set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role := (select role from public.profiles where id = v_actor);
  v_group public.task_groups%rowtype;
  v_occurrence_id uuid;
  v_task_id uuid;
  v_member record;
  v_actor_name text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;
  if p_range_id is null then
    raise exception 'A range is required to create this assignment';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'A title is required';
  end if;

  select * into v_group from public.task_groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'Task group not found';
  end if;
  if v_group.status <> 'active' then
    raise exception 'Cannot create an assignment for a % group', v_group.status;
  end if;

  if v_role = 'director' then
    null;
  elsif v_role = 'range_officer'
    and v_group.range_id is not null
    and v_group.range_id = any((select public.get_my_range_ids())::uuid[]) then
    null;
  else
    raise exception 'Not authorized to create an assignment for this group';
  end if;

  select name into v_actor_name from public.profiles where id = v_actor;

  insert into public.task_occurrences (
    group_id, series_id, title, description, category, priority, scheduled_start, due_at, status, created_by
  ) values (
    p_group_id, null, p_title, coalesce(p_description, ''), p_category, p_priority, now(), p_due_at, 'active', v_actor
  ) returning id into v_occurrence_id;

  insert into public.task_conversations (type, occurrence_id) values ('occurrence', v_occurrence_id);

  for v_member in
    select user_id from public.task_group_members where group_id = p_group_id and active
  loop
    v_task_id := null;
    insert into public.tasks (
      title, description, assignee_id, created_by_id, range_id, status, priority, category,
      due_date, completion_percentage, group_id, occurrence_id
    ) values (
      p_title, coalesce(p_description, ''), v_member.user_id, v_actor, p_range_id,
      'NotStarted', p_priority, p_category, p_due_at::date, 0, p_group_id, v_occurrence_id
    )
    on conflict (occurrence_id, assignee_id) where occurrence_id is not null do nothing
    returning id into v_task_id;

    if v_task_id is not null and v_member.user_id <> v_actor then
      insert into public.notifications (user_id, type, title, message, task_id)
      values (
        v_member.user_id, 'group_task_assigned', 'New group assignment: ' || p_title,
        coalesce(v_actor_name, 'Someone') || ' assigned you "' || p_title || '" via ' || v_group.name,
        v_task_id
      );
    end if;
  end loop;

  return v_occurrence_id;
end;
$$;

revoke all on function create_group_occurrence(uuid, text, text, task_category, task_priority, timestamptz, uuid) from public, anon;
grant execute on function create_group_occurrence(uuid, text, text, task_category, task_priority, timestamptz, uuid) to authenticated;

-- ─────────────────────────────────────────────
-- Storage: message attachments reuse the existing task-attachments bucket
-- and its "<entity-id>/<file>" folder convention — objects for a message
-- live under "<conversation-id>/<uuid>-<filename>".
-- ─────────────────────────────────────────────
create policy "task_conversation_attachments_upload" on storage.objects
  for insert with check (
    bucket_id = 'task-attachments'
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.task_conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (select public.can_post_to_conversation(c.id))
    )
  );

create policy "task_conversation_attachments_download" on storage.objects
  for select using (
    bucket_id = 'task-attachments'
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.task_conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (select public.can_view_conversation(c.id))
    )
  );

-- ═════════════════════════════════════════════
-- Task Groups & Recurring Assignments — Phase 2 (Recurring Series)
-- ═════════════════════════════════════════════
-- Do not generate all future tasks in advance. This function is called
-- hourly (see the pg_cron block below, matching send_task_deadline_
-- reminders' cadence/quiet-hours-free style) and creates only the ONE
-- occurrence a series is due for right now, if any — never a backlog of
-- future ones. recurrence_rule shapes, by recurrence_type:
--   daily            — {} (no extra fields)
--   weekly           — {"weekdays": [1]}            (exactly one, 0=Sun..6=Sat)
--   weekdays         — {"weekdays": [1,3,5]}         (one or more)
--   monthly          — {"day_of_month": 1}           (1-31; clamped to the
--                                                      actual last day of a
--                                                      shorter month)
--   custom_interval  — {"interval_days": 14}          (every N days from start_date)
--
-- Idempotency: the SAME unique index used by create_group_occurrence's
-- one-time path (tasks_occurrence_assignee_uq) also protects this
-- generator's per-member fan-out, and task_occurrences_series_due_uq
-- (already created in Phase 1, before this function ever existed) makes
-- the occurrence insert itself idempotent per (series_id, due_at) — so
-- running this function twice in the same hour, or twice for the same
-- calendar cycle after a retry, creates nothing twice.
--
-- Failures are per-series (one series erroring must not stop the loop
-- from generating every other due series) and are recorded to the
-- existing audit_log — reused rather than a new table, since it already
-- has a Director-facing UI (System audit) and a range_id/actor_id shape
-- that fits. "Notify administrators when generation repeatedly fails"
-- (spec §22) is intentionally NOT built here — that's escalation logic,
-- explicitly Phase 3 in the original spec; a director can already see
-- every failure by reading System audit for action = 'series_generation_failed'.
-- OUT parameter names are deliberately prefixed (out_*) rather than named
-- series_id/occurrence_id — plpgsql exposes OUT params as variables in
-- scope for the WHOLE function body, and task_occurrences/tasks both have
-- real columns literally named series_id/occurrence_id; without the
-- prefix every INSERT/ON CONFLICT referencing those columns inside this
-- function becomes ambiguous ("column reference is ambiguous") between
-- the table column and the OUT variable of the same name. Caught by
-- running this against a real local Postgres before it ever reached
-- Supabase — see supabase/tests/rls.test.mjs.
create or replace function generate_due_task_occurrences()
returns table(out_series_id uuid, out_occurrence_id uuid, out_outcome text, out_detail text)
language plpgsql security definer
set search_path = '' as $$
declare
  v_series record;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_hour int := extract(hour from now() at time zone 'Asia/Kolkata');
  v_dow int := extract(dow from v_today)::int;
  v_dom int := extract(day from v_today)::int;
  v_days_in_month int := extract(day from (date_trunc('month', v_today) + interval '1 month - 1 day'))::int;
  v_is_due boolean;
  v_due_at timestamptz;
  v_new_occurrence_id uuid;
  v_new_task_id uuid;
  v_member record;
begin
  for v_series in
    select s.*
    from public.task_series s
    join public.task_groups g on g.id = s.group_id
    where s.status = 'active'
      and g.status = 'active'
      and s.start_date <= v_today
      and (s.end_date is null or s.end_date >= v_today)
      and v_hour >= extract(hour from s.creation_time)
  loop
    v_is_due := case v_series.recurrence_type
      when 'daily' then true
      when 'weekly' then (v_series.recurrence_rule -> 'weekdays') @> to_jsonb(v_dow)
      when 'weekdays' then (v_series.recurrence_rule -> 'weekdays') @> to_jsonb(v_dow)
      when 'monthly' then least(coalesce((v_series.recurrence_rule ->> 'day_of_month')::int, 1), v_days_in_month) = v_dom
      when 'custom_interval' then
        (v_today - v_series.start_date) % greatest(coalesce((v_series.recurrence_rule ->> 'interval_days')::int, 1), 1) = 0
      else false
    end;

    if not v_is_due then
      continue;
    end if;

    v_due_at := (v_today + greatest(v_series.due_offset_days, 0)) + time '23:59:59';
    v_new_occurrence_id := null;

    begin
      insert into public.task_occurrences (
        group_id, series_id, title, description, category, priority, scheduled_start, due_at, status, created_by
      ) values (
        v_series.group_id, v_series.id, v_series.title, v_series.description, v_series.category,
        v_series.priority, now(), v_due_at, 'active', v_series.created_by
      )
      on conflict (series_id, due_at) where series_id is not null do nothing
      returning id into v_new_occurrence_id;

      if v_new_occurrence_id is null then
        -- Already generated for this cycle (idempotent re-run) — not a failure.
        out_series_id := v_series.id; out_occurrence_id := null; out_outcome := 'already_generated'; out_detail := null;
        return next;
        continue;
      end if;

      insert into public.task_conversations (type, occurrence_id) values ('occurrence', v_new_occurrence_id);

      for v_member in
        select user_id from public.task_group_members where group_id = v_series.group_id and active
      loop
        v_new_task_id := null;
        insert into public.tasks (
          title, description, assignee_id, created_by_id, range_id, status, priority, category,
          due_date, completion_percentage, group_id, series_id, occurrence_id
        ) values (
          v_series.title, v_series.description, v_member.user_id, v_series.created_by, v_series.range_id,
          'NotStarted', v_series.priority, v_series.category, v_due_at::date, 0,
          v_series.group_id, v_series.id, v_new_occurrence_id
        )
        on conflict (occurrence_id, assignee_id) where occurrence_id is not null do nothing
        returning id into v_new_task_id;

        if v_new_task_id is not null then
          insert into public.notifications (user_id, type, title, message, task_id)
          values (
            v_member.user_id, 'group_task_assigned', 'New group assignment: ' || v_series.title,
            'Recurring assignment "' || v_series.title || '" — due ' || to_char(v_due_at, 'DD Mon'),
            v_new_task_id
          );
        end if;
      end loop;

      out_series_id := v_series.id; out_occurrence_id := v_new_occurrence_id; out_outcome := 'created'; out_detail := null;
      return next;
    exception when others then
      insert into public.audit_log (task_id, task_title, range_id, actor_id, action, detail)
      values (null, v_series.title, v_series.range_id, v_series.created_by, 'series_generation_failed', SQLERRM);
      out_series_id := v_series.id; out_occurrence_id := null; out_outcome := 'failed'; out_detail := SQLERRM;
      return next;
    end;
  end loop;
  return;
end;
$$;

revoke all on function generate_due_task_occurrences() from public, anon, authenticated;

-- Hourly via pg_cron, same portability wrapper as task-deadline-reminders
-- immediately above (this file must still apply where pg_cron isn't
-- installable, e.g. the local test shim) — including the unschedule-first
-- step so re-running this file against an already-scheduled job is safe.
do $$ begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron unavailable; recurring series generation not scheduled';
end $$;

do $$ begin
  perform cron.unschedule('task-group-series-generation')
    from cron.job where jobname = 'task-group-series-generation';
  perform cron.schedule('task-group-series-generation', '0 * * * *',
                         'select public.generate_due_task_occurrences()');
exception when others then
  raise notice 'pg_cron unavailable; recurring series generation not scheduled';
end $$;

-- ═════════════════════════════════════════════
-- Task Groups & Recurring Assignments — Phase 3 (Advanced coordination)
-- ═════════════════════════════════════════════
-- Temporary substitutions and per-task actions (reassign/extend due date/
-- remove one member's task) need no schema changes at all — they're
-- ordinary UPDATE/DELETE on `tasks`, already covered by the existing
-- tasks_director/tasks_officer_write RLS policies. Message
-- acknowledgements likewise need no new schema — task_message_reads
-- already exists from Phase 1 with correct RLS; Phase 3 only wires up the
-- client side. What's added here: audit_log.series_id (reliable
-- attribution for consecutive-failure escalation, instead of matching on
-- title text), pinning (moderation), set_message_pinned RPC,
-- generate_series_escalations() + its cron job (repeated-failure
-- escalation + missed-occurrence handling), and updating
-- generate_due_task_occurrences()'s failure branch to also record
-- series_id. Recurring performance analytics needs no schema addition
-- either — computed client-side from the existing tasks/occurrences rows.

alter table audit_log add column if not exists series_id uuid references task_series(id) on delete set null;
create index if not exists audit_log_series_id_idx on audit_log(series_id) where series_id is not null;

alter table task_messages add column if not exists pinned_at timestamptz;
alter table task_messages add column if not exists pinned_by uuid references profiles(id) on delete set null;

alter type notification_type add value if not exists 'group_series_failing';
alter type notification_type add value if not exists 'group_occurrence_overdue';
commit;

alter table notifications add column if not exists series_id uuid references task_series(id) on delete cascade;
alter table notifications add column if not exists occurrence_id uuid references task_occurrences(id) on delete cascade;
create index if not exists notifications_series_id_idx on notifications(series_id) where series_id is not null;
create index if not exists notifications_occurrence_id_idx on notifications(occurrence_id) where occurrence_id is not null;

alter table notifications drop constraint if exists notifications_task_or_incident_chk;
alter table notifications add constraint notifications_task_or_incident_chk
  check (
    (case when task_id is not null then 1 else 0 end)
    + (case when incident_id is not null then 1 else 0 end)
    + (case when inventory_request_id is not null then 1 else 0 end)
    + (case when series_id is not null then 1 else 0 end)
    + (case when occurrence_id is not null then 1 else 0 end) = 1
  );

-- Re-deploy with series_id added to the failure-path audit_log insert —
-- everything else is byte-identical to the Phase 2 version.
create or replace function generate_due_task_occurrences()
returns table(out_series_id uuid, out_occurrence_id uuid, out_outcome text, out_detail text)
language plpgsql security definer
set search_path = '' as $$
declare
  v_series record;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_hour int := extract(hour from now() at time zone 'Asia/Kolkata');
  v_dow int := extract(dow from v_today)::int;
  v_dom int := extract(day from v_today)::int;
  v_days_in_month int := extract(day from (date_trunc('month', v_today) + interval '1 month - 1 day'))::int;
  v_is_due boolean;
  v_due_at timestamptz;
  v_new_occurrence_id uuid;
  v_new_task_id uuid;
  v_member record;
begin
  for v_series in
    select s.*
    from public.task_series s
    join public.task_groups g on g.id = s.group_id
    where s.status = 'active'
      and g.status = 'active'
      and s.start_date <= v_today
      and (s.end_date is null or s.end_date >= v_today)
      and v_hour >= extract(hour from s.creation_time)
  loop
    v_is_due := case v_series.recurrence_type
      when 'daily' then true
      when 'weekly' then (v_series.recurrence_rule -> 'weekdays') @> to_jsonb(v_dow)
      when 'weekdays' then (v_series.recurrence_rule -> 'weekdays') @> to_jsonb(v_dow)
      when 'monthly' then least(coalesce((v_series.recurrence_rule ->> 'day_of_month')::int, 1), v_days_in_month) = v_dom
      when 'custom_interval' then
        (v_today - v_series.start_date) % greatest(coalesce((v_series.recurrence_rule ->> 'interval_days')::int, 1), 1) = 0
      else false
    end;

    if not v_is_due then
      continue;
    end if;

    v_due_at := (v_today + greatest(v_series.due_offset_days, 0)) + time '23:59:59';
    v_new_occurrence_id := null;

    begin
      insert into public.task_occurrences (
        group_id, series_id, title, description, category, priority, scheduled_start, due_at, status, created_by
      ) values (
        v_series.group_id, v_series.id, v_series.title, v_series.description, v_series.category,
        v_series.priority, now(), v_due_at, 'active', v_series.created_by
      )
      on conflict (series_id, due_at) where series_id is not null do nothing
      returning id into v_new_occurrence_id;

      if v_new_occurrence_id is null then
        out_series_id := v_series.id; out_occurrence_id := null; out_outcome := 'already_generated'; out_detail := null;
        return next;
        continue;
      end if;

      insert into public.task_conversations (type, occurrence_id) values ('occurrence', v_new_occurrence_id);

      for v_member in
        select user_id from public.task_group_members where group_id = v_series.group_id and active
      loop
        v_new_task_id := null;
        insert into public.tasks (
          title, description, assignee_id, created_by_id, range_id, status, priority, category,
          due_date, completion_percentage, group_id, series_id, occurrence_id
        ) values (
          v_series.title, v_series.description, v_member.user_id, v_series.created_by, v_series.range_id,
          'NotStarted', v_series.priority, v_series.category, v_due_at::date, 0,
          v_series.group_id, v_series.id, v_new_occurrence_id
        )
        on conflict (occurrence_id, assignee_id) where occurrence_id is not null do nothing
        returning id into v_new_task_id;

        if v_new_task_id is not null then
          insert into public.notifications (user_id, type, title, message, task_id)
          values (
            v_member.user_id, 'group_task_assigned', 'New group assignment: ' || v_series.title,
            'Recurring assignment "' || v_series.title || '" — due ' || to_char(v_due_at, 'DD Mon'),
            v_new_task_id
          );
        end if;
      end loop;

      out_series_id := v_series.id; out_occurrence_id := v_new_occurrence_id; out_outcome := 'created'; out_detail := null;
      return next;
    exception when others then
      insert into public.audit_log (task_id, task_title, range_id, actor_id, action, detail, series_id)
      values (null, v_series.title, v_series.range_id, v_series.created_by, 'series_generation_failed', SQLERRM, v_series.id);
      out_series_id := v_series.id; out_occurrence_id := null; out_outcome := 'failed'; out_detail := SQLERRM;
      return next;
    end;
  end loop;
  return;
end;
$$;

-- ─────────────────────────────────────────────
-- Message pinning (moderation) — director always; officer/coordinator
-- only within their own authority (their range's group, or a group they
-- coordinate). An RPC rather than a raw UPDATE grant so the authority
-- check doesn't need column-level RLS (Postgres RLS is row-level only,
-- and task_messages_update_own's sender-or-director check is deliberately
-- broader than who should be allowed to pin).
-- ─────────────────────────────────────────────
create or replace function set_message_pinned(p_message_id uuid, p_pinned boolean)
returns void language plpgsql security definer
set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role := (select role from public.profiles where id = v_actor);
  v_conv record;
  v_authorized boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select c.id, c.type, c.group_id, c.occurrence_id into v_conv
  from public.task_messages m
  join public.task_conversations c on c.id = m.conversation_id
  where m.id = p_message_id;

  if v_conv.id is null then
    raise exception 'Message not found';
  end if;

  if v_role = 'director' then
    v_authorized := true;
  elsif v_conv.type = 'group' then
    v_authorized := public.can_officer_manage_group(v_conv.group_id) or public.is_group_coordinator(v_conv.group_id);
  elsif v_conv.type = 'occurrence' then
    v_authorized := public.can_officer_manage_occurrence(v_conv.occurrence_id);
  end if;

  if not v_authorized then
    raise exception 'Not authorized to pin messages in this conversation';
  end if;

  update public.task_messages
  set pinned_at = case when p_pinned then now() else null end,
      pinned_by = case when p_pinned then v_actor else null end
  where id = p_message_id;
end;
$$;

revoke all on function set_message_pinned(uuid, boolean) from public, anon;
grant execute on function set_message_pinned(uuid, boolean) to authenticated;

-- ─────────────────────────────────────────────
-- Escalation: repeated series-generation failures, and occurrences that
-- passed their due date with open member tasks ("missed occurrence").
-- Both are one-shot per trigger window, not a repeating alarm — a
-- director already sees ongoing state (System audit for failures, the
-- occurrence's own progress bar for overdue member tasks); this is a
-- single heads-up, not a recurring nag.
-- ─────────────────────────────────────────────
create or replace function generate_series_escalations()
returns table(out_kind text, out_target_id uuid, out_outcome text)
language plpgsql security definer
set search_path = '' as $$
declare
  v_series record;
  v_occ record;
  v_recent_failures int;
  v_already_notified boolean;
begin
  for v_series in
    select s.id, s.title, s.created_by
    from public.task_series s
    join public.task_groups g on g.id = s.group_id
    where s.status = 'active' and g.status = 'active'
  loop
    select count(*) into v_recent_failures
    from public.audit_log
    where series_id = v_series.id
      and action = 'series_generation_failed'
      and created_at > now() - interval '48 hours';

    if v_recent_failures < 2 then
      continue;
    end if;

    select exists (
      select 1 from public.notifications
      where series_id = v_series.id and type = 'group_series_failing'
        and created_at > now() - interval '48 hours'
    ) into v_already_notified;

    if v_already_notified then
      continue;
    end if;

    insert into public.notifications (user_id, type, title, message, series_id)
    values (
      v_series.created_by, 'group_series_failing', 'Recurring series failing to generate',
      '"' || v_series.title || '" has failed to generate ' || v_recent_failures || ' time(s) in the last 48 hours. Check System audit for details.',
      v_series.id
    );
    out_kind := 'series'; out_target_id := v_series.id; out_outcome := 'notified';
    return next;
  end loop;

  for v_occ in
    select o.id, o.title, o.created_by
    from public.task_occurrences o
    where o.status = 'active'
      and o.due_at < now()
      and exists (select 1 from public.tasks t where t.occurrence_id = o.id and t.status <> 'Archived')
      and not exists (
        select 1 from public.notifications n where n.occurrence_id = o.id and n.type = 'group_occurrence_overdue'
      )
  loop
    insert into public.notifications (user_id, type, title, message, occurrence_id)
    values (
      v_occ.created_by, 'group_occurrence_overdue', 'Assignment overdue: ' || v_occ.title,
      '"' || v_occ.title || '" passed its due date with member tasks still open.',
      v_occ.id
    );
    out_kind := 'occurrence'; out_target_id := v_occ.id; out_outcome := 'notified';
    return next;
  end loop;

  return;
end;
$$;

revoke all on function generate_series_escalations() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron unavailable; series escalations not scheduled';
end $$;

do $$ begin
  perform cron.unschedule('task-group-escalations')
    from cron.job where jobname = 'task-group-escalations';
  perform cron.schedule('task-group-escalations', '0 * * * *',
                         'select public.generate_series_escalations()');
exception when others then
  raise notice 'pg_cron unavailable; series escalations not scheduled';
end $$;
