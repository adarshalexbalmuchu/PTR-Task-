import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { mapInventoryPurchase } from '../lib/mappers';
import { postInventoryPurchase as postInventoryPurchaseRpc } from '../lib/inventoryRpc';
import { logInventoryAction } from '../lib/audit';
import useStore from '../store/useStore';
import type { InventoryPurchase } from '../types';

// RLS (inventory_purchases_staff_read / inventory_purchases_director) already
// scopes which rows come back — same pattern as useInventoryStock.
export function useInventoryPurchases() {
  const queryClient = useQueryClient();
  const currentUser = useStore((s) => s.currentUser);

  const { data: purchases = [], isLoading } = useQuery({
    queryKey: ['inventory-purchases'],
    queryFn: async (): Promise<InventoryPurchase[]> => {
      const { data, error } = await supabase
        .from('inventory_purchases')
        .select('*, inventory_locations(name), profiles(name), inventory_purchase_items(*, inventory_items(name, inventory_units(abbreviation)))')
        .order('purchase_date', { ascending: false });
      if (error) throw error;
      return data.map(mapInventoryPurchase);
    },
  });

  const channelId = useRef(crypto.randomUUID()).current;
  useEffect(() => {
    const channel = supabase
      .channel(`inventory-purchases-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_purchases' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['inventory-purchases'] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, channelId]);

  const createPurchase = useMutation({
    mutationFn: async (args: Parameters<typeof postInventoryPurchaseRpc>[0]) => {
      const purchaseId = await postInventoryPurchaseRpc(args);
      // A retried call recognized as a duplicate (purchaseId === null) must
      // not re-send the audit entry a second time.
      if (!purchaseId) return;
      if (currentUser) {
        await logInventoryAction(
          currentUser.id,
          'inventory_purchase_recorded',
          `Recorded a purchase of ${args.items.length} item line(s)${args.supplierName ? ` from ${args.supplierName}` : ''}`,
          { purchaseId },
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory-purchases'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-batches'] });
    },
  });

  return { purchases, isLoading, createPurchase };
}
