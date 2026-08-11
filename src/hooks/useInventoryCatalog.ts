import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { mapInventoryCategory, mapInventoryUnit, mapInventoryItem } from '../lib/mappers';
import { verifyAffectedRows, SINGLE_RECORD_NOT_UPDATED_MESSAGE } from '../lib/mutationVerification';
import type { InventoryCategory, InventoryUnit, InventoryItem, InventoryItemKind } from '../types';

// Catalog data (categories/units/items) is global-read for every inventory
// role — a request can only be raised for an item the requester can see,
// and the catalog isn't location-scoped (see inventory_categories_read /
// inventory_units_read / inventory_items_read in schema.sql).
export function useInventoryCategories() {
  const queryClient = useQueryClient();

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['inventory-categories'],
    queryFn: async (): Promise<InventoryCategory[]> => {
      const { data, error } = await supabase.from('inventory_categories').select('*').order('name');
      if (error) throw error;
      return data.map(mapInventoryCategory);
    },
  });

  const createCategory = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('inventory_categories').insert({ name });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-categories'] }),
  });

  // Hard delete — `inventory_categories.id` is `on delete restrict` from
  // inventory_items, so this only ever succeeds for a category no item
  // references yet; anything in use surfaces a friendly "deactivate
  // instead" message (see friendlyDeleteErrorMessage in the page).
  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('inventory_categories').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-categories'] }),
  });

  return { categories, isLoading, createCategory, deleteCategory };
}

export function useInventoryUnits() {
  const queryClient = useQueryClient();

  const { data: units = [], isLoading } = useQuery({
    queryKey: ['inventory-units'],
    queryFn: async (): Promise<InventoryUnit[]> => {
      const { data, error } = await supabase.from('inventory_units').select('*').order('name');
      if (error) throw error;
      return data.map(mapInventoryUnit);
    },
  });

  const createUnit = useMutation({
    mutationFn: async (input: { name: string; abbreviation?: string; allowsFractional?: boolean }) => {
      const { error } = await supabase.from('inventory_units').insert({
        name: input.name,
        abbreviation: input.abbreviation ?? '',
        allows_fractional: input.allowsFractional ?? true,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-units'] }),
  });

  // Hard delete — `inventory_units.id` is `on delete restrict` from
  // inventory_items, so this only ever succeeds for a unit no item
  // references yet.
  const deleteUnit = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('inventory_units').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-units'] }),
  });

  return { units, isLoading, createUnit, deleteUnit };
}

export function useInventoryItems() {
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: async (): Promise<InventoryItem[]> => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*, inventory_categories(name), inventory_units(abbreviation, allows_fractional)')
        .order('name');
      if (error) throw error;
      return data.map(mapInventoryItem);
    },
  });

  const createItem = useMutation({
    mutationFn: async (input: {
      name: string; categoryId: string; unitId: string; sku?: string; description?: string;
      kind?: InventoryItemKind; minStock?: number; reorderLevel?: number; maxStock?: number;
      trackExpiry?: boolean; trackBatch?: boolean;
    }) => {
      const { error } = await supabase.from('inventory_items').insert({
        name: input.name,
        category_id: input.categoryId,
        unit_id: input.unitId,
        sku: input.sku ?? null,
        description: input.description ?? '',
        kind: input.kind ?? 'consumable',
        min_stock: input.minStock ?? 0,
        reorder_level: input.reorderLevel ?? 0,
        max_stock: input.maxStock ?? null,
        track_expiry: input.trackExpiry ?? false,
        track_batch: input.trackBatch ?? false,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-items'] }),
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, ...data }: {
      id: string; name?: string; categoryId?: string; unitId?: string; sku?: string; description?: string;
      kind?: InventoryItemKind; minStock?: number; reorderLevel?: number; maxStock?: number | null;
      trackExpiry?: boolean; trackBatch?: boolean; active?: boolean;
    }) => {
      const patch: Database['public']['Tables']['inventory_items']['Update'] = {};
      if (data.name !== undefined) patch.name = data.name;
      if (data.categoryId !== undefined) patch.category_id = data.categoryId;
      if (data.unitId !== undefined) patch.unit_id = data.unitId;
      if (data.sku !== undefined) patch.sku = data.sku;
      if (data.description !== undefined) patch.description = data.description;
      if (data.kind !== undefined) patch.kind = data.kind;
      if (data.minStock !== undefined) patch.min_stock = data.minStock;
      if (data.reorderLevel !== undefined) patch.reorder_level = data.reorderLevel;
      if (data.maxStock !== undefined) patch.max_stock = data.maxStock;
      if (data.trackExpiry !== undefined) patch.track_expiry = data.trackExpiry;
      if (data.trackBatch !== undefined) patch.track_batch = data.trackBatch;
      if (data.active !== undefined) patch.active = data.active;

      const { data: rows, error } = await supabase.from('inventory_items').update(patch).eq('id', id).select('id');
      if (error) throw error;
      if (verifyAffectedRows({ requestedIds: [id], returnedRows: rows, entityName: 'inventory-item-update' }).outcome !== 'complete') {
        throw new Error(SINGLE_RECORD_NOT_UPDATED_MESSAGE);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-items'] }),
  });

  // Hard delete — `inventory_items.id` is `on delete restrict` from stock/
  // transactions/purchases/sales/request lines, so this only ever succeeds
  // for an item with no history yet; anything in use surfaces a friendly
  // "deactivate instead" message (see friendlyDeleteErrorMessage).
  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('inventory_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-items'] }),
  });

  return { items, isLoading, createItem, updateItem, deleteItem };
}
