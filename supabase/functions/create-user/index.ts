import { createClient } from 'npm:@supabase/supabase-js@2';

// JWT-authenticated endpoint, so a wildcard origin is not itself an auth
// bypass (no cookies are involved) — but set ALLOWED_ORIGIN to the app's
// deployed origin(s) to stop other websites from even initiating calls.
// Accepts a comma-separated list because the app may be served from more
// than one domain (e.g. two Vercel projects):
//   supabase secrets set ALLOWED_ORIGIN=https://app-a.example,https://app-b.example
// CORS only permits ONE origin per response, so we echo the request's
// Origin back when it's on the list (with Vary: Origin so caches don't
// serve one origin's preflight to another).
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGIN') ?? '*')
  .split(',').map((s) => s.trim()).filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

// inventory_staff is DEPRECATED and deliberately excluded here — Inventory
// access is now an additional capability any existing guard can be granted
// (via inventory_location_staff), not a separate role/account type. No new
// user should ever be created with it.
interface CreateUserPayload {
  email: string;
  password: string;
  name: string;
  role: 'director' | 'range_officer' | 'guard' | 'range_office' | 'tiger_cell' | 'divisional_office';
  phone?: string;
  avatarInitials: string;
  designation: string;
  rangeId?: string;
}

const VALID_ROLES = ['director', 'range_officer', 'guard', 'range_office', 'tiger_cell', 'divisional_office'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deliberately simple: enough to reject garbage, not trying to fully
// implement RFC 5322 (Supabase Auth validates again on its side).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 10;

// Throws with a client-safe message when the payload is invalid.
function validatePayload(p: CreateUserPayload): void {
  if (typeof p.email !== 'string' || !EMAIL_RE.test(p.email) || p.email.length > 254) {
    throw new ValidationError('A valid email address is required');
  }
  if (typeof p.password !== 'string' || p.password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!/[a-zA-Z]/.test(p.password) || !/[0-9]/.test(p.password)) {
    throw new ValidationError('Password must contain both letters and numbers');
  }
  if (typeof p.name !== 'string' || p.name.trim().length === 0 || p.name.length > 120) {
    throw new ValidationError('Name is required (max 120 characters)');
  }
  if (!VALID_ROLES.includes(p.role)) {
    throw new ValidationError('Invalid role');
  }
  if (p.phone !== undefined && p.phone !== null && (typeof p.phone !== 'string' || p.phone.length > 30)) {
    throw new ValidationError('Invalid phone number');
  }
  if (typeof p.avatarInitials !== 'string' || p.avatarInitials.length > 4) {
    throw new ValidationError('Invalid avatar initials');
  }
  if (typeof p.designation !== 'string' || p.designation.length > 120) {
    throw new ValidationError('Invalid designation');
  }
  if (p.rangeId !== undefined && p.rangeId !== null && !UUID_RE.test(p.rangeId)) {
    throw new ValidationError('Invalid range id');
  }
}

class ValidationError extends Error {}

function jsonResponse(req: Request, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    status,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed' }, 405);
  }

  try {
    // Only directors can call this — verify JWT matches a director profile
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return jsonResponse(req, { error: 'Unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Call /auth/v1/user directly with fetch rather than the supabase-js
    // client's auth.getUser() — the client-side call was failing here for
    // reasons that only showed as an opaque "not valid JSON" parse error.
    // Raw fetch works reliably; failures are logged server-side only so the
    // response doesn't leak internals to the caller.
    const authCheckRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { authorization: authHeader, apikey: anonKey },
    });
    const authCheckText = await authCheckRes.text();
    if (!authCheckRes.ok) {
      console.error(`auth check failed: HTTP ${authCheckRes.status} — ${authCheckText.slice(0, 300)}`);
      return jsonResponse(req, { error: 'Unauthorized' }, 401);
    }
    let caller: { id: string } | undefined;
    try {
      caller = JSON.parse(authCheckText);
    } catch {
      console.error(`auth check returned non-JSON (HTTP ${authCheckRes.status})`);
      return jsonResponse(req, { error: 'Unauthorized' }, 401);
    }
    if (!caller?.id) return jsonResponse(req, { error: 'Unauthorized' }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { authorization: authHeader } },
    });

    const { data: callerProfile, error: profileErr } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single();
    if (profileErr || callerProfile?.role !== 'director') {
      return jsonResponse(req, { error: 'Only directors can create users' }, 403);
    }

    const payload: CreateUserPayload = await req.json();
    validatePayload(payload);
    const email = payload.email.trim().toLowerCase();

    // Use service role to create auth user
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: payload.password,
      email_confirm: true,
    });

    // Auth errors (duplicate email, rejected password, …) are user-facing
    // by design — surface them so the director knows what to correct.
    // Anything else falls through to the generic 500 below.
    if (createErr) throw new ValidationError(createErr.message);
    if (!user) throw new Error('Failed to create auth user');

    // Insert profile row
    const { error: insertErr } = await admin.from('profiles').insert({
      id: user.id,
      name: payload.name.trim(),
      role: payload.role,
      email,
      phone: payload.phone ?? null,
      avatar_initials: payload.avatarInitials,
      designation: payload.designation,
      range_id: payload.rangeId ?? null,
    });

    if (insertErr) {
      // Roll back auth user if profile insert fails
      await admin.auth.admin.deleteUser(user.id);
      throw insertErr;
    }

    return jsonResponse(req, { id: user.id }, 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonResponse(req, { error: err.message }, 400);
    }
    // Never echo internal error detail (DB constraint names, stack info)
    // back to the caller — full detail goes to the function logs only.
    console.error('create-user failed:', err instanceof Error ? err.message : err);
    return jsonResponse(req, { error: 'Internal error — check the function logs' }, 500);
  }
});
