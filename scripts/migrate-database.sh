#!/usr/bin/env bash
# Copy auth users + all public-schema data from one Supabase project's
# database to another. Run supabase/schema.sql against the DESTINATION
# project FIRST (it creates tables, storage buckets, and RLS policies) —
# this script only copies rows into that already-created schema.
#
# Run this from a machine with normal internet access to both projects'
# database hosts.
#
# The direct host (db.<ref>.supabase.co) is IPv6-only — it won't connect
# from networks without IPv6 (many CI/cloud/Codespaces environments,
# notably). Use the session pooler host/user from each project's
# Settings > Database > Connection string > "Session pooler" instead;
# it works over IPv4. Its username is "postgres.<ref>", not just "postgres".
#
# Usage (pooler, typical):
#   SOURCE_DB_HOST=aws-0-<region>.pooler.supabase.com SOURCE_DB_USER=postgres.hsaqgpuvdbyrineknwzf SOURCE_DB_PASSWORD='...' \
#   DEST_DB_HOST=aws-0-<region>.pooler.supabase.com   DEST_DB_USER=postgres.tnckextopwhgjqysozoe   DEST_DB_PASSWORD='...' \
#   ./scripts/migrate-database.sh
#
# Passwords are passed as separate variables (not a connection URL) so
# special characters like "@" in them don't need URL-encoding.
#
# What this does NOT do:
# - auth.sessions / auth.refresh_tokens are intentionally skipped — stale
#   sessions aren't useful; everyone just signs in fresh on the new project.
# - Storage files (photos/attachments) aren't touched — run
#   scripts/migrate-storage.mjs separately for those.
#
# Re-running: set SKIP_AUTH=1 to skip the auth.users/auth.identities step
# (e.g. because a previous run already copied it — re-running it would
# hit duplicate-key errors, since it's not upsert-safe). If a previous run
# of the public-schema restore failed partway through (each COPY commits
# immediately, so a later failure doesn't roll back earlier tables), set
# RESET_PUBLIC=1 to truncate every public table first so the retry starts
# clean — this restore now runs as a single transaction, so that shouldn't
# happen again going forward.

set -euo pipefail

: "${SOURCE_DB_HOST:?Set SOURCE_DB_HOST (e.g. db.<old-ref>.supabase.co, or the pooler host)}"
: "${SOURCE_DB_PASSWORD:?Set SOURCE_DB_PASSWORD}"
: "${DEST_DB_HOST:?Set DEST_DB_HOST (e.g. db.<new-ref>.supabase.co, or the pooler host)}"
: "${DEST_DB_PASSWORD:?Set DEST_DB_PASSWORD}"

SOURCE_DB_PORT="${SOURCE_DB_PORT:-5432}"
DEST_DB_PORT="${DEST_DB_PORT:-5432}"
SOURCE_DB_USER="${SOURCE_DB_USER:-postgres}"
DEST_DB_USER="${DEST_DB_USER:-postgres}"
SKIP_AUTH="${SKIP_AUTH:-0}"
RESET_PUBLIC="${RESET_PUBLIC:-0}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

source_conn=(-h "$SOURCE_DB_HOST" -p "$SOURCE_DB_PORT" -U "$SOURCE_DB_USER" -d postgres)
dest_conn=(-h "$DEST_DB_HOST" -p "$DEST_DB_PORT" -U "$DEST_DB_USER" -d postgres)

if [ "$SKIP_AUTH" != "1" ]; then
  echo "==> Dumping auth.users + auth.identities from source..."
  # No --disable-triggers here: Supabase's hosted "postgres" role doesn't own
  # auth.* tables (supabase_auth_admin does), so ALTER TABLE ... DISABLE
  # TRIGGER on them fails with "must be owner of table users". Not needed
  # anyway — there are no custom triggers on auth.users/auth.identities, and
  # users are dumped before identities so the FK is satisfied in order.
  PGPASSWORD="$SOURCE_DB_PASSWORD" pg_dump "${source_conn[@]}" \
    --data-only \
    --table=auth.users --table=auth.identities \
    -f "$WORKDIR/auth.sql"

  echo "==> Restoring auth data into destination (profiles.id references auth.users.id, so this must go first)..."
  PGPASSWORD="$DEST_DB_PASSWORD" psql "${dest_conn[@]}" -v ON_ERROR_STOP=1 -f "$WORKDIR/auth.sql"
else
  echo "==> SKIP_AUTH=1 — skipping auth.users/auth.identities (assumed already migrated)."
fi

if [ "$RESET_PUBLIC" = "1" ]; then
  echo "==> RESET_PUBLIC=1 — truncating destination public tables (except schema.sql-seeded reference tables)..."
  table_list=$(PGPASSWORD="$DEST_DB_PASSWORD" psql "${dest_conn[@]}" -tAc \
    "select string_agg(quote_ident(tablename), ', ') from pg_tables where schemaname = 'public' and tablename not in ('inventory_categories', 'inventory_units')")
  PGPASSWORD="$DEST_DB_PASSWORD" psql "${dest_conn[@]}" -v ON_ERROR_STOP=1 \
    -c "truncate table $table_list restart identity cascade;"
fi

echo "==> Dumping public schema data from source..."
# No --disable-triggers here either: disabling the FK-check triggers Postgres
# generates for referential integrity ("RI_ConstraintTrigger_...") requires
# real superuser, which Supabase's hosted "postgres" role isn't. Instead we
# load the data with session_replication_role set to 'replica' below, which
# skips both those and any custom triggers for the duration of the session
# without needing special per-table permissions — this also resolves the
# circular-FK warnings pg_dump prints (inventory_locations, task_messages).
#
# inventory_categories/inventory_units are excluded: schema.sql seeds those
# itself with the app's fixed reference lists, so the destination already
# has them and re-inserting the source's rows just collides on name.
PGPASSWORD="$SOURCE_DB_PASSWORD" pg_dump "${source_conn[@]}" \
  --data-only \
  --schema=public \
  --exclude-table=public.inventory_categories \
  --exclude-table=public.inventory_units \
  -f "$WORKDIR/public.sql"

echo "==> Restoring public schema data into destination (single transaction — all or nothing)..."
PGPASSWORD="$DEST_DB_PASSWORD" psql "${dest_conn[@]}" --single-transaction -v ON_ERROR_STOP=1 <<SQL
SET session_replication_role = replica;
\i $WORKDIR/public.sql
SET session_replication_role = DEFAULT;
SQL

echo
echo "Done. Spot-check row counts (e.g. select count(*) from profiles;) on both"
echo "projects, then run scripts/migrate-storage.mjs to copy the actual files."
echo
echo "Note: inventory_categories/inventory_units were NOT copied — if the"
echo "source project has custom categories/units beyond schema.sql's default"
echo "list, add those manually."
