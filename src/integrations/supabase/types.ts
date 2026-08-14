export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      image_messages: {
        Row: {
          alt_text: string | null
          approved_at: string | null
          checksum: string | null
          created_at: string
          expires_at: string
          file_size: number
          height: number | null
          id: number
          mime_type: string
          moderation_reason: string | null
          moderation_status: string
          room_id: string
          sender_membership_id: string
          storage_path: string
          uploaded: boolean
          width: number | null
        }
        Insert: {
          alt_text?: string | null
          approved_at?: string | null
          checksum?: string | null
          created_at?: string
          expires_at?: string
          file_size?: number
          height?: number | null
          id?: number
          mime_type: string
          moderation_reason?: string | null
          moderation_status?: string
          room_id: string
          sender_membership_id: string
          storage_path: string
          uploaded?: boolean
          width?: number | null
        }
        Update: {
          alt_text?: string | null
          approved_at?: string | null
          checksum?: string | null
          created_at?: string
          expires_at?: string
          file_size?: number
          height?: number | null
          id?: number
          mime_type?: string
          moderation_reason?: string | null
          moderation_status?: string
          room_id?: string
          sender_membership_id?: string
          storage_path?: string
          uploaded?: boolean
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "image_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_messages_sender_membership_id_fkey"
            columns: ["sender_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          alias: string
          id: string
          joined_at: string
          last_read_image_id: number | null
          last_read_message_id: number | null
          last_seen_at: string
          left_at: string | null
          room_id: string
          subject_hash: string
          topic_id: string
        }
        Insert: {
          alias: string
          id?: string
          joined_at?: string
          last_read_image_id?: number | null
          last_read_message_id?: number | null
          last_seen_at?: string
          left_at?: string | null
          room_id: string
          subject_hash: string
          topic_id: string
        }
        Update: {
          alias?: string
          id?: string
          joined_at?: string
          last_read_image_id?: number | null
          last_read_message_id?: number | null
          last_seen_at?: string
          left_at?: string | null
          room_id?: string
          subject_hash?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reports: {
        Row: {
          created_at: string
          id: string
          image_message_id: number | null
          message_id: number | null
          reason: string
          reporter_membership_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_message_id?: number | null
          message_id?: number | null
          reason: string
          reporter_membership_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_message_id?: number | null
          message_id?: number | null
          reason?: string
          reporter_membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reports_image_message_id_fkey"
            columns: ["image_message_id"]
            isOneToOne: false
            referencedRelation: "image_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reports_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reports_reporter_membership_id_fkey"
            columns: ["reporter_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          expires_at: string
          id: number
          membership_id: string
          room_id: string
        }
        Insert: {
          body: string
          created_at?: string
          expires_at?: string
          id?: never
          membership_id: string
          room_id: string
        }
        Update: {
          body?: string
          created_at?: string
          expires_at?: string
          id?: never
          membership_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_events: {
        Row: {
          action: string
          created_at: string
          id: number
          subject_hash: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: never
          subject_hash: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: never
          subject_hash?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          capacity: number
          created_at: string
          id: string
          room_number: number
          status: string
          topic_id: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          id?: string
          room_number: number
          status?: string
          topic_id: string
        }
        Update: {
          capacity?: number
          created_at?: string
          id?: string
          room_number?: number
          status?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_aliases: {
        Row: {
          created_at: string
          id: string
          normalized_alias: string
          topic_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          normalized_alias: string
          topic_id: string
        }
        Update: {
          created_at?: string
          id?: string
          normalized_alias?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_aliases_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          created_at: string
          description: string | null
          display_name: string
          enabled: boolean
          id: string
          slug: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_name: string
          enabled?: boolean
          id?: string
          slug: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_name?: string
          enabled?: boolean
          id?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired: { Args: never; Returns: Json }
      enforce_all_retention: {
        Args: never
        Returns: {
          storage_path: string
        }[]
      }
      enforce_image_retention: {
        Args: { p_room_id: string }
        Returns: {
          storage_path: string
        }[]
      }
      enforce_text_retention: { Args: { p_room_id: string }; Returns: number }
      join_topic_room: {
        Args: { p_alias: string; p_subject_hash: string; p_topic_slug: string }
        Returns: Json
      }
      purge_dead_images: {
        Args: never
        Returns: {
          storage_path: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
