import type { Role } from '../types';

// Where a signed-in user's Inventory routes are mounted. Capability-based,
// not purely role-based (matches ProtectedInventoryAccess in App.tsx): a
// director always gets the full director shell; anyone else with access
// reaches it through whichever Field Ops shell their role actually uses
// (range_officer -> /officer, every other field role -> /guard). No route
// is ever mounted at bare '/inventory'.
export function inventoryBase(role: Role | undefined): string {
  if (role === 'director') return '/director/inventory';
  if (role === 'range_officer') return '/officer/inventory';
  return '/guard/inventory';
}
