import React from "react";
import { SlideShell } from "./SlideShell";
import type { ExtractedRow } from "@/features/case/types";
import { icGetItems, icLiVal, icFmt } from "@/tabs/case/ic/ICComponents";

const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  altRow:  "#F5F5F0",
  body:    "#1C1C1E",
  muted:   "#888888",
  green:   "#15803D",
  red:     "#B91C1C",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

type RawItem = { label: string; value: number | null; override_value?: number | null };

function scaleToDisplay(v: number | null, unit: string | null): number | null {
  if (v === null) return null;
  const u = (unit ?? "").toLowerCase();
  if (u.includes("lakh") || u.includes("crore") || u.includes("million") || u.includes("thousand")) return v;
  return v / 100000;
}

function getRawVal(rows: ExtractedRow[], fy: number, label: string): number | null {
  for (const row of rows.filter(r => r.fiscal_year === fy)) {
    const item = (row.line_items as unknown as RawItem[]).find(i => i.label === label);
    if (item) {
      const v = item.override_value !== undefined && item.override_value !== null ? item.override_value : item.value;
      if (v !== null) return scaleToDisplay(Number(v), row.unit);
    }
  }
  return null;
}

function yoyColor(curr: number | null, prev: number | null): string {
  if (curr == null || prev == null || prev === 0) return DS.muted;
  return ((curr - prev) / Math.abs(prev)) > 0 ? DS.green : DS.red;
}

interface CashFlowCardProps {
  extracted: ExtractedRow[];
  pageNum: number;
}

