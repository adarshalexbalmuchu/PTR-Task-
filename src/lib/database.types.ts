export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = 'director' | 'range_officer' | 'guard' | 'range_office' | 'tiger_cell' | 'inventory_staff' | 'divisional_office';
export type TaskStatus = 'NotStarted' | 'InProgress' | 'Completed' | 'Archived';
export type TaskPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type TaskCategory = 'Patrol' | 'Camera Trap' | 'Survey' | 'Maintenance' | 'Admin' | 'Other';
export type NotificationType = 'task_assigned' | 'task_updated' | 'task_completed' | 'changes_requested' | 'task_archived' | 'task_due_soon' | 'task_due_today' | 'task_overdue' | 'incident_reported' | 'inventory_request_submitted' | 'inventory_request_approved' | 'inventory_request_rejected' | 'inventory_stock_issued' | 'group_task_assigned' | 'group_announcement' | 'group_series_failing' | 'group_occurrence_overdue';
export type IncidentType = 'human_attack' | 'livestock_attack' | 'crop_damage' | 'property_damage' | 'conflict_other' | 'poaching_sign' | 'road_kill' | 'animal_injury' | 'tree_felling' | 'other' | 'wildlife_sighting' | 'sighting_other';
export type IncidentSeverity = 'Low' | 'Medium' | 'High' | 'Critical';
export type IncidentStatus = 'Open' | 'Resolved';
export type InventoryLocationType = 'central_warehouse' | 'range_store' | 'forest_office' | 'resort' | 'hotel' | 'guest_house' | 'kitchen' | 'housekeeping_store' | 'other_facility';
export type InventoryItemKind = 'consumable' | 'reusable';
export type InventoryTransactionType = 'opening_balance' | 'issued';
export type InventoryRequestStatus = 'Draft' | 'Submitted' | 'Approved' | 'PartiallyApproved' | 'Rejected' | 'PartiallyFulfilled' | 'Fulfilled' | 'Cancelled';
export type TaskGroupType = 'permanent' | 'temporary';
export type TaskGroupStatus = 'active' | 'paused' | 'archived';
export type GroupMembershipRole = 'member' | 'coordinator';
export type TaskOccurrenceStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';
export type TaskConversationType = 'group' | 'occurrence';
export type TaskSeriesStatus = 'draft' | 'active' | 'paused' | 'ended' | 'archived';
export type TaskSeriesRecurrence = 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'custom_interval';

