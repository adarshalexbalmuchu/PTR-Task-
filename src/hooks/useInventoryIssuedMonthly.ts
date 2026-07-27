import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface InventoryIssuedMonthlyRow {
  itemId: string;
  locationId: string;
  month: string;
  issuedQty: number;
}

// Backs the Reports page's "Issuance trends" chart. Reads the
// inventory_issued_monthly view (security_invoker — RLS on the underlying
// inventory_transactions scopes rows the same as everywhere else). Views
// have no FK metadata for PostgREST to embed a join on, so item/location
// names are resolved client-side by the caller against
// useInventoryItems()/useInventoryLocations(), same pattern as other pages
// that cross-reference an already-loaded list instead of a query-time join.
export function useInventoryIssuedMonthly() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['inventory-issued-monthly'],
    queryFn: async (): Promise<InventoryIssuedMonthlyRow[]> => {
      const { data, error } = await supabase
        .from('inventory_issued_monthly')
        .select('*')
        .order('month', { ascending: true });
      if (error) throw error;
      return data.map((row) => ({
        itemId: row.item_id,
        locationId: row.location_id,
        month: row.month,
        issuedQty: row.issued_qty,
      }));
    },
  });

  return { rows, isLoading };
}
