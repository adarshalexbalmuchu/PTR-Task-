#!/usr/bin/env node
// Copy every object in the app's storage buckets from one Supabase project
// to another. Run this from a machine with normal internet access — it
// downloads each file from the source project and re-uploads it to the
// destination, since Supabase has no cross-project storage copy.
//
// The buckets themselves (with their RLS policies) are created by
// supabase/schema.sql — run that against the destination project FIRST,
// otherwise these uploads will fail with "bucket not found".
//
// Usage:
//   SOURCE_SUPABASE_URL=https://<old-ref>.supabase.co \
//   SOURCE_SERVICE_ROLE_KEY=<old-secret-key> \
//   DEST_SUPABASE_URL=https://<new-ref>.supabase.co \
//   DEST_SERVICE_ROLE_KEY=<new-secret-key> \
//   node scripts/migrate-storage.mjs
//
// Safe to re-run: existing objects at the destination are skipped unless
// OVERWRITE=1 is set.

import { createClient } from '@supabase/supabase-js';

const SOURCE_URL = process.env.SOURCE_SUPABASE_URL;
const SOURCE_KEY = process.env.SOURCE_SERVICE_ROLE_KEY;
const DEST_URL = process.env.DEST_SUPABASE_URL;
const DEST_KEY = process.env.DEST_SERVICE_ROLE_KEY;
const OVERWRITE = process.env.OVERWRITE === '1';

if (!SOURCE_URL || !SOURCE_KEY || !DEST_URL || !DEST_KEY) {
  console.error('Set SOURCE_SUPABASE_URL, SOURCE_SERVICE_ROLE_KEY, DEST_SUPABASE_URL and DEST_SERVICE_ROLE_KEY first.');
  process.exit(1);
}

// Must match the bucket ids created in supabase/schema.sql.
const BUCKETS = ['task-attachments', 'incident-photos', 'inventory-photos', 'inventory-request-photos'];

const clientOpts = { auth: { autoRefreshToken: false, persistSession: false } };
const source = createClient(SOURCE_URL, SOURCE_KEY, clientOpts);
const dest = createClient(DEST_URL, DEST_KEY, clientOpts);

// Buckets are used as <id>/<filename> — one folder level — but list
// recursively anyway so nothing is missed if that ever changes.
async function listAllPaths(client, bucket, prefix = '') {
  const { data: entries, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${bucket}/${prefix} failed: ${error.message}`);

  const paths = [];
  for (const entry of entries ?? []) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    // A storage "folder" has no id and no metadata; a real object does.
    if (entry.id === null) {
      paths.push(...await listAllPaths(client, bucket, fullPath));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

async function migrateBucket(bucket) {
  console.log(`\n=== ${bucket} ===`);
  const paths = await listAllPaths(source, bucket);
  console.log(`${paths.length} object(s) found in source.`);

  let copied = 0, skipped = 0, failed = 0;

  for (const path of paths) {
    if (!OVERWRITE) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
      const { data: existing } = await dest.storage.from(bucket).list(dir, { search: name, limit: 1 });
      if (existing?.some((e) => e.name === name)) {
        skipped++;
        continue;
      }
    }

    const { data: blob, error: downloadErr } = await source.storage.from(bucket).download(path);
    if (downloadErr) {
      failed++;
      console.error(`! download failed ${bucket}/${path}: ${downloadErr.message}`);
      continue;
    }

    const { error: uploadErr } = await dest.storage
      .from(bucket)
      .upload(path, blob, { upsert: OVERWRITE, contentType: blob.type || undefined });
    if (uploadErr) {
      failed++;
      console.error(`! upload failed ${bucket}/${path}: ${uploadErr.message}`);
      continue;
    }

    copied++;
    console.log(`+ ${bucket}/${path}`);
  }

  console.log(`${bucket}: ${copied} copied, ${skipped} skipped (already present), ${failed} failed.`);
  return { copied, skipped, failed };
}

async function main() {
  const totals = { copied: 0, skipped: 0, failed: 0 };
  for (const bucket of BUCKETS) {
    const result = await migrateBucket(bucket);
    totals.copied += result.copied;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }
  console.log(`\nDone: ${totals.copied} copied, ${totals.skipped} skipped, ${totals.failed} failed.`);
  if (totals.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
