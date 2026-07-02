import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AIDetectedError } from "@/features/case/types";

interface ICErrorPanelProps {
  caseId:        string;
  generationRun: string | null;
  caseContext?: {
    client_name?: string | null;
    industry?:    string | null;
    product_type?: string | null;
  };
}

const SECTION_LABELS: Record<string, string> = {
  executive_summary:      "I — Executive Summary",
  client_promoter:        "II — Client & Promoter",
  investment_structure:   "III — Investment Structure",
  rehbar_funding_history: "IV — Rehbar History",
  historical_financial:   "V — Historical Financials",
  projections:            "VI — Projections",
  key_ratios:             "VII — Key Ratios",
  cash_flow:              "VIII — Cash Flow",
  due_diligence:          "IX — Due Diligence",
  risk_assessment:        "X — Risk Assessment",
  visit_reference:        "XI — Visit Report",
  exec_recommendation:    "XII — Recommendation",
  product_specifics:      "XIII — Product Specifics",
  triangulation_analysis: "XIV — Triangulation",
  conditions_precedent:   "XV — Conditions Precedent",
  swot_analysis:          "XVI — SWOT",
};

const ERROR_LABELS: Record<string, string> = {
  hallucination:           "Hallucination",
  unit_error:              "Unit Error",
  cross_section_mismatch:  "Cross-Section Mismatch",
  missing_data:            "Missing Data",
  illogical_narrative:     "Illogical Narrative",
  template_gap:            "Template Gap",
};

