import type { Database, Json } from './database.types';
import type {
  User, Task, TaskUpdate, Comment, Attachment, Notification, Incident, IncidentPhoto, AuditLogEntry, LiveLocation,
  InventoryLocation, InventoryCategory, InventoryUnit, InventoryItem, InventoryStock, InventoryTransaction,
  InventoryRequest, InventoryRequestItem, InventoryRequestPhoto, InventoryPurchase, InventoryPurchaseItem, InventoryBatch,
  TaskGroup, TaskGroupMember, TaskOccurrence, GroupMessage,
  TaskSeries, RecurrenceRule,
} from '../types';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type TaskRow = Database['public']['Tables']['tasks']['Row'];
type TaskUpdateRow = Database['public']['Tables']['task_updates']['Row'];
type CommentRow = Database['public']['Tables']['comments']['Row'];
type AttachmentRow = Database['public']['Tables']['attachments']['Row'];
type NotificationRow = Database['public']['Tables']['notifications']['Row'];
type IncidentRow = Database['public']['Tables']['incidents']['Row'];
type IncidentPhotoRow = Database['public']['Tables']['incident_photos']['Row'];
type AuditLogRow = Database['public']['Tables']['audit_log']['Row'];
type TaskGroupRow = Database['public']['Tables']['task_groups']['Row'];
type TaskGroupMemberRow = Database['public']['Tables']['task_group_members']['Row'];
type TaskOccurrenceRow = Database['public']['Tables']['task_occurrences']['Row'];
type TaskMessageRow = Database['public']['Tables']['task_messages']['Row'];
type TaskSeriesRow = Database['public']['Tables']['task_series']['Row'];

export function mapProfile(row: ProfileRow): User {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email,
    phone: row.phone ?? undefined,
    avatarInitials: row.avatar_initials,
    designation: row.designation,
    rangeId: row.range_id ?? undefined,
  };
}

export function mapTaskUpdate(row: TaskUpdateRow): TaskUpdate {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    note: row.note,
    progressPercentage: row.progress_percentage,
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    createdAt: row.created_at,
  };
}

export function mapComment(row: CommentRow): Comment {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function mapAttachment(row: AttachmentRow): Attachment {
  // row.url stores the bare storage path; resolveAttachmentUrls() replaces
  // url/previewUrl with a time-limited signed URL before this reaches the UI.
  return {
    id: row.id,
    name: row.name,
    type: row.mime_type,
    size: row.size,
    path: row.url,
    url: row.url,
    previewUrl: undefined,
  };
}

export function mapTask(
  row: TaskRow & {
    task_updates?: TaskUpdateRow[];
    comments?: CommentRow[];
    attachments?: AttachmentRow[];
    task_assignees?: { user_id: string }[];
  },
): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    assigneeId: row.assignee_id,
    coAssigneeIds: (row.task_assignees ?? []).map((a) => a.user_id),
    createdById: row.created_by_id,
    rangeId: row.range_id,
    areaId: row.area_id ?? undefined,
    status: row.status,
    priority: row.priority,
    category: row.category,
    categoryOther: row.category_other ?? undefined,
    dueDate: row.due_date,
    completionPercentage: row.completion_percentage,
    acknowledgedAt: row.acknowledged_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    batchId: row.batch_id ?? undefined,
    groupId: row.group_id ?? undefined,
    seriesId: row.series_id ?? undefined,
    occurrenceId: row.occurrence_id ?? undefined,
    createdAt: row.created_at,
    taskUpdates: (row.task_updates ?? []).map(mapTaskUpdate),
    comments: (row.comments ?? []).map(mapComment),
    attachments: (row.attachments ?? []).map(mapAttachment),
  };
}

export function mapNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    message: row.message,
    taskId: row.task_id ?? undefined,
    incidentId: row.incident_id ?? undefined,
    inventoryRequestId: row.inventory_request_id ?? undefined,
    seriesId: row.series_id ?? undefined,
    occurrenceId: row.occurrence_id ?? undefined,
    read: row.read,
    createdAt: row.created_at,
  };
}

export function mapIncidentPhoto(row: IncidentPhotoRow): IncidentPhoto {
  // row.path stores the bare storage path; resolveIncidentPhotoUrls() in
  // useIncidents.ts replaces url with a time-limited signed URL.
  return {
    id: row.id,
    path: row.path,
    url: row.path,
    size: row.size,
    type: row.mime_type,
  };
}

