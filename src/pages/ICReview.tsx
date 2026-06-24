import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { IC_SECTIONS, PRODUCTS, type ProductType } from "@/features/credit/domain";
import { toast } from "sonner";
import { BulletOnlyMd } from "@/components/case/MdRenderer";
import { cn } from "@/lib/utils";
import {
  ICSummaryPanel,
  ICClientProfile,
  ICInvestmentStructure,
  ICRehbarHistory,
  ICHistoricalTables,
  ICProjectionsTable,
  ICRatioTable,
  ICVisitReference,
  ICProductSpecifics,
} from "@/tabs/case/ic/ICComponents";
import type { CaseRow as FullCaseRow, ExtractedRow, RatioRow } from "@/features/case/types";

const IC_ACCESS_ROLES = ["ic_member", "credit_committee", "admin"];
const HISTORY_STATUSES = ["approved", "conditionally_approved", "declined", "queries_resubmission"];

type ICNote = {
  sections?: Record<string, { markdown?: string }>;
  risks?: Array<{ category: string; risk: string; mitigant: string; severity: string }>;
  conditions_precedent?: string[];
  swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
};

type ICCase = {
  id: string;
  case_code: string;
  client_name: string;
  product_type: ProductType;
  deal_amount: number | null;
  status: string;
  ic_note: ICNote | null;
  ic_decision: string | null;
  ic_decision_notes: string | null;
  created_at: string;
};

type DecisionChoice = "approved" | "conditionally_approved" | "declined" | null;

const DECISION_META: Record<NonNullable<DecisionChoice>, {
  label: string; shortLabel: string;
  activeClass: string; badge: string; borderColor: string;
  icon: string;
}> = {
  approved: {
    label: "Approve",
    shortLabel: "Approved",
    activeClass: "bg-green-600 text-white border-green-600 shadow-green-100 shadow-lg",
    badge: "bg-green-50 text-green-700 border-green-200",
    borderColor: "border-green-300 hover:border-green-500 hover:bg-green-50 text-green-700",
    icon: "✓",
  },
  conditionally_approved: {
    label: "Conditionally Approve",
    shortLabel: "Cond. Approved",
    activeClass: "bg-amber-500 text-white border-amber-500 shadow-amber-100 shadow-lg",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    borderColor: "border-amber-300 hover:border-amber-500 hover:bg-amber-50 text-amber-700",
    icon: "~",
  },
  declined: {
    label: "Reject",
    shortLabel: "Rejected",
    activeClass: "bg-red-600 text-white border-red-600 shadow-red-100 shadow-lg",
    badge: "bg-red-50 text-red-700 border-red-200",
    borderColor: "border-red-300 hover:border-red-500 hover:bg-red-50 text-red-700",
    icon: "✗",
  },
};

const SEVERITY_STYLE: Record<string, string> = {
  low:      "bg-green-50 text-green-700 border-green-200",
  medium:   "bg-amber-50 text-amber-700 border-amber-200",
  high:     "bg-red-50 text-red-700 border-red-200",
  critical: "bg-red-100 text-red-800 border-red-300 font-semibold",
};

const HIST_DECISION: Record<string, { label: string; cls: string }> = {
  approved:               { label: "Approved",              cls: "bg-green-50 text-green-700 border-green-200" },
  conditionally_approved: { label: "Cond. Approved",        cls: "bg-amber-50 text-amber-700 border-amber-200" },
  declined:               { label: "Declined",              cls: "bg-red-50 text-red-700 border-red-200"       },
  queries_resubmission:   { label: "Queries Resubmission",  cls: "bg-blue-50 text-blue-700 border-blue-200"    },
};

