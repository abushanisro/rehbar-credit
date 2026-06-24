import { useState, useRef, useCallback, useEffect } from "react";
import { IC_SECTIONS } from "@/features/credit/domain";
import type { CaseRow, ExtractedRow, RatioRow } from "@/features/case/types";
import {
  ICSummaryPanel, ICHistoricalTables, ICProjectionsTable,
  ICRatioTable, ICClientProfile, ICInvestmentStructure,
  ICRehbarHistory, ICVisitReference, ICProductSpecifics,
} from "./ICComponents";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IcComment {
  id: string;
  section_id: string;
  text: string;
  author_email: string;
  created_at: string;
  resolved: boolean;
}

export interface IcNoteShape {
  sections?: Record<string, { markdown: string }>;
  risks?: { category: string; risk: string; mitigant: string; severity: string }[];
  conditions_precedent?: string[];
  swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  comments?: IcComment[];
  draft?: boolean;
  generated_at?: string;
}

// ── IC colour constants ───────────────────────────────────────────────────────

const IC = {
  navy:    "#0F1B2D",
  navy2:   "#162236",
  cream:   "#FAFAF6",
  gold:    "#8B6914",
  goldLt:  "#C4A04A",
  ink:     "#1C1C1E",
  rule:    "#D4C9B0",
  muted:   "#6B6152",
  pass:    "#1A4A2E",
  fail:    "#6B1A1A",
  caution: "#6B4B00",
  passBg:  "#EAF3EC",
  failBg:  "#F3EAEA",
  cautBg:  "#F5F0E4",
} as const;

// ── Inline markdown renderer ──────────────────────────────────────────────────

function inlineBold(s: string): React.ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return s;
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i} style={{ fontWeight: 700, color: IC.ink }}>{p.slice(2, -2)}</strong>
          : p
      )}
    </>
  );
}

