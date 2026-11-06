type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type EventStatus = "draft" | "open" | "closed" | "cancelled";
type EventType = "poll" | "election";

export type Database = {
  public: {
    Tables: {
      admins: Table<{
        id: string;
        email: string;
        password_salt: string;
        password_hash: string;
        is_active: boolean;
        created_at: string;
      }>;
      admin_sessions: Table<{
        id: string;
        admin_id: string;
        token_hash: string;
        expires_at: string;
        created_at: string;
        revoked_at: string | null;
      }>;
      rate_limit_buckets: Table<{
        bucket_key: string;
        window_started_at: string;
        request_count: number;
      }>;
      polls: Table<{
        id: string;
        title: string;
        description: string;
        status: EventStatus;
        opens_at: string;
        closes_at: string;
        results_public: boolean;
        secret_ballots: boolean;
        session_duplicate_protection: boolean;
        rate_limit_per_minute: number;
        bot_protection: boolean;
        created_by: string | null;
        created_at: string;
        updated_at: string;
      }>;
      poll_questions: Table<{
        id: string;
        poll_id: string;
        prompt: string;
        min_selections: number;
        max_selections: number;
        position: number;
      }>;
      poll_options: Table<{
        id: string;
        question_id: string;
        label: string;
        position: number;
      }>;
      elections: Table<{
        id: string;
        title: string;
        description: string;
        status: EventStatus;
        opens_at: string;
        closes_at: string;
        results_public: boolean;
        secret_ballots: boolean;
        created_by: string | null;
        created_at: string;
        updated_at: string;
      }>;
      election_positions: Table<{
        id: string;
        election_id: string;
        title: string;
        min_selections: number;
        max_selections: number;
        position: number;
      }>;
      media_files: Table<{
        id: string;
        storage_key: string;
        original_name: string;
        content_type: string;
        size_bytes: number;
        uploaded_by: string | null;
        created_at: string;
      }>;
      candidates: Table<{
        id: string;
        position_id: string;
        name: string;
        grade: string;
        statement: string;
        media_file_id: string | null;
        created_at: string;
      }>;
      voter_eligibility: Table<{
        id: string;
        election_id: string;
        voter_ref_hash: string;
        email: string | null;
        is_active: boolean;
        created_at: string;
      }>;
      invitation_tokens: Table<{
        id: string;
        eligibility_id: string;
        election_id: string;
        token_hash: string;
        expires_at: string | null;
        revoked_at: string | null;
        used_at: string | null;
        created_at: string;
      }>;
      voting_links: Table<{
        id: string;
        poll_id: string;
        token_hash: string;
        is_active: boolean;
        created_by: string | null;
        created_at: string;
        revoked_at: string | null;
      }>;
      voter_participation: Table<{
        id: string;
        event_type: EventType;
        event_id: string;
        participant_hash: string;
        participated_at: string;
      }>;
      ballots: Table<{
        id: string;
        event_type: EventType;
        event_id: string;
        submitted_at: string;
      }>;
      ballot_selections: Table<{
        id: string;
        ballot_id: string;
        poll_question_id: string | null;
        poll_option_id: string | null;
        candidate_id: string | null;
      }>;
      notifications: Table<{
        id: string;
        admin_id: string | null;
        message: string;
        read_at: string | null;
        created_at: string;
      }>;
      audit_logs: Table<{
        id: string;
        admin_id: string | null;
        action: string;
        event_type: EventType | null;
        event_id: string | null;
        details: Record<string, unknown>;
        created_at: string;
      }>;
      reports: Table<{
        id: string;
        admin_id: string | null;
        event_type: EventType;
        event_id: string;
        report_type: string;
        storage_key: string | null;
        created_at: string;
      }>;
      platform_settings: Table<{
        setting_key: string;
        setting_value: Record<string, unknown>;
        updated_by: string | null;
        updated_at: string;
      }>;
      public_rate_limits: Table<{
        bucket_key: string;
        window_started_at: string;
        request_count: number;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      consume_admin_login_limit: { Args: { p_bucket: string }; Returns: boolean };
      consume_public_rate_limit: { Args: { p_bucket: string; p_limit: number }; Returns: boolean };
      submit_poll_ballot: {
        Args: {
          p_link_hash: string;
          p_session_hash: string;
          p_answers: Record<string, unknown>[];
          p_enforce_session: boolean;
        };
        Returns: string;
      };
      submit_election_ballot: {
        Args: { p_invitation_hash: string; p_candidate_ids: string[] };
        Returns: string;
      };
      replace_poll_question: {
        Args: { p_poll_id: string; p_question_id: string; p_prompt: string; p_max_selections: number; p_options: string[] };
        Returns: undefined;
      };
    };
    Enums: { event_status: EventStatus; voting_event_type: EventType };
    CompositeTypes: Record<string, never>;
  };
};
