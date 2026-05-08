/**
 * PartnerAnalysisTab — Full co-borrower / guarantor financial analysis.
 *
 * Features per partner:
 *  • Import financials from Excel (same parser as the main Review tab)
 *  • Manual year entry with P&L + BS line items
 *  • Inline cell editing (click to edit)
 *  • DSCR, D/E, Net Profit Margin, Current Ratio — computed per year
 *  • Collapsible P&L and BS tables
 *  • Combined debt-service capacity across all partners
 *
 * Storage: ic_note.partners JSON array (preserved through generate-narrative).
 */

import { useState, useRef, useCallback } from "react";
import { Panel } from "@/components/terminal/Panel";
import type { CaseRow } from "@/features/case/types";
import type { LineItem } from "@/features/case/types";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type PartnerRelation =
  | "guarantor"
  | "co_borrower"
  | "partner"
  | "group_company"
  | "promoter_entity";

export interface PartnerFY {
  fiscal_year: number;
  unit: string;
  pl: LineItem[];
  bs: LineItem[];
}

export interface PartnerEntry {
  id: string;
  name: string;
  relation: PartnerRelation;
  notes: string;
  annual_repayment: number | null;   // total principal repayment / yr across all lenders
  financials: PartnerFY[];           // full multi-year P&L + BS
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

export const RELATION_LABELS: Record<PartnerRelation, string> = {
  guarantor:       "Guarantor",
  co_borrower:     "Co-Borrower",
  partner:         "Business Partner",
  group_company:   "Group Company",
  promoter_entity: "Promoter Entity",
};

const PL_LABELS = [
  "Turnover", "Cost of Goods Sold", "Gross Profit",
  "Operating Expenses", "EBITDA", "Depreciation", "EBIT",
  "Interest Expense", "Profit Before Tax", "Tax", "PAT",
];
const BS_LABELS = [
  "Share Capital", "Reserves & Surplus", "Net Worth",
  "Long Term Borrowings", "Short Term Borrowings", "Total Debt",
  "Trade Payables", "Other Current Liabilities", "Current Liabilities", "Total Liabilities",
  "Fixed Assets (Net)", "Inventory", "Trade Receivables",
  "Cash & Bank", "Other Current Assets", "Current Assets", "Total Assets", "Capital Employed",
];

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getv(items: LineItem[], label: string): number | null {
  const it = items.find(i => i.label === label);
  if (!it) return null;
  return it.override_value != null ? it.override_value : it.value;
}

function setv(items: LineItem[], label: string, value: number | null): LineItem[] {
  const idx = items.findIndex(i => i.label === label);
  if (idx === -1) return [...items, { label, value, confidence: 100, reviewed: true, override_value: null }];
  const next = [...items];
  next[idx] = { ...next[idx], value };
  return next;
}

function blankLineItems(labels: string[]): LineItem[] {
  return labels.map(label => ({ label, value: null, confidence: 100, reviewed: true, override_value: null }));
}

function blankFY(fiscal_year: number): PartnerFY {
  return { fiscal_year, unit: "Lakhs", pl: blankLineItems(PL_LABELS), bs: blankLineItems(BS_LABELS) };
}

function blankPartner(): PartnerEntry {
  return {
    id: crypto.randomUUID(),
    name: "", relation: "guarantor", notes: "",
    annual_repayment: null, financials: [],
  };
}

function fmtN(n: number | null, dec = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec, minimumFractionDigits: dec });
}
function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(1) + "%";
}

