// The literal unions below mirror the Postgres enum columns exactly — they
// are re-exported from the generated database.types.ts (the source of
// truth for the schema) instead of being hand-copied, so a schema change
// can't silently drift out of sync with the app's types.
import type {
  UserRole, TaskStatus, TaskPriority, TaskCategory, IncidentType, IncidentSeverity, IncidentStatus, NotificationType,
  InventoryLocationType, InventoryItemKind, InventoryTransactionType, InventoryRequestStatus,
  TaskGroupType, TaskGroupStatus, GroupMembershipRole, TaskOccurrenceStatus, TaskConversationType,
  TaskSeriesStatus, TaskSeriesRecurrence,
} from '../lib/database.types';
export type { TaskStatus, TaskPriority, TaskCategory, IncidentType, IncidentSeverity, IncidentStatus, NotificationType };
export type { InventoryLocationType, InventoryItemKind, InventoryTransactionType, InventoryRequestStatus };
export type { TaskGroupType, TaskGroupStatus, GroupMembershipRole, TaskOccurrenceStatus, TaskConversationType };
export type { TaskSeriesStatus, TaskSeriesRecurrence };
export type Role = UserRole;

// inventory_staff is DEPRECATED — Inventory access is no longer a separate
// role/tier. It's an additional capability any existing guard can hold
// (see useMyInventoryAccess / inventory_location_staff), on top of their
// normal Field Ops access. No new user can ever be given this role (see
// the create-user Edge Function and every role-selection UI); it stays in
// FIELD_ROLES' exclusion list only because the Postgres enum value can't
// be safely dropped while live and no profile currently holds it.

// range_office, tiger_cell, and divisional_office hold the same access
// level as guard (field staff scoped to their own assigned tasks/
// incidents) — just a different personnel label. Anywhere the app
// branches on "is this a field-level user", check this instead of
// `role === 'guard'` directly.
export const FIELD_ROLES: Role[] = ['guard', 'range_office', 'tiger_cell', 'divisional_office'];
export function isFieldRole(role: Role | undefined): boolean {
  return role !== undefined && FIELD_ROLES.includes(role);
}

export interface Range {
  id: string;
  name: string;
}

export interface Area {
  id: string;
  rangeId: string;
  name: string;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  email: string;
  phone?: string;
  avatarInitials: string;
  designation: string;
  rangeId?: string;
  /** Every range this user holds: rangeId plus any officer_ranges rows.
      Only populated for the signed-in user (AuthContext); an officer with
      more than one entry gets a range switcher in their pages. */
  rangeIds?: string[];
}

export interface Comment {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  /** Raw storage path (bucket-relative), used to generate/revoke signed URLs. */
  path: string;
  /** Time-limited signed URL for viewing/downloading. */
  url: string;
  previewUrl?: string;
}

export interface TaskUpdate {
  id: string;
  taskId: string;
  userId: string;
  note: string;
  progressPercentage: number;
  lat?: number;
  lng?: number;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  /** Additional collaborators beyond the primary assignee — same access as the assignee. */
  coAssigneeIds: string[];
  createdById: string;
  rangeId: string;
  areaId?: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  /** Free-text label when category is 'Other'; undefined otherwise. */
  categoryOther?: string;
  dueDate: string;
  completionPercentage: number;
  taskUpdates: TaskUpdate[];
  acknowledgedAt?: string;
  completedAt?: string;
  archivedAt?: string;
  /** Shared by every task spawned from the same "assign to several people" submission; undefined for a single-assignee task. Lets the UI group them into one card. */
  batchId?: string;
  /** Set only when this task was fanned out from a Task Group assignment — see the Task Groups section below. Undefined for every ordinary/batch_id task. */
  groupId?: string;
  seriesId?: string;
  occurrenceId?: string;
  createdAt: string;
  comments: Comment[];
  attachments: Attachment[];
}

export type CreateTaskData = Omit<Task, 'id' | 'createdAt' | 'comments' | 'attachments' | 'taskUpdates'>;

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Set for every notification type except incident_reported, inventory_*, group_series_failing, group_occurrence_overdue. */
  taskId?: string;
  /** Set only for incident_reported. */
  incidentId?: string;
  /** Set only for inventory_request_* / inventory_stock_issued. */
  inventoryRequestId?: string;
  /** Set only for group_series_failing. */
  seriesId?: string;
  /** Set only for group_occurrence_overdue. */
  occurrenceId?: string;
  read: boolean;
  createdAt: string;
}

