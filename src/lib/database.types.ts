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
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          device_id: string | null
          diff: Json | null
          entity_id: string
          entity_type: string
          event_id: string | null
          id: string
          venue_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          device_id?: string | null
          diff?: Json | null
          entity_id: string
          entity_type: string
          event_id?: string | null
          id?: string
          venue_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          device_id?: string | null
          diff?: Json | null
          entity_id?: string
          entity_type?: string
          event_id?: string | null
          id?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
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
            foreignKeyName: "audit_log_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          checked_at: string
          checked_by: string
          client_timestamp: string | null
          created_at: string
          device_id: string | null
          guest_id: string
          id: string
          offline_synced: boolean
          plus_ones_arrived: number
        }
        Insert: {
          checked_at?: string
          checked_by: string
          client_timestamp?: string | null
          created_at?: string
          device_id?: string | null
          guest_id: string
          id?: string
          offline_synced?: boolean
          plus_ones_arrived?: number
        }
        Update: {
          checked_at?: string
          checked_by?: string
          client_timestamp?: string | null
          created_at?: string
          device_id?: string | null
          guest_id?: string
          id?: string
          offline_synced?: boolean
          plus_ones_arrived?: number
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: true
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
      event_organizers: {
        Row: {
          created_at: string
          event_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          user_id?: string
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
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_quotas: {
        Row: {
          created_at: string
          event_id: string
          id: string
          quota_override: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          quota_override: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          quota_override?: number
          updated_at?: string
          user_id?: string
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
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          landing_active: boolean
          landing_slug: string
          list_locked: boolean
          locked_at: string | null
          locked_by: string | null
          name: string
          starts_at: string
          status: Database["public"]["Enums"]["event_status"]
          updated_at: string
          venue_id: string
          went_live_at: string | null
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          landing_active?: boolean
          landing_slug: string
          list_locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          name: string
          starts_at: string
          status?: Database["public"]["Enums"]["event_status"]
          updated_at?: string
          venue_id: string
          went_live_at?: string | null
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          landing_active?: boolean
          landing_slug?: string
          list_locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          name?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["event_status"]
          updated_at?: string
          venue_id?: string
          went_live_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          email: string | null
          event_id: string
          full_name: string
          id: string
          motivation: string | null
          phone: string | null
          status: Database["public"]["Enums"]["request_status"]
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          email?: string | null
          event_id: string
          full_name: string
          id?: string
          motivation?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["request_status"]
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          email?: string | null
          event_id?: string
          full_name?: string
          id?: string
          motivation?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "guest_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_tiers: {
        Row: {
          aliases: string[]
          color: string | null
          created_at: string
          description: string | null
          event_id: string
          id: string
          max_guests: number | null
          name: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          color?: string | null
          created_at?: string
          description?: string | null
          event_id: string
          id?: string
          max_guests?: number | null
          name: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          color?: string | null
          created_at?: string
          description?: string | null
          event_id?: string
          id?: string
          max_guests?: number | null
          name?: string
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
          added_by: string
          anonymized_at: string | null
          created_at: string
          email: string | null
          event_id: string
          full_name: string
          id: string
          note: string | null
          note_acknowledged_at: string | null
          note_acknowledged_by: string | null
          note_priority: Database["public"]["Enums"]["note_priority"]
          phone: string | null
          plus_ones: number
          removed_at: string | null
          source: Database["public"]["Enums"]["guest_source"]
          status: Database["public"]["Enums"]["guest_status"]
          tier_id: string
          updated_at: string
        }
        Insert: {
          added_by: string
          anonymized_at?: string | null
          created_at?: string
          email?: string | null
          event_id: string
          full_name: string
          id?: string
          note?: string | null
          note_acknowledged_at?: string | null
          note_acknowledged_by?: string | null
          note_priority?: Database["public"]["Enums"]["note_priority"]
          phone?: string | null
          plus_ones?: number
          removed_at?: string | null
          source?: Database["public"]["Enums"]["guest_source"]
          status?: Database["public"]["Enums"]["guest_status"]
          tier_id: string
          updated_at?: string
        }
        Update: {
          added_by?: string
          anonymized_at?: string | null
          created_at?: string
          email?: string | null
          event_id?: string
          full_name?: string
          id?: string
          note?: string | null
          note_acknowledged_at?: string | null
          note_acknowledged_by?: string | null
          note_priority?: Database["public"]["Enums"]["note_priority"]
          phone?: string | null
          plus_ones?: number
          removed_at?: string | null
          source?: Database["public"]["Enums"]["guest_source"]
          status?: Database["public"]["Enums"]["guest_status"]
          tier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guests_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_note_acknowledged_by_fkey"
            columns: ["note_acknowledged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_tier_id_event_id_fkey"
            columns: ["tier_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_tiers"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          roles: Database["public"]["Enums"]["venue_role"][]
          venue_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          roles: Database["public"]["Enums"]["venue_role"][]
          venue_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          roles?: Database["public"]["Enums"]["venue_role"][]
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      quota_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          event_id: string
          id: string
          motivation: string | null
          requested_extra: number
          status: Database["public"]["Enums"]["request_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          event_id: string
          id?: string
          motivation?: string | null
          requested_extra: number
          status?: Database["public"]["Enums"]["request_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          event_id?: string
          id?: string
          motivation?: string | null
          requested_extra?: number
          status?: Database["public"]["Enums"]["request_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quota_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quotas: {
        Row: {
          created_at: string
          default_count: number
          id: string
          updated_at: string
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          default_count?: number
          id?: string
          updated_at?: string
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          default_count?: number
          id?: string
          updated_at?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotas_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      refusals: {
        Row: {
          client_timestamp: string | null
          created_at: string
          device_id: string | null
          guest_id: string
          id: string
          reason: string
          refused_at: string
          refused_by: string
        }
        Insert: {
          client_timestamp?: string | null
          created_at?: string
          device_id?: string | null
          guest_id: string
          id?: string
          reason: string
          refused_at?: string
          refused_by: string
        }
        Update: {
          client_timestamp?: string | null
          created_at?: string
          device_id?: string | null
          guest_id?: string
          id?: string
          reason?: string
          refused_at?: string
          refused_by?: string
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
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          plan_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan_id?: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          venue_id?: string
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
      user_profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      venue_memberships: {
        Row: {
          created_at: string
          id: string
          roles: Database["public"]["Enums"]["venue_role"][]
          updated_at: string
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          roles: Database["public"]["Enums"]["venue_role"][]
          updated_at?: string
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          roles?: Database["public"]["Enums"]["venue_role"][]
          updated_at?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_memberships_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          created_at: string
          id: string
          name: string
          retention_months: number
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          retention_months?: number
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          retention_months?: number
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_pending_invites: { Args: never; Returns: number }
      admin_list_user_sessions: {
        Args: { p_target: string }
        Returns: {
          aal: string
          created_at: string
          ip: string
          not_after: string
          session_id: string
          updated_at: string
          user_agent: string
        }[]
      }
      admin_revoke_session: { Args: { p_session_id: string }; Returns: boolean }
      approve_quota_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      audit_changed: { Args: { p_new: Json; p_old: Json }; Returns: Json }
      can_check_in: { Args: { p_event_id: string }; Returns: boolean }
      can_view_profile: { Args: { p_profile_id: string }; Returns: boolean }
      can_write_guests: { Args: { p_event_id: string }; Returns: boolean }
      current_user_requires_mfa: { Args: never; Returns: boolean }
      event_quota_status: {
        Args: { p_event_id: string }
        Returns: {
          consumed: number
          exempt: boolean
          quota: number
          remaining: number
        }[]
      }
      event_venue: { Args: { p_event_id: string }; Returns: string }
      guest_event: { Args: { p_guest_id: string }; Returns: string }
      guest_personal_contribution: {
        Args: {
          g: Database["public"]["Tables"]["guests"]["Row"]
          p_went_live_at: string
        }
        Returns: number
      }
      guest_tier_contribution: {
        Args: { g: Database["public"]["Tables"]["guests"]["Row"] }
        Returns: number
      }
      has_venue_role: {
        Args: {
          p_roles: Database["public"]["Enums"]["venue_role"][]
          p_venue_id: string
        }
        Returns: boolean
      }
      is_aal2: { Args: never; Returns: boolean }
      is_event_organizer: { Args: { p_event_id: string }; Returns: boolean }
      is_venue_member: { Args: { p_venue_id: string }; Returns: boolean }
      list_own_sessions: {
        Args: never
        Returns: {
          aal: string
          created_at: string
          ip: string
          is_current: boolean
          not_after: string
          session_id: string
          updated_at: string
          user_agent: string
        }[]
      }
      organizes_event_at_venue: {
        Args: { p_venue_id: string }
        Returns: boolean
      }
      request_device_id: { Args: never; Returns: string }
      revoke_own_session: { Args: { p_session_id: string }; Returns: boolean }
      tier_consumption: { Args: { p_tier_id: string }; Returns: number }
      user_event_consumption: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: number
      }
      user_event_quota: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: number
      }
      user_is_quota_exempt: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: boolean
      }
      uuid_generate_v7: { Args: never; Returns: string }
    }
    Enums: {
      event_status: "draft" | "open" | "live" | "closed"
      guest_source: "app" | "landing" | "door"
      guest_status:
        | "pending"
        | "approved"
        | "denied"
        | "checked_in"
        | "refused"
        | "removed"
      note_priority: "none" | "low" | "high"
      request_status: "pending" | "approved" | "denied"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "comped"
      venue_role: "admin" | "user_manager" | "finance" | "staff" | "doorhost"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      event_status: ["draft", "open", "live", "closed"],
      guest_source: ["app", "landing", "door"],
      guest_status: [
        "pending",
        "approved",
        "denied",
        "checked_in",
        "refused",
        "removed",
      ],
      note_priority: ["none", "low", "high"],
      request_status: ["pending", "approved", "denied"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "canceled",
        "comped",
      ],
      venue_role: ["admin", "user_manager", "finance", "staff", "doorhost"],
    },
  },
} as const
