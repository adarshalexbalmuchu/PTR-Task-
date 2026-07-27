import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { mapInventoryBatch } from '../lib/mappers';
import type { InventoryBatch } from '../types';

// Read-only — batches are only ever written by post_inventory_purchase /
// issue_inventory_stock's FEFO depletion (both SECURITY DEFINER RPCs), same
// discipline as inventory_stock/inventory_transactions. RLS
// (inventory_batches_staff_read / inventory_batches_director) already scopes
// which rows come back.
export function useInventoryBatches() {
  const queryClient = useQueryClient();

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['inventory-batches'],
    queryFn: async (): Promise<InventoryBatch[]> => {
      const { data, error } = await supabase
        .from('inventory_batches')
        .select('*, inventory_items(name), inventory_locations(name)')
        .order('expiry_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data.map(mapInventoryBatch);
    },
  });

  const channelId = useRef(crypto.randomUUID()).current;
  useEffect(() => {
    const channel = supabase
      .channel(`inventory-batches-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_batches' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['inventory-batches'] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, channelId]);

  return { batches, isLoading };
}
