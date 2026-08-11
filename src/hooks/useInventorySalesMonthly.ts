import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface InventorySalesMonthlyRow {
  itemId: string;
  locationId: string;
  month: string;
  soldQty: number;
  revenue: number;
}

// Backs the Reports page's Sales tab. Reads the inventory_sales_monthly
// view (security_invoker — RLS on the underlying inventory_sales/
// inventory_sale_items scopes rows the same as everywhere else). Views have
// no FK metadata for PostgREST to embed a join on, so item/location names
// are resolved client-side by the caller against
// useInventoryItems()/useInventoryLocations(), same pattern as
// useInventoryIssuedMonthly.
export function useInventorySalesMonthly() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['inventory-sales-monthly'],
    queryFn: async (): Promise<InventorySalesMonthlyRow[]> => {
      const { data, error } = await supabase
        .from('inventory_sales_monthly')
        .select('*')
        .order('month', { ascending: true });
      if (error) throw error;
      return data.map((row) => ({
        itemId: row.item_id,
        locationId: row.location_id,
        month: row.month,
        soldQty: row.sold_qty,
        revenue: row.revenue,
      }));
    },
  });

  return { rows, isLoading };
}