type Relationships = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
}[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          role: UserRole;
          email: string;
          phone: string | null;
          avatar_initials: string;
          designation: string;
          range_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          role: UserRole;
          email: string;
          phone?: string | null;
          avatar_initials: string;
          designation: string;
          range_id?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          role?: UserRole;
          email?: string;
          phone?: string | null;
          avatar_initials?: string;
          designation?: string;
          range_id?: string | null;
        };
        Relationships: Relationships;
      };
      ranges: {
        Row: { id: string; name: string; created_at: string };
        Insert: { id?: string; name: string };
        Update: { id?: string; name?: string };
        Relationships: Relationships;
      };
      areas: {
        Row: { id: string; range_id: string; name: string; created_at: string };
        Insert: { id?: string; range_id: string; name: string };
        Update: { id?: string; range_id?: string; name?: string };
        Relationships: Relationships;
      };
      tasks: {
        Row: {
          id: string;
          title: string;
          description: string;
          assignee_id: string;
          created_by_id: string;
          range_id: string;
          area_id: string | null;
          status: TaskStatus;
          priority: TaskPriority;
          category: TaskCategory;
          category_other: string | null;
          due_date: string;
          completion_percentage: number;
          acknowledged_at: string | null;
          completed_at: string | null;
          archived_at: string | null;
          batch_id: string | null;
          group_id: string | null;
          series_id: string | null;
          occurrence_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string;
          assignee_id: string;
          created_by_id: string;
          range_id: string;
          area_id?: string | null;
          status?: TaskStatus;
          priority: TaskPriority;
          category: TaskCategory;
          category_other?: string | null;
          due_date: string;
          completion_percentage?: number;
          acknowledged_at?: string | null;
          completed_at?: string | null;
          archived_at?: string | null;
          batch_id?: string | null;
          group_id?: string | null;
          series_id?: string | null;
          occurrence_id?: string | null;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string;
          assignee_id?: string;
          created_by_id?: string;
          range_id?: string;
          area_id?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          category?: TaskCategory;
          category_other?: string | null;
          due_date?: string;
          completion_percentage?: number;
          acknowledged_at?: string | null;
          completed_at?: string | null;
          archived_at?: string | null;
          batch_id?: string | null;
          group_id?: string | null;
          series_id?: string | null;
          occurrence_id?: string | null;
        };
        Relationships: Relationships;
      };
      task_updates: {
        Row: {
          id: string;
          task_id: string;
          user_id: string;
          note: string;
          progress_percentage: number;
          lat: number | null;
          lng: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          user_id: string;
          note: string;
          progress_percentage: number;
          lat?: number | null;
          lng?: number | null;
        };
        Update: {
          id?: string;
          task_id?: string;
          user_id?: string;
          note?: string;
          progress_percentage?: number;
          lat?: number | null;
          lng?: number | null;
        };
        Relationships: Relationships;
      };
      comments: {
        Row: {
          id: string;
          task_id: string;
          user_id: string;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          user_id: string;
          content: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          user_id?: string;
          content?: string;
        };
        Relationships: Relationships;
      };
      attachments: {
        Row: {
          id: string;
          task_id: string;
          user_id: string;
          name: string;
          url: string;
          size: number;
          mime_type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          user_id: string;
          name: string;
          url: string;
          size: number;
          mime_type: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          user_id?: string;
          name?: string;
          url?: string;
          size?: number;
          mime_type?: string;
        };
        Relationships: Relationships;
      };
      task_assignees: {
        Row: {
          task_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          task_id: string;
          user_id: string;
        };
        Update: {
          task_id?: string;
          user_id?: string;
        };
        Relationships: Relationships;
      };
      officer_ranges: {
        Row: {
          user_id: string;
          range_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          range_id: string;
        };
        Update: {
          user_id?: string;
          range_id?: string;
        };
        Relationships: Relationships;
      };
      live_locations: {
        Row: {
          user_id: string;
          task_id: string;
          lat: number;
          lng: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          task_id: string;
          lat: number;
          lng: number;
        };
        Update: {
          user_id?: string;
          task_id?: string;
          lat?: number;
          lng?: number;
        };
        Relationships: Relationships;
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: NotificationType;
          title: string;
          message: string;
          task_id: string | null;
          incident_id: string | null;
          inventory_request_id: string | null;
          series_id: string | null;
          occurrence_id: string | null;
          read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: NotificationType;
          title: string;
          message: string;
          task_id?: string | null;
          incident_id?: string | null;
          inventory_request_id?: string | null;
          series_id?: string | null;
          occurrence_id?: string | null;
          read?: boolean;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: NotificationType;
          title?: string;
          message?: string;
          task_id?: string | null;
          incident_id?: string | null;
          inventory_request_id?: string | null;
          read?: boolean;
        };
        Relationships: Relationships;
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
        };
        Relationships: Relationships;
      };
      daily_reports: {
        Row: {
          id: string;
          report_date: string;
          generated_by: string;
          total_tasks: number;
          completed_count: number;
          in_progress_count: number;
          not_started_count: number;
          overdue_count: number;
          range_breakdown: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          report_date: string;
          generated_by: string;
          total_tasks: number;
          completed_count: number;
          in_progress_count: number;
          not_started_count: number;
          overdue_count: number;
          range_breakdown: Json;
        };
        Update: {
          id?: string;
          report_date?: string;
          generated_by?: string;
          total_tasks?: number;
          completed_count?: number;
          in_progress_count?: number;
          not_started_count?: number;
          overdue_count?: number;
          range_breakdown?: Json;
        };
        Relationships: Relationships;
      };
      incidents: {
        Row: {
          id: string;
          type: IncidentType;
          type_other: string | null;
          severity: IncidentSeverity;
          status: IncidentStatus;
          description: string;
          range_id: string;
          area_id: string | null;
          lat: number | null;
          lng: number | null;
          reported_by: string;
          assigned_to: string | null;
          assigned_at: string | null;
          resolved_at: string | null;
          incident_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          type: IncidentType;
          type_other?: string | null;
          severity?: IncidentSeverity;
          status?: IncidentStatus;
          description: string;
          range_id: string;
          area_id?: string | null;
          lat?: number | null;
          lng?: number | null;
          reported_by: string;
          assigned_to?: string | null;
          assigned_at?: string | null;
          resolved_at?: string | null;
          incident_date?: string;
        };
        Update: {
          id?: string;
          type?: IncidentType;
          type_other?: string | null;
          severity?: IncidentSeverity;
          status?: IncidentStatus;
          description?: string;
          range_id?: string;
          area_id?: string | null;
          lat?: number | null;
          lng?: number | null;
          reported_by?: string;
          assigned_to?: string | null;
          assigned_at?: string | null;
          resolved_at?: string | null;
          incident_date?: string;
        };
        Relationships: Relationships;
      };
      incident_photos: {
        Row: {
          id: string;
          incident_id: string;
          uploaded_by: string;
          path: string;
          size: number;
          mime_type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          incident_id: string;
          uploaded_by: string;
          path: string;
          size: number;
          mime_type?: string;
        };
        Update: {
          id?: string;
          incident_id?: string;
          uploaded_by?: string;
          path?: string;
          size?: number;
          mime_type?: string;
        };
        Relationships: Relationships;
      };
      audit_log: {
        Row: {
          id: string;
          task_id: string | null;
          task_title: string;
          range_id: string | null;
          actor_id: string;
          action: string;
          detail: string;
          inventory_item_id: string | null;
          inventory_transaction_id: string | null;
          inventory_request_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id?: string | null;
          task_title?: string;
          range_id?: string | null;
          actor_id: string;
          action: string;
          detail?: string;
          inventory_item_id?: string | null;
          inventory_transaction_id?: string | null;
          inventory_request_id?: string | null;
        };
        Update: {
          id?: string;
          task_id?: string | null;
          task_title?: string;
          range_id?: string | null;
          actor_id?: string;
          action?: string;
          detail?: string;
          inventory_item_id?: string | null;
          inventory_transaction_id?: string | null;
          inventory_request_id?: string | null;
        };
        Relationships: Relationships;
      };
      inventory_locations: {
        Row: {
          id: string;
          name: string;
          type: InventoryLocationType;
          range_id: string | null;
          address_description: string;
          parent_location_id: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          type: InventoryLocationType;
          range_id?: string | null;
          address_description?: string;
          parent_location_id?: string | null;
          active?: boolean;
        };
        Update: {
          id?: string;
          name?: string;
          type?: InventoryLocationType;
          range_id?: string | null;
          address_description?: string;
          parent_location_id?: string | null;
          active?: boolean;
        };
        Relationships: Relationships;
      };
      inventory_location_staff: {
        Row: {
          id: string; location_id: string; user_id: string; active: boolean;
          assignment_type: string; assigned_by: string | null; assigned_at: string;
          ended_at: string | null; created_at: string;
        };
        Insert: {
          id?: string; location_id: string; user_id: string; active?: boolean;
          assignment_type?: string; assigned_by?: string | null; assigned_at?: string;
          ended_at?: string | null;
        };
        Update: {
          id?: string; location_id?: string; user_id?: string; active?: boolean;
          assignment_type?: string; assigned_by?: string | null; assigned_at?: string;
          ended_at?: string | null;
        };
        Relationships: Relationships;
      };
      inventory_categories: {
        Row: { id: string; name: string; active: boolean; created_at: string };
        Insert: { id?: string; name: string; active?: boolean };
        Update: { id?: string; name?: string; active?: boolean };
        Relationships: Relationships;
      };
      inventory_units: {
        Row: { id: string; name: string; abbreviation: string; active: boolean; allows_fractional: boolean; created_at: string };
        Insert: { id?: string; name: string; abbreviation?: string; active?: boolean; allows_fractional?: boolean };
        Update: { id?: string; name?: string; abbreviation?: string; active?: boolean; allows_fractional?: boolean };
        Relationships: Relationships;
      };
      inventory_items: {
        Row: {
          id: string;
          name: string;
          category_id: string;
          sku: string | null;
          description: string;
          unit_id: string;
          kind: InventoryItemKind;
          min_stock: number;
          reorder_level: number;
          max_stock: number | null;
          track_expiry: boolean;
          track_batch: boolean;
          active: boolean;
          photo_path: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          category_id: string;
          sku?: string | null;
          description?: string;
          unit_id: string;
          kind?: InventoryItemKind;
          min_stock?: number;
          reorder_level?: number;
          max_stock?: number | null;
          track_expiry?: boolean;
          track_batch?: boolean;
          active?: boolean;
          photo_path?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          category_id?: string;
          sku?: string | null;
          description?: string;
          unit_id?: string;
          kind?: InventoryItemKind;
          min_stock?: number;
          reorder_level?: number;
          max_stock?: number | null;
          track_expiry?: boolean;
          track_batch?: boolean;
          active?: boolean;
          photo_path?: string | null;
        };
        Relationships: Relationships;
      };
      inventory_stock: {
        Row: {
          id: string;
          item_id: string;
          location_id: string;
          available_qty: number;
          reserved_qty: number;
          in_use_qty: number;
          damaged_qty: number;
          expired_qty: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          location_id: string;
          available_qty?: number;
          reserved_qty?: number;
          in_use_qty?: number;
          damaged_qty?: number;
          expired_qty?: number;
        };
        Update: {
          id?: string;
          item_id?: string;
          location_id?: string;
          available_qty?: number;
          reserved_qty?: number;
          in_use_qty?: number;
          damaged_qty?: number;
          expired_qty?: number;
        };
        Relationships: Relationships;
      };
      inventory_transactions: {
        Row: {
          id: string;
          item_id: string;
          location_id: string;
          quantity: number;
          transaction_type: InventoryTransactionType;
          source_location_id: string | null;
          destination_location_id: string | null;
          related_request_id: string | null;
          performed_by: string;
          approved_by: string | null;
          notes: string;
          attachment_path: string | null;
          previous_balance: number;
          new_balance: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          location_id: string;
          quantity: number;
          transaction_type: InventoryTransactionType;
          source_location_id?: string | null;
          destination_location_id?: string | null;
          related_request_id?: string | null;
          performed_by: string;
          approved_by?: string | null;
          notes?: string;
          attachment_path?: string | null;
          previous_balance: number;
          new_balance: number;
        };
        Update: {
          id?: string;
          item_id?: string;
          location_id?: string;
          quantity?: number;
          transaction_type?: InventoryTransactionType;
          source_location_id?: string | null;
          destination_location_id?: string | null;
          related_request_id?: string | null;
          performed_by?: string;
          approved_by?: string | null;
          notes?: string;
          attachment_path?: string | null;
          previous_balance?: number;
          new_balance?: number;
        };
        Relationships: Relationships;
      };
      inventory_requests: {
        Row: {
          id: string;
          requesting_location_id: string;
          requested_by: string;
          status: InventoryRequestStatus;
          required_by_date: string | null;
          priority: TaskPriority;
          reason: string;
          notes: string;
          reject_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          requesting_location_id: string;
          requested_by: string;
          status?: InventoryRequestStatus;
          required_by_date?: string | null;
          priority?: TaskPriority;
          reason?: string;
          notes?: string;
          reject_reason?: string | null;
        };
        Update: {
          id?: string;
          requesting_location_id?: string;
          requested_by?: string;
          status?: InventoryRequestStatus;
          required_by_date?: string | null;
          priority?: TaskPriority;
          reason?: string;
          notes?: string;
          reject_reason?: string | null;
        };
        Relationships: Relationships;
      };
      inventory_request_items: {
        Row: {
          id: string;
          request_id: string;
          item_id: string;
          requested_qty: number;
          approved_qty: number | null;
          fulfilled_qty: number;
          notes: string;
        };
        Insert: {
          id?: string;
          request_id: string;
          item_id: string;
          requested_qty: number;
          approved_qty?: number | null;
          fulfilled_qty?: number;
          notes?: string;
        };
        Update: {
          id?: string;
          request_id?: string;
          item_id?: string;
          requested_qty?: number;
          approved_qty?: number | null;
          fulfilled_qty?: number;
          notes?: string;
        };
        Relationships: Relationships;
      };
      task_groups: {
        Row: {
          id: string;
          name: string;
          description: string;
          group_type: TaskGroupType;
          range_id: string | null;
          created_by: string;
          status: TaskGroupStatus;
          auto_archive: boolean;
          archive_after_date: string | null;
          members_can_reply: boolean;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string;
          group_type: TaskGroupType;
          range_id?: string | null;
          created_by: string;
          status?: TaskGroupStatus;
          auto_archive?: boolean;
          archive_after_date?: string | null;
          members_can_reply?: boolean;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string;
          group_type?: TaskGroupType;
          range_id?: string | null;
          status?: TaskGroupStatus;
          auto_archive?: boolean;
          archive_after_date?: string | null;
          members_can_reply?: boolean;
          archived_at?: string | null;
        };
        Relationships: Relationships;
      };
      task_group_members: {
        Row: {
          id: string;
          group_id: string;
          user_id: string;
          membership_role: GroupMembershipRole;
          active: boolean;
          joined_at: string;
          removed_at: string | null;
          added_by: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          user_id: string;
          membership_role?: GroupMembershipRole;
          active?: boolean;
          removed_at?: string | null;
          added_by: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          user_id?: string;
          membership_role?: GroupMembershipRole;
          active?: boolean;
          removed_at?: string | null;
        };
        Relationships: Relationships;
      };
      task_series: {
        Row: {
          id: string;
          group_id: string;
          title: string;
          description: string;
          category: TaskCategory;
          priority: TaskPriority;
          evidence_requirements: string;
          recurrence_type: TaskSeriesRecurrence;
          recurrence_rule: Json;
          start_date: string;
          end_date: string | null;
          creation_time: string;
          due_offset_days: number;
          status: TaskSeriesStatus;
          created_by: string;
          range_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          title: string;
          description?: string;
          category?: TaskCategory;
          priority?: TaskPriority;
          evidence_requirements?: string;
          recurrence_type: TaskSeriesRecurrence;
          recurrence_rule?: Json;
          start_date: string;
          end_date?: string | null;
          creation_time?: string;
          due_offset_days?: number;
          status?: TaskSeriesStatus;
          created_by: string;
          range_id: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string;
          category?: TaskCategory;
          priority?: TaskPriority;
          evidence_requirements?: string;
          recurrence_type?: TaskSeriesRecurrence;
          recurrence_rule?: Json;
          start_date?: string;
          end_date?: string | null;
          creation_time?: string;
          due_offset_days?: number;
          status?: TaskSeriesStatus;
        };
        Relationships: Relationships;
      };
      task_occurrences: {
        Row: {
          id: string;
          group_id: string;
          series_id: string | null;
          title: string;
          description: string;
          category: TaskCategory;
          priority: TaskPriority;
          scheduled_start: string;
          due_at: string;
          status: TaskOccurrenceStatus;
          created_by: string;
          created_at: string;
          cancelled_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          group_id: string;
          series_id?: string | null;
          title: string;
          description?: string;
          category?: TaskCategory;
          priority?: TaskPriority;
          scheduled_start?: string;
          due_at: string;
          status?: TaskOccurrenceStatus;
          created_by: string;
          cancelled_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          status?: TaskOccurrenceStatus;
          cancelled_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: Relationships;
      };
      task_conversations: {
        Row: {
          id: string;
          type: TaskConversationType;
          group_id: string | null;
          occurrence_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          type: TaskConversationType;
          group_id?: string | null;
          occurrence_id?: string | null;
        };
        Update: {
          id?: string;
        };
        Relationships: Relationships;
      };
      task_messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          attachment_path: string | null;
          reply_to_id: string | null;
          created_at: string;
          edited_at: string | null;
          redacted_at: string | null;
          redacted_by: string | null;
          pinned_at: string | null;
          pinned_by: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          attachment_path?: string | null;
          reply_to_id?: string | null;
        };
        Update: {
          id?: string;
          body?: string;
          edited_at?: string | null;
          redacted_at?: string | null;
          redacted_by?: string | null;
        };
        Relationships: Relationships;
      };
      task_message_reads: {
        Row: {
          message_id: string;
          user_id: string;
          read_at: string;
        };
        Insert: {
          message_id: string;
          user_id: string;
        };
        Update: Record<string, never>;
        Relationships: Relationships;
      };
    };
    Views: {
      task_dashboard_stats: {
        Row: {
          total_tasks: number;
          critical_count: number;
          in_progress_count: number;
          completed_count: number;
          archived_count: number;
          overdue_count: number;
        };
        Relationships: Relationships;
      };
      task_range_stats: {
        Row: {
          range_id: string;
          range_name: string;
          total: number;
          not_started_count: number;
          in_progress_count: number;
          completed_count: number;
          archived_count: number;
          completed: number;
          overdue: number;
        };
        Relationships: Relationships;
      };
    };
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      task_status: TaskStatus;
      task_priority: TaskPriority;
      task_category: TaskCategory;
      notification_type: NotificationType;
      incident_type: IncidentType;
      incident_severity: IncidentSeverity;
      incident_status: IncidentStatus;
      inventory_location_type: InventoryLocationType;
      inventory_item_kind: InventoryItemKind;
      inventory_transaction_type: InventoryTransactionType;
      inventory_request_status: InventoryRequestStatus;
      task_group_type: TaskGroupType;
      task_group_status: TaskGroupStatus;
      group_membership_role: GroupMembershipRole;
      task_occurrence_status: TaskOccurrenceStatus;
      task_conversation_type: TaskConversationType;
      task_series_status: TaskSeriesStatus;
      task_series_recurrence: TaskSeriesRecurrence;
    };
  };
}