export function CashFlowCard({ extracted, pageNum }: CashFlowCardProps) {
  const cfRows = extracted.filter(r => r.statement_type === "cash_flow");
  const histRows = extracted.filter(r => r.statement_type !== "projections");
  const histYears = Array.from(new Set(histRows.map(r => r.fiscal_year))).sort();
  const shownYears = histYears.slice(-5);

  // ── Case 1: Actual cash flow statement uploaded ────────────────────────────
  if (cfRows.length > 0) {
    const cfYears = Array.from(new Set(cfRows.map(r => r.fiscal_year))).sort().slice(-5);

    // Collect all unique labels
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const row of cfRows) {
      for (const item of (row.line_items as unknown as RawItem[]) ?? []) {
        if (item.label && !seen.has(item.label)) {
          seen.add(item.label);
          labels.push(item.label);
        }
      }
    }
    const activeLabels = labels.filter(label =>
      cfYears.some(y => getRawVal(cfRows, y, label) !== null)
    );

    const rawUnit = cfRows.find(r => r.unit)?.unit ?? null;
    const unitLabel = rawUnit
      ? rawUnit.toLowerCase().includes("lakh") ? "Lakhs"
      : rawUnit.toLowerCase().includes("crore") ? "Crores"
      : "Lakhs"
      : "Lakhs";

    return (
      <SlideShell roman="VIII" title={`Cash Flow Statement (₹ ${unitLabel})`} pageNum={pageNum}>
        <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: DS.gold }}>
                <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: DS.body, width: "34%" }}>Line Item</th>
                {cfYears.map(y => (
                  <th key={y} style={{ padding: "7px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: DS.body }}>FY{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeLabels.map((label, i) => (
                <tr key={label} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow }}>
                  <td style={{ padding: "7px 12px", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB" }}>{label}</td>
                  {cfYears.map((y, vi) => (
                    <td key={vi} style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums" }}>
                      {icFmt(getRawVal(cfRows, y, label))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SlideShell>
    );
  }

  // ── Case 2: No actual CF — compute derived (indirect method) ──────────────
  if (shownYears.length < 2) {
    return (
      <SlideShell roman="VIII" title="Cash Flow Statement" pageNum={pageNum}>
        <div style={{ padding: "32px 24px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic", fontFamily: DS.bodyFont }}>
          No cash flow statement uploaded and insufficient historical data to derive.
        </div>
      </SlideShell>
    );
  }

  // Compute derived CF for each year (from year 1 onwards, need prior year BS)
  const derivedYears = shownYears.slice(1); // delta needs prior year
  const rawUnit = histRows.find(r => r.unit)?.unit ?? null;

  function bs(label: string, fy: number): number | null {
    return scaleToDisplay(icLiVal(icGetItems(histRows, fy), label), rawUnit);
  }
  function pl(label: string, fy: number): number | null {
    return scaleToDisplay(icLiVal(icGetItems(histRows, fy), label), rawUnit);
  }
  function delta(label: string, fy: number): number | null {
    const curr = bs(label, fy);
    const prev = bs(label, shownYears[shownYears.indexOf(fy) - 1]);
    if (curr === null || prev === null) return null;
    return curr - prev;
  }

  interface DerivedCFRow { label: string; isSummary: boolean; getValue: (fy: number) => number | null; indent?: boolean }

  const derivedRows: DerivedCFRow[] = [
    { label: "Operating Cash Flow (CFO)", isSummary: true, getValue: fy => {
      const pat   = pl("PAT", fy);
      const depn  = pl("Depreciation", fy);
      const dAR   = delta("Trade Receivables", fy);
      const dInv  = delta("Inventory", fy);
      const dOCA  = delta("Other Current Assets", fy);
      const dAP   = delta("Trade Payables", fy);
      const dOCL  = delta("Other Current Liabilities", fy);
      const parts = [pat, depn, dAR !== null ? -dAR : null, dInv !== null ? -dInv : null, dOCA !== null ? -dOCA : null, dAP, dOCL];
      if (parts.every(p => p === null)) return null;
      return parts.reduce<number>((s, v) => s + (v ?? 0), 0);
    }},
    { label: "PAT", isSummary: false, indent: true, getValue: fy => pl("PAT", fy) },
    { label: "Add: Depreciation", isSummary: false, indent: true, getValue: fy => pl("Depreciation", fy) },
    { label: "Δ Trade Receivables", isSummary: false, indent: true, getValue: fy => { const d = delta("Trade Receivables", fy); return d !== null ? -d : null; } },
    { label: "Δ Inventory", isSummary: false, indent: true, getValue: fy => { const d = delta("Inventory", fy); return d !== null ? -d : null; } },
    { label: "Δ Trade Payables", isSummary: false, indent: true, getValue: fy => delta("Trade Payables", fy) },
    { label: "Investing Cash Flow (CFI)", isSummary: true, getValue: fy => {
      const depn = pl("Depreciation", fy);
      const dFA  = delta("Fixed Assets (Net)", fy);
      if (dFA === null && depn === null) return null;
      return -((dFA ?? 0) + (depn ?? 0));
    }},
    { label: "Capex (approx.)", isSummary: false, indent: true, getValue: fy => {
      const depn = pl("Depreciation", fy);
      const dFA  = delta("Fixed Assets (Net)", fy);
      if (dFA === null && depn === null) return null;
      return -((dFA ?? 0) + (depn ?? 0));
    }},
    { label: "Financing Cash Flow (CFF)", isSummary: true, getValue: fy => {
      const dLT  = delta("Long Term Borrowings", fy);
      const dST  = delta("Short Term Borrowings", fy);
      const pat  = pl("PAT", fy);
      const dNW  = delta("Net Worth", fy);
      const eq   = (dNW !== null && pat !== null) ? dNW - pat : null;
      const parts = [dLT, dST, eq];
      if (parts.every(p => p === null)) return null;
      return parts.reduce<number>((s, v) => s + (v ?? 0), 0);
    }},
    { label: "Δ Long Term Borrowings", isSummary: false, indent: true, getValue: fy => delta("Long Term Borrowings", fy) },
    { label: "Δ Short Term Borrowings", isSummary: false, indent: true, getValue: fy => delta("Short Term Borrowings", fy) },
    { label: "Net Change in Cash", isSummary: true, getValue: fy => {
      const cfo = derivedRows[0].getValue(fy);
      const cfi = derivedRows[6].getValue(fy);
      const cff = derivedRows[8].getValue(fy);
      if (cfo === null && cfi === null && cff === null) return null;
      return (cfo ?? 0) + (cfi ?? 0) + (cff ?? 0);
    }},
  ];

  // Filter to rows with at least one non-null value
  const activeRows = derivedRows.filter(row =>
    derivedYears.some(y => row.getValue(y) !== null)
  );

  return (
    <SlideShell roman="VIII" title="Cash Flow Statement (₹ Lakhs)" pageNum={pageNum}>
      <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
        {/* Derived badge */}
        <div style={{ margin: "10px 20px 0", padding: "6px 12px", background: "#FFF8E1", border: "1px solid #F5C518", borderRadius: 3, fontSize: 10, color: "#92400E", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 700 }}>⚙ Derived – Indirect Method</span>
          <span style={{ color: DS.muted }}>· computed from BS + P&L · actual cash flow not uploaded</span>
        </div>

        {activeRows.length === 0 ? (
          <div style={{ padding: "24px 20px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic" }}>
            Insufficient data to derive cash flow. Upload the cash flow statement for accurate figures.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead>
              <tr style={{ background: DS.gold }}>
                <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: DS.body, width: "34%" }}>Line Item</th>
                {derivedYears.map(y => (
                  <th key={y} style={{ padding: "7px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: DS.body }}>FY{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeRows.map((row, i) => {
                const vals = derivedYears.map(y => row.getValue(y));
                return (
                  <tr key={row.label} style={{ background: row.isSummary ? "#EBF3FD" : (i % 2 === 0 ? "#FFFFFF" : DS.altRow) }}>
                    <td style={{ padding: "7px 12px", fontSize: row.isSummary ? 11 : 10.5, fontWeight: row.isSummary ? 700 : 400, color: row.isSummary ? DS.body : DS.muted, paddingLeft: row.indent ? 24 : 12, borderBottom: "1px solid #EBEBEB" }}>
                      {row.label}
                    </td>
                    {vals.map((v, vi) => (
                      <td key={vi} style={{ padding: "7px 10px", textAlign: "right", fontSize: row.isSummary ? 11 : 10.5, fontWeight: row.isSummary ? 700 : 400, color: v !== null && v < 0 ? DS.red : (row.isSummary ? DS.body : DS.muted), borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums" }}>
                        {icFmt(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div style={{ padding: "8px 20px", fontSize: 9, color: DS.muted, lineHeight: 1.6, borderTop: "1px solid #EBEBEB", marginTop: 4 }}>
          · CFO: PAT + Depreciation ± working capital changes &nbsp;·&nbsp; CFI: –(ΔNet Fixed Assets + Depreciation) &nbsp;·&nbsp; CFF: ΔBorrowings + Equity raised<br />
          · Upload actual cash flow statement for precise figures
        </div>
      </div>
    </SlideShell>
  );
}