export function mapIncident(
  row: IncidentRow & {
    incident_photos?: IncidentPhotoRow[];
    profiles?: { name: string } | null;
    assignee?: { name: string } | null;
  },
): Incident {
  return {
    id: row.id,
    type: row.type,
    typeOther: row.type_other ?? undefined,
    severity: row.severity,
    status: row.status,
    description: row.description,
    rangeId: row.range_id,
    areaId: row.area_id ?? undefined,
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    reportedBy: row.reported_by,
    reporterName: row.profiles?.name ?? undefined,
    assignedTo: row.assigned_to ?? undefined,
    assigneeName: row.assignee?.name ?? undefined,
    assignedAt: row.assigned_at ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    incidentDate: row.incident_date,
    createdAt: row.created_at,
    photos: (row.incident_photos ?? []).map(mapIncidentPhoto),
  };
}

type LiveLocationRow = Database['public']['Tables']['live_locations']['Row'];

export function mapLiveLocation(
  row: LiveLocationRow & {
    profiles: { name: string; avatar_initials: string; designation: string } | null;
    tasks: { title: string } | null;
  },
): LiveLocation {
  return {
    userId: row.user_id,
    userName: row.profiles?.name ?? 'Unknown',
    avatarInitials: row.profiles?.avatar_initials ?? '',
    designation: row.profiles?.designation ?? '',
    taskId: row.task_id,
    taskTitle: row.tasks?.title ?? 'Untitled task',
    lat: row.lat,
    lng: row.lng,
    updatedAt: row.updated_at,
  };
}

export function mapAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    taskId: row.task_id ?? undefined,
    taskTitle: row.task_title,
    rangeId: row.range_id ?? undefined,
    actorId: row.actor_id,
    action: row.action,
    detail: row.detail,
    inventoryItemId: row.inventory_item_id ?? undefined,
    inventoryTransactionId: row.inventory_transaction_id ?? undefined,
    createdAt: row.created_at,
  };
}

// ─────────────────────────────────────────────
// Hospitality Inventory Management (Phase 1)
// ─────────────────────────────────────────────

type InventoryLocationRow = Database['public']['Tables']['inventory_locations']['Row'];
type InventoryCategoryRow = Database['public']['Tables']['inventory_categories']['Row'];
type InventoryUnitRow = Database['public']['Tables']['inventory_units']['Row'];
type InventoryItemRow = Database['public']['Tables']['inventory_items']['Row'];
type InventoryStockRow = Database['public']['Tables']['inventory_stock']['Row'];
type InventoryTransactionRow = Database['public']['Tables']['inventory_transactions']['Row'];
type InventoryRequestRow = Database['public']['Tables']['inventory_requests']['Row'];
type InventoryRequestItemRow = Database['public']['Tables']['inventory_request_items']['Row'];
type InventoryRequestPhotoRow = Database['public']['Tables']['inventory_request_photos']['Row'];
type InventoryPurchaseRow = Database['public']['Tables']['inventory_purchases']['Row'];
type InventoryPurchaseItemRow = Database['public']['Tables']['inventory_purchase_items']['Row'];
type InventoryBatchRow = Database['public']['Tables']['inventory_batches']['Row'];

export function mapInventoryLocation(row: InventoryLocationRow): InventoryLocation {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    rangeId: row.range_id ?? undefined,
    addressDescription: row.address_description,
    parentLocationId: row.parent_location_id ?? undefined,
    active: row.active,
    createdAt: row.created_at,
  };
}

export function mapInventoryCategory(row: InventoryCategoryRow): InventoryCategory {
  return { id: row.id, name: row.name, active: row.active };
}

export function mapInventoryUnit(row: InventoryUnitRow): InventoryUnit {
  return { id: row.id, name: row.name, abbreviation: row.abbreviation, active: row.active, allowsFractional: row.allows_fractional };
}

export function mapInventoryItem(
  row: InventoryItemRow & {
    inventory_categories?: { name: string } | null;
    inventory_units?: { abbreviation: string; allows_fractional?: boolean } | null;
  },
): InventoryItem {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.inventory_categories?.name ?? undefined,
    sku: row.sku ?? undefined,
    description: row.description,
    unitId: row.unit_id,
    unitAbbreviation: row.inventory_units?.abbreviation ?? undefined,
    allowsFractional: row.inventory_units?.allows_fractional,
    kind: row.kind,
    minStock: row.min_stock,
    reorderLevel: row.reorder_level,
    maxStock: row.max_stock ?? undefined,
    trackExpiry: row.track_expiry,
    trackBatch: row.track_batch,
    active: row.active,
    photoPath: row.photo_path ?? undefined,
    // photo_path is a bare storage path; a signed URL is resolved separately
    // (same pattern as mapAttachment/mapIncidentPhoto), not filled in here.
    photoUrl: undefined,
  };
}

