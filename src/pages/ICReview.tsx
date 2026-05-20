import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { IC_SECTIONS, PRODUCTS, type ProductType } from "@/features/credit/domain";
import { toast } from "sonner";
import { BulletOnlyMd } from "@/components/case/MdRenderer";
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

const DECISION_META: Record<NonNullable<DecisionChoice>, { label: string; color: string; activeClass: string; badge: string }> = {
  approved:               { label: "APPROVE",       color: "text-success",     activeClass: "bg-success text-white border-success",         badge: "text-success border-success/40 bg-success/5" },
  conditionally_approved: { label: "COND. APPROVE", color: "text-warning",     activeClass: "bg-warning text-black border-warning",          badge: "text-warning border-warning/40 bg-warning/5" },
  declined:               { label: "REJECT",        color: "text-destructive", activeClass: "bg-destructive text-white border-destructive",  badge: "text-destructive border-destructive/40 bg-destructive/5" },
};

const SEVERITY_COLOR: Record<string, string> = {
  low:      "text-success border-success/30",
  medium:   "text-warning border-warning/30",
  high:     "text-destructive border-destructive/30",
  critical: "text-destructive border-destructive/50 font-bold",
};

const HIST_DECISION_LABEL: Record<string, { short: string; cls: string }> = {
  approved:               { short: "APPROVED",  cls: "text-success border-success/40" },
  conditionally_approved: { short: "COND.",     cls: "text-warning border-warning/40" },
  declined:               { short: "DECLINED",  cls: "text-destructive border-destructive/40" },
  queries_resubmission:   { short: "QUERIES",   cls: "text-accent border-accent/40" },
};

