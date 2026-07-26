import type { Role } from '../types';

// Named-person exception, not a role rule — one specific profile holds the
// tiger_cell role but is deliberately excluded from full incident-log
// access (see incidents_tiger_cell in supabase/schema.sql; internal
// records have who/why). If that profile is ever deleted and recreated,
// this id must be updated to match. Shared by every surface (desktop
// IncidentLog, mobile incident list/actions) so the rule can't drift.
export const RESTRICTED_TIGER_CELL_USER_ID = '237e1f9b-cf77-4b83-ae43-7641af75f67f';

/** Mirrors the incidents_director / incidents_tiger_cell RLS policies —
    these are the only roles with any UPDATE grant on incidents at all. */
export function canManageIncidents(role: Role | undefined, userId: string | undefined): boolean {
  if (role === 'director') return true;
  if (role === 'tiger_cell') return userId !== RESTRICTED_TIGER_CELL_USER_ID;
  return false;
}

/** Director and range officers can edit, approve, and revise tasks. */
export function canManageTasks(role: Role | undefined): boolean {
  return role === 'director' || role === 'range_officer';
}

/** Mirrors the inventory_*_director RLS policies — only a director can
    manage the catalog, approve/reject requests, and issue stock outright.
    Inventory staff act only within their assigned locations (enforced by
    RLS via get_my_inventory_location_ids(), not by this check). */
export function canManageInventory(role: Role | undefined): boolean {
  return role === 'director';
}

/** Director and range officers can create/manage Task Groups (roster,
    one-time assignments). This is the coarse UI-level gate only — WHICH
    groups an officer can actually touch (range match) and whether a
    member/coordinator can post to a given conversation is enforced by RLS
    (can_officer_manage_group / is_group_member / can_post_to_conversation
    in supabase/schema.sql), not mirrored here. Guards/range_office/
    tiger_cell/divisional_office only ever see groups they belong to. */
export function canManageTaskGroups(role: Role | undefined): boolean {
  return role === 'director' || role === 'range_officer';
}