export interface IncidentPhoto {
  id: string;
  path: string;
  url: string;
  size: number;
  type: string;
}

export interface Incident {
  id: string;
  type: IncidentType;
  /** Free-text label when type is one of the per-category "Other" catch-alls; undefined otherwise. */
  typeOther?: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  description: string;
  rangeId: string;
  areaId?: string;
  lat?: number;
  lng?: number;
  reportedBy: string;
  /** The reporter's display name, joined in from profiles — undefined only if that profile row is unreadable/missing. */
  reporterName?: string;
  assignedTo?: string;
  /** The assignee's display name, joined in from profiles — undefined if unassigned or unreadable. */
  assigneeName?: string;
  assignedAt?: string;
  resolvedAt?: string;
  incidentDate: string;
  createdAt: string;
  photos: IncidentPhoto[];
}

// Current live location of a field-role user on an active patrol task —
// see useLocationSharing/useLiveLocations in src/hooks/useLiveLocation.ts.
export interface LiveLocation {
  userId: string;
  userName: string;
  avatarInitials: string;
  designation: string;
  taskId: string;
  taskTitle: string;
  lat: number;
  lng: number;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  taskId?: string;
  taskTitle: string;
  rangeId?: string;
  actorId: string;
  action: string;
  detail: string;
  inventoryItemId?: string;
  inventoryTransactionId?: string;
  createdAt: string;
}

// ─────────────────────────────────────────────
// Hospitality Inventory Management (Phase 1)
// ─────────────────────────────────────────────

export interface InventoryLocation {
  id: string;
  name: string;
  type: InventoryLocationType;
  rangeId?: string;
  addressDescription: string;
  parentLocationId?: string;
  active: boolean;
  createdAt: string;
}

export interface InventoryCategory {
  id: string;
  name: string;
  active: boolean;
}

export interface InventoryUnit {
  id: string;
  name: string;
  abbreviation: string;
  active: boolean;
  /** Whether a quantity in this unit may be fractional (e.g. kg) or must be a whole number (e.g. Piece). */
  allowsFractional: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  categoryId: string;
  /** Joined display name, when the query includes the category join. */
  categoryName?: string;
  sku?: string;
  description: string;
  unitId: string;
  /** Joined display abbreviation, when the query includes the unit join. */
  unitAbbreviation?: string;
  /** Joined from inventory_units, when the query includes the unit join. */
  allowsFractional?: boolean;
  kind: InventoryItemKind;
  minStock: number;
  reorderLevel: number;
  maxStock?: number;
  trackExpiry: boolean;
  trackBatch: boolean;
  active: boolean;
  photoPath?: string;
  photoUrl?: string;
}

export interface InventoryStock {
  id: string;
  itemId: string;
  /** Joined display fields, when the query includes the item join. */
  itemName?: string;
  unitAbbreviation?: string;
  allowsFractional?: boolean;
  locationId: string;
  locationName?: string;
  availableQty: number;
  reservedQty: number;
  inUseQty: number;
  damagedQty: number;
  expiredQty: number;
  minStock?: number;
  reorderLevel?: number;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  itemId: string;
  itemName?: string;
  locationId: string;
  locationName?: string;
  quantity: number;
  transactionType: InventoryTransactionType;
  sourceLocationId?: string;
  destinationLocationId?: string;
  relatedRequestId?: string;
  performedBy: string;
  performedByName?: string;
  approvedBy?: string;
  notes: string;
  attachmentPath?: string;
  previousBalance: number;
  newBalance: number;
  createdAt: string;
}

export interface InventoryRequestItem {
  id: string;
  requestId: string;
  itemId: string;
  itemName?: string;
  unitAbbreviation?: string;
  allowsFractional?: boolean;
  requestedQty: number;
  approvedQty?: number;
  fulfilledQty: number;
  notes: string;
}

export interface InventoryRequestPhoto {
  id: string;
  path: string;
  url: string;
  size: number;
  type: string;
}