export function mapInventoryStock(
  row: InventoryStockRow & {
    inventory_items?: { name: string; unit_id: string; min_stock: number; reorder_level: number; inventory_units?: { abbreviation: string; allows_fractional?: boolean } | null } | null;
    inventory_locations?: { name: string } | null;
  },
): InventoryStock {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.inventory_items?.name ?? undefined,
    unitAbbreviation: row.inventory_items?.inventory_units?.abbreviation ?? undefined,
    allowsFractional: row.inventory_items?.inventory_units?.allows_fractional,
    locationId: row.location_id,
    locationName: row.inventory_locations?.name ?? undefined,
    availableQty: row.available_qty,
    reservedQty: row.reserved_qty,
    inUseQty: row.in_use_qty,
    damagedQty: row.damaged_qty,
    expiredQty: row.expired_qty,
    minStock: row.inventory_items?.min_stock,
    reorderLevel: row.inventory_items?.reorder_level,
    updatedAt: row.updated_at,
  };
}

export function mapInventoryTransaction(
  row: InventoryTransactionRow & {
    inventory_items?: { name: string } | null;
    inventory_locations?: { name: string } | null;
    performed_by_profile?: { name: string } | null;
  },
): InventoryTransaction {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.inventory_items?.name ?? undefined,
    locationId: row.location_id,
    locationName: row.inventory_locations?.name ?? undefined,
    quantity: row.quantity,
    transactionType: row.transaction_type,
    sourceLocationId: row.source_location_id ?? undefined,
    destinationLocationId: row.destination_location_id ?? undefined,
    relatedRequestId: row.related_request_id ?? undefined,
    performedBy: row.performed_by,
    performedByName: row.performed_by_profile?.name ?? undefined,
    approvedBy: row.approved_by ?? undefined,
    notes: row.notes,
    attachmentPath: row.attachment_path ?? undefined,
    previousBalance: row.previous_balance,
    newBalance: row.new_balance,
    createdAt: row.created_at,
  };
}

export function mapInventoryRequestItem(
  row: InventoryRequestItemRow & {
    inventory_items?: { name: string; inventory_units?: { abbreviation: string; allows_fractional?: boolean } | null } | null;
  },
): InventoryRequestItem {
  return {
    id: row.id,
    requestId: row.request_id,
    itemId: row.item_id,
    itemName: row.inventory_items?.name ?? undefined,
    unitAbbreviation: row.inventory_items?.inventory_units?.abbreviation ?? undefined,
    allowsFractional: row.inventory_items?.inventory_units?.allows_fractional,
    requestedQty: row.requested_qty,
    approvedQty: row.approved_qty ?? undefined,
    fulfilledQty: row.fulfilled_qty,
    notes: row.notes,
  };
}

// row.path stores the bare storage path; resolveInventoryRequestPhotoUrls()
// in useInventoryRequests.ts replaces url with a time-limited signed URL —
// same pattern as mapIncidentPhoto.
export function mapInventoryRequestPhoto(row: InventoryRequestPhotoRow): InventoryRequestPhoto {
  return {
    id: row.id,
    path: row.path,
    url: row.path,
    size: row.size,
    type: row.mime_type,
  };
}

