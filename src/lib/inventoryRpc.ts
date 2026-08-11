import { supabase } from './supabase';

// Called through a narrow shim rather than the typed client — same reason
// as claim_push_subscription in src/utils/push.ts: this project's hand-written
// database.types.ts models Functions as an empty map (populating it breaks
// supabase-js's embedded-relationship type inference elsewhere in the app),
// so the typed `supabase.rpc` doesn't know these functions. Must be invoked
// as `client.rpc(...)`, not via an extracted `const rpc = client.rpc` —
// supabase-js's rpc() reads `this.rest` internally, so a detached call throws.
type PgError = { message: string; code?: string };
const client = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: PgError | null }>;
};
const clientWithData = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PgError | null }>;
};

export async function createInventoryRequest(args: {
  requestingLocationId: string;
  items: { itemId: string; requestedQty: number; notes?: string }[];
  requiredByDate?: string;
  priority?: string;
  reason?: string;
}): Promise<string> {
  const { data, error } = await clientWithData.rpc('create_inventory_request', {
    p_requesting_location_id: args.requestingLocationId,
    p_items: args.items.map((i) => ({ item_id: i.itemId, requested_qty: i.requestedQty, notes: i.notes ?? '' })),
    p_required_by_date: args.requiredByDate ?? null,
    p_priority: args.priority ?? 'Medium',
    p_reason: args.reason ?? '',
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// Returns whether this call actually applied the posting (false means a
// retried call with the same idempotencyKey was recognized as a duplicate
// and safely skipped).
export async function postOpeningBalance(args: {
  itemId: string; locationId: string; quantity: number; notes?: string; idempotencyKey?: string;
}): Promise<boolean> {
  const { data, error } = await clientWithData.rpc('post_opening_balance', {
    p_item_id: args.itemId,
    p_location_id: args.locationId,
    p_quantity: args.quantity,
    p_notes: args.notes ?? '',
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) throw new Error(error.message);
  return data as boolean;
}

export async function approveInventoryRequest(
  requestId: string,
  approvals: { requestItemId: string; approvedQty: number }[],
): Promise<void> {
  const { error } = await client.rpc('approve_inventory_request', {
    p_request_id: requestId,
    p_item_approvals: approvals.map((a) => ({ request_item_id: a.requestItemId, approved_qty: a.approvedQty })),
  });
  if (error) throw new Error(error.message);
}

export async function rejectInventoryRequest(requestId: string, reason: string): Promise<void> {
  const { error } = await client.rpc('reject_inventory_request', { p_request_id: requestId, p_reason: reason });
  if (error) throw new Error(error.message);
}

// Returns whether this call actually applied the issue (false means a
// retried call with the same idempotencyKey was recognized as a duplicate
// and safely skipped — callers should not re-send notifications/audit
// entries for a skipped call).
export async function issueInventoryStock(args: {
  requestItemId: string; locationId: string; quantity: number; notes?: string; idempotencyKey?: string;
}): Promise<boolean> {
  const { data, error } = await clientWithData.rpc('issue_inventory_stock', {
    p_request_item_id: args.requestItemId,
    p_location_id: args.locationId,
    p_quantity: args.quantity,
    p_notes: args.notes ?? '',
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) throw new Error(error.message);
  return data as boolean;
}

// Returns the new purchase's id, or null if a retried call with the same
// idempotencyKey was recognized as a duplicate and safely skipped.
export async function postInventoryPurchase(args: {
  locationId: string;
  supplierName?: string;
  invoiceNumber?: string;
  purchaseDate: string;
  notes?: string;
  items: { itemId: string; quantity: number; unitCost?: number; batchNumber?: string; expiryDate?: string }[];
  idempotencyKey?: string;
}): Promise<string | null> {
  const { data, error } = await clientWithData.rpc('post_inventory_purchase', {
    p_location_id: args.locationId,
    p_supplier_name: args.supplierName ?? '',
    p_invoice_number: args.invoiceNumber ?? null,
    p_purchase_date: args.purchaseDate,
    p_notes: args.notes ?? '',
    p_items: args.items.map((i) => ({
      item_id: i.itemId,
      quantity: i.quantity,
      unit_cost: i.unitCost ?? null,
      batch_number: i.batchNumber ?? null,
      expiry_date: i.expiryDate ?? null,
    })),
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string | null;
}

// Returns the new sale's id, or null if a retried call with the same
// idempotencyKey was recognized as a duplicate and safely skipped.
export async function postInventorySale(args: {
  locationId: string;
  buyerName?: string;
  invoiceNumber?: string;
  saleDate: string;
  notes?: string;
  items: { itemId: string; quantity: number; unitPrice?: number }[];
  idempotencyKey?: string;
}): Promise<string | null> {
  const { data, error } = await clientWithData.rpc('post_inventory_sale', {
    p_location_id: args.locationId,
    p_buyer_name: args.buyerName ?? '',
    p_invoice_number: args.invoiceNumber ?? null,
    p_sale_date: args.saleDate,
    p_notes: args.notes ?? '',
    p_items: args.items.map((i) => ({
      item_id: i.itemId,
      quantity: i.quantity,
      unit_price: i.unitPrice ?? null,
    })),
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string | null;
}
