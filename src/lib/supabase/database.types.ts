export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          display_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          display_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          display_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          id: string
          slug: string
          name: string
          description: string | null
          owner_id: string
          retention_days: number | null
          stripe_customer_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          description?: string | null
          owner_id: string
          retention_days?: number | null
          stripe_customer_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          description?: string | null
          owner_id?: string
          retention_days?: number | null
          stripe_customer_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_memberships: {
        Row: {
          id: string
          venue_id: string
          user_id: string
          roles: Database["public"]["Enums"]["venue_role"][]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          venue_id: string
          user_id: string
          roles?: Database["public"]["Enums"]["venue_role"][]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          venue_id?: string
          user_id?: string
          roles?: Database["public"]["Enums"]["venue_role"][]
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_memberships_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          id: string
          venue_id: string
          name: string
          date: string
          start_time: string
          end_time: string
          status: Database["public"]["Enums"]["event_status"]
          landing_slug: string | null
          landing_active: boolean
          list_locked: boolean
          locked_by: string | null
          locked_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          venue_id: string
          name: string
          date: string
          start_time: string
          end_time: string
          status?: Database["public"]["Enums"]["event_status"]
          landing_slug?: string | null
          landing_active?: boolean
          list_locked?: boolean
          locked_by?: string | null
          locked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          venue_id?: string
          name?: string
          date?: string
          start_time?: string
          end_time?: string
          status?: Database["public"]["Enums"]["event_status"]
          landing_slug?: string | null
          landing_active?: boolean
          list_locked?: boolean
          locked_by?: string | null
          locked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_organizers: {
        Row: {
          id: string
          event_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          id?: string
          event_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          user_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_organizers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_organizers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_tiers: {
        Row: {
          id: string
          event_id: string
          name: string
          description: string | null
          color: string | null
          max_count: number | null
          aliases: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          name: string
          description?: string | null
          color?: string | null
          max_count?: number | null
          aliases?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          name?: string
          description?: string | null
          color?: string | null
          max_count?: number | null
          aliases?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_tiers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      guests: {
        Row: {
          id: string
          event_id: string
          tier_id: string | null
          name: string
          email: string | null
          phone: string | null
          plus_ones: number
          note: string | null
          note_priority: Database["public"]["Enums"]["note_priority"]
          note_acknowledged_by: string | null
          note_acknowledged_at: string | null
          added_by: string
          source: Database["public"]["Enums"]["guest_source"]
          status: Database["public"]["Enums"]["guest_status"]
          anonymized_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          tier_id?: string | null
          name: string
          email?: string | null
          phone?: string | null
          plus_ones?: number
          note?: string | null
          note_priority?: Database["public"]["Enums"]["note_priority"]
          note_acknowledged_by?: string | null
          note_acknowledged_at?: string | null
          added_by: string
          source?: Database["public"]["Enums"]["guest_source"]
          status?: Database["public"]["Enums"]["guest_status"]
          anonymized_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          tier_id?: string | null
          name?: string
          email?: string | null
          phone?: string | null
          plus_ones?: number
          note?: string | null
          note_priority?: Database["public"]["Enums"]["note_priority"]
          note_acknowledged_by?: string | null
          note_acknowledged_at?: string | null
          added_by?: string
          source?: Database["public"]["Enums"]["guest_source"]
          status?: Database["public"]["Enums"]["guest_status"]
          anonymized_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "guest_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_note_acknowledged_by_fkey"
            columns: ["note_acknowledged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_requests: {
        Row: {
          id: string
          event_id: string
          name: string
          email: string | null
          phone: string | null
          message: string | null
          decided_by: string | null
          decided_at: string | null
          decision: string | null
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          event_id: string
          name: string
          email?: string | null
          phone?: string | null
          message?: string | null
          decided_by?: string | null
          decided_at?: string | null
          decision?: string | null
          reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          name?: string
          email?: string | null
          phone?: string | null
          message?: string | null
          decided_by?: string | null
          decided_at?: string | null
          decision?: string | null
          reason?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      quotas: {
        Row: {
          id: string
          venue_id: string
          user_id: string
          default_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          venue_id: string
          user_id: string
          default_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          venue_id?: string
          user_id?: string
          default_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotas_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_quotas: {
        Row: {
          id: string
          event_id: string
          user_id: string
          override_count: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          user_id: string
          override_count?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          user_id?: string
          override_count?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_quotas_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_quotas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      quota_requests: {
        Row: {
          id: string
          event_id: string
          user_id: string
          requested_count: number
          requested_by: string
          decided_by: string | null
          decided_at: string | null
          decision: string | null
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          event_id: string
          user_id: string
          requested_count: number
          requested_by: string
          decided_by?: string | null
          decided_at?: string | null
          decision?: string | null
          reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          user_id?: string
          requested_count?: number
          requested_by?: string
          decided_by?: string | null
          decided_at?: string | null
          decision?: string | null
          reason?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quota_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quota_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quota_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quota_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          id: string
          guest_id: string
          checked_by: string
          server_timestamp: string
          client_timestamp: string | null
          device_id: string | null
          plus_ones_arrived: number
          offline_synced: boolean
          created_at: string
        }
        Insert: {
          id?: string
          guest_id: string
          checked_by: string
          server_timestamp?: string
          client_timestamp?: string | null
          device_id?: string | null
          plus_ones_arrived?: number
          offline_synced?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          guest_id?: string
          checked_by?: string
          server_timestamp?: string
          client_timestamp?: string | null
          device_id?: string | null
          plus_ones_arrived?: number
          offline_synced?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: true
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      refusals: {
        Row: {
          id: string
          guest_id: string
          refused_by: string
          reason: string | null
          server_timestamp: string
          client_timestamp: string | null
          device_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          guest_id: string
          refused_by: string
          reason?: string | null
          server_timestamp?: string
          client_timestamp?: string | null
          device_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          guest_id?: string
          refused_by?: string
          reason?: string | null
          server_timestamp?: string
          client_timestamp?: string | null
          device_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refusals_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refusals_refused_by_fkey"
            columns: ["refused_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          id: string
          venue_id: string
          event_id: string | null
          actor_id: string | null
          entity_type: string
          entity_id: string
          action: string
          before_data: Json | null
          after_data: Json | null
          device_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          venue_id: string
          event_id?: string | null
          actor_id?: string | null
          entity_type: string
          entity_id: string
          action: string
          before_data?: Json | null
          after_data?: Json | null
          device_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          venue_id?: string
          event_id?: string | null
          actor_id?: string | null
          entity_type?: string
          entity_id?: string
          action?: string
          before_data?: Json | null
          after_data?: Json | null
          device_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          id: string
          venue_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          plan_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          current_period_end: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          venue_id: string
          status?: Database["public"]["Enums"]["subscription_status"]
          plan_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          current_period_end?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          venue_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          plan_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          current_period_end?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {}
    Functions: {
      uuid_generate_v7: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
    }
    Enums: {
      event_status: "draft" | "open" | "live" | "closed"
      guest_status:
        | "pending"
        | "approved"
        | "denied"
        | "checked_in"
        | "refused"
        | "removed"
      venue_role:
        | "admin"
        | "user_manager"
        | "finance"
        | "staff"
        | "doorhost"
      note_priority: "none" | "low" | "high"
      guest_source: "app" | "landing" | "door"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "comped"
    }
    CompositeTypes: {}
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] & PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][CompositeTypeName]
    : never