export function mapInventoryRequest(
  row: InventoryRequestRow & {
    inventory_locations?: { name: string } | null;
    profiles?: { name: string } | null;
    inventory_request_items?: InventoryRequestItemRow[];
    inventory_request_photos?: InventoryRequestPhotoRow[];
  },
): InventoryRequest {
  return {
    id: row.id,
    requestingLocationId: row.requesting_location_id,
    requestingLocationName: row.inventory_locations?.name ?? undefined,
    requestedBy: row.requested_by,
    requestedByName: row.profiles?.name ?? undefined,
    status: row.status,
    requiredByDate: row.required_by_date ?? undefined,
    priority: row.priority,
    reason: row.reason,
    notes: row.notes,
    rejectReason: row.reject_reason ?? undefined,
    items: (row.inventory_request_items ?? []).map(mapInventoryRequestItem),
    photos: (row.inventory_request_photos ?? []).map(mapInventoryRequestPhoto),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─────────────────────────────────────────────
// Hospitality Inventory Management — Phase 2 (procurement + batch/expiry)
// ─────────────────────────────────────────────

export function mapInventoryPurchaseItem(
  row: InventoryPurchaseItemRow & {
    inventory_items?: { name: string; inventory_units?: { abbreviation: string } | null } | null;
  },
): InventoryPurchaseItem {
  return {
    id: row.id,
    purchaseId: row.purchase_id,
    itemId: row.item_id,
    itemName: row.inventory_items?.name ?? undefined,
    unitAbbreviation: row.inventory_items?.inventory_units?.abbreviation ?? undefined,
    quantity: row.quantity,
    unitCost: row.unit_cost ?? undefined,
    batchNumber: row.batch_number ?? undefined,
    expiryDate: row.expiry_date ?? undefined,
    notes: row.notes,
  };
}

export function mapInventoryPurchase(
  row: InventoryPurchaseRow & {
    inventory_locations?: { name: string } | null;
    profiles?: { name: string } | null;
    inventory_purchase_items?: InventoryPurchaseItemRow[];
  },
): InventoryPurchase {
  return {
    id: row.id,
    locationId: row.location_id,
    locationName: row.inventory_locations?.name ?? undefined,
    supplierName: row.supplier_name,
    invoiceNumber: row.invoice_number ?? undefined,
    purchaseDate: row.purchase_date,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.profiles?.name ?? undefined,
    items: (row.inventory_purchase_items ?? []).map(mapInventoryPurchaseItem),
    createdAt: row.created_at,
  };
}

export function mapInventoryBatch(
  row: InventoryBatchRow & {
    inventory_items?: { name: string } | null;
    inventory_locations?: { name: string } | null;
  },
): InventoryBatch {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.inventory_items?.name ?? undefined,
    locationId: row.location_id,
    locationName: row.inventory_locations?.name ?? undefined,
    batchNumber: row.batch_number ?? undefined,
    expiryDate: row.expiry_date ?? undefined,
    receivedQty: row.received_qty,
    remainingQty: row.remaining_qty,
    sourcePurchaseId: row.source_purchase_id ?? undefined,
    createdAt: row.created_at,
  };
}

// ─────────────────────────────────────────────
// Task Groups & Recurring Assignments (Phase 1)
// ─────────────────────────────────────────────

export function mapTaskGroup(
  row: TaskGroupRow & { member_count?: number; active_occurrence_count?: number },
): TaskGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    groupType: row.group_type,
    rangeId: row.range_id ?? undefined,
    createdBy: row.created_by,
    status: row.status,
    autoArchive: row.auto_archive,
    archiveAfterDate: row.archive_after_date ?? undefined,
    membersCanReply: row.members_can_reply,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
    memberCount: row.member_count,
    activeOccurrenceCount: row.active_occurrence_count,
  };
}

export function mapTaskGroupMember(row: TaskGroupMemberRow): TaskGroupMember {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    membershipRole: row.membership_role,
    active: row.active,
    joinedAt: row.joined_at,
    removedAt: row.removed_at ?? undefined,
    addedBy: row.added_by,
  };
}

export function mapTaskOccurrence(row: TaskOccurrenceRow): TaskOccurrence {
  return {
    id: row.id,
    groupId: row.group_id,
    seriesId: row.series_id ?? undefined,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    scheduledStart: row.scheduled_start,
    dueAt: row.due_at,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

function mapRecurrenceRule(raw: unknown): RecurrenceRule {
  const r = (raw ?? {}) as { weekdays?: number[]; day_of_month?: number; interval_days?: number };
  return {
    weekdays: r.weekdays ?? undefined,
    dayOfMonth: r.day_of_month ?? undefined,
    intervalDays: r.interval_days ?? undefined,
  };
}

/** Inverse of mapRecurrenceRule — for building the jsonb payload on create/update. */
export function recurrenceRuleToDb(rule: RecurrenceRule): Json {
  const out: { [key: string]: Json } = {};
  if (rule.weekdays !== undefined) out.weekdays = rule.weekdays;
  if (rule.dayOfMonth !== undefined) out.day_of_month = rule.dayOfMonth;
  if (rule.intervalDays !== undefined) out.interval_days = rule.intervalDays;
  return out;
}

export function mapTaskSeries(row: TaskSeriesRow): TaskSeries {
  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    evidenceRequirements: row.evidence_requirements,
    recurrenceType: row.recurrence_type,
    recurrenceRule: mapRecurrenceRule(row.recurrence_rule),
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
    creationTime: row.creation_time,
    dueOffsetDays: row.due_offset_days,
    status: row.status,
    createdBy: row.created_by,
    rangeId: row.range_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapGroupMessage(row: TaskMessageRow & { read_count?: number }): GroupMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    // A redacted message's body is not exposed to the UI even though the
    // row itself is kept for audit — the client never actually needs the
    // original text since redaction always clears it server-side, but this
    // is a defensive belt-and-braces in case that ever changes.
    body: row.redacted_at ? '' : row.body,
    attachmentPath: row.attachment_path ?? undefined,
    replyToId: row.reply_to_id ?? undefined,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? undefined,
    redactedAt: row.redacted_at ?? undefined,
    pinnedAt: row.pinned_at ?? undefined,
    pinnedBy: row.pinned_by ?? undefined,
    readCount: row.read_count,
  };
}
