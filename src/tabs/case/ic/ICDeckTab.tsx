import React, { useRef, useEffect, useState, useCallback } from "react";
import { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { generateIcDeckWord } from "@/lib/ic-deck-word-export";
import type { IcNoteShape } from "./ICNoteDocument";
import type { ExtractedRow, RatioRow } from "@/features/case/types";

// ── Deck components ───────────────────────────────────────────────────────────
import { SlideShell }               from "./deck/SlideShell";
import { CoverCard }                from "./deck/CoverCard";
import { TocCard }                  from "./deck/TocCard";
import { DealSummaryCard }          from "./deck/DealSummaryCard";
import { CompanyProfileCard }       from "./deck/CompanyProfileCard";
import { DirectorsCard }            from "./deck/DirectorsCard";
import { NarrativeCard }            from "./deck/NarrativeCard";
import { HistoricalFinancialsCard } from "./deck/HistoricalFinancialsCard";
import { KeyRatiosCard }            from "./deck/KeyRatiosCard";
import { RiskMatrixCard }           from "./deck/RiskMatrixCard";
import type { RiskTemplate }        from "./deck/RiskMatrixCard";
import { ConditionsPrecedentCard }  from "./deck/ConditionsPrecedentCard";
import { SwotCard }                 from "./deck/SwotCard";
import { RehbarHistoryCard }         from "./deck/RehbarHistoryCard";
import { ProjectionsCard }          from "./deck/ProjectionsCard";
import { VisitReportCard }          from "./deck/VisitReportCard";
import { CashFlowCard }             from "./deck/CashFlowCard";
import { CibilCard }               from "./deck/CibilCard";
import { NetWorthCard }            from "./deck/NetWorthCard";
import type { CibilReportRow }     from "@/tabs/case/CibilTab";
import { AnnexuresCard }            from "./deck/AnnexuresCard";
import { DataVisualizationCard }    from "./deck/DataVisualizationCard";
import { ICApprovalConditionsCard } from "./deck/ICApprovalConditionsCard";
import { SiteVisitPicturesCard }    from "./deck/SiteVisitPicturesCard";
import { InvestmentPoliciesCard }   from "./deck/InvestmentPoliciesCard";
import { ClosingCard }              from "./deck/ClosingCard";

// ── Types ─────────────────────────────────────────────────────────────────────
type CaseRow = Tables<"credit_cases">;

export interface ICDeckTabProps {
  cc: CaseRow;
  extracted: ExtractedRow[];
  ratios: RatioRow[];
  ic: IcNoteShape;
  company: Record<string, string | null> | null;
  directors: Record<string, string | null>[];
  cibilData: CibilReportRow[];
  onGenerateSection: (sectionId: string) => Promise<void>;
  generatingSection: string | null;
}

// ── Section metadata (narrative sections only) ─────────────────────────────────
interface DeckSection {
  id: string;
  roman: string;
  title: string;
  short: string;
  type: "narrative" | "financials" | "ratios" | "risk" | "conditions" | "swot";
  slideCount: number; // how many slides this section takes
}

const DECK_SECTIONS: DeckSection[] = [
  { id: "executive_summary",     roman: "I",     title: "Executive Summary",                              short: "Exec Summary",    type: "narrative",   slideCount: 1 },
  { id: "client_promoter",       roman: "II",    title: "Client & Promoter Profile",                      short: "Client Profile",  type: "narrative",   slideCount: 1 },
  { id: "cibil_report",          roman: "II-b",  title: "CIBIL Report Summary",                            short: "CIBIL",           type: "narrative",   slideCount: 1 },
  { id: "net_worth_income",      roman: "II-c",  title: "Net Worth and Sources of Income",                  short: "Net Worth",        type: "narrative",   slideCount: 1 },
  { id: "investment_structure",  roman: "III",   title: "Proposed Investment Structure",                   short: "Investment",      type: "narrative",   slideCount: 1 },
  { id: "rehbar_funding_history",roman: "IV",    title: "Rehbar Funding History",                          short: "Funding History", type: "narrative",   slideCount: 1 },
  { id: "historical_financial",  roman: "V",     title: "Historical Financial Analysis",                   short: "Financials",      type: "financials",  slideCount: 4 },
  { id: "historical_pl_obs",    roman: "V-e",   title: "P&L Statement – Observations",                    short: "P&L Obs",         type: "narrative",   slideCount: 1 },
  { id: "historical_bs_obs",    roman: "V-f",   title: "Balance Sheet – Observations",                    short: "BS Obs",          type: "narrative",   slideCount: 1 },
  { id: "projections",           roman: "VI",    title: "Projections & Estimates",                         short: "Projections",     type: "narrative",   slideCount: 1 },
  { id: "key_ratios",            roman: "VII",   title: "Key Financial Ratios",                            short: "Key Ratios",      type: "ratios",      slideCount: 9 },
  { id: "cash_flow",             roman: "VIII-a", title: "Cash Flow Statement",                             short: "Cash Flow",       type: "narrative",   slideCount: 1 },
  { id: "cash_flow_obs",         roman: "VIII-b", title: "Cash Flow – Observations",                        short: "CF Obs",          type: "narrative",   slideCount: 1 },
  { id: "due_diligence",         roman: "IX",    title: "Due Diligence Excerpts",                          short: "Due Diligence",   type: "narrative",   slideCount: 1 },
  { id: "risk_assessment",       roman: "X",     title: "Risk Assessment & Mitigation",                    short: "Risk Matrix",     type: "risk",        slideCount: 4 },
  { id: "visit_reference",        roman: "XI",    title: "Visit Report",                                    short: "Visit Report",    type: "narrative",   slideCount: 1 },
  { id: "exec_recommendation",   roman: "XII",   title: "Executive Team Recommendation",                   short: "Exec Rec",        type: "narrative",   slideCount: 1 },
  { id: "product_specifics",     roman: "XIII",  title: "Specific Product Requirements",                   short: "Product Reqs",    type: "narrative",   slideCount: 1 },
  { id: "triangulation_analysis",roman: "XIV",   title: "Triangulation Analysis",                          short: "Triangulation",   type: "narrative",   slideCount: 1 },
  // XIV and XV are not in IC_SECTIONS but we add them here
  { id: "conditions_precedent",  roman: "XV",    title: "Conditions Precedent",                            short: "CP",              type: "conditions",  slideCount: 1 },
  { id: "swot_analysis",         roman: "XVI",   title: "SWOT Analysis",                                   short: "SWOT",            type: "swot",        slideCount: 1 },
];

// ── Page number calculator ─────────────────────────────────────────────────────
// Pre-section slides: Cover(1), ToC(2), Deal Summary(3), Company Profile(4), Directors(5)
// Sections start at page 6
const PRE_SECTION_PAGES = 5;

function calcPageStart(sectionIndex: number): number {
  let page = PRE_SECTION_PAGES + 1; // sections start at 6
  for (let i = 0; i < sectionIndex; i++) {
    page += DECK_SECTIONS[i].slideCount;
  }
  return page;
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  white:   "#FFFFFF",
  muted:   "#888888",
  altRow:  "#F5F5F0",
  bg:      "#F5F5F0",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

// ── Main component ────────────────────────────────────────────────────────────
export function ICDeckTab({
  cc,
  extracted,
  ratios,
  ic,
  company,
  directors,
  cibilData,
  onGenerateSection,
  generatingSection,
}: ICDeckTabProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [exportingWord, setExportingWord] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const mainRef = useRef<HTMLDivElement | null>(null);

  const handleExportWord = useCallback(async () => {
    setExportingWord(true);
    try {
      // Fetch visit report photos and convert to ArrayBuffers for Word embed
      let photoBlobs: { name: string; data: ArrayBuffer; mimeType: string }[] = [];
      try {
        const { data: attachments } = await supabase
          .from("visit_report_attachments" as never)
          .select("file_name,file_path,mime_type,category")
          .eq("case_id", cc.id)
          .eq("category", "photo");

        if (attachments?.length) {
          const blobs = await Promise.all(
            (attachments as { file_name: string; file_path: string; mime_type: string }[]).map(async att => {
              try {
                const { data: sd } = await supabase.storage.from("case-files").createSignedUrl(att.file_path, 300);
                if (!sd?.signedUrl) return null;
                const res = await fetch(sd.signedUrl);
                if (!res.ok) return null;
                return { name: att.file_name, data: await res.arrayBuffer(), mimeType: att.mime_type };
              } catch { return null; }
            })
          );
          photoBlobs = blobs.filter(Boolean) as typeof photoBlobs;
        }
      } catch { /* photos are supplementary — continue without */ }

      await generateIcDeckWord({ cc, ic, extracted, ratios, company, directors, photoBlobs });
    } finally {
      setExportingWord(false);
    }
  }, [cc, ic, extracted, ratios, company, directors]);

  // ── IntersectionObserver to track active section ───────────────────────────
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    DECK_SECTIONS.forEach((sec) => {
      const el = sectionRefs.current[sec.id];
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(sec.id);
        },
        { threshold: 0.15 },
      );
      observer.observe(el);
      observers.push(observer);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  function scrollToSection(id: string) {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Section templates helper ──────────────────────────────────────────────
  const tpl = ic.section_templates ?? {};

  // ── TOC sections list ─────────────────────────────────────────────────────
  const tocSections = DECK_SECTIONS.map((sec, idx) => ({
    roman: sec.roman,
    title: sec.title,
    slideNum: calcPageStart(idx),
    status: (
      sec.id === "risk_assessment"
        ? (tpl["risk_assessment"]?.categories ? "generated" : "empty")
        : (tpl[sec.id] ? "generated" : "empty")
    ) as "generated" | "empty" | "na",
  }));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 0,
        fontFamily: DS.bodyFont,
        minHeight: "100vh",
      }}
    >
      {/* ── Left Nav Sidebar ─────────────────────────────────────────────── */}
      <nav
        style={{
          width: 180,
          background: DS.navy,
          position: "sticky",
          top: 0,
          maxHeight: "100vh",
          overflowY: "auto",
          flexShrink: 0,
          paddingBottom: 24,
        }}
      >
        <div style={{ padding: "16px 14px 10px" }}>
          <div
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: DS.gold,
              marginBottom: 10,
            }}
          >
            IC Deck
          </div>
          <button
            onClick={handleExportWord}
            disabled={exportingWord}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: "100%",
              background: exportingWord ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: 4,
              padding: "6px 10px",
              fontSize: 10,
              fontWeight: 600,
              color: DS.white,
              cursor: exportingWord ? "wait" : "pointer",
              fontFamily: DS.bodyFont,
              letterSpacing: "0.02em",
            }}
          >
            <span style={{ fontSize: 12 }}>{exportingWord ? "⏳" : "⬇"}</span>
            {exportingWord ? "Exporting…" : "Download Word"}
          </button>
        </div>

        {/* Pre-section items */}
        {[
          { id: "_cover",   label: "Cover" },
          { id: "_toc",     label: "Table of Content" },
          { id: "_deal",    label: "Deal Summary" },
          { id: "_company", label: "Company Profile" },
          { id: "_dirs",    label: "Directors" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => sectionRefs.current[item.id]?.scrollIntoView({ behavior: "smooth", block: "start" })}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "none",
              padding: "6px 14px",
              fontSize: 10,
              color: "rgba(255,255,255,0.55)",
              cursor: "pointer",
              fontFamily: DS.bodyFont,
              lineHeight: 1.4,
            }}
          >
            {item.label}
          </button>
        ))}

        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.1)",
            margin: "8px 14px",
          }}
        />

        {/* Section items */}
        {DECK_SECTIONS.map((sec) => {
          const isActive = activeSection === sec.id;
          const hasContent = !!tpl[sec.id];
          return (
            <button
              key={sec.id}
              onClick={() => scrollToSection(sec.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                textAlign: "left",
                background: isActive ? "rgba(245,197,24,0.12)" : "transparent",
                border: "none",
                borderLeft: isActive ? `2px solid ${DS.gold}` : "2px solid transparent",
                padding: "6px 14px",
                fontSize: 10,
                color: isActive ? DS.white : "rgba(255,255,255,0.55)",
                cursor: "pointer",
                fontFamily: DS.bodyFont,
                lineHeight: 1.4,
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {/* Status dot */}
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: hasContent ? "#4ADE80" : "rgba(255,255,255,0.2)",
                  border: hasContent ? "none" : "1px solid rgba(255,255,255,0.3)",
                }}
              />
              <span style={{ flexShrink: 0, color: DS.gold, fontWeight: 600, fontSize: 9 }}>
                {sec.roman}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {sec.short}
              </span>
            </button>
          );
        })}

        {/* Annexures + Closing */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "8px 14px" }} />
        {[
          { id: "_annexures",   label: "Annexures" },
          { id: "_site_pics",   label: "Site Photos" },
          { id: "_data_viz",    label: "Data Visualization" },
          { id: "_ic_approval", label: "IC Conditions" },
          { id: "_policies",    label: "Policies" },
          { id: "_closing",     label: "Closing" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => sectionRefs.current[item.id]?.scrollIntoView({ behavior: "smooth", block: "start" })}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "none",
              padding: "6px 14px",
              fontSize: 10,
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
              fontFamily: DS.bodyFont,
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div
        ref={mainRef}
        style={{
          flex: 1,
          padding: 24,
          background: DS.bg,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* 1. Cover */}
        <div id="deck-section-cover" ref={(el) => { sectionRefs.current["_cover"] = el; }} style={{ width: "100%", maxWidth: 960 }}>
          <CoverCard
            clientName={cc.client_name}
            productType={cc.product_type ?? "Credit Facility"}
            dealAmount={cc.deal_amount != null ? Number(cc.deal_amount) : null}
          />
        </div>

        {/* 2. ToC */}
        <div ref={(el) => { sectionRefs.current["_toc"] = el; }} style={{ width: "100%", maxWidth: 960 }}>
          <TocCard sections={tocSections} />
        </div>

        {/* 3. Deal Summary */}
        <div ref={(el) => { sectionRefs.current["_deal"] = el; }} style={{ width: "100%", maxWidth: 960 }}>
          <DealSummaryCard cc={{
            client_name:         cc.client_name,
            case_code:           cc.case_code ?? null,
            product_type:        cc.product_type ?? null,
            deal_amount:         cc.deal_amount != null ? Number(cc.deal_amount) : null,
            tenure_months:       cc.tenure_months ?? null,
            expected_irr:        cc.expected_irr != null ? Number(cc.expected_irr) : null,
            end_use:             cc.end_use ?? null,
            collateral_summary:  cc.collateral_summary ?? null,
            industry:            cc.industry ?? null,
            legal_constitution:  cc.legal_constitution ?? null,
          }} />
        </div>

        {/* 4. Company Profile */}
        <div ref={(el) => { sectionRefs.current["_company"] = el; }} style={{ width: "100%", maxWidth: 960 }}>
          <CompanyProfileCard
            cc={{
              client_name:        cc.client_name,
              year_established:   cc.year_established != null ? String(cc.year_established) : null,
              legal_constitution: cc.legal_constitution ?? null,
              industry:           cc.industry ?? null,
            }}
            company={company}
          />
        </div>

        {/* 5. Directors */}
        <div ref={(el) => { sectionRefs.current["_dirs"] = el; }} style={{ width: "100%", maxWidth: 960 }}>
          <DirectorsCard directors={directors} />
        </div>

        {/* ── Sections I–XV ───────────────────────────────────────────────── */}
        {DECK_SECTIONS.map((sec, idx) => {
          const pageStart = calcPageStart(idx);
          const template = tpl[sec.id];
          const isGenerating = generatingSection === sec.id;
          const isNarrative = sec.type === "narrative";

          return (
            <div
              key={sec.id}
              id={`deck-section-${sec.id}`}
              ref={(el) => { sectionRefs.current[sec.id] = el; }}
              style={{ width: "100%", maxWidth: 960 }}
            >
              {/* Narrative sections */}
              {isNarrative && sec.id === "cibil_report" && (
                <CibilCard cibilData={cibilData} pageNum={pageStart} />
              )}
              {isNarrative && sec.id === "net_worth_income" && (
                <NetWorthCard
                  cibilData={cibilData}
                  extracted={extracted}
                  provisional={ic.provisional}
                  pageNum={pageStart}
                />
              )}
              {isNarrative && sec.id === "investment_structure" && (
                <div>
                  <InvestmentStructureCard cc={cc} pageNum={pageStart} />
                </div>
              )}
              {isNarrative && sec.id === "rehbar_funding_history" && (
                <RehbarHistoryCard
                  history={ic.rehbar_history}
                  clientName={cc.client_name}
                  pageNum={pageStart}
                />
              )}
              {isNarrative && sec.id === "projections" && (
                <ProjectionsCard
                  extracted={extracted}
                  provisional={ic.provisional}
                  comment={ic.projections_comment}
                  pageNum={pageStart}
                />
              )}
              {isNarrative && sec.id === "cash_flow" && (
                <CashFlowCard
                  extracted={extracted}
                  pageNum={pageStart}
                />
              )}
              {isNarrative && sec.id === "visit_reference" && (
                <VisitReportCard
                  visitReport={ic.visit_report}
                  caseId={cc.id}
                  pageNum={pageStart}
                />
              )}
              {isNarrative && sec.id !== "investment_structure" && sec.id !== "rehbar_funding_history" && sec.id !== "projections" && sec.id !== "visit_reference" && sec.id !== "cash_flow" && sec.id !== "cibil_report" && sec.id !== "net_worth_income" && (
                <NarrativeCard
                  roman={sec.roman}
                  title={sec.title}
                  pageNum={pageStart}
                  template={template}
                  generating={isGenerating}
                  onGenerate={() => onGenerateSection(sec.id)}
                />
              )}

              {/* Section V – Historical Financials */}
              {sec.type === "financials" && (
                <HistoricalFinancialsCard
                  extracted={extracted}
                  pageNumStart={pageStart}
                  template={tpl["historical_financial"]}
                  generating={generatingSection === "historical_financial"}
                  onGenerate={() => onGenerateSection("historical_financial")}
                />
              )}

              {/* Section VII – Key Ratios */}
              {sec.type === "ratios" && (
                <KeyRatiosCard
                  ratios={ratios}
                  pageNumStart={pageStart}
                  template={tpl["key_ratios"]}
                  generating={generatingSection === "key_ratios"}
                  onGenerate={() => onGenerateSection("key_ratios")}
                />
              )}

              {/* Section X – Risk Matrix */}
              {sec.type === "risk" && (
                <RiskMatrixCard
                  risks={ic.risks ?? []}
                  riskTemplate={tpl["risk_assessment"]?.categories ? tpl["risk_assessment"] as unknown as RiskTemplate : null}
                  clientName={cc.client_name}
                  pageNum={pageStart}
                  generating={generatingSection === "risk_assessment"}
                  onGenerate={() => onGenerateSection("risk_assessment")}
                />
              )}

              {/* Section XIV – Conditions Precedent */}
              {sec.type === "conditions" && (
                <ConditionsPrecedentCard
                  conditions={ic.conditions_precedent ?? []}
                  pageNum={pageStart}
                />
              )}

              {/* Section XV – SWOT */}
              {sec.type === "swot" && (
                <SwotCard
                  swot={ic.swot}
                  pageNum={pageStart}
                />
              )}
            </div>
          );
        })}

        {/* ── Annexures Section ──────────────────────────────────────────── */}
        <div ref={(el) => { sectionRefs.current["_annexures"] = el; }} style={{ width: "100%", maxWidth: 960 }}>
          <AnnexuresCard clientName={cc.client_name} />
        </div>

        <div ref={(el) => { sectionRefs.current["_site_pics"] = el; }} style={{ width: "100%", maxWidth: 960 }}>
          <SiteVisitPicturesCard
            clientName={cc.client_name}
            pageNum={calcPageStart(DECK_SECTIONS.length) + 1}
            attachments={
              (ic.visit_report as Record<string, unknown> | undefined)?.attachments as
                Array<{ url?: string; caption?: string; label?: string }> | undefined
            }
          />
        </div>

        <div ref={(el) => { sectionRefs.current["_data_viz"] = el; }} style={{ width: "100%", maxWidth: 960 }}>
          <DataVisualizationCard clientName={cc.client_name} />
        </div>

        <div ref={(el) => { sectionRefs.current["_ic_approval"] = el; }} style={{ width: "100%", maxWidth: 960 }}>
          <ICApprovalConditionsCard
            pageNum={calcPageStart(DECK_SECTIONS.length) + 3}
            conditions={(ic as Record<string, unknown>).ic_approval_conditions as string | undefined}
          />
        </div>

        <div ref={(el) => { sectionRefs.current["_policies"] = el; }} style={{ width: "100%", maxWidth: 960 }}>
          <InvestmentPoliciesCard
            pageNum={calcPageStart(DECK_SECTIONS.length) + 4}
            caseId={cc.id}
            clientName={cc.client_name}
            caseCode={cc.case_code ?? null}
          />
        </div>

        {/* Closing card */}
        <div
          ref={(el) => { sectionRefs.current["_closing"] = el; }}
          style={{ width: "100%", maxWidth: 960 }}
        >
          <ClosingCard />
        </div>
      </div>
    </div>
  );
}

// ── Local helpers ─────────────────────────────────────────────────────────────

function fmtAmount(v: number): string {
  if (v >= 100) return `₹ ${(v / 100).toFixed(2)} Cr`;
  return `₹ ${v.toFixed(2)} L`;
}

// ── Section III inline card ───────────────────────────────────────────────────

function InvestmentStructureCard({ cc, pageNum }: { cc: CaseRow; pageNum: number }) {
  // Import is at top of file: SlideShell from "./deck/SlideShell"
  const rows: [string, string][] = [
    ["Product Type",       cc.product_type ?? "—"],
    ["Deal Amount",        cc.deal_amount != null ? fmtAmount(Number(cc.deal_amount)) : "—"],
    ["Tenure",             cc.tenure_months != null ? `${cc.tenure_months} months` : "—"],
    ["Expected IRR",       cc.expected_irr != null ? `${Number(cc.expected_irr)}%` : "—"],
    ["End Use",            cc.end_use ?? "—"],
    ["Collateral",         cc.collateral_summary ?? "—"],
    ["Legal Constitution", cc.legal_constitution ?? "—"],
  ];
  return (
    <InvShell pageNum={pageNum}>
      <div style={{ padding: "0 0 4px", fontFamily: "'Source Serif 4', Calibri, sans-serif" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {rows.map(([label, value], i) => (
              <tr
                key={label}
                style={{
                  borderBottom: "1px solid #E8E8E4",
                  background: i % 2 === 0 ? "#FFFFFF" : "#F5F5F0",
                }}
              >
                <td style={{ width: 200, padding: "9px 20px", fontSize: 11, color: "#888888", verticalAlign: "top" }}>
                  {label}
                </td>
                <td style={{ padding: "9px 20px", fontSize: 12, color: "#1C1C1E", lineHeight: 1.5 }}>
                  {value || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </InvShell>
  );
}

// Thin wrapper so we can use SlideShell (already imported at top)
function InvShell({ pageNum, children }: { pageNum: number; children: React.ReactNode }) {
  return (
    <SlideShell roman="III" title="Proposed Investment Structure" pageNum={pageNum}>
      {children}
    </SlideShell>
  );
}
