import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  PRODUCTS, RATIO_DISPLAY_NAMES, formatRatio,
} from "@/features/credit/domain";
import type { CaseRow, ExtractedRow, RatioRow, LineItem } from "@/features/case/types";
import { unitAbbr } from "@/features/case/utils";

export const IC_S_CLS: Record<string, string> = {
  green: "text-success", amber: "text-warning", red: "text-destructive", na: "text-muted-foreground",
};
export const IC_B_CLS: Record<string, string> = {
  green: "bg-green-50 text-green-700 border border-green-200",
  amber: "bg-amber-50 text-amber-700 border border-amber-200",
  red:   "bg-red-50 text-red-700 border border-red-200",
  na:    "bg-muted text-muted-foreground border border-border",
};

// ── Section heading used across IC components ─────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-1">
      {children}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    green: { label: "Pass",    cls: "bg-green-50 text-green-700 border border-green-200" },
    amber: { label: "Caution", cls: "bg-amber-50 text-amber-700 border border-amber-200" },
    red:   { label: "Fail",    cls: "bg-red-50 text-red-700 border border-red-200" },
    na:    { label: "—",       cls: "text-muted-foreground" },
  };
  const { label, cls } = map[status] ?? map.na;
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{label}</span>;
}

export function ICSummaryPanel({
  cc, ratios, onCasePatch, onRatioPatch, company,
}: {
  cc: CaseRow;
  ratios: RatioRow[];
  onCasePatch?: (field: string, val: string | number | null) => Promise<void>;
  onRatioPatch?: (ratioId: string, field: "ratio_value" | "benchmark", val: number | null) => Promise<void>;
  company?: Record<string, string | null> | null;
}) {
  type EC =
    | { kind: "case"; field: string; val: string }
    | { kind: "ratio"; ratioId: string; field: "ratio_value" | "benchmark"; val: string };

  const [editCell, setEditCell] = useState<EC | null>(null);

  const NUM_FIELDS = ["deal_amount", "tenure_months", "expected_irr"];

  const commitCase = async (field: string, val: string) => {
    if (!onCasePatch) return;
    setEditCell(null);
    const parsed = NUM_FIELDS.includes(field) ? (val.trim() === "" ? null : parseFloat(val)) : (val.trim() || null);
    await onCasePatch(field, parsed);
  };

  const commitRatio = async (ratioId: string, field: "ratio_value" | "benchmark", val: string) => {
    if (!onRatioPatch) return;
    setEditCell(null);
    await onRatioPatch(ratioId, field, val.trim() === "" ? null : parseFloat(val));
  };

  const caseTd = (field: string, display: string, rawVal: string) => {
    const isEditing = editCell?.kind === "case" && editCell.field === field;
    const editable = !!onCasePatch;
    if (isEditing && editCell?.kind === "case") {
      return (
        <td>
          <input
            autoFocus
            value={editCell.val}
            onChange={e => setEditCell({ kind: "case", field, val: e.target.value })}
            onBlur={() => editCell?.kind === "case" && commitCase(field, editCell.val)}
            onKeyDown={e => {
              if (e.key === "Enter" && editCell?.kind === "case") commitCase(field, editCell.val);
              if (e.key === "Escape") setEditCell(null);
            }}
            className="w-full border-b border-primary bg-transparent text-xs text-foreground outline-none py-0.5"
          />
        </td>
      );
    }
    return (
      <td
        className={`text-foreground text-sm${editable ? " cursor-pointer hover:bg-primary/5 rounded px-1 -mx-1 transition-colors" : ""}`}
        onClick={() => editable && setEditCell({ kind: "case", field, val: rawVal })}
        title={editable ? "Click to edit" : undefined}
      >
        {display}
      </td>
    );
  };

  const ratioTd = (ratioId: string, field: "ratio_value" | "benchmark", val: number | null, display: string) => {
    const isEditing = editCell?.kind === "ratio" && editCell.ratioId === ratioId && editCell.field === field;
    const editable = !!onRatioPatch;
    if (isEditing && editCell?.kind === "ratio") {
      return (
        <td className="text-right">
          <input
            autoFocus
            value={editCell.val}
            onChange={e => setEditCell({ kind: "ratio", ratioId, field, val: e.target.value })}
            onBlur={() => editCell?.kind === "ratio" && commitRatio(ratioId, field, editCell.val)}
            onKeyDown={e => {
              if (e.key === "Enter" && editCell?.kind === "ratio") commitRatio(ratioId, field, editCell.val);
              if (e.key === "Escape") setEditCell(null);
            }}
            className="w-16 border-b border-primary bg-transparent text-xs text-right outline-none"
          />
        </td>
      );
    }
    return (
      <td
        className={`text-right tabular-nums${editable ? " cursor-pointer hover:bg-primary/5 rounded transition-colors" : ""}`}
        onClick={() => editable && setEditCell({ kind: "ratio", ratioId, field, val: val != null ? String(val) : "" })}
        title={editable ? "Click to edit" : undefined}
      >
        {display}
      </td>
    );
  };

  const product = PRODUCTS[cc.product_type];
  const years = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const KEY = ["dscr", "current_ratio", "debt_to_equity", "interest_coverage", "ebitda_margin", "roe"];

  return (
    <div className="space-y-4 text-sm">
      {/* Deal summary */}
      <table className="w-full">
        <tbody>
          <tr className="border-b border-border/40">
            <td className="py-1.5 w-32 text-muted-foreground text-xs">Client</td>
            {caseTd("client_name", cc.client_name, cc.client_name)}
            <td className="w-24 text-muted-foreground text-xs">Product</td>
            <td className="text-foreground text-sm">{product.short}</td>
          </tr>
          <tr className="border-b border-border/40">
            <td className="py-1.5 text-muted-foreground text-xs">Amount</td>
            {caseTd("deal_amount", cc.deal_amount ? `₹${Number(cc.deal_amount).toLocaleString("en-IN")} Cr` : "—", String(cc.deal_amount ?? ""))}
            <td className="text-muted-foreground text-xs">Tenure</td>
            {caseTd("tenure_months", cc.tenure_months ? `${cc.tenure_months} months` : "—", String(cc.tenure_months ?? ""))}
          </tr>
          <tr className="border-b border-border/40">
            <td className="py-1.5 text-muted-foreground text-xs">IRR</td>
            {caseTd("expected_irr", cc.expected_irr ? `${cc.expected_irr}%` : "—", String(cc.expected_irr ?? ""))}
            <td className="text-muted-foreground text-xs">Industry</td>
            {caseTd("industry", cc.industry ?? "—", cc.industry ?? "")}
          </tr>
          <tr className="border-b border-border/40">
            <td className="py-1.5 text-muted-foreground text-xs">End Use</td>
            {caseTd("end_use", cc.end_use ?? "—", cc.end_use ?? "")}
            <td className="text-muted-foreground text-xs" />
            <td />
          </tr>
        </tbody>
      </table>

      {/* Company profile mini-card */}
      {company && (company.mca_cin || company.mca_category || company.mca_status) && (
        <div className="border border-border/60 rounded p-3 bg-surface-2/30 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Company Profile</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {[
              ["CIN",           company.mca_cin],
              ["PAN",           company.mca_pan],
              ["Category",      company.mca_category],
              ["Status",        company.mca_status],
              ["Type",          company.mca_type],
              ["Sector",        company.mca_nse_sector || company.mca_sector],
              ["Incorporated",  company.mca_date_of_incorp],
              ["Paid-Up Cap",   company.mca_paid_up_capital],
            ].filter(([, v]) => v).map(([label, val]) => (
              <div key={label as string} className="flex gap-1.5">
                <span className="text-muted-foreground shrink-0">{label}:</span>
                <span className="text-foreground font-medium">{val as string}</span>
              </div>
            ))}
          </div>
          {company.mca_about && (
            <p className="text-xs text-foreground/70 leading-relaxed border-t border-border/40 pt-2 mt-1 whitespace-pre-wrap line-clamp-4">
              {company.mca_about}
            </p>
          )}
        </div>
      )}

      {/* Key ratio snapshot */}
      {ratios.length > 0 && years.length > 0 && (
        <div>
          <SectionLabel>Key Ratio Snapshot</SectionLabel>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-1.5 font-medium">Ratio</th>
                {years.map(y => <th key={y} className="text-right font-medium">FY{y}</th>)}
                <th className="text-right font-medium">Benchmark</th>
                <th className="text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {KEY.map(name => {
                const rows = ratios.filter(r => r.ratio_name === name);
                if (rows.length === 0) return null;
                const latest = rows.sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
                const s = latest.threshold_status ?? "na";
                return (
                  <tr key={name} className="border-b border-border/30">
                    <td className="py-1.5 text-foreground">{RATIO_DISPLAY_NAMES[name] ?? name}</td>
                    {years.map(y => {
                      const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y);
                      return (
                        <td key={y} className="text-right tabular-nums text-foreground">
                          {formatRatio(name, r?.ratio_value != null ? Number(r.ratio_value) : null)}
                        </td>
                      );
                    })}
                    {ratioTd(latest.id, "benchmark", latest.benchmark != null ? Number(latest.benchmark) : null, latest.benchmark != null ? formatRatio(name, Number(latest.benchmark)) : "—")}
                    <td className="text-right">
                      <StatusBadge status={s} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function icGetItems(extracted: ExtractedRow[], fy: number): LineItem[] {
  const raw: LineItem[] = [];
  const seen = new Set<string>();
  for (const row of extracted.filter(r => r.fiscal_year === fy && r.statement_type !== "projections")) {
    for (const it of (row.line_items as unknown as LineItem[]) ?? []) {
      if (!seen.has(it.label)) { raw.push(it); seen.add(it.label); }
    }
  }
  return deriveFinancialItems(raw);
}

export function deriveFinancialItems(items: LineItem[]): LineItem[] {
  const result = [...items];

  const get = (label: string): number | null => {
    const it = result.find(i => i.label === label);
    if (!it) return null;
    const v = it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
    return v !== null && Number.isFinite(Number(v)) ? Number(v) : null;
  };

  const add = (label: string, value: number) => {
    if (result.find(i => i.label === label)) return;
    result.push({ label, value, confidence: 70, reviewed: false, note: "auto-derived", override_value: null });
  };

  // ── P&L derivations ────────────────────────────────────────────────────
  const turnover     = get("Turnover");
  const cogs         = get("Cost of Goods Sold");
  const grossProfit  = get("Gross Profit");
  const opEx         = get("Operating Expenses");
  const ebitda       = get("EBITDA");
  const depn         = get("Depreciation");
  const ebit         = get("EBIT");
  const interest     = get("Interest Expense");
  const pbt          = get("Profit Before Tax");
  const tax          = get("Tax");
  const pat          = get("PAT");

  if (grossProfit === null && turnover !== null && cogs !== null)
    add("Gross Profit", turnover - cogs);
  const gp = grossProfit ?? get("Gross Profit");
  if (ebitda === null && gp !== null && opEx !== null)
    add("EBITDA", gp - opEx);
  const eb = ebitda ?? get("EBITDA");
  if (ebit === null && eb !== null && depn !== null)
    add("EBIT", eb - depn);
  const ei = ebit ?? get("EBIT");
  if (pbt === null && ei !== null && interest !== null)
    add("Profit Before Tax", ei - interest);
  const pb = pbt ?? get("Profit Before Tax");
  if (pat === null && pb !== null && tax !== null)
    add("PAT", pb - tax);
  if (pat === null && pb !== null && tax === null)
    add("PAT", pb);

  // ── Balance Sheet derivations ──────────────────────────────────────────
  const shareCapital = get("Share Capital");
  const reserves     = get("Reserves & Surplus");
  const netWorth     = get("Net Worth");
  const ltBorrow     = get("Long Term Borrowings");
  const stBorrow     = get("Short Term Borrowings");
  const totalDebt    = get("Total Debt");
  const inventory    = get("Inventory");
  const receivables  = get("Trade Receivables");
  const cash         = get("Cash & Bank");
  const otherCA      = get("Other Current Assets");
  const currentAssets= get("Current Assets");
  const tradePay     = get("Trade Payables");
  const otherCL      = get("Other Current Liabilities");
  const currentLiab  = get("Current Liabilities");
  const fixedAssets  = get("Fixed Assets (Net)");
  const totalAssets  = get("Total Assets");

  if (netWorth === null && shareCapital !== null && reserves !== null)
    add("Net Worth", shareCapital + reserves);

  if (totalDebt === null) {
    const lt = ltBorrow ?? 0;
    const st = stBorrow ?? 0;
    if (ltBorrow !== null || stBorrow !== null)
      add("Total Debt", lt + st);
  }

  const nw = netWorth ?? get("Net Worth");
  const lt = ltBorrow ?? 0;
  if (get("Capital Employed") === null && nw !== null)
    add("Capital Employed", nw + lt);

  if (currentAssets === null) {
    const parts = [inventory, receivables, cash, otherCA].filter((v): v is number => v !== null);
    if (parts.length >= 2) add("Current Assets", parts.reduce((a, b) => a + b, 0));
  }

  if (get("Current Liabilities") === null) {
    const stB = stBorrow ?? 0;
    const tp  = tradePay ?? 0;
    const cl  = otherCL  ?? 0;
    if (stBorrow !== null || tradePay !== null || otherCL !== null)
      add("Current Liabilities", stB + tp + cl);
  }

  const ca = currentAssets ?? get("Current Assets");
  const cl = currentLiab  ?? get("Current Liabilities");
  if (get("Working Capital") === null && ca !== null && cl !== null)
    add("Working Capital", ca - cl);

  if (totalAssets === null && fixedAssets !== null && ca !== null)
    add("Total Assets", fixedAssets + ca);

  return result;
}

export function icLiVal(items: LineItem[], label: string): number | null {
  const it = items.find(i => i.label === label);
  if (!it) return null;
  return it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
}

export function icFmt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function FV({ v, abbr, calc }: { v: number | null | undefined; abbr: string; calc?: boolean }) {
  if (v === null || v === undefined || !Number.isFinite(v as number))
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className={calc ? "text-amber-600" : "text-foreground"}>
      {icFmt(v)}{abbr && <span className="text-[10px] text-muted-foreground ml-0.5">{abbr}</span>}
    </span>
  );
}

// ── Provisional data types (shared by ICHistoricalTables + ICProjectionsTable) ──
type ProvLineItem = { label: string; value: number | null; override_value?: number | null };
type ProvPeriodShape = { fiscal_year: number; months_covered?: number; pl?: ProvLineItem[]; bs?: ProvLineItem[] };

function provLiVal(items: ProvLineItem[] | undefined, label: string): number | null {
  const it = items?.find(i => i.label === label);
  if (!it) return null;
  const v = it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
  return v !== null && Number.isFinite(Number(v)) ? Number(v) : null;
}

export function ICHistoricalTables({
  extracted,
  provisional,
  cellEdits,
  customRows,
  onCellEdit,
  onAddRow,
}: {
  extracted: ExtractedRow[];
  provisional?: ProvPeriodShape[];
  cellEdits?: Record<string, Record<number, number>>;
  customRows?: string[];
  onCellEdit?: (rowLabel: string, fy: number, val: number | null) => void;
  onAddRow?: (label: string) => void;
}) {
  const [editCell, setEditCell] = useState<{ label: string; fy: number; val: string } | null>(null);

  const years = Array.from(new Set(
    extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year)
  )).sort();
  const annualProv = (provisional ?? []).filter(p => (p.months_covered ?? 12) >= 12);
  if (years.length === 0 && annualProv.length === 0) return <div className="text-muted-foreground text-sm">No historical data extracted.</div>;

  const unit = extracted.find(r => r.unit)?.unit;
  const unitLabel = unit ? `₹ ${unit}` : "₹";
  const abbr = unitAbbr(unit);
  const fyItems = years.map(y => icGetItems(extracted, y));

  const isCalc = (items: LineItem[], label: string) =>
    items.find(i => i.label === label)?.note === "auto-derived";

  const plLabels = ["Turnover", "Cost of Goods Sold", "Gross Profit", "Operating Expenses", "EBITDA", "Depreciation", "EBIT", "Interest Expense", "Profit Before Tax", "Tax", "PAT"];
  const bsLabels = ["Share Capital", "Reserves & Surplus", "Net Worth", "Long Term Borrowings", "Short Term Borrowings", "Total Debt", "Trade Payables", "Other Current Liabilities", "Current Liabilities", "Inventory", "Trade Receivables", "Cash & Bank", "Other Current Assets", "Current Assets", "Fixed Assets (Net)", "Total Assets", "Capital Employed", "Working Capital"];
  const cfLabels = ["Cash from Operations", "Cash from Investing", "Cash from Financing", "Net Change in Cash", "Opening Cash", "Closing Cash"];

  const commitEdit = () => {
    if (!editCell) return;
    const val = parseFloat(editCell.val);
    onCellEdit?.(editCell.label, editCell.fy, Number.isFinite(val) ? val : null);
    setEditCell(null);
  };

  const renderTable = (allLabels: string[], title: string, provKey?: "pl" | "bs") => {
    const extraLabels = (customRows ?? []).filter(l => !allLabels.includes(l));
    const activeLabels = allLabels.filter(label =>
      fyItems.some(items => icLiVal(items, label) !== null)
      || (provKey && annualProv.some(p => provLiVal(p[provKey], label) !== null))
      || (cellEdits?.[label] && Object.keys(cellEdits[label]).length > 0)
    );
    const displayLabels = [...activeLabels, ...extraLabels];
    if (displayLabels.length === 0) return null;
    return (
      <div>
        <SectionLabel>{title} · {unitLabel}</SectionLabel>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-1.5 font-medium">Item</th>
              {years.map(y => <th key={y} className="text-right font-medium">FY{y}</th>)}
              {annualProv.map(p => (
                <th key={`pv-${p.fiscal_year}`} className="text-right font-medium text-amber-600">FY{p.fiscal_year} (Prov)</th>
              ))}
              {years.length >= 2 && <th className="text-right font-medium text-primary/70">YoY %</th>}
            </tr>
          </thead>
          <tbody>
            {displayLabels.map(label => {
              const isCustom = extraLabels.includes(label);
              const rawVals = fyItems.map(items => icLiVal(items, label));
              const vals = rawVals.map((v, i) => {
                const override = cellEdits?.[label]?.[years[i]];
                return override !== undefined ? override : v;
              });
              const calcFlags = fyItems.map(items => isCalc(items, label));
              const last = vals[vals.length - 1];
              const prev = vals.length >= 2 ? vals[vals.length - 2] : null;
              const yoyPct = (last !== null && prev !== null && prev !== 0)
                ? ((last - prev) / Math.abs(prev)) * 100 : null;
              const anyCalc = !isCustom && calcFlags.some(Boolean);
              return (
                <tr key={label} className="border-b border-border/30">
                  <td className="py-1.5">
                    <span className={isCustom ? "text-blue-600" : anyCalc ? "text-amber-600" : "text-foreground"}>{label}</span>
                    {anyCalc && <span className="ml-1.5 text-[10px] text-amber-500">(calc)</span>}
                    {isCustom && <span className="ml-1.5 text-[10px] text-blue-400">(custom)</span>}
                  </td>
                  {vals.map((v, i) => {
                    const fy = years[i];
                    const isEditing = editCell?.label === label && editCell?.fy === fy;
                    return (
                      <td
                        key={i}
                        className="text-right tabular-nums cursor-pointer"
                        onClick={() => setEditCell({ label, fy, val: v !== null ? String(v) : "" })}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            type="number"
                            style={{ width: "100%", textAlign: "right", background: "rgba(139,105,20,0.08)", border: "1px solid #C4A04A", outline: "none", fontFamily: "inherit", fontSize: "inherit" }}
                            value={editCell!.val}
                            onChange={e => setEditCell(prev => prev ? { ...prev, val: e.target.value } : null)}
                            onBlur={commitEdit}
                            onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
                          />
                        ) : (
                          <FV v={v} abbr={abbr} calc={!isCustom && calcFlags[i]} />
                        )}
                      </td>
                    );
                  })}
                  {provKey && annualProv.map((p, i) => (
                    <td key={`pv-${i}`} className="text-right tabular-nums text-amber-600">
                      <FV v={provLiVal(p[provKey], label)} abbr={abbr} />
                    </td>
                  ))}
                  {years.length >= 2 && (
                    <td className={`text-right tabular-nums text-[11px] ${yoyPct !== null ? (yoyPct > 0 ? "text-green-600" : yoyPct < 0 ? "text-red-600" : "text-muted-foreground") : "text-muted-foreground"}`}>
                      {yoyPct !== null ? (yoyPct > 0 ? "+" : "") + yoyPct.toFixed(1) + "%" : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {onAddRow && (
          <button
            onClick={() => { const l = prompt("Row label:"); if (l?.trim()) onAddRow(l.trim()); }}
            style={{ fontSize: 9, marginTop: 4, padding: "2px 8px", border: "1px dashed rgba(139,105,20,0.3)", background: "transparent", color: "rgba(139,105,20,0.6)", cursor: "pointer", borderRadius: 3 }}
          >
            + Row
          </button>
        )}
      </div>
    );
  };

  const hasCF = fyItems.some(items => cfLabels.some(l => icLiVal(items, l) !== null));

  return (
    <div className="space-y-5">
      {renderTable(plLabels, "P&L Summary", "pl")}
      {renderTable(bsLabels, "Balance Sheet", "bs")}
      {hasCF && renderTable(cfLabels, "Cash Flow Statement")}
      {annualProv.length > 0 && (
        <p className="text-[10px] text-amber-600">
          Columns marked <span className="font-semibold">(Prov)</span> are provisional/MIS data — unaudited.
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Values marked <span className="text-amber-500">(calc)</span> are auto-derived from available data. All other values were extracted directly from source documents.
      </p>
    </div>
  );
}

export function ICProjectionsTable({
  extracted,
  provisional,
  cellEdits,
  customRows,
  onCellEdit,
  onAddRow,
}: {
  extracted: ExtractedRow[];
  provisional?: ProvPeriodShape[];
  cellEdits?: Record<string, Record<number, number>>;
  customRows?: string[];
  onCellEdit?: (rowLabel: string, fy: number, val: number | null) => void;
  onAddRow?: (label: string) => void;
}) {
  const [editCell, setEditCell] = useState<{ label: string; fy: number; val: string } | null>(null);

  const projRows = extracted.filter(r => r.statement_type === "projections");
  const annualProv = (provisional ?? []).filter(p => (p.months_covered ?? 12) >= 12);
  if (projRows.length === 0 && annualProv.length === 0 && (customRows ?? []).length === 0)
    return <div className="text-muted-foreground text-sm">No projection or provisional data available.</div>;

  const unit = extracted.find(r => r.unit)?.unit;
  const unitLabel = unit ? `₹ ${unit}` : "₹";
  const abbr = unitAbbr(unit);
  const histYears = Array.from(new Set(
    extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year)
  )).sort();
  const projYears = Array.from(new Set(projRows.map(r => r.fiscal_year))).sort();
  const provYears = annualProv.map(p => p.fiscal_year);
  const basePairs: [string, string][] = [
    ["Turnover", "Projected Turnover"],
    ["EBITDA", "Projected EBITDA"],
    ["PAT", "Projected PAT"],
    ["Net Worth", "Projected Net Worth"],
    ["Total Debt", "Projected Total Debt"],
  ];
  const extraPairs: [string, string][] = (customRows ?? []).map(l => [l, l]);
  const pairs = [...basePairs, ...extraPairs];

  const PROJ_ALIAS: Record<string, string[]> = {
    "Projected Turnover":   ["Projected Turnover", "Revenue", "Total Income", "Turnover"],
    "Projected EBITDA":     ["Projected EBITDA", "EBITDA", "Gross Profit"],
    "Projected PAT":        ["Projected PAT", "PAT", "PBT"],
    "Projected Net Worth":  ["Projected Net Worth", "Net Worth"],
    "Projected Total Debt": ["Projected Total Debt", "Total Debt"],
  };
  function projLiVal(items: LineItem[], ...labels: string[]): number | null {
    for (const lb of labels) { const v = icLiVal(items, lb); if (v !== null) return v; }
    return null;
  }

  const commitEdit = () => {
    if (!editCell) return;
    const val = parseFloat(editCell.val);
    onCellEdit?.(editCell.label, editCell.fy, Number.isFinite(val) ? val : null);
    setEditCell(null);
  };

  const allYears = [...histYears, ...provYears, ...projYears];

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">{unitLabel} · A=Actual · Prov=Provisional · P=Projected</p>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left py-1.5 font-medium">Metric</th>
            {histYears.map(y => <th key={`a-${y}`} className="text-right font-medium">FY{y} (A)</th>)}
            {provYears.map(y => <th key={`pv-${y}`} className="text-right font-medium text-amber-600">FY{y} (Prov)</th>)}
            {projYears.map(y => <th key={`p-${y}`} className="text-right font-medium text-primary/70">FY{y} (P)</th>)}
          </tr>
        </thead>
        <tbody>
          {pairs.map(([histLabel, projLabel]) => {
            const isCustom = extraPairs.some(([l]) => l === histLabel);
            return (
              <tr key={histLabel} className="border-b border-border/30">
                <td className="py-1.5">
                  <span className={isCustom ? "text-blue-600" : "text-foreground"}>{histLabel}</span>
                  {isCustom && <span className="ml-1.5 text-[10px] text-blue-400">(custom)</span>}
                </td>
                {histYears.map(y => {
                  const rawV = icLiVal(icGetItems(extracted, y), histLabel);
                  const override = cellEdits?.[histLabel]?.[y];
                  const v = override !== undefined ? override : rawV;
                  const isEditing = editCell?.label === histLabel && editCell?.fy === y;
                  return (
                    <td key={y} className="text-right tabular-nums cursor-pointer" onClick={() => setEditCell({ label: histLabel, fy: y, val: v !== null ? String(v) : "" })}>
                      {isEditing ? (
                        <input
                          autoFocus type="number"
                          style={{ width: "100%", textAlign: "right", background: "rgba(139,105,20,0.08)", border: "1px solid #C4A04A", outline: "none", fontFamily: "inherit", fontSize: "inherit" }}
                          value={editCell!.val}
                          onChange={e => setEditCell(prev => prev ? { ...prev, val: e.target.value } : null)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
                        />
                      ) : <FV v={v} abbr={abbr} />}
                    </td>
                  );
                })}
                {annualProv.map((p, i) => {
                  const rawV = provLiVal(p.pl, histLabel);
                  const override = cellEdits?.[histLabel]?.[provYears[i]];
                  const v = override !== undefined ? override : rawV;
                  const isEditing = editCell?.label === histLabel && editCell?.fy === provYears[i];
                  return (
                    <td key={i} className="text-right tabular-nums text-amber-600 cursor-pointer" onClick={() => setEditCell({ label: histLabel, fy: provYears[i], val: v !== null ? String(v) : "" })}>
                      {isEditing ? (
                        <input
                          autoFocus type="number"
                          style={{ width: "100%", textAlign: "right", background: "rgba(139,105,20,0.08)", border: "1px solid #C4A04A", outline: "none", fontFamily: "inherit", fontSize: "inherit" }}
                          value={editCell!.val}
                          onChange={e => setEditCell(prev => prev ? { ...prev, val: e.target.value } : null)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
                        />
                      ) : <FV v={v} abbr={abbr} />}
                    </td>
                  );
                })}
                {projYears.map(y => {
                  const items = (projRows.find(r => r.fiscal_year === y)?.line_items ?? []) as unknown as LineItem[];
                  const rawV = projLiVal(items, ...(PROJ_ALIAS[projLabel] ?? [projLabel]));
                  const override = cellEdits?.[histLabel]?.[y];
                  const v = override !== undefined ? override : rawV;
                  const isEditing = editCell?.label === histLabel && editCell?.fy === y;
                  return (
                    <td key={y} className="text-right tabular-nums cursor-pointer" onClick={() => setEditCell({ label: histLabel, fy: y, val: v !== null ? String(v) : "" })}>
                      {isEditing ? (
                        <input
                          autoFocus type="number"
                          style={{ width: "100%", textAlign: "right", background: "rgba(139,105,20,0.08)", border: "1px solid #C4A04A", outline: "none", fontFamily: "inherit", fontSize: "inherit" }}
                          value={editCell!.val}
                          onChange={e => setEditCell(prev => prev ? { ...prev, val: e.target.value } : null)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
                        />
                      ) : <FV v={v} abbr={abbr} />}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {onAddRow && (
        <button
          onClick={() => { const l = prompt("Row label:"); if (l?.trim()) onAddRow(l.trim()); }}
          style={{ fontSize: 9, marginTop: 4, padding: "2px 8px", border: "1px dashed rgba(139,105,20,0.3)", background: "transparent", color: "rgba(139,105,20,0.6)", cursor: "pointer", borderRadius: 3 }}
        >
          + Row
        </button>
      )}
      {/* suppress unused var warning */}
      {allYears.length === 0 && null}
    </div>
  );
}

export function ICRatioTable({ ratios }: { ratios: RatioRow[] }) {
  if (ratios.length === 0) return <div className="text-muted-foreground text-sm">No ratios computed. Run ratio analysis first.</div>;
  const years = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const categories = Array.from(new Set(ratios.map(r => r.category)));

  return (
    <div className="space-y-5">
      {categories.map(cat => {
        const names = Array.from(new Set(ratios.filter(r => r.category === cat).map(r => r.ratio_name)));
        return (
          <div key={cat}>
            <SectionLabel>{cat}</SectionLabel>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1.5 font-medium">Ratio</th>
                  {years.map(y => <th key={y} className="text-right font-medium">FY{y}</th>)}
                  <th className="text-right font-medium">Benchmark</th>
                </tr>
              </thead>
              <tbody>
                {names.map(name => {
                  const latest = ratios.filter(r => r.ratio_name === name).sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
                  const latestStatus = latest?.threshold_status ?? "na";
                  return (
                    <tr key={name} className="border-b border-border/30">
                      <td className="py-1.5 text-foreground">{RATIO_DISPLAY_NAMES[name] ?? name}</td>
                      {years.map(y => {
                        const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y);
                        const val = r?.ratio_value != null ? Number(r.ratio_value) : null;
                        const s = r?.threshold_status ?? "na";
                        return (
                          <td key={y} className="text-right pr-2">
                            <span className="tabular-nums text-foreground mr-1.5">{formatRatio(name, val)}</span>
                            <StatusBadge status={s} />
                          </td>
                        );
                      })}
                      <td className="text-right tabular-nums text-muted-foreground">
                        {latest?.benchmark != null ? formatRatio(name, Number(latest.benchmark)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export function ICRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <tr className="border-b border-border/40">
      <td className="py-2 w-44 text-muted-foreground text-sm">{label}</td>
      <td className="py-2 text-foreground text-sm">{String(value)}</td>
    </tr>
  );
}

type MCADirector = {
  id: string;
  name: string;
  din?: string | null;
  designation?: string | null;
  appointed_current?: string | null;
  shareholding?: string | null;
  age?: string | null;
  gender?: string | null;
};

export function ICClientProfile({
  cc,
  company,
  directors,
}: {
  cc: CaseRow;
  company?: Record<string, string | null> | null;
  directors?: MCADirector[] | null;
  onCasePatch?: (field: string, val: string | number | null) => Promise<void>;
}) {
  const product = PRODUCTS[cc.product_type];

  const fmtCap = (v: string | null | undefined) => {
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("en-IN") : v;
  };

  return (
    <div className="space-y-4">
      {/* ── MCA Company Profile (when company data is present) ── */}
      {company && (
        <div className="space-y-4">
          <SectionLabel>MCA / Corporate Profile</SectionLabel>
          <table className="w-full">
            <tbody>
              {[
                ["Legal Constitution",  company.mca_category],
                ["Year Established",    company.mca_date_of_incorp],
                ["MCA CIN",            company.mca_cin],
                ["PAN",                company.mca_pan],
                ["Category",           company.mca_category],
                ["Sub-Category",       company.mca_sub_category],
                ["Company Type",       company.mca_type],
                ["Authorised Capital", fmtCap(company.mca_authorized_capital)],
                ["Paid Up Capital",    fmtCap(company.mca_paid_up_capital)],
                ["Status",             company.mca_status],
                ["NSE Sector",         company.mca_nse_sector],
                ["Sector",             company.mca_sector],
                ["Products / Services",company.mca_products_services],
                ["Email",              company.mca_email],
                ["Telephone",          company.mca_telephone],
                ["Incorporation Date", company.mca_date_of_incorp],
                ["Last Balance Sheet", company.mca_date_last_bs],
                ["Last AGM",           company.mca_date_last_agm],
                ["Registered Address", company.registered_address],
              ].map(([label, value]) =>
                value ? (
                  <tr key={label as string} className="border-b border-border/40">
                    <td className="py-1.5 w-44 text-muted-foreground text-xs">{label}</td>
                    <td className="py-1.5 text-foreground text-sm">{value as string}</td>
                  </tr>
                ) : null
              )}
            </tbody>
          </table>

          {/* Directors table */}
          {directors && directors.length > 0 && (
            <div>
              <SectionLabel>Directors / Key Persons</SectionLabel>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      {["Name", "DIN", "Designation", "Appointed", "Shareholding %", "Age"].map(h => (
                        <th key={h} className="text-left py-1.5 px-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {directors.map(d => (
                      <tr key={d.id} className="border-b border-border/30">
                        <td className="py-1.5 px-2 text-foreground font-medium">{d.name}</td>
                        <td className="py-1.5 px-2 text-muted-foreground font-mono">{d.din ?? "—"}</td>
                        <td className="py-1.5 px-2 text-foreground">{d.designation ?? "—"}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{d.appointed_current ?? "—"}</td>
                        <td className="py-1.5 px-2 text-foreground">{d.shareholding ?? "—"}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{d.age ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MCA About / Corpository narrative */}
          {company.mca_about && (
            <div>
              <SectionLabel>MCA / Corpository Profile Narrative</SectionLabel>
              <blockquote className="border-l-4 border-border bg-surface-2/40 rounded-r-lg px-4 py-3">
                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{company.mca_about}</p>
              </blockquote>
            </div>
          )}
        </div>
      )}

      {/* ── Fallback cc-based rows when no company data ── */}
      {!company && (
        <table className="w-full">
          <tbody>
            <ICRow label="Client Name" value={cc.client_name} />
            <ICRow label="Legal Constitution" value={cc.legal_constitution} />
            <ICRow label="Industry / Sector" value={cc.industry} />
            <ICRow label="Year Established" value={cc.year_established} />
            <ICRow label="Product Applied For" value={product.label} />
            <ICRow label="Principal Borrower" value={cc.principal_borrower} />
            <ICRow label="Website" value={cc.website} />
          </tbody>
        </table>
      )}

      {/* ── Promoter & Group (always shown below MCA block) ── */}
      {cc.promoter_details && (
        <div>
          <SectionLabel>Promoter Details</SectionLabel>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{cc.promoter_details}</p>
        </div>
      )}
      {cc.group_summary && (
        <div>
          <SectionLabel>Group Summary</SectionLabel>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{cc.group_summary}</p>
        </div>
      )}
    </div>
  );
}

export function ICInvestmentStructure({ cc }: { cc: CaseRow }) {
  const product = PRODUCTS[cc.product_type];
  return (
    <div className="space-y-4">
      <table className="w-full">
        <tbody>
          <ICRow label="Product / Facility Type" value={product.label} />
          <ICRow label="Legal Nature" value={product.legalNature} />
          <ICRow label="Return Mechanism" value={product.returnMechanism} />
          <ICRow label="Proposed Amount" value={cc.deal_amount != null ? `₹${Number(cc.deal_amount).toLocaleString("en-IN")} Crores` : null} />
          <ICRow label="Tenure" value={cc.tenure_months != null ? `${cc.tenure_months} Months` : null} />
          <ICRow label="Expected IRR" value={cc.expected_irr != null ? `${cc.expected_irr}%` : null} />
          <ICRow label="Residual Value" value={cc.residual_value != null ? `₹${Number(cc.residual_value).toLocaleString("en-IN")}` : null} />
          <ICRow label="Security Deposit" value={cc.security_deposit != null ? `₹${Number(cc.security_deposit).toLocaleString("en-IN")}` : null} />
        </tbody>
      </table>
      {cc.end_use && (
        <div>
          <SectionLabel>End Use of Funds</SectionLabel>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{cc.end_use}</p>
        </div>
      )}
      {cc.collateral_summary && (
        <div>
          <SectionLabel>Collateral / Security</SectionLabel>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{cc.collateral_summary}</p>
        </div>
      )}
    </div>
  );
}

export function ICRehbarHistory({ cc }: { cc: CaseRow }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <SectionLabel>Rehbar Financial Services — Funder Profile</SectionLabel>
        <table className="w-full">
          <tbody>
            <ICRow label="Legal Entity" value="Rehbar Financial Services" />
            <ICRow label="Business Model" value="Sharia-compliant NBFC — asset financing & structured credit" />
            <ICRow label="Core Products" value="Operating Lease · Finance Lease · PLS · Project Finance · Trade Finance · Home Loan" />
            <ICRow label="Return Framework" value="Fixed rental / IRR / profit-share depending on product" />
            <ICRow label="Website" value="rehbar.co.in" />
          </tbody>
        </table>
      </div>
      <div>
        <SectionLabel>Prior Exposure to {cc.client_name}</SectionLabel>
        <p className="text-sm text-muted-foreground italic">No prior Rehbar funding history on record for this client. This appears to be a new relationship.</p>
      </div>
    </div>
  );
}

interface VisitAttachment {
  id: string;
  file_name: string;
  file_path: string;
  mime_type: string;
  category: string;
  uploaded_at: string;
  signedUrl: string;
}

export function ICVisitReference({ cc }: { cc: CaseRow }) {
  const icNote = (cc.ic_note as Record<string, unknown> | null) ?? {};
  const vr = icNote["visit_report"] as {
    checklist?: Record<string, { status: string; source: string; notes: string }>;
    overall_notes?: string;
    exec_recommendation?: string;
  } | undefined;

  const CHECKS = [
    { key: "banker_reference",   label: "Banker Reference",        defaultSource: "Principal Bank" },
    { key: "vendor_check",       label: "Vendor / Supplier Check", defaultSource: "Key Suppliers" },
    { key: "customer_reference", label: "Customer Reference",      defaultSource: "Major Clients" },
    { key: "site_visit",         label: "Site Visit",              defaultSource: "Business Premises" },
  ];

  // Local statuses — seeded from saved data, editable inline
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(CHECKS.map(c => [c.key, vr?.checklist?.[c.key]?.status ?? "pending"])),
  );
  const [saving, setSaving] = useState<string | null>(null);

  const [attachments, setAttachments] = useState<VisitAttachment[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("visit_report_attachments" as never)
        .select("*")
        .eq("case_id", cc.id)
        .order("uploaded_at", { ascending: true });
      if (cancelled || !data) return;
      const rows = data as Omit<VisitAttachment, "signedUrl">[];
      const signed = await Promise.all(
        rows.map(async r => {
          const { data: sd } = await supabase.storage.from("case-files").createSignedUrl(r.file_path, 3600);
          return { ...r, signedUrl: sd?.signedUrl ?? "" };
        }),
      );
      if (!cancelled) setAttachments(signed);
    })();
    return () => { cancelled = true; };
  }, [cc.id]);

  async function updateStatus(key: string, newStatus: string) {
    setStatuses(s => ({ ...s, [key]: newStatus }));
    setSaving(key);
    try {
      const existing = (cc.ic_note as Record<string, unknown> | null) ?? {};
      const existingVr = (existing["visit_report"] as Record<string, unknown>) ?? {};
      const existingChecklist = (existingVr["checklist"] as Record<string, unknown>) ?? {};
      const existingItem = (existingChecklist[key] as Record<string, unknown>) ?? {};
      const updated = {
        ...existing,
        visit_report: {
          ...existingVr,
          checklist: {
            ...existingChecklist,
            [key]: { ...existingItem, status: newStatus },
          },
        },
      };
      await supabase.from("credit_cases").update({ ic_note: updated }).eq("id", cc.id);
    } finally {
      setSaving(null);
    }
  }

  const statusSelectCls = (s: string) =>
    s === "done" ? "bg-emerald-50 text-emerald-800 border-emerald-300" :
    s === "na"   ? "bg-slate-100 text-slate-600 border-slate-300" :
                   "bg-amber-50 text-amber-800 border-amber-300";

  const photos    = attachments.filter(a => a.category === "photo");
  const documents = attachments.filter(a => a.category === "document");

  function fileIcon(name: string) {
    if (name.match(/\.pdf$/i))   return "📄";
    if (name.match(/\.xlsx?$/i)) return "📊";
    if (name.match(/\.docx?$/i)) return "📝";
    return "📁";
  }

  return (
    <div className="space-y-5">
      {/* ── Reference checklist ─────────────────────────────────────────── */}
      <div>
        <SectionLabel>Reference Check Status</SectionLabel>
        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-1.5 font-medium">Check Type</th>
              <th className="text-left font-medium">Source</th>
              <th className="text-left font-medium w-32">Status</th>
            </tr>
          </thead>
          <tbody>
            {CHECKS.map(({ key, label, defaultSource }) => {
              const item  = vr?.checklist?.[key];
              const status = statuses[key] ?? "pending";
              return (
                <tr key={key} className="border-b border-border/30">
                  <td className="py-2 text-foreground">{label}</td>
                  <td className="text-muted-foreground text-xs">{item?.source || defaultSource}</td>
                  <td className="py-1.5">
                    <div className="relative">
                      <select
                        value={status}
                        disabled={saving === key}
                        onChange={e => updateStatus(key, e.target.value)}
                        className={`appearance-none w-full text-[10px] font-bold tracking-widest border px-2 py-1 pr-6 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${statusSelectCls(status)} ${saving === key ? "opacity-50 cursor-wait" : ""}`}
                      >
                        <option value="pending">PENDING</option>
                        <option value="done">DONE</option>
                        <option value="na">N/A</option>
                      </select>
                      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] opacity-50">▾</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Per-check findings ──────────────────────────────────────────── */}
      {CHECKS.some(({ key }) => vr?.checklist?.[key]?.notes) && (
        <div className="space-y-2">
          <SectionLabel>Reference Check Findings</SectionLabel>
          {CHECKS.map(({ key, label }) => {
            const notes = vr?.checklist?.[key]?.notes;
            if (!notes) return null;
            return (
              <div key={key} className="border-l-2 border-primary/30 pl-3 py-1">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">{label}</div>
                <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{notes}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Site visit observations ─────────────────────────────────────── */}
      {vr?.overall_notes ? (
        <div>
          <SectionLabel>Site Visit Observations</SectionLabel>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{vr.overall_notes}</p>
        </div>
      ) : cc.analyst_notes ? (
        <div>
          <SectionLabel>Analyst Notes</SectionLabel>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{cc.analyst_notes}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">No visit observations recorded. Add via the Visit Report tab.</p>
      )}

      {/* ── Exec recommendation ─────────────────────────────────────────── */}
      {vr?.exec_recommendation && (
        <div>
          <SectionLabel>Executive Recommendation</SectionLabel>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{vr.exec_recommendation}</p>
        </div>
      )}

      {/* ── Facility photos ─────────────────────────────────────────────── */}
      {photos.length > 0 && (
        <div>
          <SectionLabel>Facility Photos ({photos.length})</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
            {photos.map(att => (
              <div key={att.id} className="border border-border/60 overflow-hidden">
                <a href={att.signedUrl} target="_blank" rel="noopener noreferrer">
                  <img
                    src={att.signedUrl}
                    alt={att.file_name}
                    className="w-full h-32 object-cover"
                  />
                </a>
                <div className="px-2 py-1 bg-muted/20 border-t border-border/40">
                  <div className="text-[8px] text-muted-foreground truncate" title={att.file_name}>{att.file_name}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Documents ───────────────────────────────────────────────────── */}
      {documents.length > 0 && (
        <div>
          <SectionLabel>Documents ({documents.length})</SectionLabel>
          <div className="space-y-1.5 mt-2">
            {documents.map(att => (
              <a
                key={att.id}
                href={att.signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 border border-border/60 px-3 py-2 hover:bg-muted/20 transition-colors"
              >
                <span className="text-base shrink-0">{fileIcon(att.file_name)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-primary truncate">{att.file_name}</div>
                  <div className="text-[9px] text-muted-foreground">
                    {new Date(att.uploaded_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </div>
                </div>
                <span className="text-[9px] text-muted-foreground shrink-0">↗</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ICProductSpecifics({ cc }: { cc: CaseRow }) {
  const product = PRODUCTS[cc.product_type];
  return (
    <div className="space-y-4">
      <table className="w-full">
        <tbody>
          <ICRow label="Product" value={product.label} />
          <ICRow label="Short Code" value={product.short} />
          <ICRow label="Legal Nature" value={product.legalNature} />
          <ICRow label="Return Mechanism" value={product.returnMechanism} />
        </tbody>
      </table>
      <div>
        <SectionLabel>SOP Rules Applicable to {product.short}</SectionLabel>
        <ul className="space-y-1.5">
          {product.rules.map((r, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-1.5 shrink-0" />
              <span className="text-foreground">{r}</span>
            </li>
          ))}
        </ul>
      </div>
      {cc.policy_exceptions && (
        <div>
          <SectionLabel>Policy Exceptions</SectionLabel>
          <p className="text-sm text-amber-700 whitespace-pre-wrap">{cc.policy_exceptions}</p>
        </div>
      )}
    </div>
  );
}