function computeRatios(fy: PartnerFY, annualRepayment: number | null, dealAmount: number | null) {
  const pl = fy.pl; const bs = fy.bs;
  const pat       = getv(pl, "PAT");
  const dep       = getv(pl, "Depreciation") ?? 0;
  const intExp    = getv(pl, "Interest Expense") ?? 0;
  const turnover  = getv(pl, "Turnover");
  const networth  = getv(bs, "Net Worth");
  const totalDebt = getv(bs, "Total Debt");
  const ca        = getv(bs, "Current Assets");
  const cl        = getv(bs, "Current Liabilities");

  const repay = annualRepayment ?? 0;
  const dscr  = (intExp + repay) > 0 ? ((pat ?? 0) + dep + intExp) / (intExp + repay) : null;
  const de    = networth && networth > 0 && totalDebt != null ? totalDebt / networth : null;
  const npm   = turnover && turnover > 0 && pat != null ? (pat / turnover) * 100 : null;
  const cr    = cl && cl > 0 && ca != null ? ca / cl : null;
  const nwCov = networth != null && dealAmount && dealAmount > 0 ? networth / dealAmount : null;

  let verdict: "STRONG" | "ADEQUATE" | "WEAK" | "INSUFFICIENT DATA";
  if (dscr === null && de === null) verdict = "INSUFFICIENT DATA";
  else if ((dscr ?? 0) >= 2 && (de ?? 999) < 2) verdict = "STRONG";
  else if ((dscr ?? 0) >= 1.25) verdict = "ADEQUATE";
  else verdict = "WEAK";

  return { dscr, de, npm, cr, nwCov, verdict, pat, turnover, networth, totalDebt, intExp, dep };
}

