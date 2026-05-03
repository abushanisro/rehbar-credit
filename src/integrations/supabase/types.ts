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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      credit_cases: {
        Row: {
          analyst_notes: string | null
          case_code: string
          client_name: string
          collateral_summary: string | null
          conditions_precedent: string | null
          created_at: string
          deal_amount: number | null
          delivery_email: string | null
          end_use: string | null
          expected_irr: number | null
          group_summary: string | null
          ic_decision: string | null
          ic_decision_notes: string | null
          ic_note: Json | null
          id: string
          industry: string | null
          legal_constitution: string | null
          policy_exceptions: string | null
          principal_borrower: string | null
          processing_fees: number | null
          product_type: Database["public"]["Enums"]["product_type"]
          product_type_custom: string | null
          promoter_details: string | null
          recommendation_text: string | null
          registered_address: string | null
          residual_value: number | null
          security_deposit: number | null
          status: Database["public"]["Enums"]["case_status"]
          strategic_rationale: string | null
          tenure_months: number | null
          updated_at: string
          user_id: string
          website: string | null
          year_established: number | null
        }
        Insert: {
          analyst_notes?: string | null
          case_code: string
          client_name: string
          collateral_summary?: string | null
          conditions_precedent?: string | null
          created_at?: string
          deal_amount?: number | null
          delivery_email?: string | null
          end_use?: string | null
          expected_irr?: number | null
          group_summary?: string | null
          ic_decision?: string | null
          ic_decision_notes?: string | null
          ic_note?: Json | null
          id?: string
          industry?: string | null
          legal_constitution?: string | null
          policy_exceptions?: string | null
          principal_borrower?: string | null
          processing_fees?: number | null
          product_type: Database["public"]["Enums"]["product_type"]
          product_type_custom?: string | null
          promoter_details?: string | null
          recommendation_text?: string | null
          registered_address?: string | null
          residual_value?: number | null
          security_deposit?: number | null
          status?: Database["public"]["Enums"]["case_status"]
          strategic_rationale?: string | null
          tenure_months?: number | null
          updated_at?: string
          user_id: string
          website?: string | null
          year_established?: number | null
        }
        Update: {
          analyst_notes?: string | null
          case_code?: string
          client_name?: string
          collateral_summary?: string | null
          conditions_precedent?: string | null
          created_at?: string
          deal_amount?: number | null
          delivery_email?: string | null
          end_use?: string | null
          expected_irr?: number | null
          group_summary?: string | null
          ic_decision?: string | null
          ic_decision_notes?: string | null
          ic_note?: Json | null
          id?: string
          industry?: string | null
          legal_constitution?: string | null
          policy_exceptions?: string | null
          principal_borrower?: string | null
          processing_fees?: number | null
          product_type?: Database["public"]["Enums"]["product_type"]
          product_type_custom?: string | null
          promoter_details?: string | null
          recommendation_text?: string | null
          registered_address?: string | null
          residual_value?: number | null
          security_deposit?: number | null
          status?: Database["public"]["Enums"]["case_status"]
          strategic_rationale?: string | null
          tenure_months?: number | null
          updated_at?: string
          user_id?: string
          website?: string | null
          year_established?: number | null
        }
        Relationships: []
      }
      extracted_financials: {
        Row: {
          case_id: string
          confirmed: boolean
          confirmed_at: string | null
          created_at: string
          document_id: string | null
          fiscal_year: number
          id: string
          line_items: Json
          statement_type: Database["public"]["Enums"]["statement_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          case_id: string
          confirmed?: boolean
          confirmed_at?: string | null
          created_at?: string
          document_id?: string | null
          fiscal_year: number
          id?: string
          line_items?: Json
          statement_type: Database["public"]["Enums"]["statement_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          case_id?: string
          confirmed?: boolean
          confirmed_at?: string | null
          created_at?: string
          document_id?: string | null
          fiscal_year?: number
          id?: string
          line_items?: Json
          statement_type?: Database["public"]["Enums"]["statement_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extracted_financials_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "credit_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_financials_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "financial_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_documents: {
        Row: {
          case_id: string
          created_at: string
          doc_class: Database["public"]["Enums"]["doc_class"]
          extraction_error: string | null
          extraction_status: string
          file_name: string
          file_path: string
          file_type: string
          fiscal_year: number | null
          id: string
          upload_status: string
          user_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          doc_class?: Database["public"]["Enums"]["doc_class"]
          extraction_error?: string | null
          extraction_status?: string
          file_name: string
          file_path: string
          file_type: string
          fiscal_year?: number | null
          id?: string
          upload_status?: string
          user_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          doc_class?: Database["public"]["Enums"]["doc_class"]
          extraction_error?: string | null
          extraction_status?: string
          file_name?: string
          file_path?: string
          file_type?: string
          fiscal_year?: number | null
          id?: string
          upload_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "credit_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_ratios: {
        Row: {
          benchmark: number | null
          case_id: string
          category: string
          created_at: string
          fiscal_year: number
          formula_note: string | null
          id: string
          ratio_name: string
          ratio_value: number | null
          threshold_status: Database["public"]["Enums"]["threshold_status"]
          user_id: string
        }
        Insert: {
          benchmark?: number | null
          case_id: string
          category: string
          created_at?: string
          fiscal_year: number
          formula_note?: string | null
          id?: string
          ratio_name: string
          ratio_value?: number | null
          threshold_status?: Database["public"]["Enums"]["threshold_status"]
          user_id: string
        }
        Update: {
          benchmark?: number | null
          case_id?: string
          category?: string
          created_at?: string
          fiscal_year?: number
          formula_note?: string | null
          id?: string
          ratio_name?: string
          ratio_value?: number | null
          threshold_status?: Database["public"]["Enums"]["threshold_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_ratios_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "credit_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      ratio_thresholds: {
        Row: {
          amber_min: number | null
          category: string
          formula_note: string | null
          green_min: number | null
          higher_is_better: boolean
          id: string
          industry: string
          peer_median: number | null
          ratio_name: string
        }
        Insert: {
          amber_min?: number | null
          category: string
          formula_note?: string | null
          green_min?: number | null
          higher_is_better?: boolean
          id?: string
          industry?: string
          peer_median?: number | null
          ratio_name: string
        }
        Update: {
          amber_min?: number | null
          category?: string
          formula_note?: string | null
          green_min?: number | null
          higher_is_better?: boolean
          id?: string
          industry?: string
          peer_median?: number | null
          ratio_name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "analyst" | "credit_committee" | "operations" | "admin"
      case_status:
        | "draft"
        | "uploading"
        | "extracting"
        | "extracted"
        | "analysis"
        | "narrative"
        | "ic_review"
        | "approved"
        | "declined"
      doc_class:
        | "profit_loss"
        | "balance_sheet"
        | "cash_flow"
        | "projections"
        | "bank_statement"
        | "gst_return"
        | "other"
        | "all_in_one"
      product_type:
        | "operating_lease"
        | "finance_lease"
        | "project_finance"
        | "trade_finance"
        | "pls"
        | "home_loan"
        | "employee_car_lease"
        | "other"
      statement_type:
        | "profit_loss"
        | "balance_sheet"
        | "cash_flow"
        | "projections"
        | "all_in_one"
      threshold_status: "green" | "amber" | "red" | "na"
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
      app_role: ["analyst", "credit_committee", "operations", "admin"],
      case_status: [
        "draft",
        "uploading",
        "extracting",
        "extracted",
        "analysis",
        "narrative",
        "ic_review",
        "approved",
        "declined",
      ],
      doc_class: [
        "profit_loss",
        "balance_sheet",
        "cash_flow",
        "projections",
        "bank_statement",
        "gst_return",
        "other",
        "all_in_one",
      ],
      product_type: [
        "operating_lease",
        "finance_lease",
        "project_finance",
        "trade_finance",
        "pls",
        "home_loan",
        "employee_car_lease",
      ],
      statement_type: [
        "profit_loss",
        "balance_sheet",
        "cash_flow",
        "projections",
        "all_in_one",
      ],
      threshold_status: ["green", "amber", "red", "na"],
    },
  },
} as const