export interface InventoryRequest {
  id: string;
  requestingLocationId: string;
  requestingLocationName?: string;
  requestedBy: string;
  requestedByName?: string;
  status: InventoryRequestStatus;
  requiredByDate?: string;
  priority: TaskPriority;
  reason: string;
  notes: string;
  rejectReason?: string;
  items: InventoryRequestItem[];
  photos: InventoryRequestPhoto[];
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// Hospitality Inventory Management — Phase 2 (procurement + batch/expiry)
// ─────────────────────────────────────────────

export interface InventoryPurchaseItem {
  id: string;
  purchaseId: string;
  itemId: string;
  itemName?: string;
  unitAbbreviation?: string;
  quantity: number;
  unitCost?: number;
  batchNumber?: string;
  expiryDate?: string;
  notes: string;
}

export interface InventoryPurchase {
  id: string;
  locationId: string;
  locationName?: string;
  supplierName: string;
  invoiceNumber?: string;
  purchaseDate: string;
  notes: string;
  createdBy: string;
  createdByName?: string;
  items: InventoryPurchaseItem[];
  createdAt: string;
}

export interface InventoryBatch {
  id: string;
  itemId: string;
  itemName?: string;
  locationId: string;
  locationName?: string;
  batchNumber?: string;
  expiryDate?: string;
  receivedQty: number;
  remainingQty: number;
  sourcePurchaseId?: string;
  createdAt: string;
}

// ─────────────────────────────────────────────
// Task Groups & Recurring Assignments (Phase 1)
// ─────────────────────────────────────────────
// A persistent, reusable team — distinct from batch_id (which only ever
// links the task rows from one single creation). See the schema-doc note
// above the "Task Groups" section in supabase/schema.sql for the full
// architecture. Phase 1 ships groups + one-time assignments only; no
// recurrence UI yet (task_series exists in the schema but has no rows).

export interface TaskGroup {
  id: string;
  name: string;
  description: string;
  groupType: TaskGroupType;
  rangeId?: string;
  createdBy: string;
  status: TaskGroupStatus;
  autoArchive: boolean;
  archiveAfterDate?: string;
  /** Whether an ordinary member (not director/officer/coordinator) may post to the group announcement channel. */
  membersCanReply: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  /** Joined aggregate, present only where the query computes it (list views). */
  memberCount?: number;
  activeOccurrenceCount?: number;
}

export interface TaskGroupMember {
  id: string;
  groupId: string;
  userId: string;
  membershipRole: GroupMembershipRole;
  active: boolean;
  joinedAt: string;
  removedAt?: string;
  addedBy: string;
}

export interface TaskOccurrence {
  id: string;
  groupId: string;
  seriesId?: string;
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  scheduledStart: string;
  dueAt: string;
  status: TaskOccurrenceStatus;
  createdBy: string;
  createdAt: string;
  cancelledAt?: string;
  completedAt?: string;
}

// Shape of task_series.recurrence_rule (jsonb) — see the exhaustive comment
// above generate_due_task_occurrences() in supabase/schema.sql for exactly
// how each field is interpreted per recurrence type. Only the field(s)
// relevant to a given recurrenceType are ever populated; the others are
// simply absent, not null.
export interface RecurrenceRule {
  /** 'weekly' (exactly one entry) and 'weekdays' (one or more). 0=Sunday..6=Saturday. */
  weekdays?: number[];
  /** 'monthly'. 1-31; clamped server-side to the real last day of a shorter month. */
  dayOfMonth?: number;
  /** 'custom_interval'. Repeats every N days from startDate. */
  intervalDays?: number;
}

export interface TaskSeries {
  id: string;
  groupId: string;
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  evidenceRequirements: string;
  recurrenceType: TaskSeriesRecurrence;
  recurrenceRule: RecurrenceRule;
  startDate: string;
  endDate?: string;
  /** 24h "HH:MM" — the server evaluates this in Asia/Kolkata, matching send_task_deadline_reminders' convention. */
  creationTime: string;
  dueOffsetDays: number;
  status: TaskSeriesStatus;
  createdBy: string;
  rangeId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachmentPath?: string;
  attachmentUrl?: string;
  replyToId?: string;
  createdAt: string;
  editedAt?: string;
  redactedAt?: string;
  pinnedAt?: string;
  pinnedBy?: string;
  /** Number of distinct members who have read this message (task_message_reads) — "acknowledgements". Only populated where the query joins it (group/occurrence discussion views). */
  readCount?: number;
}

export interface AppState {
  currentUser: User | null;
  /** Range a multi-range officer is currently working in.
      null = fall back to their first range. */
  activeRangeId: string | null;
}

export interface AppActions {
  setCurrentUser: (user: User | null) => void;
  setActiveRangeId: (rangeId: string | null) => void;
  logout: () => void;
}

export type Store = AppState & AppActions;