const VERDICT_CLS: Record<string, string> = {
  STRONG:              "text-success border-success/50 bg-success/10",
  ADEQUATE:            "text-warning border-warning/50 bg-warning/10",
  WEAK:                "text-destructive border-destructive/50 bg-destructive/10",
  "INSUFFICIENT DATA": "text-muted-foreground border-border bg-surface",
};

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCIAL TABLE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function FinTable({
  section, labels, financials, unit,
  onEdit,
}: {
  section: "pl" | "bs";
  labels: string[];
  financials: PartnerFY[];
  unit: string;
  onEdit: (fy: number, section: "pl" | "bs", label: string, value: number | null) => void;
}) {
  const [editCell, setEditCell] = useState<{ fy: number; label: string } | null>(null);
  const [editVal, setEditVal]   = useState("");

  const years = financials.map(f => f.fiscal_year).sort();

  const startEdit = (fy: number, label: string, current: number | null) => {
    setEditCell({ fy, label });
    setEditVal(current != null ? String(current) : "");
  };

  const commitEdit = () => {
    if (!editCell) return;
    const v = editVal.trim() === "" ? null : parseFloat(editVal);
    onEdit(editCell.fy, section, editCell.label, isNaN(v as number) ? null : v);
    setEditCell(null);
  };

  if (years.length === 0) return null;

  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground border-b border-border">
        <tr>
          <th className="text-left py-1 pr-3 min-w-[160px]">
            {section === "pl" ? "P&L" : "BALANCE SHEET"} · {unit}
          </th>
          {years.map(y => <th key={y} className="text-right pr-2 min-w-[90px]">FY{y}</th>)}
        </tr>
      </thead>
      <tbody>
        {labels.map(label => (
          <tr key={label} className="border-b border-border/20 hover:bg-surface/20">
            <td className="py-1 pr-3 text-foreground/80">{label}</td>
            {years.map(fy => {
              const fyData = financials.find(f => f.fiscal_year === fy);
              const items  = fyData ? fyData[section] : [];
              const val    = getv(items, label);
              const isEdit = editCell?.fy === fy && editCell?.label === label;
              return (
                <td key={fy} className="text-right pr-2 tabular-nums">
                  {isEdit ? (
                    <input
                      autoFocus
                      type="number"
                      value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
                      className="w-20 bg-input border border-primary px-1 py-0.5 text-right text-xs focus:outline-none font-mono"
                    />
                  ) : (
                    <span
                      className={`cursor-pointer hover:text-primary hover:underline hover:underline-offset-2 ${val != null ? "text-foreground" : "text-muted-foreground/30"}`}
                      onClick={() => startEdit(fy, label, val)}
                      title="Click to edit"
                    >
                      {val != null ? fmtN(val) : "—"}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTNER CARD
// ═══════════════════════════════════════════════════════════════════════════════

function PartnerCard({
  partner, dealAmount, onUpdate, onRemove,
}: {
  partner: PartnerEntry;
  dealAmount: number | null;
  onUpdate: (p: PartnerEntry) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showPL,   setShowPL]   = useState(true);
  const [showBS,   setShowBS]   = useState(true);
  const [addingFY, setAddingFY] = useState(false);
  const [newFY,    setNewFY]    = useState("");
  const [importing, setImporting] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [meta, setMeta]         = useState({ name: partner.name, relation: partner.relation, notes: partner.notes, annual_repayment: partner.annual_repayment });
  const fileRef = useRef<HTMLInputElement>(null);

  const years = partner.financials.map(f => f.fiscal_year).sort();
  const unit  = partner.financials[0]?.unit ?? "Lakhs";
  const ratiosList = partner.financials
    .sort((a, b) => a.fiscal_year - b.fiscal_year)
    .map(fy => ({ fy: fy.fiscal_year, ...computeRatios(fy, partner.annual_repayment, dealAmount) }));
  const latestR = ratiosList[ratiosList.length - 1];

  const handleImportExcel = async (file: File) => {
    setImporting(true);
    try {
      const { parseFinancialExcel } = await import("@/lib/financial-excel-parser");
      const statements = await parseFinancialExcel(file);
      if (statements.length === 0) { alert("No financial statements found in this Excel"); return; }

      const newFins = [...partner.financials];
      for (const stmt of statements) {
        for (const fy of stmt.fiscal_years) {
          const items = stmt.line_items_by_fy[fy] as unknown as LineItem[];
          let fyEntry = newFins.find(f => f.fiscal_year === fy);
          if (!fyEntry) {
            fyEntry = blankFY(fy);
            newFins.push(fyEntry);
          }
          fyEntry.unit = stmt.unit;
          if (stmt.stmt_type === "profit_loss") fyEntry.pl = items;
          if (stmt.stmt_type === "balance_sheet") fyEntry.bs = items;
        }
      }
      onUpdate({ ...partner, financials: newFins });
    } catch (e) {
      alert("Import failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImporting(false);
    }
  };

  const addManualFY = () => {
    const fy = parseInt(newFY);
    if (!fy || partner.financials.some(f => f.fiscal_year === fy)) return;
    onUpdate({ ...partner, financials: [...partner.financials, blankFY(fy)] });
    setAddingFY(false);
    setNewFY("");
  };

  const removeFY = (fy: number) => {
    if (!window.confirm(`Remove FY${fy} data for ${partner.name}?`)) return;
    onUpdate({ ...partner, financials: partner.financials.filter(f => f.fiscal_year !== fy) });
  };

  const handleCellEdit = (fy: number, section: "pl" | "bs", label: string, value: number | null) => {
    onUpdate({
      ...partner,
      financials: partner.financials.map(f =>
        f.fiscal_year !== fy ? f : { ...f, [section]: setv(f[section], label, value) }
      ),
    });
  };

  const saveMeta = () => {
    onUpdate({ ...partner, ...meta });
    setEditingMeta(false);
  };

  return (
    <Panel
      title={partner.name || "UNNAMED PARTNER"}
      ticker={RELATION_LABELS[partner.relation]}
      actions={
        <div className="flex gap-1">
          <button onClick={() => setExpanded(e => !e)} className="text-[9px] border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground tracking-widest">
            {expanded ? "▲ COLLAPSE" : "▼ EXPAND"}
          </button>
          <button onClick={() => { setEditingMeta(true); setExpanded(true); }} className="text-[9px] border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground tracking-widest">EDIT</button>
          <button onClick={onRemove} className="text-[9px] border border-destructive/40 px-2 py-0.5 text-destructive/60 hover:text-destructive hover:border-destructive tracking-widest">✕</button>
        </div>
      }
    >
      {/* ── Meta edit form ─────────────────────────────────────────────────── */}
      {editingMeta && (
        <div className="space-y-2 mb-3 pb-3 border-b border-border/40">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-0.5">
              <label className="text-[9px] text-muted-foreground tracking-widest">ENTITY NAME</label>
              <input type="text" value={meta.name} onChange={e => setMeta(m => ({ ...m, name: e.target.value }))}
                className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary" />
            </div>
            <div className="space-y-0.5">
              <label className="text-[9px] text-muted-foreground tracking-widest">RELATION</label>
              <select value={meta.relation} onChange={e => setMeta(m => ({ ...m, relation: e.target.value as PartnerRelation }))}
                className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary">
                {Object.entries(RELATION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-0.5">
              <label className="text-[9px] text-muted-foreground tracking-widest">ANNUAL REPAYMENT (₹L)</label>
              <input type="number" value={meta.annual_repayment ?? ""} onChange={e => setMeta(m => ({ ...m, annual_repayment: e.target.value ? Number(e.target.value) : null }))}
                className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary font-mono" />
            </div>
          </div>
          <div className="space-y-0.5">
            <label className="text-[9px] text-muted-foreground tracking-widest">ANALYST NOTE</label>
            <input type="text" value={meta.notes} onChange={e => setMeta(m => ({ ...m, notes: e.target.value }))}
              placeholder="Source, caveats, relationship to borrower..."
              className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary" />
          </div>
          <div className="flex gap-2">
            <button onClick={saveMeta} className="bg-primary text-primary-foreground text-[10px] tracking-widest px-3 py-1">[SAVE →]</button>
            <button onClick={() => setEditingMeta(false)} className="border border-border text-[10px] px-3 py-1 text-muted-foreground hover:text-foreground">CANCEL</button>
          </div>
        </div>
      )}

      {/* ── Ratio summary strip ────────────────────────────────────────────── */}
      {latestR && (
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className={`border px-3 py-1 text-[10px] font-bold tracking-widest shrink-0 ${VERDICT_CLS[latestR.verdict]}`}>
            {latestR.verdict}
          </div>
          {[
            { l: "DSCR",       v: latestR.dscr    != null ? fmtN(latestR.dscr) + "x"    : "—" },
            { l: "D/E",        v: latestR.de       != null ? fmtN(latestR.de) + "x"      : "—" },
            { l: "PAT MARGIN", v: fmtPct(latestR.npm) },
            { l: "CURR RATIO", v: latestR.cr       != null ? fmtN(latestR.cr) + "x"      : "—" },
            { l: "NW / DEAL",  v: latestR.nwCov    != null ? fmtN(latestR.nwCov) + "x"   : "—" },
          ].map(({ l, v }) => (
            <div key={l} className="text-center">
              <div className="text-[8px] text-muted-foreground tracking-widest">{l}</div>
              <div className="text-sm font-bold text-primary tabular-nums">{v}</div>
            </div>
          ))}
          {years.length > 1 && (
            <div className="ml-auto text-[9px] text-muted-foreground">FY{years[years.length - 1]} (latest)</div>
          )}
        </div>
      )}

      {/* ── Import / Add Year toolbar ──────────────────────────────────────── */}
      <div className="flex gap-2 items-center mb-3">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImportExcel(f); e.target.value = ""; }} />
        <button onClick={() => fileRef.current?.click()} disabled={importing}
          className="text-[10px] tracking-widest border border-accent/50 text-accent px-3 py-1 hover:bg-accent/10 disabled:opacity-50 flex items-center gap-1">
          {importing ? "IMPORTING…" : "⬆ IMPORT EXCEL"}
        </button>
        {addingFY ? (
          <div className="flex gap-1 items-center">
            <input autoFocus type="number" placeholder="e.g. 2024" value={newFY} onChange={e => setNewFY(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addManualFY(); if (e.key === "Escape") { setAddingFY(false); setNewFY(""); } }}
              className="bg-input border border-accent/60 px-2 py-1 text-[10px] w-24 focus:outline-none font-mono" />
            <button onClick={addManualFY} className="text-[9px] text-accent hover:text-accent/80">ADD</button>
            <button onClick={() => { setAddingFY(false); setNewFY(""); }} className="text-[9px] text-foreground/40 hover:text-foreground">✕</button>
          </div>
        ) : (
          <button onClick={() => setAddingFY(true)}
            className="text-[10px] tracking-widest border border-border text-muted-foreground px-3 py-1 hover:text-foreground hover:border-primary/50">
            + ADD YEAR
          </button>
        )}
        {years.length > 0 && (
          <>
            <div className="ml-auto flex gap-1">
              {years.map(fy => (
                <button key={fy} onClick={() => removeFY(fy)}
                  className="text-[8px] border border-destructive/30 text-destructive/50 hover:text-destructive hover:border-destructive px-1.5 py-0.5 tracking-widest">
                  DEL FY{fy}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Financial tables (collapsible) ────────────────────────────────── */}
      {expanded && years.length > 0 && (
        <div className="space-y-3">
          {/* Multi-year ratio table */}
          {ratiosList.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1">RATIO</th>
                    {ratiosList.map(r => <th key={r.fy} className="text-right pr-2">FY{r.fy}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { l: "DSCR",             fn: (r: typeof ratiosList[0]) => r.dscr    != null ? fmtN(r.dscr) + "x"    : "—" },
                    { l: "Debt / Equity",    fn: (r: typeof ratiosList[0]) => r.de       != null ? fmtN(r.de) + "x"      : "—" },
                    { l: "PAT Margin %",     fn: (r: typeof ratiosList[0]) => fmtPct(r.npm) },
                    { l: "Current Ratio",    fn: (r: typeof ratiosList[0]) => r.cr       != null ? fmtN(r.cr) + "x"      : "—" },
                    { l: "Turnover",         fn: (r: typeof ratiosList[0]) => fmtN(r.turnover) },
                    { l: "PAT",              fn: (r: typeof ratiosList[0]) => fmtN(r.pat) },
                    { l: "Net Worth",        fn: (r: typeof ratiosList[0]) => fmtN(r.networth) },
                    { l: "Total Debt",       fn: (r: typeof ratiosList[0]) => fmtN(r.totalDebt) },
                  ].map(({ l, fn }) => (
                    <tr key={l} className="border-b border-border/20">
                      <td className="py-1 text-foreground/80">{l}</td>
                      {ratiosList.map(r => <td key={r.fy} className="text-right pr-2 tabular-nums text-primary">{fn(r)}</td>)}
                    </tr>
                  ))}
                  <tr className="border-b border-border">
                    <td className="py-1 text-foreground/80 font-bold">VERDICT</td>
                    {ratiosList.map(r => (
                      <td key={r.fy} className={`text-right pr-2 text-[9px] font-bold tracking-widest ${
                        r.verdict === "STRONG" ? "text-success" : r.verdict === "ADEQUATE" ? "text-warning" : r.verdict === "WEAK" ? "text-destructive" : "text-muted-foreground"
                      }`}>{r.verdict}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* P&L table */}
          <div>
            <button onClick={() => setShowPL(s => !s)}
              className="text-[9px] tracking-widest text-muted-foreground hover:text-foreground mb-1.5">
              {showPL ? "▼" : "▶"} PROFIT & LOSS STATEMENT
            </button>
            {showPL && (
              <div className="overflow-x-auto border-t border-border/30 pt-2">
                <FinTable section="pl" labels={PL_LABELS} financials={partner.financials} unit={unit} onEdit={handleCellEdit} />
              </div>
            )}
          </div>

          {/* BS table */}
          <div>
            <button onClick={() => setShowBS(s => !s)}
              className="text-[9px] tracking-widest text-muted-foreground hover:text-foreground mb-1.5">
              {showBS ? "▼" : "▶"} BALANCE SHEET
            </button>
            {showBS && (
              <div className="overflow-x-auto border-t border-border/30 pt-2">
                <FinTable section="bs" labels={BS_LABELS} financials={partner.financials} unit={unit} onEdit={handleCellEdit} />
              </div>
            )}
          </div>

          {partner.notes && (
            <div className="text-[10px] text-muted-foreground italic border-l-2 border-border/40 pl-2">
              {partner.notes}
            </div>
          )}

          {partner.annual_repayment != null && (
            <div className="text-[9px] text-muted-foreground tracking-wider">
              DSCR formula: (PAT + Depreciation + Interest) ÷ (Interest + Annual Repayment {fmtN(partner.annual_repayment)}L)
            </div>
          )}
        </div>
      )}

      {!expanded && years.length === 0 && (
        <div className="text-[10px] text-muted-foreground">No financial data — import Excel or add a year above.</div>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE FORM
// ═══════════════════════════════════════════════════════════════════════════════

function CreateForm({ onSubmit, onCancel }: {
  onSubmit: (p: PartnerEntry) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft]     = useState<PartnerEntry>(blankPartner());
  const [importing, setImp]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExcelImport = async (file: File) => {
    setImp(true);
    try {
      const { parseFinancialExcel } = await import("@/lib/financial-excel-parser");
      const statements = await parseFinancialExcel(file);
      const fins: PartnerFY[] = [];
      for (const stmt of statements) {
        for (const fy of stmt.fiscal_years) {
          let entry = fins.find(f => f.fiscal_year === fy);
          if (!entry) { entry = blankFY(fy); fins.push(entry); }
          entry.unit = stmt.unit;
          const items = stmt.line_items_by_fy[fy] as unknown as LineItem[];
          if (stmt.stmt_type === "profit_loss")  entry.pl = items;
          if (stmt.stmt_type === "balance_sheet") entry.bs = items;
        }
      }
      setDraft(d => ({ ...d, financials: fins }));
    } catch (e) {
      alert("Import failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImp(false);
    }
  };

  return (
    <Panel title="NEW PARTNER" ticker="CREATE">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-0.5">
            <label className="text-[9px] text-muted-foreground tracking-widest">ENTITY NAME *</label>
            <input type="text" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="XYZ Enterprises Pvt Ltd"
              className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary" />
          </div>
          <div className="space-y-0.5">
            <label className="text-[9px] text-muted-foreground tracking-widest">RELATION</label>
            <select value={draft.relation} onChange={e => setDraft(d => ({ ...d, relation: e.target.value as PartnerRelation }))}
              className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary">
              {Object.entries(RELATION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="space-y-0.5">
            <label className="text-[9px] text-muted-foreground tracking-widest">ANNUAL REPAYMENT (₹L)</label>
            <input type="number" value={draft.annual_repayment ?? ""} onChange={e => setDraft(d => ({ ...d, annual_repayment: e.target.value ? Number(e.target.value) : null }))}
              placeholder="All-lender principal per year"
              className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary font-mono" />
          </div>
        </div>

        <div className="space-y-0.5">
          <label className="text-[9px] text-muted-foreground tracking-widest">ANALYST NOTE</label>
          <input type="text" value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
            placeholder="Source of financials, relationship to borrower, any caveats..."
            className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary" />
        </div>

        {/* Excel import in create form */}
        <div className="border border-dashed border-border/50 rounded p-3 space-y-2">
          <div className="text-[9px] text-muted-foreground tracking-widest">IMPORT FINANCIALS FROM EXCEL (OPTIONAL)</div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleExcelImport(f); e.target.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            className="text-[10px] tracking-widest border border-accent/50 text-accent px-3 py-1 hover:bg-accent/10 disabled:opacity-50">
            {importing ? "IMPORTING…" : "⬆ IMPORT FINANCIAL EXCEL"}
          </button>
          {draft.financials.length > 0 && (
            <div className="text-[10px] text-success">
              ✓ {draft.financials.length} year{draft.financials.length > 1 ? "s" : ""} imported: FY{draft.financials.map(f => f.fiscal_year).sort().join(", FY")}
            </div>
          )}
          <div className="text-[9px] text-muted-foreground/50">
            Supports Balance Sheet · P&L sheets. Can also add/edit data after creation.
          </div>
        </div>

        <div className="flex gap-2 pt-1 border-t border-border/40">
          <button onClick={() => draft.name.trim() && onSubmit(draft)} disabled={!draft.name.trim()}
            className="bg-primary text-primary-foreground text-[10px] tracking-widest px-4 py-1.5 disabled:opacity-40">
            [CREATE PARTNER →]
          </button>
          <button onClick={onCancel} className="border border-border text-[10px] tracking-widest px-3 py-1.5 text-muted-foreground hover:text-foreground">
            CANCEL
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORTED COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function PartnerAnalysisTab({
  cc, partners, onSave,
}: {
  cc: CaseRow;
  partners: PartnerEntry[];
  onSave: (partners: PartnerEntry[]) => Promise<void>;
}) {
  const [list,     setList]    = useState<PartnerEntry[]>(partners);
  const [creating, setCreating] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  const dealAmt = cc.deal_amount;

  const update = useCallback((id: string, p: PartnerEntry) => {
    setList(prev => prev.map(x => x.id === id ? p : x));
  }, []);

  const remove = useCallback((id: string) => {
    if (!window.confirm("Remove this partner?")) return;
    setList(prev => prev.filter(x => x.id !== id));
  }, []);

  const handleCreate = (p: PartnerEntry) => {
    setList(prev => [...prev, p]);
    setCreating(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(list);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── Combined metrics ──────────────────────────────────────────────────────
  const latestRatios = list.map(p => {
    const sorted = [...p.financials].sort((a, b) => a.fiscal_year - b.fiscal_year);
    const last = sorted[sorted.length - 1];
    return last ? { name: p.name, id: p.id, relation: p.relation, ...computeRatios(last, p.annual_repayment, dealAmt) } : null;
  }).filter(Boolean) as Array<ReturnType<typeof computeRatios> & { name: string; id: string; relation: PartnerRelation }>;

  const combPAT   = latestRatios.reduce((s, r) => s + (r.pat ?? 0), 0);
  const combDep   = list.reduce((s, p) => {
    const last = [...p.financials].sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
    return s + (last ? (getv(last.pl, "Depreciation") ?? 0) : 0);
  }, 0);
  const combInt   = latestRatios.reduce((s, r) => s + r.intExp, 0);
  const combRepay = list.reduce((s, p) => s + (p.annual_repayment ?? 0), 0);
  const combNW    = latestRatios.reduce((s, r) => s + (r.networth ?? 0), 0);
  const combDSCR  = (combInt + combRepay) > 0 ? (combPAT + combDep + combInt) / (combInt + combRepay) : null;

  return (
    <div className="space-y-3">

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground tracking-widest flex-1">
          Add guarantors, co-borrowers, or group entities. Import Excel or enter financials manually per partner.
        </span>
        {!creating && (
          <button onClick={() => setCreating(true)}
            className="text-[10px] tracking-widest border border-accent/50 text-accent px-3 py-1.5 hover:bg-accent/10">
            + ADD PARTNER
          </button>
        )}
        <button onClick={handleSave} disabled={saving}
          className="text-[10px] tracking-widest bg-primary text-primary-foreground px-3 py-1.5 disabled:opacity-50">
          {saving ? "SAVING..." : saved ? "✓ SAVED" : "[SAVE →]"}
        </button>
      </div>

      {/* ── Create form ─────────────────────────────────────────────────────── */}
      {creating && (
        <CreateForm onSubmit={handleCreate} onCancel={() => setCreating(false)} />
      )}

      {/* ── Partner cards ───────────────────────────────────────────────────── */}
      {list.length === 0 && !creating ? (
        <Panel title="NO PARTNERS ADDED" ticker="GUARANTOR / CO-BORROWER ANALYSIS">
          <div className="text-muted-foreground text-xs leading-relaxed space-y-1">
            <p>Add guarantors or co-borrowers to assess whether combined repayment capacity covers the deal obligation.</p>
            <p>Each partner supports full Excel import, multi-year P&L and BS tables, and computed DSCR / D/E ratios.</p>
          </div>
        </Panel>
      ) : (
        list.map(p => (
          <PartnerCard
            key={p.id}
            partner={p}
            dealAmount={dealAmt}
            onUpdate={updated => update(p.id, updated)}
            onRemove={() => remove(p.id)}
          />
        ))
      )}

      {/* ── Combined analysis ───────────────────────────────────────────────── */}
      {list.length > 1 && (
        <Panel title="COMBINED PARTNER CAPACITY" ticker={`${list.length} PARTNERS`}>
          <div className="space-y-3">
            <div className="text-[9px] text-muted-foreground tracking-wider">
              Aggregate of all {list.length} partners (latest available FY each). Primary borrower NOT included.
            </div>
            <div className="grid grid-cols-4 gap-4">
              {[
                { l: "COMBINED PAT",      v: fmtN(combPAT),  cls: "text-primary" },
                { l: "COMBINED NET WORTH", v: fmtN(combNW),   cls: "text-primary" },
                { l: "COMBINED REPAYMENT", v: fmtN(combRepay), cls: "text-primary" },
                { l: "COMBINED DSCR",     v: combDSCR != null ? fmtN(combDSCR) + "x" : "—",
                  cls: (combDSCR ?? 0) >= 2 ? "text-success" : (combDSCR ?? 0) >= 1.25 ? "text-warning" : "text-destructive" },
              ].map(({ l, v, cls }) => (
                <div key={l}>
                  <div className="text-[8px] text-muted-foreground tracking-widest">{l}</div>
                  <div className={`text-xl font-bold tabular-nums glow ${cls}`}>{v}</div>
                </div>
              ))}
            </div>

            <table className="w-full text-xs border-t border-border/30 pt-2">
              <thead className="text-muted-foreground text-[10px]">
                <tr>
                  <th className="text-left py-1">PARTNER</th>
                  <th className="text-left">RELATION</th>
                  <th className="text-right">DSCR</th>
                  <th className="text-right">D/E</th>
                  <th className="text-right">PAT MARGIN</th>
                  <th className="text-right">VERDICT</th>
                </tr>
              </thead>
              <tbody>
                {latestRatios.map(r => (
                  <tr key={r.id} className="border-b border-border/20">
                    <td className="py-1.5 font-medium">{r.name}</td>
                    <td className="text-muted-foreground text-[10px]">{RELATION_LABELS[r.relation]}</td>
                    <td className="text-right tabular-nums">{r.dscr != null ? fmtN(r.dscr) + "x" : "—"}</td>
                    <td className="text-right tabular-nums">{r.de  != null ? fmtN(r.de) + "x"   : "—"}</td>
                    <td className="text-right tabular-nums">{fmtPct(r.npm)}</td>
                    <td className={`text-right text-[9px] font-bold tracking-widest ${
                      r.verdict === "STRONG" ? "text-success" :
                      r.verdict === "ADEQUATE" ? "text-warning" :
                      r.verdict === "WEAK" ? "text-destructive" : "text-muted-foreground"
                    }`}>{r.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {dealAmt && combNW > 0 && (
              <div className="text-[9px] text-muted-foreground tracking-wider border-t border-border/20 pt-1.5">
                ▸ Deal amount ₹{fmtN(dealAmt, 0)}L · Combined NW covers {fmtN(combNW / dealAmt)}x deal · Combined DSCR {combDSCR != null ? fmtN(combDSCR) + "x" : "—"}
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