export function ICErrorPanel({ caseId, generationRun, caseContext }: ICErrorPanelProps) {
  const [errors, setErrors]       = useState<AIDetectedError[]>([]);
  const [loading, setLoading]     = useState(false);
  const [expanded, setExpanded]   = useState(true);
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [noteInput, setNoteInput]  = useState<Record<string, string>>({});

  useEffect(() => {
    if (!caseId || !generationRun) return;
    let cancelled = false;
    setLoading(true);

    supabase
      .from("ic_ai_errors")
      .select("*")
      .eq("case_id", caseId)
      .eq("generation_run", generationRun)
      .order("severity", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setErrors((data ?? []) as AIDetectedError[]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [caseId, generationRun]);

  const handleVerdict = async (error: AIDetectedError, verdict: "confirmed" | "dismissed") => {
    setSubmitting(s => ({ ...s, [error.id]: true }));
    try {
      await supabase.functions.invoke("store-error-feedback", {
        body: {
          error_id:    error.id,
          verdict,
          analyst_note: noteInput[error.id] ?? undefined,
          case_context: verdict === "confirmed" ? {
            case_id:      caseId,
            client_name:  caseContext?.client_name ?? undefined,
            industry:     caseContext?.industry ?? undefined,
            product_type: caseContext?.product_type ?? undefined,
            section_id:   error.section_id,
            error_type:   error.error_type,
            title:        error.title,
            detail:       error.detail,
            suggested_fix: error.suggested_fix ?? undefined,
          } : undefined,
        },
      });
      setErrors(prev => prev.map(e => e.id === error.id ? { ...e, analyst_verdict: verdict } : e));
    } finally {
      setSubmitting(s => ({ ...s, [error.id]: false }));
    }
  };

  if (loading) return null;
  if (errors.length === 0) return null;

  const hard = errors.filter(e => e.severity === "hard");
  const warn = errors.filter(e => e.severity === "warn");
  const open = errors.filter(e => !e.analyst_verdict);

  return (
    <div style={{ width: "100%", maxWidth: 960, marginBottom: 16 }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          background: "#FFF7E6", border: "1.5px solid #D97706",
          borderRadius: expanded ? "6px 6px 0 0" : 6,
          padding: "10px 14px", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 13 }}>🤖</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#92400E", letterSpacing: "0.04em", textTransform: "uppercase", flex: 1 }}>
          AI Semantic Review — {errors.length} Issue{errors.length !== 1 ? "s" : ""} Detected
          {hard.length > 0 && ` (${hard.length} critical)`}
          {open.length > 0 && ` · ${open.length} awaiting review`}
        </span>
        <span style={{ fontSize: 10, color: "#92400E" }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ border: "1.5px solid #D97706", borderTop: "none", borderRadius: "0 0 6px 6px", background: "#fff" }}>
          {errors.map((error, idx) => {
            const isHard     = error.severity === "hard";
            const isDone     = !!error.analyst_verdict;
            const borderClr  = isHard ? "#EF4444" : "#F59E0B";
            const bgClr      = isDone ? "#F9FAFB" : (isHard ? "#FFF5F5" : "#FFFBEB");
            const labelColor = isHard ? "#991B1B" : "#78350F";

            return (
              <div
                key={error.id}
                style={{
                  padding: "12px 16px",
                  borderBottom: idx < errors.length - 1 ? "1px solid #F3F4F6" : "none",
                  borderLeft: `3px solid ${borderClr}`,
                  background: bgClr,
                  opacity: isDone ? 0.65 : 1,
                }}
              >
                {/* Error header */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, background: isHard ? "#FEE2E2" : "#FEF3C7",
                    color: labelColor, padding: "1px 6px", borderRadius: 3, letterSpacing: "0.05em",
                    textTransform: "uppercase", whiteSpace: "nowrap", marginTop: 1,
                  }}>
                    {isHard ? "CRITICAL" : "FLAG"}
                  </span>
                  <span style={{
                    fontSize: 9, background: "#EEF2FF", color: "#3730A3",
                    padding: "1px 6px", borderRadius: 3, whiteSpace: "nowrap", marginTop: 1,
                  }}>
                    {SECTION_LABELS[error.section_id] ?? error.section_id}
                  </span>
                  <span style={{
                    fontSize: 9, background: "#F3F4F6", color: "#6B7280",
                    padding: "1px 6px", borderRadius: 3, whiteSpace: "nowrap", marginTop: 1,
                  }}>
                    {ERROR_LABELS[error.error_type] ?? error.error_type}
                  </span>
                  {isDone && (
                    <span style={{
                      fontSize: 9, background: error.analyst_verdict === "confirmed" ? "#FEE2E2" : "#D1FAE5",
                      color: error.analyst_verdict === "confirmed" ? "#991B1B" : "#065F46",
                      padding: "1px 6px", borderRadius: 3, marginLeft: "auto",
                    }}>
                      {error.analyst_verdict === "confirmed" ? "Confirmed Error" : "Dismissed"}
                    </span>
                  )}
                </div>

                {/* Title */}
                <div style={{ fontSize: 11, fontWeight: 700, color: "#111827", marginBottom: 3 }}>
                  {error.title}
                </div>

                {/* Detail */}
                <div style={{ fontSize: 10.5, color: "#374151", lineHeight: 1.6, marginBottom: error.suggested_fix ? 4 : 0 }}>
                  {error.detail}
                </div>

                {/* Suggested fix */}
                {error.suggested_fix && (
                  <div style={{ fontSize: 10, color: "#065F46", background: "#ECFDF5", borderRadius: 4, padding: "4px 8px", marginBottom: 6 }}>
                    Suggested fix: {error.suggested_fix}
                  </div>
                )}

                {/* Feedback actions — only for unreviewed errors */}
                {!isDone && (
                  <div style={{ marginTop: 8 }}>
                    <input
                      type="text"
                      placeholder="Add analyst note (optional)..."
                      value={noteInput[error.id] ?? ""}
                      onChange={e => setNoteInput(n => ({ ...n, [error.id]: e.target.value }))}
                      style={{
                        width: "100%", fontSize: 10, padding: "4px 8px",
                        border: "1px solid #D1D5DB", borderRadius: 4, marginBottom: 6,
                        fontFamily: "inherit", color: "#374151", background: "#fff",
                      }}
                    />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        disabled={submitting[error.id]}
                        onClick={() => handleVerdict(error, "confirmed")}
                        style={{
                          fontSize: 10, fontWeight: 600, padding: "4px 12px", borderRadius: 4,
                          background: "#FEE2E2", color: "#991B1B", border: "1px solid #EF4444",
                          cursor: submitting[error.id] ? "not-allowed" : "pointer", opacity: submitting[error.id] ? 0.6 : 1,
                        }}
                      >
                        {submitting[error.id] ? "Saving…" : "Confirm Error"}
                      </button>
                      <button
                        disabled={submitting[error.id]}
                        onClick={() => handleVerdict(error, "dismissed")}
                        style={{
                          fontSize: 10, fontWeight: 600, padding: "4px 12px", borderRadius: 4,
                          background: "#F9FAFB", color: "#374151", border: "1px solid #D1D5DB",
                          cursor: submitting[error.id] ? "not-allowed" : "pointer", opacity: submitting[error.id] ? 0.6 : 1,
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
