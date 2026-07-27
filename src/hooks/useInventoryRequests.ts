import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { NotificationType } from '../lib/database.types';
import { mapInventoryRequest } from '../lib/mappers';
import { logInventoryAction } from '../lib/audit';
import { verifyAffectedRows, SINGLE_RECORD_NOT_UPDATED_MESSAGE } from '../lib/mutationVerification';
import {
  approveInventoryRequest as approveRpc,
  rejectInventoryRequest as rejectRpc,
  issueInventoryStock as issueRpc,
  createInventoryRequest as createRequestRpc,
} from '../lib/inventoryRpc';
import useStore from '../store/useStore';
import type { InventoryRequest, TaskPriority } from '../types';

// One batched insert instead of a round-trip per recipient — same pattern
// as insertNotifications in useTasks.ts, keyed on inventory_request_id
// instead of task_id.
async function insertInventoryNotifications(
  userIds: string[],
  type: NotificationType,
  title: string,
  message: string,
  requestId: string,
) {
  if (userIds.length === 0) return;
  const { error } = await supabase.from('notifications').insert(
    userIds.map((userId) => ({ user_id: userId, type, title, message, inventory_request_id: requestId })),
  );
  if (error) console.error('notification insert failed', error);
}

export function useInventoryRequests() {
  const queryClient = useQueryClient();
  const currentUser = useStore((s) => s.currentUser);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['inventory-requests'],
    queryFn: async (): Promise<InventoryRequest[]> => {
      // Pre-existing bug fixed here: inventory_request_items(*) alone never
      // embedded inventory_items, so mapInventoryRequestItem's itemName/
      // unitAbbreviation/allowsFractional silently resolved to undefined for
      // every request line (the New Request form's items came from a
      // separately, correctly-joined query, which is why this went unnoticed).
      const { data, error } = await supabase
        .from('inventory_requests')
        .select('*, inventory_locations(name), profiles(name), inventory_request_items(*, inventory_items(name, unit_id, inventory_units(abbreviation, allows_fractional)))')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(mapInventoryRequest);
    },
  });

  const channelId = useRef(crypto.randomUUID()).current;
  useEffect(() => {
    const channel = supabase
      .channel(`inventory-requests-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_requests' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['inventory-requests'] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, channelId]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['inventory-requests'] });

  const createRequest = useMutation({
    mutationFn: async (input: {
      requestingLocationId: string;
      items: { itemId: string; requestedQty: number; notes?: string }[];
      requiredByDate?: string;
      priority?: TaskPriority;
      reason?: string;
      notes?: string;
    }) => {
      if (!currentUser) throw new Error('Not authenticated');
      // Single SECURITY DEFINER RPC, not two separate inserts: the request
      // header and its item rows are written in one atomic transaction, so
      // a failure on the items (inactive item, duplicate item) can't leave
      // a zero-item request header behind.
      return createRequestRpc({
        requestingLocationId: input.requestingLocationId,
        items: input.items,
        requiredByDate: input.requiredByDate,
        priority: input.priority,
        reason: input.reason,
      });
    },
    onSuccess: invalidate,
  });

  // Draft -> Submitted is a plain RLS-gated update (no balance is touched),
  // unlike approve/reject/issue which must go through the RPCs below.
  const submitRequest = useMutation({
    mutationFn: async (requestId: string) => {
      // Scoped to `.eq('status', 'Draft')` so a retried call (the first
      // attempt actually succeeded, but the client didn't see the
      // response) naturally affects 0 rows instead of re-submitting an
      // already-submitted request — checked below to tell that apart from
      // a genuine failure, so retries don't duplicate the notification.
      const { data, error } = await supabase.from('inventory_requests')
        .update({ status: 'Submitted' }).eq('id', requestId).eq('status', 'Draft').select('id');
      if (error) throw error;
      if (verifyAffectedRows({ requestedIds: [requestId], returnedRows: data, entityName: 'inventory-request-submit' }).outcome !== 'complete') {
        const { data: current } = await supabase.from('inventory_requests').select('status').eq('id', requestId).single();
        if (current?.status === 'Submitted') return; // already done by an earlier attempt — no-op
        throw new Error(SINGLE_RECORD_NOT_UPDATED_MESSAGE);
      }
      // Directors are globally readable (profiles_read), so this resolves
      // fine from an assigned guard's session without needing a
      // server-side recipient-resolution trigger the way incident_reported does.
      const { data: directors } = await supabase.from('profiles').select('id').eq('role', 'director');
      await insertInventoryNotifications(
        (directors ?? []).map((d) => d.id),
        'inventory_request_submitted',
        'Inventory request submitted',
        `${currentUser?.name ?? 'A staff member'} submitted a stock request awaiting review.`,
        requestId,
      );
      if (currentUser) await logInventoryAction(currentUser.id, 'inventory_request_submitted', 'Request submitted for review', { requestId });
    },
    onSuccess: invalidate,
  });

  const cancelRequest = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase.from('inventory_requests')
        .update({ status: 'Cancelled' }).eq('id', requestId).in('status', ['Draft', 'Submitted']).select('id');
      if (error) throw error;
      if (verifyAffectedRows({ requestedIds: [requestId], returnedRows: data, entityName: 'inventory-request-cancel' }).outcome !== 'complete') {
        const { data: current } = await supabase.from('inventory_requests').select('status').eq('id', requestId).single();
        if (current?.status === 'Cancelled') return; // already done by an earlier attempt — no-op
        throw new Error(SINGLE_RECORD_NOT_UPDATED_MESSAGE);
      }
      if (currentUser) await logInventoryAction(currentUser.id, 'inventory_request_cancelled', 'Request cancelled', { requestId });
    },
    onSuccess: invalidate,
  });

  const approveRequest = useMutation({
    mutationFn: async ({ requestId, approvals, requesterId }: {
      requestId: string; approvals: { requestItemId: string; approvedQty: number }[]; requesterId: string;
    }) => {
      await approveRpc(requestId, approvals);
      await insertInventoryNotifications(
        [requesterId], 'inventory_request_approved', 'Request approved',
        'Your stock request was approved.', requestId,
      );
      if (currentUser) await logInventoryAction(currentUser.id, 'inventory_request_approved', 'Request approved', { requestId });
    },
    onSuccess: invalidate,
  });

  const rejectRequest = useMutation({
    mutationFn: async ({ requestId, reason, requesterId }: { requestId: string; reason: string; requesterId: string }) => {
      await rejectRpc(requestId, reason);
      await insertInventoryNotifications(
        [requesterId], 'inventory_request_rejected', 'Request rejected', reason, requestId,
      );
      if (currentUser) await logInventoryAction(currentUser.id, 'inventory_request_rejected', `Request rejected: ${reason}`, { requestId });
    },
    onSuccess: invalidate,
  });

  const issueStock = useMutation({
    mutationFn: async (args: {
      requestItemId: string; locationId: string; quantity: number; notes?: string;
      requestId: string; requesterId: string; itemId?: string; idempotencyKey?: string;
    }) => {
      const applied = await issueRpc({
        requestItemId: args.requestItemId, locationId: args.locationId, quantity: args.quantity,
        notes: args.notes, idempotencyKey: args.idempotencyKey,
      });
      // A retried call recognized as a duplicate (applied === false) must
      // not re-send the notification/audit entry a second time.
      if (!applied) return;
      await insertInventoryNotifications(
        [args.requesterId], 'inventory_stock_issued', 'Stock issued',
        'Stock has been issued for your request.', args.requestId,
      );
      if (currentUser) {
        await logInventoryAction(currentUser.id, 'inventory_stock_issued', `Issued ${args.quantity} unit(s)`, {
          requestId: args.requestId, itemId: args.itemId,
        });
      }
    },
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
    },
  });

  return { requests, isLoading, createRequest, submitRequest, cancelRequest, approveRequest, rejectRequest, issueStock };
}
