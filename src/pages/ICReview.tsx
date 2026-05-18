import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { IC_SECTIONS, PRODUCTS, type ProductType } from "@/features/credit/domain";
import { toast } from "sonner";

const IC_ACCESS_ROLES = ["ic_member", "credit_committee", "admin"];

type ICNote = {
  sections?: Record<string, { markdown?: string }>;
  risks?: Array<{ category: string; risk: string; mitigant: string; severity: string }>;
  conditions_precedent?: string[];
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

const DECISION_META: Record<NonNullable<DecisionChoice>, { label: string; color: string; activeClass: string }> = {
  approved:               { label: "APPROVE",        color: "text-success",     activeClass: "bg-success text-white border-success" },
  conditionally_approved: { label: "COND. APPROVE",  color: "text-warning",     activeClass: "bg-warning text-black border-warning" },
  declined:               { label: "REJECT",         color: "text-destructive", activeClass: "bg-destructive text-white border-destructive" },
};

const SEVERITY_COLOR: Record<string, string> = {
  low:      "text-success border-success/30",
  medium:   "text-warning border-warning/30",
  high:     "text-destructive border-destructive/30",
  critical: "text-destructive border-destructive/50 font-bold",
};

export default function ICReview() {
  const { role } = useAuth();

  const [cases, setCases]             = useState<ICCase[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [activeTab, setActiveTab]     = useState<"note" | "decision">("note");
  const [activeSection, setActiveSection] = useState<string>("executive_summary");

  // Decision form
  const [decisionChoice, setDecisionChoice] = useState<DecisionChoice>(null);
  const [decisionNotes, setDecisionNotes]   = useState("");
  const [saving, setSaving]                 = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("credit_cases")
      .select("id,case_code,client_name,product_type,deal_amount,status,ic_note,ic_decision,ic_decision_notes,created_at")
      .eq("status", "ic_review")
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as ICCase[];
    setCases(rows);
    if (rows.length > 0 && !selectedId) setSelectedId(rows[0].id);
  };

  useEffect(() => {
    load().then(() => setLoading(false));
    const ch = supabase
      .channel("ic_review_cases")
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_cases" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Sync decision form when selection changes
  useEffect(() => {
    const c = cases.find(x => x.id === selectedId);
    if (!c) return;
    setDecisionChoice((c.ic_decision as DecisionChoice) ?? null);
    setDecisionNotes(c.ic_decision_notes ?? "");
    setActiveSection("executive_summary");
    setActiveTab("note");
  }, [selectedId]);

  const selectedCase = cases.find(c => c.id === selectedId) ?? null;
  const ic = selectedCase?.ic_note ?? null;

  const saveDecision = async () => {
    if (!selectedCase || !decisionChoice) return;
    setSaving(true);
    const { error } = await supabase
      .from("credit_cases")
      .update({
        ic_decision:       decisionChoice,
        ic_decision_notes: decisionNotes.trim() || null,
        status:            decisionChoice,
      } as never)
      .eq("id", selectedCase.id);
    setSaving(false);
    if (error) { toast.error("Failed to save decision"); return; }
    toast.success(`Decision recorded: ${DECISION_META[decisionChoice].label}`);
    // Remove from queue and select next
    const remaining = cases.filter(c => c.id !== selectedCase.id);
    setCases(remaining);
    setSelectedId(remaining[0]?.id ?? null);
  };

  // ── Access denied ───────────────────────────────────────────────────────────
  if (!IC_ACCESS_ROLES.includes(role ?? "")) {
    return (
      <TerminalLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <div className="border border-destructive/40 bg-destructive/5 px-8 py-6 text-center max-w-sm">
            <div className="text-destructive text-2xl mb-2">⊘</div>
            <div className="text-destructive font-bold tracking-widest text-sm mb-1">ACCESS DENIED</div>
            <div className="text-muted-foreground text-xs">This portal is restricted to IC Members, Credit Committee, and Administrators.</div>
          </div>
        </div>
      </TerminalLayout>
    );
  }

  return (
    <TerminalLayout>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3 border border-border bg-surface px-4 py-2.5">
        <div>
          <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">IC REVIEW PORTAL</div>
          <div className="text-lg font-bold text-primary glow tracking-wider">INVESTMENT COMMITTEE</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">PENDING REVIEW</div>
          <div className="text-2xl font-bold text-warning glow">{loading ? "…" : cases.length}</div>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground text-xs tracking-widest">LOADING IC QUEUE…</div>
      ) : cases.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
          <div className="text-success text-3xl">✓</div>
          <div className="text-muted-foreground text-xs tracking-widest">NO CASES PENDING IC REVIEW</div>
        </div>
      ) : (
        <div className="flex border border-border bg-surface" style={{ minHeight: "calc(100vh - 220px)" }}>

          {/* ── Left: Case queue ─────────────────────────────────────────── */}
          <div className="border-r border-border flex flex-col" style={{ width: "240px", minWidth: "240px" }}>
            <div className="px-3 py-2 border-b border-border bg-surface-2">
              <span className="text-[9px] tracking-widest text-primary font-bold">QUEUE</span>
              <span className="ml-2 text-[9px] text-muted-foreground/50">{cases.length} CASE{cases.length !== 1 ? "S" : ""}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {cases.map(c => {
                const isSelected = c.id === selectedId;
                const decided = !!c.ic_decision;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left px-3 py-3 border-b border-border/50 transition-colors ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-surface-2"}`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="text-[11px] font-bold text-primary truncate leading-tight">{c.client_name}</div>
                      {decided && (
                        <span className={`shrink-0 text-[7px] font-bold tracking-widest border px-1 py-px ${
                          c.ic_decision === "approved" ? "text-success border-success/40" :
                          c.ic_decision === "conditionally_approved" ? "text-warning border-warning/40" :
                          "text-destructive border-destructive/40"
                        }`}>
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
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Right: Detail panel ───────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selectedCase ? (
              <>
                {/* Case header */}
                <div className="border-b border-border px-5 py-3 bg-surface-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-bold text-primary leading-tight">{selectedCase.client_name}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground font-mono">{selectedCase.case_code}</span>
                        <span className="text-[9px] font-bold border border-accent/30 text-accent px-1.5 py-px">{PRODUCTS[selectedCase.product_type]?.label ?? selectedCase.product_type}</span>
                        {selectedCase.deal_amount && (
                          <span className="text-success font-bold text-sm">₹{Number(selectedCase.deal_amount).toLocaleString("en-IN")} Cr</span>
                        )}
                      </div>
                    </div>
                    {selectedCase.ic_decision && (
                      <div className={`shrink-0 text-[10px] font-bold tracking-widest border px-3 py-1.5 ${
                        selectedCase.ic_decision === "approved" ? "bg-success/10 text-success border-success/40" :
                        selectedCase.ic_decision === "conditionally_approved" ? "bg-warning/10 text-warning border-warning/40" :
                        "bg-destructive/10 text-destructive border-destructive/40"
                      }`}>
                        ◉ DECISION RECORDED
                      </div>
                    )}
                  </div>

                  {/* Tabs */}
                  <div className="flex gap-0 mt-3 -mb-3">
                    {(["note", "decision"] as const).map(tab => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-1.5 text-[10px] tracking-widest font-bold border-t border-x border-border transition-colors ${
                          activeTab === tab
                            ? "bg-surface text-primary border-b border-b-surface"
                            : "text-muted-foreground hover:text-primary bg-surface-2"
                        }`}
                      >
                        {tab === "note" ? "IC NOTE" : "DECISION"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto">

                  {/* ── IC NOTE tab ─────────────────────────────────────── */}
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

                        {/* Extras nav */}
                        {ic?.risks && ic.risks.length > 0 && (
                          <button
                            onClick={() => setActiveSection("_risks")}
                            className={`w-full text-left px-3 py-2.5 border-b border-border/40 transition-colors ${
                              activeSection === "_risks" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-primary hover:bg-surface"
                            }`}
                          >
                            <div className="text-[10px] font-bold tracking-widest">RISKS</div>
                            <div className="text-[8px] tracking-wide leading-tight mt-0.5 opacity-80">Risk Register</div>
                          </button>
                        )}
                        {ic?.conditions_precedent && ic.conditions_precedent.length > 0 && (
                          <button
                            onClick={() => setActiveSection("_conditions")}
                            className={`w-full text-left px-3 py-2.5 border-b border-border/40 transition-colors ${
                              activeSection === "_conditions" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-primary hover:bg-surface"
                            }`}
                          >
                            <div className="text-[10px] font-bold tracking-widest">CONDITIONS</div>
                            <div className="text-[8px] tracking-wide leading-tight mt-0.5 opacity-80">Precedent</div>
                          </button>
                        )}
                      </div>

                      {/* Section content */}
                      <div className="flex-1 min-w-0 p-5 overflow-y-auto">
                        {!ic ? (
                          <div className="text-center py-12">
                            <div className="text-muted-foreground/30 text-4xl mb-3">○</div>
                            <div className="text-[11px] tracking-widest text-muted-foreground/50">IC NOTE NOT YET GENERATED</div>
                            <div className="text-[10px] text-muted-foreground/30 mt-1">The analyst has not generated the IC note for this case.</div>
                          </div>
                        ) : activeSection === "_risks" ? (
                          <div>
                            <div className="text-[10px] tracking-widest font-bold text-primary mb-4 border-b border-border pb-2">RISK REGISTER</div>
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="border-b border-border">
                                  <th className="text-left px-2 py-1.5 text-[9px] tracking-widest text-muted-foreground font-bold">CATEGORY</th>
                                  <th className="text-left px-2 py-1.5 text-[9px] tracking-widest text-muted-foreground font-bold">RISK</th>
                                  <th className="text-left px-2 py-1.5 text-[9px] tracking-widest text-muted-foreground font-bold">MITIGANT</th>
                                  <th className="text-left px-2 py-1.5 text-[9px] tracking-widest text-muted-foreground font-bold">SEVERITY</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ic.risks!.map((r, i) => (
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
                              {ic.conditions_precedent!.map((cond, i) => (
                                <li key={i} className="flex gap-3 text-xs">
                                  <span className="shrink-0 text-[9px] font-bold text-muted-foreground/50 tabular-nums mt-0.5">{String(i + 1).padStart(2, "0")}.</span>
                                  <span className="text-foreground/80 leading-relaxed">{cond}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : (
                          (() => {
                            const sec = IC_SECTIONS.find(s => s.id === activeSection);
                            const md  = ic.sections?.[activeSection]?.markdown ?? "";
                            return (
                              <div>
                                <div className="flex items-baseline gap-3 mb-4 border-b border-border pb-2">
                                  <span className="text-primary text-lg font-bold">{sec?.roman}.</span>
                                  <span className="text-[10px] tracking-widest font-bold text-primary">{sec?.title}</span>
                                </div>
                                {md ? (
                                  <pre className="whitespace-pre-wrap text-xs font-mono text-foreground/80 leading-relaxed">{md}</pre>
                                ) : (
                                  <div className="text-[10px] text-muted-foreground/40 italic">No content for this section.</div>
                                )}
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── DECISION tab ─────────────────────────────────────── */}
                  {activeTab === "decision" && (
                    <div className="p-6 max-w-2xl">
                      {selectedCase.ic_decision && (
                        <div className="mb-5 border border-warning/40 bg-warning/5 px-4 py-3 text-[10px] tracking-widest text-warning font-bold">
                          ⚠ DECISION ALREADY RECORDED — YOU MAY UPDATE IT BELOW
                        </div>
                      )}

                      {/* Decision buttons */}
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
                                className={`px-4 py-2 text-[10px] font-bold tracking-widest border transition-colors ${
                                  isActive ? meta.activeClass : `border-border ${meta.color} hover:border-current`
                                }`}
                              >
                                {isActive ? "◉ " : "○ "}{meta.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Notes textarea */}
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

                      {/* Save button */}
                      <button
                        onClick={saveDecision}
                        disabled={!decisionChoice || saving}
                        className={`px-6 py-2.5 text-[10px] font-bold tracking-widest border transition-colors ${
                          !decisionChoice
                            ? "border-border text-muted-foreground/30 cursor-not-allowed"
                            : saving
                            ? "border-primary/40 text-primary/50 cursor-wait"
                            : "border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                        }`}
                      >
                        {saving ? "SAVING…" : "SAVE DECISION"}
                      </button>

                      {!decisionChoice && (
                        <p className="mt-2 text-[9px] text-muted-foreground/40">Select a decision above to enable save.</p>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground/40 text-xs tracking-widest">
                SELECT A CASE FROM THE QUEUE
              </div>
            )}
          </div>
        </div>
      )}
    </TerminalLayout>
  );
}
