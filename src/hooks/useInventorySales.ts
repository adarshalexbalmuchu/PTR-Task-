import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { mapInventorySale } from '../lib/mappers';
import { postInventorySale as postInventorySaleRpc } from '../lib/inventoryRpc';
import { logInventoryAction } from '../lib/audit';
import useStore from '../store/useStore';
import type { InventorySale } from '../types';

// RLS (inventory_sales_staff_read / inventory_sales_director) already scopes
// which rows come back — same pattern as useInventoryPurchases.
export function useInventorySales() {
  const queryClient = useQueryClient();
  const currentUser = useStore((s) => s.currentUser);

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ['inventory-sales'],
    queryFn: async (): Promise<InventorySale[]> => {
      const { data, error } = await supabase
        .from('inventory_sales')
        .select('*, inventory_locations(name), profiles(name), inventory_sale_items(*, inventory_items(name, inventory_units(abbreviation)))')
        .order('sale_date', { ascending: false });
      if (error) throw error;
      return data.map(mapInventorySale);
    },
  });

  const channelId = useRef(crypto.randomUUID()).current;
  useEffect(() => {
    const channel = supabase
      .channel(`inventory-sales-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_sales' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['inventory-sales'] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, channelId]);

  const createSale = useMutation({
    mutationFn: async (args: Parameters<typeof postInventorySaleRpc>[0]) => {
      const saleId = await postInventorySaleRpc(args);
      // A retried call recognized as a duplicate (saleId === null) must not
      // re-send the audit entry a second time.
      if (!saleId) return;
      if (currentUser) {
        await logInventoryAction(
          currentUser.id,
          'inventory_sale_recorded',
          `Recorded a sale of ${args.items.length} item line(s)${args.buyerName ? ` to ${args.buyerName}` : ''}`,
          { saleId },
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory-sales'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-batches'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-sales-monthly'] });
    },
  });

  return { sales, isLoading, createSale };
}
