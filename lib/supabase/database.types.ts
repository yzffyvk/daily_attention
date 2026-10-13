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
      check_ins: {
        Row: {
          ai_generation_context: Json | null
          attention: string
          checkin_date: string
          entry_mode: string
          created_at: string
          id: string
          image_name: string
          image_path: string | null
          inspiration: string
          source_url: string | null
          summary: string
          updated_at: string
          user_id: string
          user_prompt: string
          version: number
        }
        Insert: {
          ai_generation_context?: Json | null
          attention: string
          checkin_date: string
          entry_mode?: string
          created_at?: string
          id?: string
          image_name?: string
          image_path?: string | null
          inspiration?: string
          source_url?: string | null
          summary?: string
          updated_at?: string
          user_id: string
          user_prompt?: string
          version?: number
        }
        Update: {
          ai_generation_context?: Json | null
          attention?: string
          checkin_date?: string
          entry_mode?: string
          created_at?: string
          id?: string
          image_name?: string
          image_path?: string | null
          inspiration?: string
          source_url?: string | null
          summary?: string
          updated_at?: string
          user_id?: string
          user_prompt?: string
          version?: number
        }
        Relationships: []
      }
      daily_takeaway_lessons: {
        Row: {
          content: Json
          id: string
          published: boolean
          reviewed_at: string | null
          reviewed_by: string | null
          sequence: number
          updated_at: string
          version: number
        }
        Insert: {
          content: Json
          id: string
          published?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          sequence: number
          updated_at?: string
          version: number
        }
        Update: {
          content?: Json
          id?: string
          published?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          sequence?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      daily_takeaway_progress: {
        Row: {
          acted_at: string
          content_version: number
          learning_date: string
          lesson_id: string
          status: string
          user_id: string
        }
        Insert: {
          acted_at?: string
          content_version: number
          learning_date: string
          lesson_id: string
          status: string
          user_id: string
        }
        Update: {
          acted_at?: string
          content_version?: number
          learning_date?: string
          lesson_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "daily_takeaway_progress_lesson_id_fkey"; columns: ["lesson_id"]; isOneToOne: false; referencedRelation: "daily_takeaway_lessons"; referencedColumns: ["id"] },
          { foreignKeyName: "daily_takeaway_progress_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      daily_takeaway_quiz_results: {
        Row: {
          answer_index: number
          answered_at: string
          content_version: number
          correct: boolean
          lesson_id: string
          user_id: string
        }
        Insert: {
          answer_index: number
          answered_at?: string
          content_version: number
          correct: boolean
          lesson_id: string
          user_id: string
        }
        Update: {
          answer_index?: number
          answered_at?: string
          content_version?: number
          correct?: boolean
          lesson_id?: string
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "daily_takeaway_quiz_results_lesson_id_fkey"; columns: ["lesson_id"]; isOneToOne: false; referencedRelation: "daily_takeaway_lessons"; referencedColumns: ["id"] },
          { foreignKeyName: "daily_takeaway_quiz_results_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      knowledge_narratives: {
        Row: {
          attempt_count: number
          available_at: string
          claim_token: string | null
          copy_request_key: string | null
          copy_source_id: string | null
          created_at: string
          dates: string[]
          error_code: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          question: string
          quota_date: string
          result: Json | null
          source_snapshot: Json
          started_at: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          claim_token?: string | null
          copy_request_key?: string | null
          copy_source_id?: string | null
          created_at?: string
          dates: string[]
          error_code?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          lease_expires_at?: string | null
          question?: string
          quota_date: string
          result?: Json | null
          source_snapshot: Json
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          claim_token?: string | null
          copy_request_key?: string | null
          copy_source_id?: string | null
          created_at?: string
          dates?: string[]
          error_code?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          lease_expires_at?: string | null
          question?: string
          quota_date?: string
          result?: Json | null
          source_snapshot?: Json
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_key: number
          created_at: string
          display_name: string
          email: string
          id: string
          onboarding_completed: boolean
          updated_at: string
        }
        Insert: {
          avatar_key: number
          created_at?: string
          display_name: string
          email: string
          id: string
          onboarding_completed?: boolean
          updated_at?: string
        }
        Update: {
          avatar_key?: number
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_daily_takeaway_action: {
        Args: {
          target_action: string
          target_answer?: number
          target_lesson_id: string
          target_user_id: string
          target_version: number
        }
        Returns: Json
      }
      get_daily_takeaway_state: {
        Args: { target_user_id: string }
        Returns: Json
      }
      begin_ai_generation: {
        Args: { target_job_id: string }
        Returns: Database["public"]["CompositeTypes"]["ai_generation_job_record"][]
        SetofOptions: {
          from: "*"
          to: "ai_generation_job_record"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cancel_ai_generation_job: {
        Args: { target_job_id: string; target_user_id: string }
        Returns: Database["public"]["CompositeTypes"]["ai_generation_job_with_quota"][]
        SetofOptions: {
          from: "*"
          to: "ai_generation_job_with_quota"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_ai_generation_job: {
        Args: { target_job_id: string }
        Returns: Database["public"]["CompositeTypes"]["ai_generation_job_record"][]
        SetofOptions: {
          from: "*"
          to: "ai_generation_job_record"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_knowledge_narrative: {
        Args: never
        Returns: {
          attempt_count: number
          available_at: string
          claim_token: string | null
          copy_request_key: string | null
          copy_source_id: string | null
          created_at: string
          dates: string[]
          error_code: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          question: string
          quota_date: string
          result: Json | null
          source_snapshot: Json
          started_at: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_narratives"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_ai_generation_job: {
        Args: {
          target_attention: string
          target_completion_tokens: number
          target_content_digest: string
          target_error_code: string
          target_error_message: string
          target_inspiration: string
          target_job_id: string
          target_model: string
          target_prompt_cache_hit_tokens: number
          target_prompt_cache_miss_tokens: number
          target_prompt_tokens: number
          target_provider_call_count: number
          target_reasoning_tokens: number
          target_source_title: string
          target_succeeded: boolean
          target_summary: string
          target_system_fingerprint: string
          target_warnings: Json
        }
        Returns: Database["public"]["CompositeTypes"]["ai_generation_job_record"][]
        SetofOptions: {
          from: "*"
          to: "ai_generation_job_record"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_profile_onboarding: {
        Args: {
          target_avatar_key: number
          target_display_name: string
          target_user_id: string
        }
        Returns: {
          avatar_key: number
          created_at: string
          display_name: string
          email: string
          id: string
          onboarding_completed: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_registration: {
        Args: {
          target_avatar_key: number
          target_email: string
          target_recovery_digest: string
          target_user_id: string
        }
        Returns: {
          avatar_key: number
          created_at: string
          display_name: string
          email: string
          id: string
          onboarding_completed: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_auth_rate_limit: {
        Args: {
          target_action: string
          target_bucket: string
          target_max_attempts: number
          target_window_seconds: number
        }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
        }[]
      }
      copy_knowledge_narrative: {
        Args: {
          target_id: string
          target_idempotency_key: string
          target_user_id: string
        }
        Returns: {
          attempt_count: number
          available_at: string
          claim_token: string | null
          copy_request_key: string | null
          copy_source_id: string | null
          created_at: string
          dates: string[]
          error_code: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          question: string
          quota_date: string
          result: Json | null
          source_snapshot: Json
          started_at: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_narratives"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_ai_generation_job: {
        Args: {
          target_date: string
          target_idempotency_key: string
          target_source_host: string
          target_source_url: string
          target_user_id: string
          target_user_prompt?: string
        }
        Returns: Database["public"]["CompositeTypes"]["ai_generation_job_with_quota"][]
        SetofOptions: {
          from: "*"
          to: "ai_generation_job_with_quota"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_knowledge_narrative: {
        Args: {
          target_entry_mode?: string
          target_dates: string[]
          target_idempotency_key: string
          target_question: string
          target_user_id: string
        }
        Returns: {
          attempt_count: number
          available_at: string
          claim_token: string | null
          copy_request_key: string | null
          copy_source_id: string | null
          created_at: string
          dates: string[]
          error_code: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          question: string
          quota_date: string
          result: Json | null
          source_snapshot: Json
          started_at: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_narratives"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      delay_ai_generation_queue_message: {
        Args: { target_delay_seconds: number; target_msg_id: number }
        Returns: boolean
      }
      delete_ai_generation_queue_message: {
        Args: { target_msg_id: number }
        Returns: boolean
      }
      delete_expired_storage_upload_reservations: {
        Args: { target_limit: number }
        Returns: number
      }
      delete_knowledge_narrative: {
        Args: { target_id: string; target_user_id: string }
        Returns: boolean
      }
      expire_ai_generation_data: {
        Args: { target_limit: number }
        Returns: {
          cleared_results: number
          deleted_jobs: number
        }[]
      }
      finish_knowledge_narrative: {
        Args: {
          target_claim_token: string
          target_error_code: string
          target_id: string
          target_result: Json
          target_retryable: boolean
        }
        Returns: boolean
      }
      get_check_in_stats: {
        Args: { target_today: string }
        Returns: {
          current_streak: number
          has_today_record: boolean
          total_count: number
        }[]
      }
      list_orphan_checkin_image_paths: {
        Args: { target_limit: number }
        Returns: {
          path: string
        }[]
      }
      mark_ai_generation_fetch_failure: {
        Args: {
          target_error_code: string
          target_error_message: string
          target_job_id: string
          target_retryable: boolean
        }
        Returns: Database["public"]["CompositeTypes"]["ai_generation_job_record"][]
        SetofOptions: {
          from: "*"
          to: "ai_generation_job_record"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mark_ai_generation_provider_failure: {
        Args: {
          target_completion_tokens: number
          target_error_code: string
          target_error_message: string
          target_job_id: string
          target_prompt_cache_hit_tokens: number
          target_prompt_cache_miss_tokens: number
          target_prompt_tokens: number
          target_provider_call_count: number
          target_reasoning_tokens: number
          target_retryable: boolean
        }
        Returns: Database["public"]["CompositeTypes"]["ai_generation_job_record"][]
        SetofOptions: {
          from: "*"
          to: "ai_generation_job_record"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      read_ai_generation_job: {
        Args: { target_job_id: string; target_user_id: string }
        Returns: Database["public"]["CompositeTypes"]["ai_generation_job_record"][]
        SetofOptions: {
          from: "*"
          to: "ai_generation_job_record"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      read_ai_generation_queue: {
        Args: { target_batch_limit: number; target_visibility_timeout: number }
        Returns: {
          enqueued_at: string
          message: Json
          msg_id: number
          read_count: number
          visible_at: string
        }[]
      }
      read_profile: {
        Args: { target_user_id: string }
        Returns: {
          avatar_key: number
          created_at: string
          display_name: string
          email: string
          id: string
          onboarding_completed: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      read_recovery_digest: {
        Args: { target_user_id: string }
        Returns: string
      }
      release_checkin_image_upload_reservation: {
        Args: { target_path: string; target_user_id: string }
        Returns: boolean
      }
      replace_recovery_digest: {
        Args: {
          expected_digest: string
          next_digest: string
          target_user_id: string
        }
        Returns: boolean
      }
      report_ai_generation_progress: {
        Args: {
          target_attempt_count: number
          target_job_id: string
          target_progress: Json
        }
        Returns: boolean
      }
      reserve_checkin_image_upload: {
        Args: {
          target_path: string
          target_size: number
          target_user_id: string
        }
        Returns: {
          allowed: boolean
          reason: string
          retry_after_seconds: number
        }[]
      }
      resolve_email: {
        Args: { target_email: string }
        Returns: {
          user_id: string
        }[]
      }
      resolve_recovery_challenge: {
        Args: { target_email: string }
        Returns: {
          recovery_code_digest: string
          user_id: string
        }[]
      }
      update_knowledge_narrative: {
        Args: {
          target_expected_updated_at?: string
          target_id: string
          target_result?: Json
          target_title?: string
          target_user_id: string
        }
        Returns: {
          attempt_count: number
          available_at: string
          claim_token: string | null
          copy_request_key: string | null
          copy_source_id: string | null
          created_at: string
          dates: string[]
          error_code: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          question: string
          quota_date: string
          result: Json | null
          source_snapshot: Json
          started_at: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_narratives"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_profile: {
        Args: {
          target_avatar_key: number
          target_display_name: string
          target_user_id: string
        }
        Returns: {
          avatar_key: number
          created_at: string
          display_name: string
          email: string
          id: string
          onboarding_completed: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      ai_generation_job_record: {
        id: string | null
        user_id: string | null
        target_date: string | null
        idempotency_key: string | null
        source_url: string | null
        source_host: string | null
        source_title: string | null
        status: string | null
        attempt_count: number | null
        provider_call_count: number | null
        attention: string | null
        summary: string | null
        inspiration: string | null
        warnings: Json | null
        error_code: string | null
        error_message: string | null
        provider: string | null
        model: string | null
        thinking_enabled: boolean | null
        reasoning_effort: string | null
        prompt_version: string | null
        prompt_tokens: number | null
        prompt_cache_hit_tokens: number | null
        prompt_cache_miss_tokens: number | null
        completion_tokens: number | null
        reasoning_tokens: number | null
        system_fingerprint: string | null
        created_at: string | null
        started_at: string | null
        finished_at: string | null
        result_expires_at: string | null
        metadata_expires_at: string | null
        updated_at: string | null
        user_prompt: string | null
        progress: Json | null
      }
      ai_generation_job_with_quota: {
        job:
          | Database["public"]["CompositeTypes"]["ai_generation_job_record"]
          | null
        quota_used: number | null
        quota_reserved: number | null
        quota_consumed: number | null
        quota_remaining: number | null
      }
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
    Enums: {},
  },
} as const
