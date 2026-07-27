import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();

vi.mock('./supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const { postOpeningBalance, issueInventoryStock, createInventoryRequest, approveInventoryRequest, rejectInventoryRequest, postInventoryPurchase } =
  await import('./inventoryRpc');

beforeEach(() => {
  rpc.mockReset();
});

describe('postOpeningBalance', () => {
  it('calls post_opening_balance with correctly mapped params', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await postOpeningBalance({ itemId: 'item-1', locationId: 'loc-1', quantity: 25, notes: 'seed', idempotencyKey: 'key-1' });
    expect(rpc).toHaveBeenCalledWith('post_opening_balance', {
      p_item_id: 'item-1',
      p_location_id: 'loc-1',
      p_quantity: 25,
      p_notes: 'seed',
      p_idempotency_key: 'key-1',
    });
  });

  it('defaults notes to empty string and idempotency key to null when omitted', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await postOpeningBalance({ itemId: 'item-1', locationId: 'loc-1', quantity: 10 });
    expect(rpc).toHaveBeenCalledWith('post_opening_balance', expect.objectContaining({ p_notes: '', p_idempotency_key: null }));
  });

  it('returns the RPC-reported applied flag (false for a deduped retry)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const applied = await postOpeningBalance({ itemId: 'item-1', locationId: 'loc-1', quantity: 10, idempotencyKey: 'key-1' });
    expect(applied).toBe(false);
  });

  it('throws a JS Error carrying the Postgres error message on failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Only a director can post an opening balance' } });
    await expect(postOpeningBalance({ itemId: 'item-1', locationId: 'loc-1', quantity: 10 }))
      .rejects.toThrow('Only a director can post an opening balance');
  });
});

describe('issueInventoryStock', () => {
  it('calls issue_inventory_stock with correctly mapped params including the idempotency key', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await issueInventoryStock({ requestItemId: 'ri-1', locationId: 'loc-1', quantity: 5, idempotencyKey: 'key-2' });
    expect(rpc).toHaveBeenCalledWith('issue_inventory_stock', expect.objectContaining({
      p_request_item_id: 'ri-1', p_location_id: 'loc-1', p_quantity: 5, p_idempotency_key: 'key-2',
    }));
  });

  it('surfaces a deduped retry as applied = false', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const applied = await issueInventoryStock({ requestItemId: 'ri-1', locationId: 'loc-1', quantity: 5, idempotencyKey: 'key-2' });
    expect(applied).toBe(false);
  });

  it('throws on error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Cannot issue more than the approved quantity' } });
    await expect(issueInventoryStock({ requestItemId: 'ri-1', locationId: 'loc-1', quantity: 999 }))
      .rejects.toThrow('Cannot issue more than the approved quantity');
  });
});

describe('createInventoryRequest', () => {
  it('maps items to the RPC jsonb shape', async () => {
    rpc.mockResolvedValue({ data: 'new-request-id', error: null });
    const id = await createInventoryRequest({
      requestingLocationId: 'loc-1',
      items: [{ itemId: 'item-1', requestedQty: 3 }, { itemId: 'item-2', requestedQty: 1.5 }],
    });
    expect(id).toBe('new-request-id');
    expect(rpc).toHaveBeenCalledWith('create_inventory_request', expect.objectContaining({
      p_requesting_location_id: 'loc-1',
      p_items: [{ item_id: 'item-1', requested_qty: 3, notes: '' }, { item_id: 'item-2', requested_qty: 1.5, notes: '' }],
    }));
  });

  it('carries a per-item note through to the RPC (the "Other / not listed" free-text case)', async () => {
    rpc.mockResolvedValue({ data: 'new-request-id', error: null });
    await createInventoryRequest({
      requestingLocationId: 'loc-1',
      items: [{ itemId: 'other-item-id', requestedQty: 1, notes: 'Need a spare tent pole' }],
    });
    expect(rpc).toHaveBeenCalledWith('create_inventory_request', expect.objectContaining({
      p_items: [{ item_id: 'other-item-id', requested_qty: 1, notes: 'Need a spare tent pole' }],
    }));
  });

  it('throws when the request must include at least one item', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'A request must include at least one item' } });
    await expect(createInventoryRequest({ requestingLocationId: 'loc-1', items: [] }))
      .rejects.toThrow('A request must include at least one item');
  });
});

describe('postInventoryPurchase', () => {
  it('maps args and items to the RPC jsonb shape', async () => {
    rpc.mockResolvedValue({ data: 'new-purchase-id', error: null });
    const id = await postInventoryPurchase({
      locationId: 'loc-1',
      supplierName: 'Acme Supplies',
      purchaseDate: '2026-07-27',
      items: [{ itemId: 'item-1', quantity: 10, unitCost: 25.5, batchNumber: 'B1', expiryDate: '2026-12-31' }],
      idempotencyKey: 'key-3',
    });
    expect(id).toBe('new-purchase-id');
    expect(rpc).toHaveBeenCalledWith('post_inventory_purchase', {
      p_location_id: 'loc-1',
      p_supplier_name: 'Acme Supplies',
      p_invoice_number: null,
      p_purchase_date: '2026-07-27',
      p_notes: '',
      p_items: [{ item_id: 'item-1', quantity: 10, unit_cost: 25.5, batch_number: 'B1', expiry_date: '2026-12-31' }],
      p_idempotency_key: 'key-3',
    });
  });

  it('returns null for a deduped retry', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const id = await postInventoryPurchase({
      locationId: 'loc-1', purchaseDate: '2026-07-27', items: [{ itemId: 'item-1', quantity: 1 }], idempotencyKey: 'key-3',
    });
    expect(id).toBeNull();
  });

  it('throws on a permission error from an unassigned location', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'You are not assigned to this location' } });
    await expect(postInventoryPurchase({ locationId: 'loc-1', purchaseDate: '2026-07-27', items: [{ itemId: 'item-1', quantity: 1 }] }))
      .rejects.toThrow('You are not assigned to this location');
  });
});

describe('approveInventoryRequest / rejectInventoryRequest', () => {
  it('approve maps approvals to the RPC jsonb shape', async () => {
    rpc.mockResolvedValue({ error: null });
    await approveInventoryRequest('req-1', [{ requestItemId: 'ri-1', approvedQty: 4 }]);
    expect(rpc).toHaveBeenCalledWith('approve_inventory_request', {
      p_request_id: 'req-1',
      p_item_approvals: [{ request_item_id: 'ri-1', approved_qty: 4 }],
    });
  });

  it('reject rejects on a permission error from a non-director caller', async () => {
    rpc.mockResolvedValue({ error: { message: 'Only a director can reject a request' } });
    await expect(rejectInventoryRequest('req-1', 'out of stock')).rejects.toThrow('Only a director can reject a request');
  });
});
