export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string;
          display_alias: string | null;
          email: string | null;
          id: string;
          stripe_customer_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_alias?: string | null;
          email?: string | null;
          id?: string;
          stripe_customer_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_alias?: string | null;
          email?: string | null;
          id?: string;
          stripe_customer_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      analytics_events: {
        Row: {
          actor_hash: string | null;
          created_at: string;
          event_type: string;
          id: number;
          metadata: Json;
          owner_subject_hash: string;
          room_id: string;
        };
        Insert: {
          actor_hash?: string | null;
          created_at?: string;
          event_type: string;
          id?: never;
          metadata?: Json;
          owner_subject_hash: string;
          room_id: string;
        };
        Update: {
          actor_hash?: string | null;
          created_at?: string;
          event_type?: string;
          id?: never;
          metadata?: Json;
          owner_subject_hash?: string;
          room_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analytics_events_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      anonymous_identities: {
        Row: {
          account_id: string | null;
          auth_user_hash: string | null;
          custom_alias: string | null;
          first_seen_at: string;
          handle: string | null;
          last_seen_at: string;
          subject_hash: string;
        };
        Insert: {
          account_id?: string | null;
          auth_user_hash?: string | null;
          custom_alias?: string | null;
          first_seen_at?: string;
          handle?: string | null;
          last_seen_at?: string;
          subject_hash: string;
        };
        Update: {
          account_id?: string | null;
          auth_user_hash?: string | null;
          custom_alias?: string | null;
          first_seen_at?: string;
          handle?: string | null;
          last_seen_at?: string;
          subject_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "anonymous_identities_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_type: string;
          created_at: string;
          id: number;
          metadata: Json;
          target_id: string | null;
          target_type: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_type?: string;
          created_at?: string;
          id?: number;
          metadata?: Json;
          target_id?: string | null;
          target_type?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_type?: string;
          created_at?: string;
          id?: number;
          metadata?: Json;
          target_id?: string | null;
          target_type?: string | null;
        };
        Relationships: [];
      };
      campaign_budgets: {
        Row: {
          campaign_id: string;
          cost_per_entry_cents: number;
          created_at: string;
          currency: string;
          daily_cap_cents: number | null;
          id: string;
          spent_cents: number;
          total_budget_cents: number;
          updated_at: string;
        };
        Insert: {
          campaign_id: string;
          cost_per_entry_cents?: number;
          created_at?: string;
          currency?: string;
          daily_cap_cents?: number | null;
          id?: string;
          spent_cents?: number;
          total_budget_cents?: number;
          updated_at?: string;
        };
        Update: {
          campaign_id?: string;
          cost_per_entry_cents?: number;
          created_at?: string;
          currency?: string;
          daily_cap_cents?: number | null;
          id?: string;
          spent_cents?: number;
          total_budget_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_budgets_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: true;
            referencedRelation: "sponsored_campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_impression_log: {
        Row: {
          campaign_id: string;
          created_at: string;
          id: number;
          subject_hash: string;
        };
        Insert: {
          campaign_id: string;
          created_at?: string;
          id?: number;
          subject_hash: string;
        };
        Update: {
          campaign_id?: string;
          created_at?: string;
          id?: number;
          subject_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_impression_log_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "sponsored_campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_metrics: {
        Row: {
          campaign_id: string;
          cta_clicks: number;
          day: string;
          entries: number;
          event_signups: number;
          hides: number;
          id: number;
          impressions: number;
          reports: number;
          spend_cents: number;
          unique_viewers: number;
        };
        Insert: {
          campaign_id: string;
          cta_clicks?: number;
          day?: string;
          entries?: number;
          event_signups?: number;
          hides?: number;
          id?: number;
          impressions?: number;
          reports?: number;
          spend_cents?: number;
          unique_viewers?: number;
        };
        Update: {
          campaign_id?: string;
          cta_clicks?: number;
          day?: string;
          entries?: number;
          event_signups?: number;
          hides?: number;
          id?: number;
          impressions?: number;
          reports?: number;
          spend_cents?: number;
          unique_viewers?: number;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_metrics_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "sponsored_campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_reviews: {
        Row: {
          campaign_id: string;
          created_at: string;
          decision: string;
          id: string;
          reason: string | null;
          reviewer_account_id: string | null;
        };
        Insert: {
          campaign_id: string;
          created_at?: string;
          decision: string;
          id?: string;
          reason?: string | null;
          reviewer_account_id?: string | null;
        };
        Update: {
          campaign_id?: string;
          created_at?: string;
          decision?: string;
          id?: string;
          reason?: string | null;
          reviewer_account_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_reviews_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "sponsored_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_reviews_reviewer_account_id_fkey";
            columns: ["reviewer_account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      content_likes: {
        Row: {
          created_at: string;
          id: string;
          owner_subject_hash: string;
          room_id: string | null;
          subject_hash: string;
          target_id: string;
          target_type: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          owner_subject_hash: string;
          room_id?: string | null;
          subject_hash: string;
          target_id: string;
          target_type: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          owner_subject_hash?: string;
          room_id?: string | null;
          subject_hash?: string;
          target_id?: string;
          target_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_likes_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      entitlement_overrides: {
        Row: {
          account_id: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          key: string;
          value: Json;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          key: string;
          value: Json;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          key?: string;
          value?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "entitlement_overrides_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          created_at: string;
          description: string | null;
          ends_at: string | null;
          id: string;
          organization_id: string | null;
          room_id: string | null;
          starts_at: string;
          status: string;
          title: string;
          updated_at: string;
          visibility: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          ends_at?: string | null;
          id?: string;
          organization_id?: string | null;
          room_id?: string | null;
          starts_at: string;
          status?: string;
          title: string;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          ends_at?: string | null;
          id?: string;
          organization_id?: string | null;
          room_id?: string | null;
          starts_at?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "events_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      handle_redirects: {
        Row: {
          created_at: string;
          old_handle: string;
          owner_subject_hash: string;
          room_id: string;
        };
        Insert: {
          created_at?: string;
          old_handle: string;
          owner_subject_hash: string;
          room_id: string;
        };
        Update: {
          created_at?: string;
          old_handle?: string;
          owner_subject_hash?: string;
          room_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "handle_redirects_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      image_messages: {
        Row: {
          alt_text: string | null;
          approved_at: string | null;
          checksum: string | null;
          created_at: string;
          expires_at: string;
          file_size: number;
          height: number | null;
          id: number;
          mime_type: string;
          moderation_reason: string | null;
          moderation_status: string;
          room_id: string;
          sender_membership_id: string;
          storage_path: string;
          uploaded: boolean;
          width: number | null;
        };
        Insert: {
          alt_text?: string | null;
          approved_at?: string | null;
          checksum?: string | null;
          created_at?: string;
          expires_at?: string;
          file_size?: number;
          height?: number | null;
          id?: number;
          mime_type: string;
          moderation_reason?: string | null;
          moderation_status?: string;
          room_id: string;
          sender_membership_id: string;
          storage_path: string;
          uploaded?: boolean;
          width?: number | null;
        };
        Update: {
          alt_text?: string | null;
          approved_at?: string | null;
          checksum?: string | null;
          created_at?: string;
          expires_at?: string;
          file_size?: number;
          height?: number | null;
          id?: number;
          mime_type?: string;
          moderation_reason?: string | null;
          moderation_status?: string;
          room_id?: string;
          sender_membership_id?: string;
          storage_path?: string;
          uploaded?: boolean;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "image_messages_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "image_messages_sender_membership_id_fkey";
            columns: ["sender_membership_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          created_at: string;
          created_by_account_id: string | null;
          expires_at: string | null;
          id: string;
          max_uses: number | null;
          revoked_at: string | null;
          room_id: string;
          token_hash: string;
          used_count: number;
        };
        Insert: {
          created_at?: string;
          created_by_account_id?: string | null;
          expires_at?: string | null;
          id?: string;
          max_uses?: number | null;
          revoked_at?: string | null;
          room_id: string;
          token_hash: string;
          used_count?: number;
        };
        Update: {
          created_at?: string;
          created_by_account_id?: string | null;
          expires_at?: string | null;
          id?: string;
          max_uses?: number | null;
          revoked_at?: string | null;
          room_id?: string;
          token_hash?: string;
          used_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_created_by_account_id_fkey";
            columns: ["created_by_account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      memberships: {
        Row: {
          account_id: string | null;
          alias: string;
          favorite: boolean;
          id: string;
          joined_at: string;
          last_read_image_id: number | null;
          last_read_message_id: number | null;
          last_seen_at: string;
          left_at: string | null;
          pinned: boolean;
          role: string;
          room_id: string;
          subject_hash: string;
          topic_id: string | null;
        };
        Insert: {
          account_id?: string | null;
          alias: string;
          favorite?: boolean;
          id?: string;
          joined_at?: string;
          last_read_image_id?: number | null;
          last_read_message_id?: number | null;
          last_seen_at?: string;
          left_at?: string | null;
          pinned?: boolean;
          role?: string;
          room_id: string;
          subject_hash: string;
          topic_id?: string | null;
        };
        Update: {
          account_id?: string | null;
          alias?: string;
          favorite?: boolean;
          id?: string;
          joined_at?: string;
          last_read_image_id?: number | null;
          last_read_message_id?: number | null;
          last_seen_at?: string;
          left_at?: string | null;
          pinned?: boolean;
          role?: string;
          room_id?: string;
          subject_hash?: string;
          topic_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      message_reports: {
        Row: {
          campaign_id: string | null;
          created_at: string;
          id: string;
          image_message_id: number | null;
          message_id: number | null;
          reason: string;
          reporter_membership_id: string | null;
          reporter_subject_hash: string | null;
          status: string;
        };
        Insert: {
          campaign_id?: string | null;
          created_at?: string;
          id?: string;
          image_message_id?: number | null;
          message_id?: number | null;
          reason: string;
          reporter_membership_id?: string | null;
          reporter_subject_hash?: string | null;
          status?: string;
        };
        Update: {
          campaign_id?: string | null;
          created_at?: string;
          id?: string;
          image_message_id?: number | null;
          message_id?: number | null;
          reason?: string;
          reporter_membership_id?: string | null;
          reporter_subject_hash?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "message_reports_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "sponsored_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "message_reports_image_message_id_fkey";
            columns: ["image_message_id"];
            isOneToOne: false;
            referencedRelation: "image_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "message_reports_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "message_reports_reporter_membership_id_fkey";
            columns: ["reporter_membership_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          body: string;
          created_at: string;
          deleted_at: string | null;
          expires_at: string;
          id: number;
          idempotency_key: string | null;
          membership_id: string;
          pinned: boolean;
          room_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          deleted_at?: string | null;
          expires_at?: string;
          id?: never;
          idempotency_key?: string | null;
          membership_id: string;
          pinned?: boolean;
          room_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          deleted_at?: string | null;
          expires_at?: string;
          id?: never;
          idempotency_key?: string | null;
          membership_id?: string;
          pinned?: boolean;
          room_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_membership_id_fkey";
            columns: ["membership_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      moderation_decisions: {
        Row: {
          created_at: string;
          decision: string;
          id: string;
          reason: string | null;
          reviewer_account_id: string | null;
          source: string;
          subject_id: string;
          subject_type: string;
        };
        Insert: {
          created_at?: string;
          decision: string;
          id?: string;
          reason?: string | null;
          reviewer_account_id?: string | null;
          source?: string;
          subject_id: string;
          subject_type: string;
        };
        Update: {
          created_at?: string;
          decision?: string;
          id?: string;
          reason?: string | null;
          reviewer_account_id?: string | null;
          source?: string;
          subject_id?: string;
          subject_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moderation_decisions_reviewer_account_id_fkey";
            columns: ["reviewer_account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_settings: {
        Row: {
          live_event: boolean;
          new_conversation: boolean;
          new_follower: boolean;
          public_message: boolean;
          subject_hash: string;
          updated_at: string;
        };
        Insert: {
          live_event?: boolean;
          new_conversation?: boolean;
          new_follower?: boolean;
          public_message?: boolean;
          subject_hash: string;
          updated_at?: string;
        };
        Update: {
          live_event?: boolean;
          new_conversation?: boolean;
          new_follower?: boolean;
          public_message?: boolean;
          subject_hash?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          organization_id: string;
          role: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          organization_id: string;
          role?: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          billing_ready: boolean;
          created_at: string;
          description: string | null;
          id: string;
          logo_path: string | null;
          name: string;
          owner_account_id: string;
          slug: string | null;
          suspended_at: string | null;
          updated_at: string;
          verified: boolean;
          verified_at: string | null;
          website: string | null;
        };
        Insert: {
          billing_ready?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          logo_path?: string | null;
          name: string;
          owner_account_id: string;
          slug?: string | null;
          suspended_at?: string | null;
          updated_at?: string;
          verified?: boolean;
          verified_at?: string | null;
          website?: string | null;
        };
        Update: {
          billing_ready?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          logo_path?: string | null;
          name?: string;
          owner_account_id?: string;
          slug?: string | null;
          suspended_at?: string | null;
          updated_at?: string;
          verified?: boolean;
          verified_at?: string | null;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "organizations_owner_account_id_fkey";
            columns: ["owner_account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          currency: string;
          entitlements: Json;
          id: string;
          interval: string;
          limits: Json;
          name: string;
          price_cents: number;
          sort_order: number;
          stripe_price_id: string | null;
          stripe_product_id: string | null;
          tagline: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          currency?: string;
          entitlements?: Json;
          id?: string;
          interval?: string;
          limits?: Json;
          name: string;
          price_cents?: number;
          sort_order?: number;
          stripe_price_id?: string | null;
          stripe_product_id?: string | null;
          tagline?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          currency?: string;
          entitlements?: Json;
          id?: string;
          interval?: string;
          limits?: Json;
          name?: string;
          price_cents?: number;
          sort_order?: number;
          stripe_price_id?: string | null;
          stripe_product_id?: string | null;
          tagline?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_roles: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          role: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          role: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_roles_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_settings: {
        Row: {
          key: string;
          updated_at: string;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [];
      };
      poll_votes: {
        Row: {
          created_at: string;
          id: string;
          membership_id: string;
          option_index: number;
          poll_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          membership_id: string;
          option_index: number;
          poll_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          membership_id?: string;
          option_index?: number;
          poll_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "poll_votes_membership_id_fkey";
            columns: ["membership_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "poll_votes_poll_id_fkey";
            columns: ["poll_id"];
            isOneToOne: false;
            referencedRelation: "polls";
            referencedColumns: ["id"];
          },
        ];
      };
      polls: {
        Row: {
          closes_at: string | null;
          created_at: string;
          created_by_membership_id: string | null;
          id: string;
          options: Json;
          question: string;
          room_id: string;
        };
        Insert: {
          closes_at?: string | null;
          created_at?: string;
          created_by_membership_id?: string | null;
          id?: string;
          options: Json;
          question: string;
          room_id: string;
        };
        Update: {
          closes_at?: string | null;
          created_at?: string;
          created_by_membership_id?: string | null;
          id?: string;
          options?: Json;
          question?: string;
          room_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "polls_created_by_membership_id_fkey";
            columns: ["created_by_membership_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "polls_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      privacy_requests: {
        Row: {
          auth_user_hash: string;
          created_at: string;
          expires_at: string;
          id: string;
          note: string | null;
          reference: string;
          request_type: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          auth_user_hash: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          note?: string | null;
          reference: string;
          request_type: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          auth_user_hash?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          note?: string | null;
          reference?: string;
          request_type?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profile_blocks: {
        Row: {
          blocked_subject_hash: string;
          created_at: string;
          id: string;
          reason: string | null;
          subject_hash: string;
        };
        Insert: {
          blocked_subject_hash: string;
          created_at?: string;
          id?: string;
          reason?: string | null;
          subject_hash: string;
        };
        Update: {
          blocked_subject_hash?: string;
          created_at?: string;
          id?: string;
          reason?: string | null;
          subject_hash?: string;
        };
        Relationships: [];
      };
      rate_events: {
        Row: {
          action: string;
          created_at: string;
          id: number;
          subject_hash: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          id?: never;
          subject_hash: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: never;
          subject_hash?: string;
        };
        Relationships: [];
      };
      room_followers: {
        Row: {
          created_at: string;
          follower_subject_hash: string;
          id: string;
          room_id: string;
        };
        Insert: {
          created_at?: string;
          follower_subject_hash: string;
          id?: string;
          room_id: string;
        };
        Update: {
          created_at?: string;
          follower_subject_hash?: string;
          id?: string;
          room_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_followers_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      room_notifications: {
        Row: {
          created_at: string;
          id: number;
          message: string;
          notification_type: string;
          read: boolean;
          recipient_subject_hash: string;
          room_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: number;
          message: string;
          notification_type: string;
          read?: boolean;
          recipient_subject_hash: string;
          room_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: number;
          message?: string;
          notification_type?: string;
          read?: boolean;
          recipient_subject_hash?: string;
          room_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "room_notifications_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      rooms: {
        Row: {
          archived_at: string | null;
          capacity: number;
          color: string | null;
          cover_path: string | null;
          created_at: string;
          description: string | null;
          id: string;
          kind: string;
          organization_id: string | null;
          owner_account_id: string | null;
          retention_hours: number | null;
          retention_images: number | null;
          retention_texts: number | null;
          room_number: number;
          rules: string | null;
          slug: string | null;
          status: string;
          title: string | null;
          topic_id: string | null;
          updated_at: string;
          visibility: string;
        };
        Insert: {
          archived_at?: string | null;
          capacity?: number;
          color?: string | null;
          cover_path?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          kind?: string;
          organization_id?: string | null;
          owner_account_id?: string | null;
          retention_hours?: number | null;
          retention_images?: number | null;
          retention_texts?: number | null;
          room_number: number;
          rules?: string | null;
          slug?: string | null;
          status?: string;
          title?: string | null;
          topic_id?: string | null;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          archived_at?: string | null;
          capacity?: number;
          color?: string | null;
          cover_path?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          kind?: string;
          organization_id?: string | null;
          owner_account_id?: string | null;
          retention_hours?: number | null;
          retention_images?: number | null;
          retention_texts?: number | null;
          room_number?: number;
          rules?: string | null;
          slug?: string | null;
          status?: string;
          title?: string | null;
          topic_id?: string | null;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rooms_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rooms_owner_account_id_fkey";
            columns: ["owner_account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rooms_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      sponsored_campaigns: {
        Row: {
          cover_path: string | null;
          created_at: string;
          cta_label: string | null;
          cta_url: string | null;
          description: string;
          ends_at: string | null;
          id: string;
          languages: string[];
          organization_id: string;
          rejection_reason: string | null;
          room_id: string | null;
          safety_status: string;
          starts_at: string | null;
          status: string;
          title: string;
          topics: string[];
          updated_at: string;
        };
        Insert: {
          cover_path?: string | null;
          created_at?: string;
          cta_label?: string | null;
          cta_url?: string | null;
          description: string;
          ends_at?: string | null;
          id?: string;
          languages?: string[];
          organization_id: string;
          rejection_reason?: string | null;
          room_id?: string | null;
          safety_status?: string;
          starts_at?: string | null;
          status?: string;
          title: string;
          topics?: string[];
          updated_at?: string;
        };
        Update: {
          cover_path?: string | null;
          created_at?: string;
          cta_label?: string | null;
          cta_url?: string | null;
          description?: string;
          ends_at?: string | null;
          id?: string;
          languages?: string[];
          organization_id?: string;
          rejection_reason?: string | null;
          room_id?: string | null;
          safety_status?: string;
          starts_at?: string | null;
          status?: string;
          title?: string;
          topics?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sponsored_campaigns_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sponsored_campaigns_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      sponsored_placements: {
        Row: {
          active: boolean;
          campaign_id: string;
          created_at: string;
          id: string;
          surface: string;
          topic_slug: string | null;
          weight: number;
        };
        Insert: {
          active?: boolean;
          campaign_id: string;
          created_at?: string;
          id?: string;
          surface?: string;
          topic_slug?: string | null;
          weight?: number;
        };
        Update: {
          active?: boolean;
          campaign_id?: string;
          created_at?: string;
          id?: string;
          surface?: string;
          topic_slug?: string | null;
          weight?: number;
        };
        Relationships: [
          {
            foreignKeyName: "sponsored_placements_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "sponsored_campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          account_id: string;
          cancel_at_period_end: boolean;
          created_at: string;
          current_period_end: string | null;
          grace_until: string | null;
          id: string;
          plan_id: string;
          status: string;
          stripe_subscription_id: string | null;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          grace_until?: string | null;
          id?: string;
          plan_id: string;
          status?: string;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          grace_until?: string | null;
          id?: string;
          plan_id?: string;
          status?: string;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: true;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      support_requests: {
        Row: {
          body: string;
          category: string;
          contact: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          public_target: string | null;
          reference: string;
          requester_hash: string | null;
          requester_hash_expires_at: string | null;
          status: string;
          subject: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          category: string;
          contact?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          public_target?: string | null;
          reference: string;
          requester_hash?: string | null;
          requester_hash_expires_at?: string | null;
          status?: string;
          subject: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          category?: string;
          contact?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          public_target?: string | null;
          reference?: string;
          requester_hash?: string | null;
          requester_hash_expires_at?: string | null;
          status?: string;
          subject?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      topic_aliases: {
        Row: {
          created_at: string;
          id: string;
          normalized_alias: string;
          topic_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          normalized_alias: string;
          topic_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          normalized_alias?: string;
          topic_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "topic_aliases_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      topics: {
        Row: {
          created_at: string;
          description: string | null;
          display_name: string;
          enabled: boolean;
          id: string;
          slug: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          display_name: string;
          enabled?: boolean;
          id?: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          display_name?: string;
          enabled?: boolean;
          id?: string;
          slug?: string;
        };
        Relationships: [];
      };
      user_hidden_campaigns: {
        Row: {
          campaign_id: string;
          created_at: string;
          id: string;
          subject_hash: string;
        };
        Insert: {
          campaign_id: string;
          created_at?: string;
          id?: string;
          subject_hash: string;
        };
        Update: {
          campaign_id?: string;
          created_at?: string;
          id?: string;
          subject_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_hidden_campaigns_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "sponsored_campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      user_rooms: {
        Row: {
          avatar_path: string | null;
          banner_path: string | null;
          created_at: string;
          description: string | null;
          external_url: string | null;
          handle: string;
          id: string;
          location: string | null;
          owner_subject_hash: string;
          profile_visibility: string;
          room_id: string;
          room_name: string;
          show_follower_count: boolean;
          show_likes: boolean;
          show_online_status: boolean;
          updated_at: string;
        };
        Insert: {
          avatar_path?: string | null;
          banner_path?: string | null;
          created_at?: string;
          description?: string | null;
          external_url?: string | null;
          handle: string;
          id?: string;
          location?: string | null;
          owner_subject_hash: string;
          profile_visibility?: string;
          room_id: string;
          room_name: string;
          show_follower_count?: boolean;
          show_likes?: boolean;
          show_online_status?: boolean;
          updated_at?: string;
        };
        Update: {
          avatar_path?: string | null;
          banner_path?: string | null;
          created_at?: string;
          description?: string | null;
          external_url?: string | null;
          handle?: string;
          id?: string;
          location?: string | null;
          owner_subject_hash?: string;
          profile_visibility?: string;
          room_id?: string;
          room_name?: string;
          show_follower_count?: boolean;
          show_likes?: boolean;
          show_online_status?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_rooms_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: true;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_events: {
        Row: {
          created_at: string;
          external_id: string;
          id: string;
          payload: Json;
          processed_at: string | null;
          provider: string;
          type: string;
        };
        Insert: {
          created_at?: string;
          external_id: string;
          id?: string;
          payload?: Json;
          processed_at?: string | null;
          provider?: string;
          type: string;
        };
        Update: {
          created_at?: string;
          external_id?: string;
          id?: string;
          payload?: Json;
          processed_at?: string | null;
          provider?: string;
          type?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      room_presence: {
        Row: {
          alias: string | null;
          joined_at: string | null;
          last_seen_at: string | null;
          presence_status: string | null;
          room_id: string | null;
          user_id: string | null;
        };
        Insert: {
          alias?: string | null;
          joined_at?: string | null;
          last_seen_at?: string | null;
          presence_status?: never;
          room_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          alias?: string | null;
          joined_at?: string | null;
          last_seen_at?: string | null;
          presence_status?: never;
          room_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      cleanup_expired: { Args: never; Returns: Json };
      cleanup_support_requests: { Args: never; Returns: Json };
      custom_access_token_hook: { Args: { event: Json }; Returns: Json };
      enforce_all_retention: {
        Args: never;
        Returns: {
          storage_path: string;
        }[];
      };
      enforce_image_retention: {
        Args: { p_room_id: string };
        Returns: {
          storage_path: string;
        }[];
      };
      enforce_text_retention: { Args: { p_room_id: string }; Returns: number };
      get_or_create_personal_room: {
        Args: { p_handle: string; p_room_name: string; p_subject_hash: string };
        Returns: Json;
      };
      join_topic_room: {
        Args: { p_alias: string; p_subject_hash: string; p_topic_slug: string };
        Returns: Json;
      };
      join_universal_room: {
        Args: { p_alias: string; p_subject_hash: string };
        Returns: Json;
      };
      purge_dead_images: {
        Args: never;
        Returns: {
          storage_path: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