export default function ICReview() {
  const { role } = useAuth();

  // ── page-level: pending vs history ────────────────────────────────────────
  const [pageView, setPageView] = useState<"pending" | "history">("pending");

  // ── pending queue ─────────────────────────────────────────────────────────
  const [pending, setPending]         = useState<ICCase[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);

  // ── history list ──────────────────────────────────────────────────────────
  const [history, setHistory]         = useState<ICCase[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded]   = useState(false);
  const [histSearch, setHistSearch]         = useState("");

  // ── shared detail state ───────────────────────────────────────────────────
  const [selectedId, setSelectedId]         = useState<string | null>(null);
  const [activeTab, setActiveTab]           = useState<"note" | "decision">("note");
  const [activeSection, setActiveSection]   = useState<string>("executive_summary");
  const [caseDetail, setCaseDetail]         = useState<FullCaseRow | null>(null);
  const [extracted, setExtracted]           = useState<ExtractedRow[]>([]);
  const [ratios, setRatios]                 = useState<RatioRow[]>([]);
  const [detailLoading, setDetailLoading]   = useState(false);

  // ── decision form (pending only) ──────────────────────────────────────────
  const [decisionChoice, setDecisionChoice] = useState<DecisionChoice>(null);
  const [decisionNotes, setDecisionNotes]   = useState("");
  const [saving, setSaving]                 = useState(false);

  // ── data loaders ──────────────────────────────────────────────────────────
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
        setHistoryLoaded(false); // invalidate history cache on any change
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // load history when switching to that tab
  useEffect(() => {
    if (pageView === "history") loadHistory();
  }, [pageView]);

  // fetch full data when selected case changes
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

  // ── access denied ──────────────────────────────────────────────────────────
  if (!IC_ACCESS_ROLES.includes(role ?? "")) {
    return (
      <TerminalLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <div className="border border-destructive/40 bg-destructive/5 px-8 py-6 text-center max-w-sm">
            <div className="text-destructive text-2xl mb-2">⊘</div>
            <div className="text-destructive font-bold tracking-widest text-sm mb-1">ACCESS DENIED</div>
            <div className="text-muted-foreground text-xs">Restricted to IC Members, Credit Committee, and Administrators.</div>
          </div>
        </div>
      </TerminalLayout>
    );
  }

  // ── section structured content ─────────────────────────────────────────────
  const renderSectionContent = (sectionId: string) => {
    const md = ic?.sections?.[sectionId]?.markdown ?? "";

    if (detailLoading) {
      return <div className="text-muted-foreground/40 text-xs tracking-widest animate-pulse py-4">LOADING DATA…</div>;
    }

    switch (sectionId) {
      case "executive_summary":
        return <div className="space-y-3">{caseDetail && <ICSummaryPanel cc={caseDetail} ratios={ratios} />}<BulletOnlyMd text={md} /></div>;
      case "client_promoter":
        return <div className="space-y-3">{caseDetail && <ICClientProfile cc={caseDetail} />}<BulletOnlyMd text={md} /></div>;
      case "investment_structure":
        return <div className="space-y-3">{caseDetail && <ICInvestmentStructure cc={caseDetail} />}<BulletOnlyMd text={md} /></div>;
      case "rehbar_funding_history":
        return <div className="space-y-3">{caseDetail && <ICRehbarHistory cc={caseDetail} />}<BulletOnlyMd text={md} /></div>;
      case "historical_financial":
        return <div className="space-y-3"><ICHistoricalTables extracted={extracted} /><BulletOnlyMd text={md} /></div>;
      case "projections":
        return <div className="space-y-3"><ICProjectionsTable extracted={extracted} /><BulletOnlyMd text={md} /></div>;
      case "key_ratios":
        return <ICRatioTable ratios={ratios} />;
      case "cash_flow":
        return md
          ? <BulletOnlyMd text={md} />
          : <div className="text-muted-foreground/40 text-xs italic">No cash flow narrative. See Historical Analysis (V) for financial tables.</div>;
      case "due_diligence":
        return md
          ? <BulletOnlyMd text={md} />
          : <div className="text-muted-foreground/40 text-xs italic">No due diligence excerpts recorded by analyst.</div>;
      case "risk_assessment":
        return md
          ? <BulletOnlyMd text={md} />
          : <div className="text-muted-foreground/40 text-xs italic">No risk assessment narrative. See Risk Register entry in the side nav.</div>;
      case "visit_reference":
        return <div className="space-y-3">{caseDetail && <ICVisitReference cc={caseDetail} />}<BulletOnlyMd text={md} /></div>;
      case "product_specifics":
        return <div className="space-y-3">{caseDetail && <ICProductSpecifics cc={caseDetail} />}<BulletOnlyMd text={md} /></div>;
      default:
        return md
          ? <BulletOnlyMd text={md} />
          : <div className="text-muted-foreground/40 text-xs italic">No content for this section.</div>;
    }
  };

  // ── filtered history ───────────────────────────────────────────────────────
  const filteredHistory = history.filter(c =>
    !histSearch ||
    c.client_name.toLowerCase().includes(histSearch.toLowerCase()) ||
    c.case_code.toLowerCase().includes(histSearch.toLowerCase())
  );

  // ── queue list shared renderer ─────────────────────────────────────────────
  const renderCaseList = (list: ICCase[], emptyLabel: string) => (
    <div className="flex-1 overflow-y-auto">
      {list.length === 0
        ? <div className="px-3 py-6 text-[10px] text-muted-foreground/40 tracking-widest text-center">{emptyLabel}</div>
        : list.map(c => {
            const isSelected = c.id === selectedId;
            const dm = c.ic_decision ? DECISION_META[c.ic_decision as NonNullable<DecisionChoice>] : null;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-3 py-3 border-b border-border/50 transition-colors ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-surface-2"}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="text-[11px] font-bold text-primary truncate leading-tight">{c.client_name}</div>
                  {dm && (
                    <span className={`shrink-0 text-[7px] font-bold tracking-widest border px-1 py-px ${dm.badge}`}>
                      {c.ic_decision === "approved" ? "APPR." : c.ic_decision === "conditionally_approved" ? "COND." : "REJ."}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[9px] text-muted-foreground font-mono">{c.case_code}</span>
                  <span className="text-[8px] font-bold tracking-widest border border-accent/30 text-accent px-1 py-px">{PRODUCTS[c.product_type]?.short ?? c.product_type}</span>
                </div>
                {c.deal_amount && (
                  <div className="text-[10px] text-success font-bold mt-0.5">₹{Number(c.deal_amount).toLocaleString("en-IN")} Cr</div>
                )}
                {isHistory && c.created_at && (
                  <div className="text-[9px] text-muted-foreground/50 mt-0.5">{new Date(c.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
                )}
              </button>
            );
          })
      }
    </div>
  );

  return (
    <TerminalLayout>
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3 border border-border bg-surface px-4 py-2.5">
        <div>
          <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">IC REVIEW PORTAL</div>
          <div className="text-lg font-bold text-primary glow tracking-wider">INVESTMENT COMMITTEE</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">PENDING</div>
            <div className="text-2xl font-bold text-warning glow">{pendingLoading ? "…" : pending.length}</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">DECIDED</div>
            <div className="text-2xl font-bold text-success glow">{historyLoaded ? history.length : "—"}</div>
          </div>
        </div>
      </div>

      {/* ── Page-level tabs: PENDING / HISTORY ───────────────────────────── */}
      <div className="flex border-b border-border mb-3">
        {(["pending", "history"] as const).map(v => (
          <button
            key={v}
            onClick={() => {
              setPageView(v);
              // auto-select first case in the new list
              const list = v === "pending" ? pending : history;
              if (list.length > 0) setSelectedId(list[0].id);
              else setSelectedId(null);
            }}
            className={`px-5 py-2 text-[10px] font-bold tracking-widest border-b-2 transition-colors ${
              pageView === v
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-primary"
            }`}
          >
            {v === "pending"
              ? `PENDING REVIEW${!pendingLoading ? ` (${pending.length})` : ""}`
              : `IC HISTORY${historyLoaded ? ` (${history.length})` : ""}`
            }
          </button>
        ))}
      </div>

      {pendingLoading && pageView === "pending" ? (
        <div className="p-12 text-center text-muted-foreground text-xs tracking-widest">LOADING IC QUEUE…</div>
      ) : pageView === "pending" && pending.length === 0 ? (
        /* ── empty pending state ── */
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
          <div className="text-success text-4xl">✓</div>
          <div className="text-muted-foreground text-xs tracking-widest">NO CASES PENDING IC REVIEW</div>
          <button
            onClick={() => { setPageView("history"); loadHistory(); }}
            className="mt-2 px-5 py-2 text-[10px] font-bold tracking-widest border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
          >
            VIEW IC HISTORY →
          </button>
        </div>
      ) : (
        <div className="flex border border-border bg-surface" style={{ minHeight: "calc(100vh - 260px)" }}>

          {/* ── Left: Case list ─────────────────────────────────────────── */}
          <div className="border-r border-border flex flex-col" style={{ width: "240px", minWidth: "240px" }}>
            <div className="px-3 py-2 border-b border-border bg-surface-2 flex items-center justify-between">
              <span className="text-[9px] tracking-widest text-primary font-bold">
                {pageView === "pending" ? "QUEUE" : "HISTORY"}
              </span>
              <span className="text-[9px] text-muted-foreground/50">
                {pageView === "pending" ? pending.length : filteredHistory.length} CASE{(pageView === "pending" ? pending.length : filteredHistory.length) !== 1 ? "S" : ""}
              </span>
            </div>

            {/* history search */}
            {pageView === "history" && (
              <div className="px-2 py-1.5 border-b border-border">
                <input
                  type="text"
                  value={histSearch}
                  onChange={e => setHistSearch(e.target.value)}
                  placeholder="Search client / code…"
                  className="w-full bg-input border border-border px-2 py-1 text-[10px] text-primary focus:outline-none focus:border-primary/60 placeholder:text-muted-foreground/30"
                />
              </div>
            )}

            {pageView === "pending"
              ? renderCaseList(pending, "NO PENDING CASES")
              : historyLoading
                ? <div className="px-3 py-6 text-[10px] text-muted-foreground/40 tracking-widest text-center animate-pulse">LOADING HISTORY…</div>
                : renderCaseList(filteredHistory, "NO HISTORY FOUND")
            }
          </div>

          {/* ── Right: Detail panel ──────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selectedCase ? (
              <>
                {/* Case header */}
                <div className="border-b border-border px-5 py-3 bg-surface-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-lg font-bold text-primary leading-tight">{selectedCase.client_name}</div>
                        {isHistory && selectedCase.ic_decision && (() => {
                          const hm = HIST_DECISION_LABEL[selectedCase.ic_decision] ?? { short: selectedCase.ic_decision.toUpperCase(), cls: "text-muted-foreground border-border" };
                          return (
                            <span className={`text-[9px] font-bold tracking-widest border px-2 py-0.5 ${hm.cls}`}>{hm.short}</span>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground font-mono">{selectedCase.case_code}</span>
                        <span className="text-[9px] font-bold border border-accent/30 text-accent px-1.5 py-px">{PRODUCTS[selectedCase.product_type]?.label ?? selectedCase.product_type}</span>
                        {selectedCase.deal_amount && (
                          <span className="text-success font-bold text-sm">₹{Number(selectedCase.deal_amount).toLocaleString("en-IN")} Cr</span>
                        )}
                        <span className="text-[9px] text-muted-foreground/50">{new Date(selectedCase.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                      </div>
                    </div>
                    {!isHistory && selectedCase.ic_decision && (
                      <div className={`shrink-0 text-[10px] font-bold tracking-widest border px-3 py-1.5 ${
                        selectedCase.ic_decision === "approved" ? "bg-success/10 text-success border-success/40" :
                        selectedCase.ic_decision === "conditionally_approved" ? "bg-warning/10 text-warning border-warning/40" :
                        "bg-destructive/10 text-destructive border-destructive/40"
                      }`}>
                        ◉ DECISION RECORDED
                      </div>
                    )}
                  </div>

                  {/* Inner tabs */}
                  <div className="flex gap-0 mt-3 -mb-3">
                    {(["note", "decision"] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setActiveTab(t)}
                        className={`px-4 py-1.5 text-[10px] tracking-widest font-bold border-t border-x border-border transition-colors ${
                          activeTab === t
                            ? "bg-surface text-primary border-b border-b-surface"
                            : "text-muted-foreground hover:text-primary bg-surface-2"
                        }`}
                      >
                        {t === "note" ? "IC NOTE" : isHistory ? "DECISION RECORD" : "DECISION"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Inner tab content */}
                <div className="flex-1 overflow-y-auto">

                  {/* IC NOTE tab */}
                  {activeTab === "note" && (
                    <div className="flex h-full">
                      {/* Section nav */}
                      <div className="border-r border-border bg-surface-2 overflow-y-auto shrink-0" style={{ width: "160px" }}>
                        {IC_SECTIONS.map(sec => (
                          <button
                            key={sec.id}
                            onClick={() => setActiveSection(sec.id)}
                            className={`w-full text-left px-3 py-2.5 border-b border-border/40 transition-colors ${
                              activeSection === sec.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-primary hover:bg-surface"
                            }`}
                          >
                            <div className="text-[10px] font-bold tracking-widest">{sec.roman}</div>
                            <div className="text-[8px] tracking-wide leading-tight mt-0.5 opacity-80">{sec.title}</div>
                          </button>
                        ))}
                        {ic?.risks && ic.risks.length > 0 && (
                          <button
                            onClick={() => setActiveSection("_risks")}
                            className={`w-full text-left px-3 py-2.5 border-b border-border/40 transition-colors ${activeSection === "_risks" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-primary hover:bg-surface"}`}
                          >
                            <div className="text-[10px] font-bold tracking-widest">RISKS</div>
                            <div className="text-[8px] tracking-wide leading-tight mt-0.5 opacity-80">Risk Register</div>
                          </button>
                        )}
                        {ic?.conditions_precedent && ic.conditions_precedent.length > 0 && (
                          <button
                            onClick={() => setActiveSection("_conditions")}
                            className={`w-full text-left px-3 py-2.5 border-b border-border/40 transition-colors ${activeSection === "_conditions" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-primary hover:bg-surface"}`}
                          >
                            <div className="text-[10px] font-bold tracking-widest">CONDITIONS</div>
                            <div className="text-[8px] tracking-wide leading-tight mt-0.5 opacity-80">Precedent</div>
                          </button>
                        )}
                        {ic?.swot && (
                          <button
                            onClick={() => setActiveSection("_swot")}
                            className={`w-full text-left px-3 py-2.5 border-b border-border/40 transition-colors ${activeSection === "_swot" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-primary hover:bg-surface"}`}
                          >
                            <div className="text-[10px] font-bold tracking-widest">SWOT</div>
                            <div className="text-[8px] tracking-wide leading-tight mt-0.5 opacity-80">Analysis</div>
                          </button>
                        )}
                      </div>

                      {/* Section content */}
                      <div className="flex-1 min-w-0 p-5 overflow-y-auto">
                        {activeSection === "_risks" ? (
                          <div>
                            <div className="text-[10px] tracking-widest font-bold text-primary mb-4 border-b border-border pb-2">RISK REGISTER</div>
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="border-b border-border">
                                  {["CATEGORY","RISK","MITIGANT","SEVERITY"].map(h => (
                                    <th key={h} className="text-left px-2 py-1.5 text-[9px] tracking-widest text-muted-foreground font-bold">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {ic!.risks!.map((r, i) => (
                                  <tr key={i} className="border-b border-border/40 hover:bg-surface-2">
                                    <td className="px-2 py-2 text-[10px] text-muted-foreground">{r.category}</td>
                                    <td className="px-2 py-2 text-[10px]">{r.risk}</td>
                                    <td className="px-2 py-2 text-[10px] text-muted-foreground">{r.mitigant}</td>
                                    <td className="px-2 py-2">
                                      <span className={`text-[9px] font-bold tracking-widest border px-1.5 py-0.5 uppercase ${SEVERITY_COLOR[r.severity?.toLowerCase()] ?? "text-muted-foreground border-border"}`}>
                                        {r.severity}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : activeSection === "_conditions" ? (
                          <div>
                            <div className="text-[10px] tracking-widest font-bold text-primary mb-4 border-b border-border pb-2">CONDITIONS PRECEDENT</div>
                            <ol className="space-y-2">
                              {ic!.conditions_precedent!.map((cond, i) => (
                                <li key={i} className="flex gap-3 text-xs">
                                  <span className="shrink-0 text-[9px] font-bold text-muted-foreground/50 tabular-nums mt-0.5">{String(i + 1).padStart(2, "0")}.</span>
                                  <span className="text-foreground/80 leading-relaxed">{cond}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : activeSection === "_swot" ? (
                          <div>
                            <div className="text-[10px] tracking-widest font-bold text-primary mb-4 border-b border-border pb-2">SWOT ANALYSIS</div>
                            <div className="grid grid-cols-2 gap-3">
                              {([
                                ["STRENGTHS",    ic?.swot?.strengths,    "text-success",     "border-success/30 bg-success/5"],
                                ["WEAKNESSES",   ic?.swot?.weaknesses,   "text-destructive", "border-destructive/30 bg-destructive/5"],
                                ["OPPORTUNITIES",ic?.swot?.opportunities,"text-accent",      "border-accent/30 bg-accent/5"],
                                ["THREATS",      ic?.swot?.threats,      "text-warning",     "border-warning/30 bg-warning/5"],
                              ] as [string, string[] | undefined, string, string][]).map(([label, items, cls, boxCls]) => (
                                <div key={label} className={`border p-3 ${boxCls}`}>
                                  <div className={`text-[9px] font-bold tracking-widest mb-2 ${cls}`}>{label}</div>
                                  <div className="space-y-1">
                                    {(items ?? []).map((item, i) => (
                                      <div key={i} className="flex gap-1.5 text-xs">
                                        <span className={`shrink-0 font-bold ${cls}`}>▸</span>
                                        <span className="text-foreground/80">{item}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (() => {
                          const sec = IC_SECTIONS.find(s => s.id === activeSection);
                          return (
                            <div>
                              <div className="flex items-baseline gap-3 mb-4 border-b border-border pb-2">
                                <span className="text-primary text-lg font-bold">{sec?.roman}.</span>
                                <span className="text-[10px] tracking-widest font-bold text-primary">{sec?.title}</span>
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
                        /* read-only decision record for history */
                        <div className="space-y-4">
                          {selectedCase.ic_decision ? (
                            <>
                              <div className={`border px-5 py-4 text-center ${
                                selectedCase.ic_decision === "approved" ? "bg-success/5 border-success/40" :
                                selectedCase.ic_decision === "conditionally_approved" ? "bg-warning/5 border-warning/40" :
                                selectedCase.ic_decision === "declined" ? "bg-destructive/5 border-destructive/40" :
                                "bg-muted/10 border-border"
                              }`}>
                                <div className={`text-xl font-bold tracking-widest ${
                                  selectedCase.ic_decision === "approved" ? "text-success" :
                                  selectedCase.ic_decision === "conditionally_approved" ? "text-warning" :
                                  selectedCase.ic_decision === "declined" ? "text-destructive" : "text-muted-foreground"
                                }`}>
                                  {selectedCase.ic_decision === "approved" ? "APPROVED"
                                    : selectedCase.ic_decision === "conditionally_approved" ? "CONDITIONALLY APPROVED"
                                    : selectedCase.ic_decision === "declined" ? "DECLINED"
                                    : selectedCase.ic_decision.replace(/_/g," ").toUpperCase()}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-1">{selectedCase.client_name} · {PRODUCTS[selectedCase.product_type]?.label}</div>
                              </div>
                              {selectedCase.ic_decision_notes && (
                                <div>
                                  <div className="text-[9px] tracking-widest text-muted-foreground mb-2">DECISION NOTES</div>
                                  <div className="border border-border bg-input/30 px-3 py-3 text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
                                    {selectedCase.ic_decision_notes}
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-muted-foreground/40 text-xs tracking-widest">No decision recorded for this case.</div>
                          )}
                        </div>
                      ) : (
                        /* active decision form for pending */
                        <>
                          {selectedCase.ic_decision && (
                            <div className="mb-5 border border-warning/40 bg-warning/5 px-4 py-3 text-[10px] tracking-widest text-warning font-bold">
                              ⚠ DECISION ALREADY RECORDED — YOU MAY UPDATE IT BELOW
                            </div>
                          )}
                          <div className="mb-5">
                            <div className="text-[9px] tracking-widest text-muted-foreground mb-3">SELECT DECISION</div>
                            <div className="flex gap-2 flex-wrap">
                              {(["approved", "conditionally_approved", "declined"] as const).map(d => {
                                const meta = DECISION_META[d];
                                const isActive = decisionChoice === d;
                                return (
                                  <button
                                    key={d}
                                    onClick={() => setDecisionChoice(d)}
                                    className={`px-4 py-2 text-[10px] font-bold tracking-widest border transition-colors ${isActive ? meta.activeClass : `border-border ${meta.color} hover:border-current`}`}
                                  >
                                    {isActive ? "◉ " : "○ "}{meta.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div className="mb-5">
                            <div className="text-[9px] tracking-widest text-muted-foreground mb-2">DECISION NOTES / CONDITIONS</div>
                            <textarea
                              value={decisionNotes}
                              onChange={e => setDecisionNotes(e.target.value)}
                              placeholder="Enter decision rationale, conditions, or queries for the analyst…"
                              rows={8}
                              className="w-full bg-input border border-border px-3 py-2 text-xs font-mono text-primary focus:outline-none focus:border-primary/60 placeholder:text-muted-foreground/30 resize-y"
                            />
                          </div>
                          <button
                            onClick={saveDecision}
                            disabled={!decisionChoice || saving}
                            className={`px-6 py-2.5 text-[10px] font-bold tracking-widest border transition-colors ${
                              !decisionChoice ? "border-border text-muted-foreground/30 cursor-not-allowed"
                              : saving ? "border-primary/40 text-primary/50 cursor-wait"
                              : "border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                            }`}
                          >
                            {saving ? "SAVING…" : "SAVE DECISION"}
                          </button>
                          {!decisionChoice && <p className="mt-2 text-[9px] text-muted-foreground/40">Select a decision above to enable save.</p>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground/40 text-xs tracking-widest">
                {pageView === "history" && historyLoading
                  ? <span className="animate-pulse">LOADING HISTORY…</span>
                  : <span>SELECT A CASE FROM THE {pageView === "pending" ? "QUEUE" : "LIST"}</span>
                }
              </div>
            )}
          </div>
        </div>
      )}
    </TerminalLayout>
  );
}