function BulletMd({ text, skipTables = false }: { text: string; skipTables?: boolean }) {
  if (!text?.trim()) return null;
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const trim = lines[i].trim();

    if (trim.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (!skipTables) {
        const rows = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l));
        if (rows.length > 0) {
          const parse = (l: string) => l.split("|").slice(1, -1).map(c => c.trim());
          const [hdr, ...body] = rows;
          out.push(
            <div key={`tbl-${i}`} style={{ overflowX: "auto", margin: "10px 0", border: `1px solid ${IC.rule}`, borderRadius: 4 }}>
              <table style={{ fontSize: 10, borderCollapse: "collapse", minWidth: "100%", fontFamily: "'Source Serif 4', Georgia, serif" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${IC.rule}`, background: IC.navy }}>
                    {parse(hdr).map((h, hi) => (
                      <th key={hi} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 700, fontSize: 8, color: IC.goldLt, letterSpacing: "0.12em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: `1px solid ${IC.rule}`, background: ri % 2 === 1 ? "rgba(212,201,176,0.12)" : "transparent" }}>
                      {parse(row).map((cell, ci) => (
                        <td key={ci} style={{ padding: "5px 10px", color: cell === "—" || cell === "" ? IC.muted : IC.ink, whiteSpace: "nowrap", fontSize: 10 }}>
                          {cell === "—" || cell === "" ? "—" : inlineBold(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
      }
      continue;
    }

    if (/^[-*▸•]\s/.test(trim)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*▸•]\s/.test(lines[i].trim())) {
        bullets.push(lines[i].trim().replace(/^[-*▸•]\s+/, ""));
        i++;
      }
      out.push(
        <div key={`ul-${i}`} style={{ borderLeft: `3px solid ${IC.gold}`, paddingLeft: 14, margin: "10px 0" }}>
          {bullets.map((b, bi) => (
            <div key={bi} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 11.5, lineHeight: 1.65, fontFamily: "'Source Serif 4', Georgia, serif", color: IC.ink }}>
              <span style={{ color: IC.gold, flexShrink: 0, marginTop: 2, fontWeight: 700, fontSize: 9 }}>▸</span>
              <span>{inlineBold(b)}</span>
            </div>
          ))}
        </div>
      );
      continue;
    }

    if (/^\*\*[^*]+\*\*$/.test(trim)) {
      out.push(
        <div key={`sh-${i}`} style={{ fontSize: 8, fontWeight: 700, color: IC.gold, letterSpacing: "0.14em", textTransform: "uppercase", margin: "16px 0 5px", borderBottom: `1px solid ${IC.rule}`, paddingBottom: 3, fontFamily: "'Source Serif 4', Georgia, serif" }}>
          {trim.slice(2, -2)}
        </div>
      );
      i++;
      continue;
    }

    if (trim) {
      out.push(
        <p key={`p-${i}`} style={{ fontSize: 11.5, color: IC.ink, margin: "5px 0", lineHeight: 1.7, fontFamily: "'Source Serif 4', Georgia, serif" }}>
          {inlineBold(trim)}
        </p>
      );
    }
    i++;
  }

  return <div>{out}</div>;
}

// ── Section panel dispatcher ──────────────────────────────────────────────────

function SectionPanel({
  sectionId, cc, extracted, ratios,
}: {
  sectionId: string;
  cc: CaseRow;
  extracted: ExtractedRow[];
  ratios: RatioRow[];
}) {
  switch (sectionId) {
    case "executive_summary":      return <ICSummaryPanel cc={cc} ratios={ratios} />;
    case "historical_financial":   return <ICHistoricalTables extracted={extracted} />;
    case "projections":            return <ICProjectionsTable extracted={extracted} />;
    case "key_ratios":             return <ICRatioTable ratios={ratios} />;
    case "client_promoter":        return <ICClientProfile cc={cc} />;
    case "investment_structure":   return <ICInvestmentStructure cc={cc} />;
    case "rehbar_funding_history": return <ICRehbarHistory cc={cc} />;
    case "visit_reference":        return <ICVisitReference cc={cc} />;
    case "product_specifics":      return <ICProductSpecifics cc={cc} />;
    default:                       return null;
  }
}

// ── Comments sidebar ──────────────────────────────────────────────────────────

function CommentsPanel({
  ic,
  activeSection,
  newCommentText,
  onNewCommentChange,
  onAddComment,
  onResolveComment,
  onClose,
}: {
  ic: IcNoteShape;
  activeSection: string | null;
  newCommentText: string;
  onNewCommentChange: (v: string) => void;
  onAddComment: () => void;
  onResolveComment: (id: string) => void;
  onClose: () => void;
}) {
  const comments = ic.comments ?? [];
  const sections = IC_SECTIONS;
  const sectionsWithComments = sections.filter(s => comments.some(c => c.section_id === s.id && !c.resolved));
  const activeSectionLabel = sections.find(s => s.id === activeSection)?.short ?? activeSection ?? "";

  return (
    <div style={{ width: 240, flexShrink: 0, borderLeft: `1px solid ${IC.rule}`, display: "flex", flexDirection: "column", background: IC.cream }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${IC.rule}`, background: IC.navy }}>
        <span style={{ fontSize: 8, letterSpacing: "0.15em", color: IC.goldLt, textTransform: "uppercase", fontWeight: 700, fontFamily: "'Source Serif 4', Georgia, serif" }}>
          Analyst Notes
        </span>
        <button onClick={onClose} style={{ color: IC.goldLt, fontSize: 14, lineHeight: 1, cursor: "pointer", background: "none", border: "none" }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px", minHeight: 0 }}>
        {sectionsWithComments.length === 0 && !activeSection && (
          <div style={{ fontSize: 10, color: IC.muted, fontStyle: "italic", textAlign: "center", marginTop: 20, lineHeight: 1.6, fontFamily: "'Source Serif 4', Georgia, serif" }}>
            Click '+ NOTE' on any section<br />to add analyst annotations
          </div>
        )}
        {sectionsWithComments.map(s => (
          <div key={s.id} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 8, letterSpacing: "0.12em", color: IC.gold, textTransform: "uppercase", marginBottom: 6, fontWeight: 700, fontFamily: "'Source Serif 4', Georgia, serif" }}>
              {s.roman}. {s.short}
            </div>
            {comments.filter(c => c.section_id === s.id && !c.resolved).map(c => (
              <div key={c.id} style={{ borderLeft: `2px solid ${IC.gold}`, background: "rgba(139,105,20,0.06)", padding: "6px 8px", marginBottom: 8, borderRadius: "0 3px 3px 0" }}>
                <div style={{ fontSize: 10.5, color: IC.ink, lineHeight: 1.5, fontFamily: "'Source Serif 4', Georgia, serif" }}>{c.text}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 5 }}>
                  <span style={{ fontSize: 8, color: IC.muted }}>
                    {c.author_email.split("@")[0]} · {new Date(c.created_at).toLocaleDateString("en-IN")}
                  </span>
                  <button
                    onClick={() => onResolveComment(c.id)}
                    style={{ fontSize: 8, color: IC.pass, cursor: "pointer", background: "none", border: "none", fontFamily: "inherit" }}
                  >
                    ✓ Resolve
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {activeSection && (
        <div style={{ borderTop: `1px solid ${IC.rule}`, padding: "10px 12px", background: "rgba(212,201,176,0.15)" }}>
          <div style={{ fontSize: 8, letterSpacing: "0.12em", color: IC.gold, textTransform: "uppercase", fontWeight: 700, marginBottom: 5, fontFamily: "'Source Serif 4', Georgia, serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Note on: {activeSectionLabel}
          </div>
          <textarea
            rows={3}
            value={newCommentText}
            onChange={e => onNewCommentChange(e.target.value)}
            placeholder="Type analyst note…"
            style={{ width: "100%", background: IC.cream, border: `1px solid ${IC.rule}`, padding: "6px 8px", fontSize: 10, color: IC.ink, resize: "none", outline: "none", fontFamily: "'Source Serif 4', Georgia, serif", borderRadius: 3, boxSizing: "border-box" }}
          />
          <button
            onClick={onAddComment}
            disabled={!newCommentText.trim()}
            style={{
              width: "100%", marginTop: 5, fontSize: 8, letterSpacing: "0.12em", border: `1px solid ${IC.gold}`, color: IC.gold,
              padding: "6px", cursor: "pointer", background: "transparent", fontFamily: "inherit", textTransform: "uppercase",
              opacity: newCommentText.trim() ? 1 : 0.4, transition: "all 0.15s", borderRadius: 3,
            }}
          >
            [ADD NOTE]
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main document component ───────────────────────────────────────────────────

export function ICNoteDocument({
  cc,
  extracted,
  ratios,
  ic,
  userEmail,
  busy,
  onGenerate,
  onPatchSection,
  onAddComment,
  onResolveComment,
}: {
  cc: CaseRow;
  extracted: ExtractedRow[];
  ratios: RatioRow[];
  ic: IcNoteShape;
  userEmail: string;
  busy?: boolean;
  onGenerate: (notes?: string) => void;
  onPatchSection: (sectionId: string, markdown: string) => Promise<void>;
  onAddComment: (sectionId: string, text: string) => Promise<void>;
  onResolveComment: (commentId: string) => Promise<void>;
}) {
  const [editingSection, setEditingSection]             = useState<string | null>(null);
  const [draftText, setDraftText]                       = useState("");
  const [showComments, setShowComments]                 = useState(false);
  const [activeCommentSection, setActiveCommentSection] = useState<string | null>(null);
  const [newCommentText, setNewCommentText]             = useState("");
  const [showReanalyse, setShowReanalyse]               = useState(false);
  const [reanalyseNotes, setReanalyseNotes]             = useState("");
  const [activeNavSection, setActiveNavSection]         = useState<string>(IC_SECTIONS[0]?.id ?? "");
  const saveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs    = useRef<Record<string, HTMLDivElement | null>>({});
  const contentScrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToSection = useCallback((id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveNavSection(id);
  }, []);

  // Track active section via scroll
  useEffect(() => {
    const el = contentScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      for (const s of [...IC_SECTIONS].reverse()) {
        const ref = sectionRefs.current[s.id];
        if (ref && ref.offsetTop - el.scrollTop <= 120) {
          setActiveNavSection(s.id);
          return;
        }
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ic.sections]);

  const activeCommentCount = (sectionId: string) =>
    (ic.comments ?? []).filter(c => c.section_id === sectionId && !c.resolved).length;

  const totalComments = (ic.comments ?? []).filter(c => !c.resolved).length;

  const startEdit = (id: string) => {
    setEditingSection(id);
    setDraftText(ic.sections?.[id]?.markdown ?? "");
  };

  const handleTextChange = (id: string, text: string) => {
    setDraftText(text);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => onPatchSection(id, text), 1200);
  };

  const endEdit = (id: string) => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    onPatchSection(id, draftText);
    setEditingSection(null);
  };

  const handleAddComment = async () => {
    if (!activeCommentSection || !newCommentText.trim()) return;
    await onAddComment(activeCommentSection, newCommentText.trim());
    setNewCommentText("");
  };

  const handleSectionNoteClick = (sectionId: string) => {
    setActiveCommentSection(sectionId);
    setShowComments(true);
  };

  const genDate = ic.generated_at
    ? new Date(ic.generated_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  // ── No IC note state ──────────────────────────────────────────────────────

  if (!ic.sections) {
    return (
      <div className="ic-document" style={{ background: IC.cream, border: `1px solid ${IC.rule}`, minHeight: "70vh", display: "flex", flexDirection: "column" }}>
        {/* Letterhead */}
        <div style={{ background: IC.navy, padding: "18px 32px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 11, fontWeight: 700, color: IC.goldLt, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 2 }}>
              Rehbar Financial Services
            </div>
            <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 9, color: "rgba(250,250,246,0.5)", letterSpacing: "0.1em" }}>
              Investment Committee · Credit Appraisal Note
            </div>
          </div>
          <div style={{ fontSize: 7.5, color: "rgba(196,160,74,0.6)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            CONFIDENTIAL · DRAFT
          </div>
        </div>

        {/* Empty state body */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 32px" }}>
          <div style={{ maxWidth: 480, textAlign: "center" }}>
            <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, fontWeight: 700, color: IC.navy, marginBottom: 10 }}>
              Generate IC Appraisal Note
            </div>
            <div style={{ fontSize: 12, color: IC.muted, lineHeight: 1.7, fontFamily: "'Source Serif 4', Georgia, serif", marginBottom: 28 }}>
              {busy
                ? "Claude is drafting all 12 sections with per-section RAG retrieval. This takes 60–90 seconds."
                : "Run ratio analysis first, then generate the 30-section IC appraisal note with RAG-enriched content."}
            </div>

            {!busy && (
              <>
                <div style={{ textAlign: "left", marginBottom: 18 }}>
                  <div style={{ fontSize: 8, letterSpacing: "0.14em", color: IC.gold, textTransform: "uppercase", fontWeight: 700, marginBottom: 6, fontFamily: "'Source Serif 4', Georgia, serif" }}>
                    Analyst context (optional)
                  </div>
                  <textarea
                    rows={3}
                    value={reanalyseNotes}
                    onChange={e => setReanalyseNotes(e.target.value)}
                    placeholder="e.g. Focus on banking gap risk. Promoter confirmed low balance due to group routing. IRR target 18%. Waive projections per SOP."
                    style={{ width: "100%", background: IC.cream, border: `1px solid ${IC.rule}`, padding: "8px 12px", fontSize: 11, color: IC.ink, resize: "none", outline: "none", fontFamily: "'Source Serif 4', Georgia, serif", borderRadius: 3, boxSizing: "border-box" }}
                  />
                </div>
                <button
                  onClick={() => onGenerate(reanalyseNotes.trim() || undefined)}
                  style={{ background: IC.navy, color: IC.cream, padding: "12px 32px", fontSize: 10, letterSpacing: "0.14em", fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Source Serif 4', Georgia, serif", textTransform: "uppercase", borderRadius: 3 }}
                >
                  Generate 12-Section IC Note →
                </button>
              </>
            )}

            {busy && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: IC.gold, animation: "pulse 1.4s ease-in-out infinite" }} />
                <span style={{ fontSize: 10, color: IC.muted, fontFamily: "'Source Serif 4', Georgia, serif", letterSpacing: "0.06em" }}>
                  Generating — please wait…
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Document layout ───────────────────────────────────────────────────────

  const hasDataPanel = (id: string) => [
    "executive_summary","historical_financial","projections","key_ratios",
    "client_promoter","investment_structure","rehbar_funding_history",
    "visit_reference","product_specifics",
  ].includes(id);

  return (
    <div
      className="ic-document"
      style={{ background: IC.cream, border: `1px solid ${IC.rule}`, display: "flex", flexDirection: "column", minHeight: "80vh" }}
    >

      {/* ── Letterhead ──────────────────────────────────────────────────────── */}
      <div style={{ background: IC.navy, padding: "0 0 0 0", borderBottom: `3px solid ${IC.gold}` }}>
        {/* Top bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "16px 28px 12px" }}>
          <div>
            <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 13, fontWeight: 700, color: IC.goldLt, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 3 }}>
              Rehbar Financial Services
            </div>
            <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontStyle: "italic", fontSize: 11, color: "rgba(250,250,246,0.55)", letterSpacing: "0.06em" }}>
              Investment Committee Credit Appraisal Note
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 7.5, color: IC.goldLt, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 3, opacity: 0.8 }}>
              CONFIDENTIAL · {ic.draft !== false ? "DRAFT" : "FINAL"}
            </div>
            {genDate && (
              <div style={{ fontSize: 8, color: "rgba(250,250,246,0.35)", fontFamily: "'Source Serif 4', Georgia, serif" }}>
                {genDate}
              </div>
            )}
          </div>
        </div>

        {/* Case meta strip */}
        <div style={{ background: "rgba(255,255,255,0.04)", borderTop: `1px solid rgba(212,201,176,0.15)`, padding: "8px 28px", display: "flex", flexWrap: "wrap", gap: "16px 28px" }}>
          {([
            ["CLIENT",      cc.client_name],
            ["CASE REF",    cc.case_code ?? "—"],
            ["PRODUCT",     cc.product_type?.replace(/_/g, " ").toUpperCase() ?? "—"],
            ["AMOUNT",      cc.deal_amount ? `₹${cc.deal_amount} Cr` : "—"],
            ["TENURE",      cc.tenure_months ? `${cc.tenure_months}M` : "—"],
            ["IRR",         cc.expected_irr ? `${cc.expected_irr}%` : "—"],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label}>
              <div style={{ fontSize: 7, letterSpacing: "0.18em", color: "rgba(196,160,74,0.6)", textTransform: "uppercase", marginBottom: 2, fontFamily: "'Source Serif 4', Georgia, serif" }}>{label}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: IC.cream, fontFamily: "'Source Serif 4', Georgia, serif", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 28px", borderTop: `1px solid rgba(212,201,176,0.1)` }}>
          <button
            onClick={() => setShowComments(v => !v)}
            style={{
              fontSize: 8, letterSpacing: "0.12em", border: `1px solid ${showComments ? IC.goldLt : "rgba(212,201,176,0.25)"}`,
              padding: "4px 10px", cursor: "pointer", color: showComments ? IC.goldLt : "rgba(250,250,246,0.45)",
              background: showComments ? "rgba(196,160,74,0.1)" : "transparent", fontFamily: "inherit", textTransform: "uppercase", borderRadius: 3,
            }}
          >
            💬{totalComments > 0 ? ` ${totalComments}` : ""} Notes
          </button>
          <button
            onClick={() => { setShowReanalyse(v => !v); setReanalyseNotes(""); }}
            disabled={busy}
            style={{
              fontSize: 8, letterSpacing: "0.12em", border: "1px solid rgba(212,201,176,0.25)", padding: "4px 10px", cursor: "pointer",
              color: "rgba(250,250,246,0.45)", background: "transparent", fontFamily: "inherit", textTransform: "uppercase", borderRadius: 3,
              opacity: busy ? 0.4 : 1,
            }}
          >
            ↻ Re-analyse
          </button>
        </div>

        {/* Re-analyse panel */}
        {showReanalyse && (
          <div style={{ background: "rgba(139,105,20,0.12)", borderTop: `1px solid rgba(139,105,20,0.25)`, padding: "14px 28px" }}>
            <div style={{ fontSize: 8, letterSpacing: "0.14em", color: IC.goldLt, textTransform: "uppercase", fontWeight: 700, marginBottom: 6, fontFamily: "'Source Serif 4', Georgia, serif" }}>
              Analyst notes for regeneration
            </div>
            {!busy ? (
              <>
                <textarea
                  rows={2}
                  value={reanalyseNotes}
                  onChange={e => setReanalyseNotes(e.target.value)}
                  placeholder="e.g. Banking gap explained by group routing — add as mitigant. Strengthen Section X. Confirm IRR at 18%."
                  style={{ width: "100%", background: "rgba(250,250,246,0.08)", border: `1px solid rgba(196,160,74,0.35)`, padding: "7px 10px", fontSize: 10.5, color: IC.cream, resize: "none", outline: "none", fontFamily: "'Source Serif 4', Georgia, serif", borderRadius: 3, boxSizing: "border-box", marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => { setShowReanalyse(false); onGenerate(reanalyseNotes.trim() || undefined); }}
                    style={{ background: IC.gold, color: IC.cream, padding: "7px 18px", fontSize: 9, letterSpacing: "0.12em", border: "none", cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase", borderRadius: 3 }}
                  >
                    [Regenerate IC Note →]
                  </button>
                  <button
                    onClick={() => setShowReanalyse(false)}
                    style={{ fontSize: 9, letterSpacing: "0.1em", border: "1px solid rgba(212,201,176,0.25)", padding: "7px 14px", color: "rgba(250,250,246,0.5)", background: "transparent", cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase", borderRadius: 3 }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 9, color: IC.goldLt, letterSpacing: "0.08em", fontFamily: "'Source Serif 4', Georgia, serif" }}>
                Regenerating — Claude is drafting all 12 sections (60–90s)…
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AI draft banner ──────────────────────────────────────────────────── */}
      <div style={{ background: "rgba(107,75,0,0.07)", borderBottom: `1px solid rgba(139,105,20,0.2)`, padding: "5px 28px" }}>
        <div style={{ fontSize: 8.5, letterSpacing: "0.1em", color: IC.caution, fontFamily: "'Source Serif 4', Georgia, serif", fontStyle: "italic" }}>
          ⚠ AI-Generated Draft — Analyst review and approval required before circulation to IC members
        </div>
      </div>

      {/* ── Body: nav sidebar + document content + comments ─────────────────── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* Left nav sidebar */}
        <div style={{ width: 188, flexShrink: 0, background: IC.navy, overflowY: "auto", borderRight: `1px solid rgba(212,201,176,0.12)` }}>
          <div style={{ padding: "14px 0 8px" }}>
            <div style={{ fontSize: 7, letterSpacing: "0.18em", color: "rgba(196,160,74,0.45)", textTransform: "uppercase", fontWeight: 700, padding: "0 14px 8px", fontFamily: "'Source Serif 4', Georgia, serif", borderBottom: `1px solid rgba(212,201,176,0.1)`, marginBottom: 4 }}>
              Sections
            </div>
            {IC_SECTIONS.map(s => {
              const isActive = activeNavSection === s.id;
              const hasMd = !!(ic.sections?.[s.id]?.markdown);
              const commentCt = activeCommentCount(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => scrollToSection(s.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "7px 14px", cursor: "pointer", background: isActive ? "rgba(139,105,20,0.18)" : "transparent",
                    borderLeft: `3px solid ${isActive ? IC.gold : "transparent"}`,
                    border: "none", borderRight: "none", borderTop: "none", borderBottom: "none",
                    borderLeftWidth: 3, borderLeftStyle: "solid", borderLeftColor: isActive ? IC.gold : "transparent",
                    transition: "all 0.15s", textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 9, fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 700, color: isActive ? IC.goldLt : "rgba(212,201,176,0.4)", width: 16, flexShrink: 0 }}>
                    {s.roman}
                  </span>
                  <span style={{ fontSize: 9.5, color: isActive ? IC.cream : "rgba(250,250,246,0.45)", fontFamily: "'Source Serif 4', Georgia, serif", flex: 1, lineHeight: 1.3 }}>
                    {s.short}
                  </span>
                  <span style={{ display: "flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
                    {hasMd && <span style={{ width: 5, height: 5, borderRadius: "50%", background: isActive ? IC.gold : "rgba(139,105,20,0.5)" }} />}
                    {commentCt > 0 && <span style={{ fontSize: 7.5, color: IC.goldLt, fontFamily: "inherit" }}>{commentCt}</span>}
                  </span>
                </button>
              );
            })}
            <div style={{ height: 1, background: "rgba(212,201,176,0.1)", margin: "8px 0" }} />
            {[["R", "Risk Register"], ["CP", "Conditions Precedent"], ["SW", "SWOT Analysis"]].map(([abbr, label]) => (
              <div key={abbr} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px" }}>
                <span style={{ fontSize: 8, fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 700, color: "rgba(212,201,176,0.3)", width: 16 }}>{abbr}</span>
                <span style={{ fontSize: 9, color: "rgba(250,250,246,0.3)", fontFamily: "'Source Serif 4', Georgia, serif" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Document content */}
        <div ref={contentScrollRef} style={{ flex: 1, overflowY: "auto", background: IC.cream, position: "relative" }}>

          {/* Regeneration overlay */}
          {busy && (
            <div style={{
              position: "sticky", top: 0, left: 0, right: 0, zIndex: 20,
              background: `rgba(15,27,45,0.92)`, backdropFilter: "blur(3px)",
              padding: "14px 28px", display: "flex", alignItems: "center", gap: 14,
              borderBottom: `1px solid ${IC.gold}`,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: IC.gold, flexShrink: 0, animation: "pulse 1.4s ease-in-out infinite" }} />
              <div>
                <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 12, fontWeight: 700, color: IC.goldLt, letterSpacing: "0.06em" }}>
                  Regenerating IC Note…
                </div>
                <div style={{ fontSize: 9.5, color: "rgba(250,250,246,0.5)", fontFamily: "'Source Serif 4', Georgia, serif", marginTop: 2 }}>
                  Claude is drafting all 12 sections with RAG context — 60–90 seconds. The document below will update when complete.
                </div>
              </div>
            </div>
          )}

          {/* 12 Sections */}
          {IC_SECTIONS.map((s, idx) => {
            const md = ic.sections?.[s.id]?.markdown ?? "";
            const commentCount = activeCommentCount(s.id);
            const hasPanel = hasDataPanel(s.id);

            return (
              <div
                key={s.id}
                ref={el => { sectionRefs.current[s.id] = el; }}
                id={`sec-${s.id}`}
                style={{
                  padding: "32px 36px 28px",
                  borderBottom: `1px solid ${IC.rule}`,
                  background: IC.cream,
                }}
              >
                {/* Section header */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 14, flex: 1 }}>
                    {/* Gold roman numeral */}
                    <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 900, color: IC.gold, lineHeight: 1, flexShrink: 0, marginTop: -4 }}>
                      {s.roman}
                    </div>
                    <div style={{ flex: 1, borderLeft: `2px solid ${IC.navy}`, paddingLeft: 12 }}>
                      <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 13, fontWeight: 700, color: IC.navy, letterSpacing: "0.02em", marginBottom: 2 }}>
                        {s.title.toUpperCase()}
                      </div>
                      <div style={{ fontSize: 9, color: IC.muted, fontFamily: "'Source Serif 4', Georgia, serif", lineHeight: 1.5, maxWidth: 500 }}>
                        {s.desc}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 4, flexShrink: 0, marginLeft: 12 }}>
                    {commentCount > 0 && (
                      <button
                        onClick={() => handleSectionNoteClick(s.id)}
                        style={{ fontSize: 8, color: IC.gold, border: `1px solid ${IC.gold}`, padding: "3px 7px", cursor: "pointer", background: "rgba(139,105,20,0.06)", borderRadius: 3, fontFamily: "inherit" }}
                      >
                        💬 {commentCount}
                      </button>
                    )}
                    <button
                      onClick={() => handleSectionNoteClick(s.id)}
                      style={{ fontSize: 7.5, letterSpacing: "0.1em", color: IC.muted, border: `1px solid ${IC.rule}`, padding: "3px 8px", cursor: "pointer", background: "transparent", borderRadius: 3, fontFamily: "inherit", textTransform: "uppercase" }}
                    >
                      + Note
                    </button>
                    <button
                      onClick={() => startEdit(s.id)}
                      style={{ fontSize: 7.5, letterSpacing: "0.1em", color: IC.muted, border: `1px solid ${IC.rule}`, padding: "3px 8px", cursor: "pointer", background: "transparent", borderRadius: 3, fontFamily: "inherit", textTransform: "uppercase" }}
                    >
                      ✎ Edit
                    </button>
                  </div>
                </div>

                {/* Horizontal rule under header */}
                <div style={{ height: 1, background: IC.rule, marginBottom: 18 }} />

                {/* Pre-built data panel */}
                {hasPanel && (
                  <div style={{ marginBottom: 16 }}>
                    <SectionPanel sectionId={s.id} cc={cc} extracted={extracted} ratios={ratios} />
                  </div>
                )}

                {/* Analytical observations */}
                {editingSection === s.id ? (
                  <textarea
                    autoFocus
                    value={draftText}
                    onChange={e => handleTextChange(s.id, e.target.value)}
                    onBlur={() => endEdit(s.id)}
                    style={{ width: "100%", minHeight: 120, background: "rgba(15,27,45,0.04)", border: `1px solid ${IC.gold}`, padding: "10px 12px", fontSize: 11, color: IC.ink, resize: "vertical", outline: "none", fontFamily: "'Source Serif 4', Georgia, serif", borderRadius: 3, boxSizing: "border-box" }}
                  />
                ) : (
                  <div
                    onClick={() => startEdit(s.id)}
                    style={{ cursor: "pointer", padding: "4px 6px", borderRadius: 3, transition: "background 0.15s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(139,105,20,0.04)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {md ? (
                      <BulletMd text={md} skipTables={hasPanel} />
                    ) : (
                      <div style={{ fontSize: 10, color: IC.muted, fontStyle: "italic", padding: "8px 0 4px 14px", borderLeft: `2px dashed ${IC.rule}`, fontFamily: "'Source Serif 4', Georgia, serif" }}>
                        No AI analysis generated — click to add manually, or use Re-analyse to regenerate.
                      </div>
                    )}
                  </div>
                )}

                {/* Section footer rule */}
                {idx < IC_SECTIONS.length - 1 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, opacity: 0.35 }}>
                    <div style={{ flex: 1, height: 1, background: IC.rule }} />
                    <div style={{ fontSize: 7.5, letterSpacing: "0.1em", color: IC.muted, fontFamily: "'Source Serif 4', Georgia, serif" }}>
                      {String(idx + 1).padStart(2, "0")}
                    </div>
                    <div style={{ flex: 1, height: 1, background: IC.rule }} />
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Risk Register ───────────────────────────────────────────────── */}
          {ic.risks && ic.risks.length > 0 && (
            <div style={{ padding: "32px 36px 28px", borderBottom: `1px solid ${IC.rule}` }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 16 }}>
                <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 900, color: IC.gold, lineHeight: 1 }}>R</div>
                <div style={{ borderLeft: `2px solid ${IC.navy}`, paddingLeft: 12 }}>
                  <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 13, fontWeight: 700, color: IC.navy, letterSpacing: "0.02em" }}>
                    RISK REGISTER
                  </div>
                </div>
              </div>
              <div style={{ height: 1, background: IC.rule, marginBottom: 16 }} />
              <div style={{ overflowX: "auto", borderRadius: 3, border: `1px solid ${IC.rule}` }}>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", fontFamily: "'Source Serif 4', Georgia, serif" }}>
                  <thead>
                    <tr style={{ background: IC.navy, borderBottom: `1px solid rgba(212,201,176,0.2)` }}>
                      {["Category","Risk Factor","Mitigant","Severity"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 7.5, letterSpacing: "0.14em", color: IC.goldLt, textTransform: "uppercase", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ic.risks.map((r, i) => {
                      const sevBg = r.severity === "high" ? IC.failBg : r.severity === "medium" ? IC.cautBg : IC.passBg;
                      const sevColor = r.severity === "high" ? IC.fail : r.severity === "medium" ? IC.caution : IC.pass;
                      return (
                        <tr key={i} style={{ borderBottom: `1px solid ${IC.rule}`, background: i % 2 === 1 ? "rgba(212,201,176,0.07)" : "transparent" }}>
                          <td style={{ padding: "7px 12px", fontSize: 9, fontWeight: 700, color: IC.gold, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{r.category}</td>
                          <td style={{ padding: "7px 12px", color: IC.ink, fontSize: 11 }}>{r.risk}</td>
                          <td style={{ padding: "7px 12px", color: IC.muted, fontSize: 11 }}>{r.mitigant}</td>
                          <td style={{ padding: "7px 12px", textAlign: "center" }}>
                            <span style={{ fontSize: 8, fontWeight: 700, padding: "3px 8px", borderRadius: 3, background: sevBg, color: sevColor, letterSpacing: "0.1em" }}>
                              {r.severity?.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Conditions Precedent ────────────────────────────────────────── */}
          {ic.conditions_precedent && ic.conditions_precedent.length > 0 && (
            <div style={{ padding: "32px 36px 28px", borderBottom: `1px solid ${IC.rule}` }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 16 }}>
                <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 900, color: IC.gold, lineHeight: 1 }}>CP</div>
                <div style={{ borderLeft: `2px solid ${IC.navy}`, paddingLeft: 12 }}>
                  <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 13, fontWeight: 700, color: IC.navy, letterSpacing: "0.02em" }}>
                    CONDITIONS PRECEDENT
                  </div>
                </div>
              </div>
              <div style={{ height: 1, background: IC.rule, marginBottom: 16 }} />
              <div>
                {ic.conditions_precedent.map((c, i) => (
                  <div key={i} style={{ display: "flex", gap: 14, marginBottom: 10, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 9, fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 700, color: IC.gold, flexShrink: 0, marginTop: 2, minWidth: 20 }}>
                      {String(i + 1).padStart(2, "0")}.
                    </span>
                    <span style={{ fontSize: 11.5, color: IC.ink, lineHeight: 1.65, fontFamily: "'Source Serif 4', Georgia, serif" }}>{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── SWOT ────────────────────────────────────────────────────────── */}
          {ic.swot && (
            <div style={{ padding: "32px 36px 28px", borderBottom: `1px solid ${IC.rule}` }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 16 }}>
                <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 900, color: IC.gold, lineHeight: 1 }}>SW</div>
                <div style={{ borderLeft: `2px solid ${IC.navy}`, paddingLeft: 12 }}>
                  <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 13, fontWeight: 700, color: IC.navy, letterSpacing: "0.02em" }}>
                    SWOT ANALYSIS
                  </div>
                </div>
              </div>
              <div style={{ height: 1, background: IC.rule, marginBottom: 16 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {([
                  ["Strengths",     ic.swot.strengths,     "+", IC.pass,    "#EAF3EC"],
                  ["Weaknesses",    ic.swot.weaknesses,    "−", IC.fail,    "#F3EAEA"],
                  ["Opportunities", ic.swot.opportunities, "↑", "#1A3A5C",  "#EAF0F5"],
                  ["Threats",       ic.swot.threats,       "▲", IC.caution, IC.cautBg],
                ] as [string, string[], string, string, string][]).map(([label, items, icon, color, bg]) => (
                  <div key={label} style={{ background: bg, border: `1px solid ${color}30`, padding: "14px 16px", borderRadius: 3 }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10, fontFamily: "'Source Serif 4', Georgia, serif" }}>
                      {icon} {label}
                    </div>
                    {items?.map((item, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 11, lineHeight: 1.55, fontFamily: "'Source Serif 4', Georgia, serif", color: IC.ink }}>
                        <span style={{ color, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ height: 48 }} />
        </div>

        {/* Comments sidebar */}
        {showComments && (
          <CommentsPanel
            ic={ic}
            activeSection={activeCommentSection}
            newCommentText={newCommentText}
            onNewCommentChange={setNewCommentText}
            onAddComment={handleAddComment}
            onResolveComment={onResolveComment}
            onClose={() => { setShowComments(false); setActiveCommentSection(null); }}
          />
        )}
      </div>
    </div>
  );
}
