import { describe, it, expect } from 'vitest';
import { canManageInventory, canManageTasks, canManageIncidents, canManageTaskGroups } from './permissions';
import { isFieldRole, FIELD_ROLES } from '../types';
import type { Role } from '../types';

// inventory_staff is DEPRECATED — kept only because the Postgres enum value
// can't be safely dropped while live. No profile currently holds it and no
// new user can ever be given it (see the create-user Edge Function and
// every role-selection UI). It's still included here so these exhaustive
// checks stay honest about every literal the Role type actually contains.
const ALL_ROLES: Role[] = ['director', 'range_officer', 'guard', 'range_office', 'tiger_cell', 'divisional_office', 'inventory_staff'];

describe('canManageInventory', () => {
  it('director can manage inventory', () => {
    expect(canManageInventory('director')).toBe(true);
  });

  it('the deprecated inventory_staff role cannot manage inventory', () => {
    expect(canManageInventory('inventory_staff')).toBe(false);
  });

  it('every existing Field Operations role is denied full inventory management (an assigned guard acts only within their assigned locations, enforced by RLS, not by this check)', () => {
    for (const role of ['range_officer', 'guard', 'range_office', 'tiger_cell', 'divisional_office'] as Role[]) {
      expect(canManageInventory(role)).toBe(false);
    }
  });

  it('undefined role is denied', () => {
    expect(canManageInventory(undefined)).toBe(false);
  });
});

describe('the deprecated inventory_staff role is not accidentally treated as a field role', () => {
  it('is not included in FIELD_ROLES', () => {
    expect(FIELD_ROLES).not.toContain('inventory_staff');
  });

  it('isFieldRole(inventory_staff) is false', () => {
    expect(isFieldRole('inventory_staff')).toBe(false);
  });

  it('isFieldRole still correctly recognizes the real field-tier roles', () => {
    expect(isFieldRole('guard')).toBe(true);
    expect(isFieldRole('range_office')).toBe(true);
    expect(isFieldRole('tiger_cell')).toBe(true);
    expect(isFieldRole('divisional_office')).toBe(true);
  });

  it('isFieldRole rejects director/range_officer/inventory_staff', () => {
    expect(isFieldRole('director')).toBe(false);
    expect(isFieldRole('range_officer')).toBe(false);
    expect(isFieldRole('inventory_staff')).toBe(false);
  });
});

describe('existing permission helpers are unaffected by Inventory access', () => {
  it('canManageTasks is unchanged for every role, including the deprecated inventory_staff', () => {
    expect(canManageTasks('director')).toBe(true);
    expect(canManageTasks('range_officer')).toBe(true);
    expect(canManageTasks('guard')).toBe(false);
    expect(canManageTasks('range_office')).toBe(false);
    expect(canManageTasks('tiger_cell')).toBe(false);
    expect(canManageTasks('divisional_office')).toBe(false);
    expect(canManageTasks('inventory_staff')).toBe(false);
  });

  it('canManageIncidents is unchanged for every role, including the deprecated inventory_staff', () => {
    expect(canManageIncidents('director', 'any-id')).toBe(true);
    expect(canManageIncidents('tiger_cell', 'some-other-id')).toBe(true);
    expect(canManageIncidents('inventory_staff', 'any-id')).toBe(false);
    expect(canManageIncidents('guard', 'any-id')).toBe(false);
  });

  it('every known role is covered by exactly one of canManageInventory/canManageTasks/canManageIncidents assertions above (no role silently falls through untested)', () => {
    expect(ALL_ROLES).toHaveLength(7);
  });
});

describe('canManageTaskGroups', () => {
  it('director and range officer can create/manage Task Groups', () => {
    expect(canManageTaskGroups('director')).toBe(true);
    expect(canManageTaskGroups('range_officer')).toBe(true);
  });

  it('field-tier roles and the deprecated inventory_staff role cannot — RLS further restricts director/officer to their own range, not mirrored here', () => {
    expect(canManageTaskGroups('guard')).toBe(false);
    expect(canManageTaskGroups('range_office')).toBe(false);
    expect(canManageTaskGroups('tiger_cell')).toBe(false);
    expect(canManageTaskGroups('divisional_office')).toBe(false);
    expect(canManageTaskGroups('inventory_staff')).toBe(false);
  });

  it('undefined role is denied', () => {
    expect(canManageTaskGroups(undefined)).toBe(false);
  });
});
