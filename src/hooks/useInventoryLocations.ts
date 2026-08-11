import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { mapInventoryLocation } from '../lib/mappers';
import { verifyAffectedRows, SINGLE_RECORD_NOT_UPDATED_MESSAGE } from '../lib/mutationVerification';
import useStore from '../store/useStore';
import type { InventoryLocation, InventoryLocationType } from '../types';

export function useInventoryLocations() {
  const queryClient = useQueryClient();

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: async (): Promise<InventoryLocation[]> => {
      const { data, error } = await supabase.from('inventory_locations').select('*').order('name');
      if (error) throw error;
      return data.map(mapInventoryLocation);
    },
  });

  const createLocation = useMutation({
    mutationFn: async (input: {
      name: string; type: InventoryLocationType; rangeId?: string; addressDescription?: string; parentLocationId?: string;
    }) => {
      const { error } = await supabase.from('inventory_locations').insert({
        name: input.name,
        type: input.type,
        range_id: input.rangeId ?? null,
        address_description: input.addressDescription ?? '',
        parent_location_id: input.parentLocationId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-locations'] }),
  });

  const updateLocation = useMutation({
    mutationFn: async ({ id, ...data }: {
      id: string; name?: string; type?: InventoryLocationType;
      // string | null, not just string | undefined: undefined means "leave
      // this field alone", null means "clear it back to no range/parent" —
      // collapsing those to one optional string made switching a location
      // back to "None" silently do nothing (an empty-string patch value
      // isn't a valid uuid and either errored or was skipped entirely).
      rangeId?: string | null; addressDescription?: string;
      parentLocationId?: string | null; active?: boolean;
    }) => {
      const patch: Database['public']['Tables']['inventory_locations']['Update'] = {};
      if (data.name !== undefined) patch.name = data.name;
      if (data.type !== undefined) patch.type = data.type;
      if (data.rangeId !== undefined) patch.range_id = data.rangeId;
      if (data.addressDescription !== undefined) patch.address_description = data.addressDescription;
      if (data.parentLocationId !== undefined) patch.parent_location_id = data.parentLocationId;
      if (data.active !== undefined) patch.active = data.active;

      const { data: rows, error } = await supabase.from('inventory_locations').update(patch).eq('id', id).select('id');
      if (error) throw error;
      if (verifyAffectedRows({ requestedIds: [id], returnedRows: rows, entityName: 'inventory-location-update' }).outcome !== 'complete') {
        throw new Error(SINGLE_RECORD_NOT_UPDATED_MESSAGE);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-locations'] }),
  });

  // Hard delete — `inventory_locations.id` is `on delete restrict` from
  // stock/transactions/purchases/sales/requests, so this only ever succeeds
  // for a location with no activity yet; anything in use surfaces a
  // friendly "deactivate instead" message (see friendlyDeleteErrorMessage).
  const deleteLocation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('inventory_locations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-locations'] }),
  });

  return { locations, isLoading, createLocation, updateLocation, deleteLocation };
}

// Which guards currently hold Inventory access to which locations —
// director-only management surface (src/pages/inventory/StaffManagement.tsx,
// "Inventory managers"). Access is capability-based, not role-based: any
// existing guard can be granted it via an active row here.
export function useInventoryLocationStaff() {
  const queryClient = useQueryClient();
  const currentUser = useStore((s) => s.currentUser);

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['inventory-location-staff'],
    queryFn: async (): Promise<{ locationId: string; userId: string }[]> => {
      const { data, error } = await supabase.from('inventory_location_staff')
        .select('location_id, user_id').eq('active', true);
      if (error) throw error;
      return data.map((r) => ({ locationId: r.location_id, userId: r.user_id }));
    },
  });

  const assignStaff = useMutation({
    mutationFn: async ({ locationId, userId }: { locationId: string; userId: string }) => {
      const { error } = await supabase.from('inventory_location_staff').insert({
        location_id: locationId, user_id: userId, assigned_by: currentUser?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-location-staff'] }),
  });

  // Soft-deactivate, not a hard delete — preserves assignment history (who
  // held Inventory access to a location and when) rather than erasing it.
  // Scoped to `.eq('active', true)` so this only ever touches the current
  // active row for the pair, never a past historical one.
  const unassignStaff = useMutation({
    mutationFn: async ({ locationId, userId }: { locationId: string; userId: string }) => {
      const { error } = await supabase.from('inventory_location_staff')
        .update({ active: false, ended_at: new Date().toISOString() })
        .eq('location_id', locationId).eq('user_id', userId).eq('active', true);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-location-staff'] }),
  });

  return { assignments, isLoading, assignStaff, unassignStaff };
}