export default function ICReview() {
  const { role } = useAuth();

  const [pageView, setPageView]               = useState<"pending" | "history">("pending");
  const [pending, setPending]                 = useState<ICCase[]>([]);
  const [pendingLoading, setPendingLoading]   = useState(true);
  const [history, setHistory]                 = useState<ICCase[]>([]);
  const [historyLoading, setHistoryLoading]   = useState(false);
  const [historyLoaded, setHistoryLoaded]     = useState(false);
  const [histSearch, setHistSearch]           = useState("");
  const [selectedId, setSelectedId]           = useState<string | null>(null);
  const [activeTab, setActiveTab]             = useState<"note" | "decision">("note");
  const [activeSection, setActiveSection]     = useState<string>("executive_summary");
  const [caseDetail, setCaseDetail]           = useState<FullCaseRow | null>(null);
  const [extracted, setExtracted]             = useState<ExtractedRow[]>([]);
  const [ratios, setRatios]                   = useState<RatioRow[]>([]);
  const [detailLoading, setDetailLoading]     = useState(false);
  const [decisionChoice, setDecisionChoice]   = useState<DecisionChoice>(null);
  const [decisionNotes, setDecisionNotes]     = useState("");
  const [saving, setSaving]                   = useState(false);

  const loadPending = async () => {
    const { data } = await supabase
      .from("credit_cases")
      .select("id,case_code,client_name,product_type,deal_amount,status,ic_note,ic_decision,ic_decision_notes,created_at")
      .eq("status", "ic_review")
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as ICCase[];
    setPending(rows);
    if (rows.length > 0 && !selectedId) setSelectedId(rows[0].id);
  };

  const loadHistory = async () => {
    if (historyLoaded) return;
    setHistoryLoading(true);
    const { data } = await supabase
      .from("credit_cases")
      .select("id,case_code,client_name,product_type,deal_amount,status,ic_note,ic_decision,ic_decision_notes,created_at")
      .in("status", HISTORY_STATUSES)
      .order("created_at", { ascending: false });
    setHistory((data ?? []) as ICCase[]);
    setHistoryLoaded(true);
    setHistoryLoading(false);
  };

  useEffect(() => {
    loadPending().then(() => setPendingLoading(false));
    const ch = supabase
      .channel("ic_review_cases")
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_cases" }, () => {
        loadPending();
        setHistoryLoaded(false);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    if (pageView === "history") loadHistory();
  }, [pageView]);

  useEffect(() => {
    if (!selectedId) return;
    const allCases = [...pending, ...history];
    const c = allCases.find(x => x.id === selectedId);
    if (!c) return;
    setDecisionChoice((c.ic_decision as DecisionChoice) ?? null);
    setDecisionNotes(c.ic_decision_notes ?? "");
    setActiveSection("executive_summary");
    setActiveTab("note");
    setDetailLoading(true);
    setCaseDetail(null);
    setExtracted([]);
    setRatios([]);

    Promise.all([
      supabase.from("credit_cases").select("*").eq("id", selectedId).single(),
      supabase.from("extracted_financials").select("*").eq("case_id", selectedId),
      supabase.from("financial_ratios").select("*").eq("case_id", selectedId).order("fiscal_year"),
    ]).then(([cRes, eRes, rRes]) => {
      if (cRes.data) setCaseDetail(cRes.data as FullCaseRow);
      setExtracted((eRes.data ?? []) as ExtractedRow[]);
      setRatios((rRes.data ?? []) as RatioRow[]);
      setDetailLoading(false);
    });
  }, [selectedId]);

  const activeList   = pageView === "pending" ? pending : history;
  const selectedCase = activeList.find(c => c.id === selectedId) ?? null;
  const ic           = selectedCase?.ic_note ?? null;
  const isHistory    = pageView === "history";

  const saveDecision = async () => {
    if (!selectedCase || !decisionChoice) return;
    setSaving(true);
    const { error } = await supabase
      .from("credit_cases")
      .update({ ic_decision: decisionChoice, ic_decision_notes: decisionNotes.trim() || null, status: decisionChoice } as never)
      .eq("id", selectedCase.id);
    setSaving(false);
    if (error) { toast.error("Failed to save decision"); return; }
    toast.success(`Decision recorded: ${DECISION_META[decisionChoice].label}`);
    const remaining = pending.filter(c => c.id !== selectedCase.id);
    setPending(remaining);
    setHistoryLoaded(false);
    setSelectedId(remaining[0]?.id ?? null);
    if (remaining.length === 0) setPageView("history");
  };

  // ── Section content renderer ────────────────────────────────────────────────
  const renderSectionContent = (sectionId: string) => {
    const md = ic?.sections?.[sectionId]?.markdown ?? "";
    if (detailLoading) {
      return <div className="text-sm text-muted-foreground animate-pulse py-6">Loading section data…</div>;
    }
    switch (sectionId) {
      case "executive_summary":
        return <div className="space-y-4">{caseDetail && <ICSummaryPanel cc={caseDetail} ratios={ratios} />}<BulletOnlyMd text={md} /></div>;
      case "client_promoter":
        return <div className="space-y-4">{caseDetail && <ICClientProfile cc={caseDetail} />}<BulletOnlyMd text={md} /></div>;
      case "investment_structure":
        return <div className="space-y-4">{caseDetail && <ICInvestmentStructure cc={caseDetail} />}<BulletOnlyMd text={md} /></div>;
      case "rehbar_funding_history":
        return <div className="space-y-4">{caseDetail && <ICRehbarHistory cc={caseDetail} />}<BulletOnlyMd text={md} /></div>;
      case "historical_financial":
        return <div className="space-y-4"><ICHistoricalTables extracted={extracted} /><BulletOnlyMd text={md} /></div>;
      case "projections":
        return <div className="space-y-4"><ICProjectionsTable extracted={extracted} /><BulletOnlyMd text={md} /></div>;
      case "key_ratios":
        return <ICRatioTable ratios={ratios} />;
      case "cash_flow":
        return md ? <BulletOnlyMd text={md} /> : <p className="text-sm text-muted-foreground italic">No cash flow narrative recorded. See Historical Analysis for financial tables.</p>;
      case "due_diligence":
        return md ? <BulletOnlyMd text={md} /> : <p className="text-sm text-muted-foreground italic">No due diligence notes recorded by the analyst.</p>;
      case "risk_assessment":
        return md ? <BulletOnlyMd text={md} /> : <p className="text-sm text-muted-foreground italic">No risk narrative recorded. See the Risk Register section.</p>;
      case "visit_reference":
        return <div className="space-y-4">{caseDetail && <ICVisitReference cc={caseDetail} />}<BulletOnlyMd text={md} /></div>;
      case "product_specifics":
        return <div className="space-y-4">{caseDetail && <ICProductSpecifics cc={caseDetail} />}<BulletOnlyMd text={md} /></div>;
      default:
        return md ? <BulletOnlyMd text={md} /> : <p className="text-sm text-muted-foreground italic">No content recorded for this section.</p>;
    }
  };

  const filteredHistory = history.filter(c =>
    !histSearch ||
    c.client_name.toLowerCase().includes(histSearch.toLowerCase()) ||
    c.case_code.toLowerCase().includes(histSearch.toLowerCase())
  );

  // ── Access denied ────────────────────────────────────────────────────────────
  if (!IC_ACCESS_ROLES.includes(role ?? "")) {
    return (
      <TerminalLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <div className="bg-card rounded-xl border border-red-200 px-10 py-8 text-center max-w-sm" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-foreground mb-2">Access Restricted</h2>
            <p className="text-sm text-muted-foreground">This portal is restricted to IC Members, Credit Committee members, and Administrators.</p>
          </div>
        </div>
      </TerminalLayout>
    );
  }

  // ── Case list renderer ────────────────────────────────────────────────────────
  const renderCaseList = (list: ICCase[], emptyLabel: string) => (
    <div className="flex-1 overflow-y-auto">
      {list.length === 0 ? (
        <div className="px-4 py-8 text-sm text-muted-foreground text-center">{emptyLabel}</div>
      ) : list.map(c => {
        const isSelected = c.id === selectedId;
        const dm = c.ic_decision ? DECISION_META[c.ic_decision as NonNullable<DecisionChoice>] : null;
        return (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={cn(
              "w-full text-left px-4 py-3.5 border-b border-border/50 transition-colors",
              isSelected
                ? "bg-primary/8 border-l-[3px] border-l-primary"
                : "hover:bg-surface-2 border-l-[3px] border-l-transparent"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className={cn("text-sm font-semibold leading-snug", isSelected ? "text-primary" : "text-foreground")}>
                {c.client_name}
              </p>
              {dm && (
                <span className={cn("shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border", dm.badge)}>
                  {dm.shortLabel}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{c.case_code}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-muted-foreground/70">{PRODUCTS[c.product_type]?.short ?? c.product_type}</span>
              {c.deal_amount && (
                <span className="text-xs font-semibold text-green-600">₹{Number(c.deal_amount).toLocaleString("en-IN")} Cr</span>
              )}
            </div>
            {isHistory && c.created_at && (
              <p className="text-xs text-muted-foreground/50 mt-1">
                {new Date(c.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <TerminalLayout>

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Investment Committee Review</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Review and approve credit cases submitted for IC</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-xs font-medium text-muted-foreground">Pending Review</p>
            <p className="text-2xl font-bold text-amber-600">{pendingLoading ? "…" : pending.length}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-muted-foreground">Decisions Made</p>
            <p className="text-2xl font-bold text-green-600">{historyLoaded ? history.length : "—"}</p>
          </div>
        </div>
      </div>

      {/* ── Page tabs ────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-border mb-5">
        {(["pending", "history"] as const).map(v => (
          <button
            key={v}
            onClick={() => {
              setPageView(v);
              const list = v === "pending" ? pending : history;
              setSelectedId(list.length > 0 ? list[0].id : null);
            }}
            className={cn(
              "px-5 py-3 text-sm font-medium border-b-2 transition-colors",
              pageView === v
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            {v === "pending"
              ? `Pending Review${!pendingLoading ? ` (${pending.length})` : ""}`
              : `Decision History${historyLoaded ? ` (${history.length})` : ""}`}
          </button>
        ))}
      </div>

      {pendingLoading && pageView === "pending" ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground animate-pulse">
          Loading IC queue…
        </div>
      ) : pageView === "pending" && pending.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
          <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-foreground">All caught up!</p>
            <p className="text-sm text-muted-foreground mt-1">No cases are currently pending IC review.</p>
          </div>
          <button
            onClick={() => { setPageView("history"); loadHistory(); }}
            className="mt-2 px-5 py-2.5 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            View Decision History →
          </button>
        </div>
      ) : (
        <div className="flex rounded-xl border border-border bg-card overflow-hidden" style={{ minHeight: "calc(100vh - 300px)", boxShadow: "var(--shadow-panel)" }}>

          {/* ── Left: Case queue ────────────────────────────────────────── */}
          <div className="border-r border-border flex flex-col shrink-0" style={{ width: "260px" }}>
            <div className="px-4 py-3 border-b border-border bg-surface-2/50 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                {pageView === "pending" ? "Review Queue" : "History"}
              </span>
              <span className="text-xs text-muted-foreground">
                {pageView === "pending" ? pending.length : filteredHistory.length} case{(pageView === "pending" ? pending.length : filteredHistory.length) !== 1 ? "s" : ""}
              </span>
            </div>

            {pageView === "history" && (
              <div className="px-3 py-2.5 border-b border-border">
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    value={histSearch}
                    onChange={e => setHistSearch(e.target.value)}
                    placeholder="Search cases…"
                    className="w-full bg-background border border-border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
              </div>
            )}

            {pageView === "pending"
              ? renderCaseList(pending, "No pending cases")
              : historyLoading
                ? <div className="px-4 py-8 text-sm text-muted-foreground text-center animate-pulse">Loading history…</div>
                : renderCaseList(filteredHistory, "No history found")}
          </div>

          {/* ── Right: Case detail ────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selectedCase ? (
              <>
                {/* Case header */}
                <div className="border-b border-border px-6 py-4 bg-surface-2/30">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-lg font-bold text-foreground">{selectedCase.client_name}</h2>
                        {isHistory && selectedCase.ic_decision && (() => {
                          const hd = HIST_DECISION[selectedCase.ic_decision] ?? { label: selectedCase.ic_decision, cls: "bg-slate-50 text-slate-600 border-slate-200" };
                          return (
                            <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", hd.cls)}>{hd.label}</span>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="text-sm text-muted-foreground font-mono">{selectedCase.case_code}</span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary/10 text-primary">
                          {PRODUCTS[selectedCase.product_type]?.label ?? selectedCase.product_type}
                        </span>
                        {selectedCase.deal_amount && (
                          <span className="text-sm font-semibold text-green-600">₹{Number(selectedCase.deal_amount).toLocaleString("en-IN")} Cr</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {new Date(selectedCase.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      </div>
                    </div>

                    {!isHistory && selectedCase.ic_decision && (
                      <div className={cn("shrink-0 flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg border", DECISION_META[selectedCase.ic_decision as NonNullable<DecisionChoice>]?.badge)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Decision Recorded
                      </div>
                    )}
                  </div>

                  {/* Inner tabs */}
                  <div className="flex gap-1 mt-4 -mb-4">
                    {(["note", "decision"] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setActiveTab(t)}
                        className={cn(
                          "px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors",
                          activeTab === t
                            ? "border-primary text-primary bg-card"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {t === "note" ? "IC Note" : isHistory ? "Decision Record" : "Make Decision"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto">

                  {/* IC NOTE tab */}
                  {activeTab === "note" && (
                    <div className="flex h-full">
                      {/* Section nav */}
                      <div className="border-r border-border bg-surface-2/30 overflow-y-auto shrink-0" style={{ width: "200px" }}>
                        {IC_SECTIONS.map(sec => (
                          <button
                            key={sec.id}
                            onClick={() => setActiveSection(sec.id)}
                            className={cn(
                              "w-full text-left px-4 py-3 border-b border-border/40 transition-colors",
                              activeSection === sec.id
                                ? "bg-primary/8 border-l-[3px] border-l-primary text-primary"
                                : "border-l-[3px] border-l-transparent text-muted-foreground hover:text-foreground hover:bg-surface-2"
                            )}
                          >
                            <div className="text-[10px] font-semibold text-muted-foreground/60 mb-0.5">{sec.roman}</div>
                            <div className="text-xs font-medium leading-snug">{sec.title}</div>
                          </button>
                        ))}

                        {ic?.risks && ic.risks.length > 0 && (
                          <button
                            onClick={() => setActiveSection("_risks")}
                            className={cn("w-full text-left px-4 py-3 border-b border-border/40 transition-colors border-l-[3px]",
                              activeSection === "_risks" ? "bg-primary/8 border-l-primary text-primary" : "border-l-transparent text-muted-foreground hover:text-foreground hover:bg-surface-2"
                            )}
                          >
                            <div className="text-xs font-medium">Risk Register</div>
                            <div className="text-[10px] text-muted-foreground/60 mt-0.5">{ic.risks.length} risks</div>
                          </button>
                        )}

                        {ic?.conditions_precedent && ic.conditions_precedent.length > 0 && (
                          <button
                            onClick={() => setActiveSection("_conditions")}
                            className={cn("w-full text-left px-4 py-3 border-b border-border/40 transition-colors border-l-[3px]",
                              activeSection === "_conditions" ? "bg-primary/8 border-l-primary text-primary" : "border-l-transparent text-muted-foreground hover:text-foreground hover:bg-surface-2"
                            )}
                          >
                            <div className="text-xs font-medium">Conditions Precedent</div>
                            <div className="text-[10px] text-muted-foreground/60 mt-0.5">{ic.conditions_precedent.length} conditions</div>
                          </button>
                        )}

                        {ic?.swot && (
                          <button
                            onClick={() => setActiveSection("_swot")}
                            className={cn("w-full text-left px-4 py-3 border-b border-border/40 transition-colors border-l-[3px]",
                              activeSection === "_swot" ? "bg-primary/8 border-l-primary text-primary" : "border-l-transparent text-muted-foreground hover:text-foreground hover:bg-surface-2"
                            )}
                          >
                            <div className="text-xs font-medium">SWOT Analysis</div>
                          </button>
                        )}
                      </div>

                      {/* Section content */}
                      <div className="flex-1 min-w-0 p-6 overflow-y-auto">
                        {activeSection === "_risks" ? (
                          <div>
                            <h3 className="text-base font-semibold text-foreground mb-4">Risk Register</h3>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm border-collapse">
                                <thead>
                                  <tr className="border-b border-border bg-surface-2/40">
                                    {["Category", "Risk", "Mitigant", "Severity"].map(h => (
                                      <th key={h} className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {ic!.risks!.map((r, i) => (
                                    <tr key={i} className="border-b border-border/40 hover:bg-surface-2/40">
                                      <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">{r.category}</td>
                                      <td className="py-3 px-4 text-sm">{r.risk}</td>
                                      <td className="py-3 px-4 text-sm text-muted-foreground">{r.mitigant}</td>
                                      <td className="py-3 px-4">
                                        <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border capitalize", SEVERITY_STYLE[r.severity?.toLowerCase()] ?? "bg-slate-50 text-slate-600 border-slate-200")}>
                                          {r.severity}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : activeSection === "_conditions" ? (
                          <div>
                            <h3 className="text-base font-semibold text-foreground mb-4">Conditions Precedent</h3>
                            <ol className="space-y-3">
                              {ic!.conditions_precedent!.map((cond, i) => (
                                <li key={i} className="flex gap-4">
                                  <span className="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-semibold flex items-center justify-center">
                                    {i + 1}
                                  </span>
                                  <p className="text-sm text-foreground/80 leading-relaxed pt-0.5">{cond}</p>
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : activeSection === "_swot" ? (
                          <div>
                            <h3 className="text-base font-semibold text-foreground mb-4">SWOT Analysis</h3>
                            <div className="grid grid-cols-2 gap-4">
                              {([
                                ["Strengths",     ic?.swot?.strengths,     "text-green-700", "bg-green-50 border-green-200"],
                                ["Weaknesses",    ic?.swot?.weaknesses,    "text-red-700",   "bg-red-50 border-red-200"    ],
                                ["Opportunities", ic?.swot?.opportunities, "text-blue-700",  "bg-blue-50 border-blue-200"  ],
                                ["Threats",       ic?.swot?.threats,       "text-amber-700", "bg-amber-50 border-amber-200"],
                              ] as [string, string[] | undefined, string, string][]).map(([label, items, cls, boxCls]) => (
                                <div key={label} className={cn("rounded-lg border p-4", boxCls)}>
                                  <h4 className={cn("text-sm font-semibold mb-3", cls)}>{label}</h4>
                                  <ul className="space-y-2">
                                    {(items ?? []).map((item, i) => (
                                      <li key={i} className="flex gap-2.5 text-sm">
                                        <span className={cn("shrink-0 font-bold mt-0.5", cls)}>·</span>
                                        <span className="text-foreground/80 leading-snug">{item}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (() => {
                          const sec = IC_SECTIONS.find(s => s.id === activeSection);
                          return (
                            <div>
                              <div className="flex items-baseline gap-2 mb-5 pb-3 border-b border-border">
                                <span className="text-sm font-semibold text-muted-foreground">{sec?.roman}.</span>
                                <h3 className="text-base font-semibold text-foreground">{sec?.title}</h3>
                              </div>
                              {renderSectionContent(activeSection)}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* DECISION tab */}
                  {activeTab === "decision" && (
                    <div className="p-6 max-w-2xl">
                      {isHistory ? (
                        <div className="space-y-5">
                          {selectedCase.ic_decision ? (() => {
                            const dm = DECISION_META[selectedCase.ic_decision as NonNullable<DecisionChoice>];
                            return (
                              <>
                                <div className={cn("rounded-xl border px-6 py-5 text-center", dm.badge)}>
                                  <p className="text-2xl font-bold mb-1">{dm.shortLabel}</p>
                                  <p className="text-sm text-muted-foreground">{selectedCase.client_name} · {PRODUCTS[selectedCase.product_type]?.label}</p>
                                </div>
                                {selectedCase.ic_decision_notes && (
                                  <div>
                                    <h3 className="text-sm font-semibold text-foreground mb-2">Decision Notes</h3>
                                    <div className="bg-surface-2 rounded-lg border border-border px-4 py-3 text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                                      {selectedCase.ic_decision_notes}
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })() : (
                            <p className="text-sm text-muted-foreground italic">No decision recorded for this case.</p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-6">
                          <div>
                            <h3 className="text-base font-semibold text-foreground mb-1">Make Your Decision</h3>
                            <p className="text-sm text-muted-foreground">Select a decision and provide your rationale or conditions below.</p>
                          </div>

                          {selectedCase.ic_decision && (
                            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                              </svg>
                              <p className="text-sm text-amber-800 font-medium">A decision has already been recorded — you may update it below.</p>
                            </div>
                          )}

                          {/* Decision buttons */}
                          <div>
                            <p className="text-sm font-medium text-foreground mb-3">Select your decision:</p>
                            <div className="flex flex-col sm:flex-row gap-3">
                              {(["approved", "conditionally_approved", "declined"] as const).map(d => {
                                const meta     = DECISION_META[d];
                                const isActive = decisionChoice === d;
                                return (
                                  <button
                                    key={d}
                                    onClick={() => setDecisionChoice(d)}
                                    className={cn(
                                      "flex-1 py-4 px-4 rounded-xl border-2 text-sm font-semibold transition-all",
                                      isActive ? meta.activeClass : cn("bg-card border-2", meta.borderColor)
                                    )}
                                  >
                                    <div className="text-lg font-bold mb-0.5">{meta.icon}</div>
                                    <div>{meta.label}</div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Notes */}
                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                              Decision Notes / Conditions
                              <span className="text-muted-foreground font-normal ml-1">(optional)</span>
                            </label>
                            <textarea
                              value={decisionNotes}
                              onChange={e => setDecisionNotes(e.target.value)}
                              placeholder="Enter your decision rationale, conditions to be met, or queries for the analyst team…"
                              rows={7}
                              className="w-full bg-background border border-border rounded-lg px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-muted-foreground/50 resize-y"
                            />
                          </div>

                          <button
                            onClick={saveDecision}
                            disabled={!decisionChoice || saving}
                            className={cn(
                              "w-full py-4 rounded-xl text-base font-semibold transition-all",
                              !decisionChoice
                                ? "bg-surface-2 text-muted-foreground cursor-not-allowed border-2 border-border"
                                : saving
                                ? "bg-primary/70 text-white cursor-wait"
                                : "bg-primary text-white hover:bg-primary/90 shadow-md hover:shadow-lg"
                            )}
                          >
                            {saving ? "Saving decision…" : "Save Decision"}
                          </button>

                          {!decisionChoice && (
                            <p className="text-sm text-muted-foreground text-center">Please select a decision above to continue.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                {pageView === "history" && historyLoading ? (
                  <span className="text-sm animate-pulse">Loading history…</span>
                ) : (
                  <span className="text-sm">Select a case from the {pageView === "pending" ? "queue" : "list"} on the left</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    </TerminalLayout>
  );
}
