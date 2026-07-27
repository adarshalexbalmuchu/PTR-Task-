import { supabase } from './supabase';
import type { Task } from '../types';

async function logAudit(params: {
  taskId?: string;
  taskTitle?: string;
  rangeId?: string;
  actorId: string;
  action: string;
  detail: string;
  inventoryItemId?: string;
  inventoryTransactionId?: string;
  inventoryRequestId?: string;
  inventoryPurchaseId?: string;
}) {
  // Best-effort — a logging failure should never block the underlying
  // task/inventory mutation the user actually cares about.
  await supabase.from('audit_log').insert({
    task_id: params.taskId ?? null,
    task_title: params.taskTitle ?? '',
    range_id: params.rangeId ?? null,
    actor_id: params.actorId,
    action: params.action,
    detail: params.detail,
    inventory_item_id: params.inventoryItemId ?? null,
    inventory_transaction_id: params.inventoryTransactionId ?? null,
    inventory_request_id: params.inventoryRequestId ?? null,
    inventory_purchase_id: params.inventoryPurchaseId ?? null,
  }).then(({ error }) => {
    if (error) console.error('audit log insert failed', error);
  });
}

export async function logTaskAction(task: Task, actorId: string, action: string, detail: string) {
  await logAudit({ taskId: task.id, taskTitle: task.title, rangeId: task.rangeId, actorId, action, detail });
}

// Mirrors logTaskAction for the Hospitality Inventory module — writes into
// the same audit_log table (director wanted one unified timeline) via its
// nullable inventory_item_id/inventory_transaction_id/inventory_request_id
// columns. Callers should pass whichever entity the action was actually
// about — a request-lifecycle action needs requestId, an issue needs
// itemId/transactionId — so the audit trail can be traced back to the
// specific record, not just a free-text description.
export async function logInventoryAction(
  actorId: string,
  action: string,
  detail: string,
  refs: { itemId?: string; transactionId?: string; requestId?: string; purchaseId?: string } = {},
) {
  await logAudit({
    actorId, action, detail,
    inventoryItemId: refs.itemId,
    inventoryTransactionId: refs.transactionId,
    inventoryRequestId: refs.requestId,
    inventoryPurchaseId: refs.purchaseId,
  });
}

// Compares a patch against the task's current state and logs only the
// fields that actually change (reassignment, status, priority, due date).
export async function logTaskChanges(
  before: Task,
  patch: Partial<Pick<Task, 'assigneeId' | 'status' | 'priority' | 'dueDate'>>,
  actorId: string,
) {
  const entries: string[] = [];
  if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
    entries.push('Reassigned');
  }
  if (patch.status !== undefined && patch.status !== before.status) {
    entries.push(`Status: ${before.status} → ${patch.status}`);
  }
  if (patch.priority !== undefined && patch.priority !== before.priority) {
    entries.push(`Priority: ${before.priority} → ${patch.priority}`);
  }
  if (patch.dueDate !== undefined && patch.dueDate !== before.dueDate) {
    entries.push('Due date changed');
  }
  if (entries.length === 0) return;
  await logTaskAction(before, actorId, 'update', entries.join('; '));
}

export async function logTaskDeletion(task: Task, actorId: string) {
  await logTaskAction(task, actorId, 'delete', `Task "${task.title}" deleted`);
}
