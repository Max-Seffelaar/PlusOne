export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
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
          event_id: string
          guest_id: string
          id: string
          offline_synced: boolean
          plus_ones_arrived: number
          venue_id: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          checked_at?: string
          checked_by: string
          client_timestamp?: string | null
          created_at?: string
          device_id?: string | null
          event_id: string
          guest_id: string
          id?: string
          offline_synced?: boolean
          plus_ones_arrived?: number
          venue_id: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          checked_at?: string
          checked_by?: string
          client_timestamp?: string | null
          created_at?: string
          device_id?: string | null
          event_id?: string
          guest_id?: string
          id?: string
          offline_synced?: boolean
          plus_ones_arrived?: number
          venue_id?: string
          voided_at?: string | null
          voided_by?: string | null
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
            foreignKeyName: "check_ins_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: true
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_event_exclusions: {
        Row: {
          contact_id: string
          event_id: string
          excluded_at: string
          excluded_by: string | null
        }
        Insert: {
          contact_id: string
          event_id: string
          excluded_at?: string
          excluded_by?: string | null
        }
        Update: {
          contact_id?: string
          event_id?: string
          excluded_at?: string
          excluded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_event_exclusions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_event_exclusions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_event_exclusions_excluded_by_fkey"
            columns: ["excluded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          anonymized_at: string | null
          birthdate: string | null
          created_at: string
          created_by: string | null
          email: string | null
          email_norm: string | null
          full_name: string
          id: string
          is_permanent: boolean
          note: string | null
          phone: string | null
          phone_norm: string | null
          preferred_role: Database["public"]["Enums"]["contact_role"] | null
          source: Database["public"]["Enums"]["contact_source"]
          updated_at: string
          venue_id: string
        }
        Insert: {
          anonymized_at?: string | null
          birthdate?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_norm?: string | null
          full_name: string
          id?: string
          is_permanent?: boolean
          note?: string | null
          phone?: string | null
          phone_norm?: string | null
          preferred_role?: Database["public"]["Enums"]["contact_role"] | null
          source?: Database["public"]["Enums"]["contact_source"]
          updated_at?: string
          venue_id: string
        }
        Update: {
          anonymized_at?: string | null
          birthdate?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_norm?: string | null
          full_name?: string
          id?: string
          is_permanent?: boolean
          note?: string | null
          phone?: string | null
          phone_norm?: string | null
          preferred_role?: Database["public"]["Enums"]["contact_role"] | null
          source?: Database["public"]["Enums"]["contact_source"]
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
      event_template_tiers: {
        Row: {
          aliases: string[]
          color: string | null
          created_at: string
          description: string | null
          door_price_cents: number | null
          id: string
          max_guests: number | null
          name: string
          position: number
          template_id: string
          updated_at: string
          vat_percent: number | null
          venue_id: string
        }
        Insert: {
          aliases?: string[]
          color?: string | null
          created_at?: string
          description?: string | null
          door_price_cents?: number | null
          id?: string
          max_guests?: number | null
          name: string
          position?: number
          template_id: string
          updated_at?: string
          vat_percent?: number | null
          venue_id: string
        }
        Update: {
          aliases?: string[]
          color?: string | null
          created_at?: string
          description?: string | null
          door_price_cents?: number | null
          id?: string
          max_guests?: number | null
          name?: string
          position?: number
          template_id?: string
          updated_at?: string
          vat_percent?: number | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_template_tiers_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "event_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_template_tiers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      event_templates: {
        Row: {
          allow_uncheck: boolean | null
          auto_lock_offset_minutes: number | null
          capacity: number | null
          created_at: string
          id: string
          landing_active: boolean
          name: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          allow_uncheck?: boolean | null
          auto_lock_offset_minutes?: number | null
          capacity?: number | null
          created_at?: string
          id?: string
          landing_active?: boolean
          name: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          allow_uncheck?: boolean | null
          auto_lock_offset_minutes?: number | null
          capacity?: number | null
          created_at?: string
          id?: string
          landing_active?: boolean
          name?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_templates_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          allow_uncheck: boolean | null
          auto_lock_at: string | null
          cancelled_at: string | null
          capacity: number | null
          created_at: string
          default_member_quota: number
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
          allow_uncheck?: boolean | null
          auto_lock_at?: string | null
          cancelled_at?: string | null
          capacity?: number | null
          created_at?: string
          default_member_quota: number
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
          allow_uncheck?: boolean | null
          auto_lock_at?: string | null
          cancelled_at?: string | null
          capacity?: number | null
          created_at?: string
          default_member_quota?: number
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
          anonymized_at: string | null
          birthdate: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_via: Database["public"]["Enums"]["decision_source"]
          decision_reason: string | null
          dedupe_key: string | null
          email: string | null
          event_id: string
          full_name: string
          id: string
          marketing_opt_in: boolean
          motivation: string | null
          phone: string | null
          plus_ones: number
          request_link_id: string | null
          status: Database["public"]["Enums"]["request_status"]
          status_token_hash: string | null
          venue_id: string
        }
        Insert: {
          anonymized_at?: string | null
          birthdate?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_via?: Database["public"]["Enums"]["decision_source"]
          decision_reason?: string | null
          dedupe_key?: string | null
          email?: string | null
          event_id: string
          full_name: string
          id?: string
          marketing_opt_in?: boolean
          motivation?: string | null
          phone?: string | null
          plus_ones?: number
          request_link_id?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          status_token_hash?: string | null
          venue_id: string
        }
        Update: {
          anonymized_at?: string | null
          birthdate?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_via?: Database["public"]["Enums"]["decision_source"]
          decision_reason?: string | null
          dedupe_key?: string | null
          email?: string | null
          event_id?: string
          full_name?: string
          id?: string
          marketing_opt_in?: boolean
          motivation?: string | null
          phone?: string | null
          plus_ones?: number
          request_link_id?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          status_token_hash?: string | null
          venue_id?: string
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
          {
            foreignKeyName: "guest_requests_request_link_id_fkey"
            columns: ["request_link_id"]
            isOneToOne: false
            referencedRelation: "request_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
          door_price_cents: number | null
          event_id: string
          id: string
          max_guests: number | null
          name: string
          updated_at: string
          vat_percent: number | null
          venue_id: string
        }
        Insert: {
          aliases?: string[]
          color?: string | null
          created_at?: string
          description?: string | null
          door_price_cents?: number | null
          event_id: string
          id?: string
          max_guests?: number | null
          name: string
          updated_at?: string
          vat_percent?: number | null
          venue_id: string
        }
        Update: {
          aliases?: string[]
          color?: string | null
          created_at?: string
          description?: string | null
          door_price_cents?: number | null
          event_id?: string
          id?: string
          max_guests?: number | null
          name?: string
          updated_at?: string
          vat_percent?: number | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_tiers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_tiers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      guests: {
        Row: {
          added_by: string | null
          anonymized_at: string | null
          contact_id: string | null
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
          request_link_id: string | null
          source: Database["public"]["Enums"]["guest_source"]
          status: Database["public"]["Enums"]["guest_status"]
          tier_id: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          added_by?: string | null
          anonymized_at?: string | null
          contact_id?: string | null
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
          request_link_id?: string | null
          source?: Database["public"]["Enums"]["guest_source"]
          status?: Database["public"]["Enums"]["guest_status"]
          tier_id: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          added_by?: string | null
          anonymized_at?: string | null
          contact_id?: string | null
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
          request_link_id?: string | null
          source?: Database["public"]["Enums"]["guest_source"]
          status?: Database["public"]["Enums"]["guest_status"]
          tier_id?: string
          updated_at?: string
          venue_id?: string
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
            foreignKeyName: "guests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
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
            foreignKeyName: "guests_request_link_id_fkey"
            columns: ["request_link_id"]
            isOneToOne: false
            referencedRelation: "request_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_tier_id_event_id_fkey"
            columns: ["tier_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_tiers"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "guests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      influencers: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          handle: string | null
          id: string
          name: string
          notes: string | null
          stats_token_hash: string | null
          updated_at: string
          user_id: string | null
          venue_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          handle?: string | null
          id?: string
          name: string
          notes?: string | null
          stats_token_hash?: string | null
          updated_at?: string
          user_id?: string | null
          venue_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          handle?: string | null
          id?: string
          name?: string
          notes?: string | null
          stats_token_hash?: string | null
          updated_at?: string
          user_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "influencers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "influencers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "influencers_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          default_quota: number | null
          email: string
          event_ids: string[]
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
          default_quota?: number | null
          email: string
          event_ids?: string[]
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
          default_quota?: number | null
          email?: string
          event_ids?: string[]
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
      landing_request_throttle: {
        Row: {
          ip_hash: string
          request_count: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          ip_hash: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          ip_hash?: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
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
          venue_id: string
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
          venue_id: string
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
          venue_id?: string
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
          {
            foreignKeyName: "quota_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
          anonymized_at: string | null
          client_timestamp: string | null
          created_at: string
          device_id: string | null
          event_id: string
          guest_id: string
          id: string
          reason: string
          refused_at: string
          refused_by: string
          venue_id: string
        }
        Insert: {
          anonymized_at?: string | null
          client_timestamp?: string | null
          created_at?: string
          device_id?: string | null
          event_id: string
          guest_id: string
          id?: string
          reason: string
          refused_at?: string
          refused_by: string
          venue_id: string
        }
        Update: {
          anonymized_at?: string | null
          client_timestamp?: string | null
          created_at?: string
          device_id?: string | null
          event_id?: string
          guest_id?: string
          id?: string
          reason?: string
          refused_at?: string
          refused_by?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refusals_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "refusals_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      request_link_pageviews_daily: {
        Row: {
          day: string
          request_link_id: string
          updated_at: string
          views: number
        }
        Insert: {
          day: string
          request_link_id: string
          updated_at?: string
          views?: number
        }
        Update: {
          day?: string
          request_link_id?: string
          updated_at?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "request_link_pageviews_daily_request_link_id_fkey"
            columns: ["request_link_id"]
            isOneToOne: false
            referencedRelation: "request_links"
            referencedColumns: ["id"]
          },
        ]
      }
      request_links: {
        Row: {
          active: boolean
          archived_at: string | null
          auto_approve: boolean
          created_at: string
          created_by: string | null
          event_id: string
          expires_at: string | null
          id: string
          influencer_id: string | null
          is_default: boolean
          label: string | null
          max_headcount: number | null
          slug: string
          tier_id: string | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          auto_approve?: boolean
          created_at?: string
          created_by?: string | null
          event_id: string
          expires_at?: string | null
          id?: string
          influencer_id?: string | null
          is_default?: boolean
          label?: string | null
          max_headcount?: number | null
          slug: string
          tier_id?: string | null
          updated_at?: string
          venue_id: string
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          auto_approve?: boolean
          created_at?: string
          created_by?: string | null
          event_id?: string
          expires_at?: string | null
          id?: string
          influencer_id?: string | null
          is_default?: boolean
          label?: string | null
          max_headcount?: number | null
          slug?: string
          tier_id?: string | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_links_influencer_id_fkey"
            columns: ["influencer_id"]
            isOneToOne: false
            referencedRelation: "influencers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_links_tier_id_event_id_fkey"
            columns: ["tier_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_tiers"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "request_links_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          id: string
          processed_at: string
          type: string
          venue_id: string | null
        }
        Insert: {
          id: string
          processed_at?: string
          type: string
          venue_id?: string | null
        }
        Update: {
          id?: string
          processed_at?: string
          type?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stripe_webhook_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          last_stripe_event_at: string | null
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
          last_stripe_event_at?: string | null
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
          last_stripe_event_at?: string | null
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
          first_name: string | null
          full_name: string
          id: string
          last_name: string | null
          mfa_snooze_until: string | null
          phone: string | null
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          first_name?: string | null
          full_name: string
          id: string
          last_name?: string | null
          mfa_snooze_until?: string | null
          phone?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string | null
          full_name?: string
          id?: string
          last_name?: string | null
          mfa_snooze_until?: string | null
          phone?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      venue_memberships: {
        Row: {
          created_at: string
          id: string
          job_title: string | null
          roles: Database["public"]["Enums"]["venue_role"][]
          updated_at: string
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_title?: string | null
          roles: Database["public"]["Enums"]["venue_role"][]
          updated_at?: string
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_title?: string | null
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
          address_line: string | null
          allow_uncheck: boolean
          city: string | null
          company_name: string | null
          country: string
          created_at: string
          default_personal_quota: number
          finance_email: string | null
          id: string
          kvk_number: string | null
          name: string
          postal_code: string | null
          retention_months: number
          settings: Json
          slug: string
          terms_accepted_at: string | null
          terms_accepted_by: string | null
          terms_version: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          address_line?: string | null
          allow_uncheck?: boolean
          city?: string | null
          company_name?: string | null
          country?: string
          created_at?: string
          default_personal_quota?: number
          finance_email?: string | null
          id?: string
          kvk_number?: string | null
          name: string
          postal_code?: string | null
          retention_months?: number
          settings?: Json
          slug: string
          terms_accepted_at?: string | null
          terms_accepted_by?: string | null
          terms_version?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          address_line?: string | null
          allow_uncheck?: boolean
          city?: string | null
          company_name?: string | null
          country?: string
          created_at?: string
          default_personal_quota?: number
          finance_email?: string | null
          id?: string
          kvk_number?: string | null
          name?: string
          postal_code?: string | null
          retention_months?: number
          settings?: Json
          slug?: string
          terms_accepted_at?: string | null
          terms_accepted_by?: string | null
          terms_version?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      audit_feed: {
        Row: {
          action: string | null
          actor_id: string | null
          actor_name: string | null
          created_at: string | null
          device_id: string | null
          diff: Json | null
          entity_id: string | null
          entity_type: string | null
          event_id: string | null
          event_name: string | null
          guest_id: string | null
          guest_name: string | null
          id: string | null
          new_tier_name: string | null
          old_tier_name: string | null
          request_name: string | null
          subject_name: string | null
          subject_user_id: string | null
          venue_id: string | null
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
    }
    Functions: {
      accept_pending_invites: { Args: never; Returns: number }
      add_contact_to_event: {
        Args: {
          p_contact_id: string
          p_event_id: string
          p_plus_ones?: number
          p_tier_id?: string
        }
        Returns: string
      }
      add_contacts_to_event: {
        Args: {
          p_contact_ids: string[]
          p_event_id: string
          p_tier_id?: string
        }
        Returns: Json
      }
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
      apply_stripe_subscription_update: {
        Args: {
          p_current_period_end?: string
          p_event_created?: string
          p_event_id: string
          p_event_type: string
          p_plan_id?: string
          p_status?: Database["public"]["Enums"]["subscription_status"]
          p_stripe_customer_id?: string
          p_stripe_subscription_id?: string
          p_venue_id?: string
        }
        Returns: boolean
      }
      approve_guest_request: {
        Args: { p_request_id: string; p_tier_id: string }
        Returns: string
      }
      approve_quota_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      audit_changed: { Args: { p_new: Json; p_old: Json }; Returns: Json }
      can_check_in: { Args: { p_event_id: string }; Returns: boolean }
      can_read_event_stats: { Args: { p_event_id: string }; Returns: boolean }
      can_read_venue_stats: { Args: { p_venue_id: string }; Returns: boolean }
      can_view_profile: { Args: { p_profile_id: string }; Returns: boolean }
      can_write_guests: { Args: { p_event_id: string }; Returns: boolean }
      consume_public_throttle: {
        Args: { p_key: string; p_max: number; p_window_min: number }
        Returns: boolean
      }
      create_event_from_template: {
        Args: {
          p_ends_at?: string
          p_name: string
          p_starts_at: string
          p_template_id: string
        }
        Returns: string
      }
      create_template_from_event: {
        Args: { p_event_id: string; p_name: string }
        Returns: string
      }
      create_venue_with_owner: {
        Args: {
          p_address: string
          p_city?: string
          p_complete?: boolean
          p_finance_email?: string
          p_kvk_number?: string
          p_name: string
          p_plan_id?: string
          p_retention_months: number
          p_terms_version?: string
          p_vat_number?: string
          p_venue_type: string
        }
        Returns: string
      }
      current_user_requires_mfa: { Args: never; Returns: boolean }
      event_allows_uncheck: { Args: { p_event_id: string }; Returns: boolean }
      event_capacity_consumption: {
        Args: { p_event_id: string }
        Returns: number
      }
      event_capacity_status: {
        Args: { p_event_id: string }
        Returns: {
          capacity: number
          consumed: number
          remaining: number
        }[]
      }
      event_checkins_per_quarter: {
        Args: { p_event_id: string }
        Returns: {
          bucket: string
          checkins: number
          headcount: number
        }[]
      }
      event_link_funnel: {
        Args: { p_event_id: string }
        Returns: {
          active: boolean
          approved_heads: number
          auto_approve: boolean
          checked_in_heads: number
          expires_at: string
          influencer_id: string
          influencer_name: string
          is_default: boolean
          label: string
          link_id: string
          max_headcount: number
          requests: number
          slug: string
          views: number
        }[]
      }
      event_quota_status: {
        Args: { p_event_id: string }
        Returns: {
          consumed: number
          exempt: boolean
          quota: number
          remaining: number
        }[]
      }
      event_refusal_reasons: {
        Args: { p_event_id: string }
        Returns: {
          n: number
          reason: string
        }[]
      }
      event_stats_summary: {
        Args: { p_event_id: string }
        Returns: {
          attendance_pct: number
          no_shows: number
          peak_bucket: string
          peak_count: number
          present: number
          present_headcount: number
          refused: number
          registered: number
          registered_headcount: number
        }[]
      }
      event_tier_stats: {
        Args: { p_event_id: string }
        Returns: {
          color: string
          present: number
          present_headcount: number
          registered: number
          registered_headcount: number
          tier_id: string
          tier_name: string
        }[]
      }
      event_transition_requires_admin: {
        Args: {
          p_from: Database["public"]["Enums"]["event_status"]
          p_to: Database["public"]["Enums"]["event_status"]
        }
        Returns: boolean
      }
      event_user_additions: {
        Args: { p_event_id: string }
        Returns: {
          added: number
          added_free_headcount: number
          added_headcount: number
          full_name: string
          present: number
          present_free_headcount: number
          present_headcount: number
          removed_headcount: number
          user_id: string
        }[]
      }
      event_venue: { Args: { p_event_id: string }; Returns: string }
      find_event_guest_by_name: {
        Args: { p_event_id: string; p_name: string }
        Returns: {
          full_name: string
          id: string
          plus_ones: number
        }[]
      }
      find_event_guests_by_names: {
        Args: { p_event_id: string; p_names: string[] }
        Returns: {
          full_name: string
          id: string
          plus_ones: number
        }[]
      }
      forget_contact: { Args: { p_contact_id: string }; Returns: Json }
      get_influencer_stats: {
        Args: { p_ip_hash: string; p_token_hash: string }
        Returns: Json
      }
      get_landing_event: {
        Args: { p_ip_hash: string; p_slug: string }
        Returns: {
          event_name: string
          spots_left: number
          starts_at: string
          via_label: string
        }[]
      }
      get_request_status: {
        Args: { p_ip_hash: string; p_token_hash: string }
        Returns: Json
      }
      guest_capacity_contribution: {
        Args: {
          g: Database["public"]["Tables"]["guests"]["Row"]
          p_is_inside: boolean
        }
        Returns: number
      }
      guest_event: { Args: { p_guest_id: string }; Returns: string }
      guest_personal_contribution: {
        Args: {
          g: Database["public"]["Tables"]["guests"]["Row"]
          p_is_inside: boolean
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
      is_valid_event_status_transition: {
        Args: {
          p_from: Database["public"]["Enums"]["event_status"]
          p_to: Database["public"]["Enums"]["event_status"]
        }
        Returns: boolean
      }
      is_venue_member: { Args: { p_venue_id: string }; Returns: boolean }
      is_venue_organizer: { Args: { p_venue_id: string }; Returns: boolean }
      link_headcount_contribution: {
        Args: {
          g: Database["public"]["Tables"]["guests"]["Row"]
          p_is_inside: boolean
        }
        Returns: number
      }
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
      mark_guest_regular: { Args: { p_guest_id: string }; Returns: undefined }
      mark_onboarding_complete: {
        Args: { p_venue_id: string }
        Returns: undefined
      }
      organizes_event_at_venue: {
        Args: { p_venue_id: string }
        Returns: boolean
      }
      promote_guest_to_contact: {
        Args: { p_guest_id: string }
        Returns: undefined
      }
      record_link_pageview: {
        Args: { p_ip_hash: string; p_slug: string }
        Returns: undefined
      }
      redact_anonymized_audit_pii: {
        Args: { p_guest_ids: string[] }
        Returns: number
      }
      redact_anonymized_contact_audit_pii: {
        Args: { p_contact_ids: string[] }
        Returns: number
      }
      redact_audit_diff: {
        Args: { p_diff: Json; p_redaction: Json }
        Returns: Json
      }
      redact_jsonb_obj: {
        Args: { p_obj: Json; p_redaction: Json }
        Returns: Json
      }
      request_device_id: { Args: never; Returns: string }
      request_link_consumption: { Args: { p_link_id: string }; Returns: number }
      request_link_open: {
        Args: { l: Database["public"]["Tables"]["request_links"]["Row"] }
        Returns: boolean
      }
      resolve_tier_for_contact: {
        Args: {
          p_event_id: string
          p_role: Database["public"]["Enums"]["contact_role"]
        }
        Returns: string
      }
      revoke_own_session: { Args: { p_session_id: string }; Returns: boolean }
      run_privacy_retention: {
        Args: never
        Returns: {
          audit_rows_redacted: number
          guests_anonymized: number
          refusals_redacted: number
          requests_anonymized: number
        }[]
      }
      search_contacts_for_reuse: {
        Args: { p_query?: string; p_venue_id: string }
        Returns: {
          event_count: number
          full_name: string
          id: string
          preferred_role: Database["public"]["Enums"]["contact_role"]
        }[]
      }
      set_venue_plan: {
        Args: { p_plan_id: string; p_venue_id: string }
        Returns: undefined
      }
      slugify: { Args: { p_text: string }; Returns: string }
      stamp_stripe_customer: {
        Args: { p_stripe_customer_id: string; p_venue_id: string }
        Returns: undefined
      }
      submit_guest_request: {
        Args: {
          p_birthdate?: string
          p_email: string
          p_full_name: string
          p_ip_hash: string
          p_marketing_opt_in: boolean
          p_motivation: string
          p_phone: string
          p_plus_ones: number
          p_slug: string
          p_status_token_hash?: string
        }
        Returns: Json
      }
      sync_permanent_guests_into_event: {
        Args: { p_event_id: string }
        Returns: number
      }
      tier_consumption: { Args: { p_tier_id: string }; Returns: number }
      unique_venue_slug: { Args: { p_name: string }; Returns: string }
      upsert_contacts: {
        Args: { p_rows: Json; p_venue_id: string }
        Returns: Json
      }
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
      venue_event_headcounts: {
        Args: { p_since?: string; p_venue_id: string }
        Returns: {
          event_id: string
          present: number
          registered: number
        }[]
      }
      venue_event_rollup: {
        Args: { p_from?: string; p_to?: string; p_venue_id: string }
        Returns: {
          attendance_pct: number
          event_id: string
          name: string
          present: number
          present_headcount: number
          refused: number
          registered: number
          registered_headcount: number
          starts_at: string
          status: Database["public"]["Enums"]["event_status"]
        }[]
      }
      venue_influencer_leaderboard: {
        Args: { p_from?: string; p_to?: string; p_venue_id: string }
        Returns: {
          approved_heads: number
          checked_in_heads: number
          events_count: number
          handle: string
          influencer_id: string
          influencer_name: string
          links_count: number
          requests: number
          views: number
        }[]
      }
      venue_label_link_funnel: {
        Args: { p_from?: string; p_to?: string; p_venue_id: string }
        Returns: {
          approved_heads: number
          checked_in_heads: number
          event_id: string
          event_name: string
          is_default: boolean
          label: string
          link_id: string
          requests: number
          views: number
        }[]
      }
      venue_refusal_reasons: {
        Args: { p_from?: string; p_to?: string; p_venue_id: string }
        Returns: {
          n: number
          reason: string
        }[]
      }
      venue_stats_summary: {
        Args: { p_from?: string; p_to?: string; p_venue_id: string }
        Returns: {
          attendance_pct: number
          events: number
          no_shows: number
          present: number
          present_headcount: number
          refused: number
          registered: number
          registered_headcount: number
        }[]
      }
      venue_user_additions: {
        Args: { p_from?: string; p_to?: string; p_venue_id: string }
        Returns: {
          added: number
          added_headcount: number
          full_name: string
          present: number
          user_id: string
        }[]
      }
    }
    Enums: {
      contact_role: "vip" | "all_access" | "artist" | "press" | "crew" | "guest"
      contact_source: "manual" | "import" | "guest_request" | "guest_list"
      decision_source: "manual" | "auto"
      event_status: "draft" | "open" | "live" | "closed"
      guest_source: "app" | "landing" | "door" | "permanent"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      contact_role: ["vip", "all_access", "artist", "press", "crew", "guest"],
      contact_source: ["manual", "import", "guest_request", "guest_list"],
      decision_source: ["manual", "auto"],
      event_status: ["draft", "open", "live", "closed"],
      guest_source: ["app", "landing", "door", "permanent"],
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

