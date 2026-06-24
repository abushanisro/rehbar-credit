import type { ExtractedRow } from "./types";

export interface DerivedCFRow {
  label: string;
  value: number | null;
  note?: string;
}

export interface DerivedCashFlow {
  years: [number, number];
  cfo: { total: number | null; rows: DerivedCFRow[] };
  cfi: { total: number | null; rows: DerivedCFRow[] };
  cff: { total: number | null; rows: DerivedCFRow[] };
  netChange: number | null;
  openingCash: number | null;
  derivedClosingCash: number | null;
  bsCash: number | null;
  reconciliationGap: number | null;
}

// Resolve an item from a flat dict, returning null if absent or null.
function get(dict: Record<string, number | null>, key: string): number | null {
  return dict[key] ?? null;
}

// Sum non-null values; null if every value is null.
function sumNonNull(rows: DerivedCFRow[]): number | null {
  let total = 0;
  let hasAny = false;
  for (const r of rows) {
    if (r.value !== null) { total += r.value; hasAny = true; }
  }
  return hasAny ? total : null;
}

function delta(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null) return null;
  return curr - prev;
}

export function deriveCashFlow(
  prevYear: number,
  currYear: number,
  pl: Record<string, number | null>,
  bs: Record<string, number | null>,
  prevBs: Record<string, number | null>,
): DerivedCashFlow {

  // ── CFO ─────────────────────────────────────────────────────────────────────
  const pat         = get(pl, "PAT");
  const depreciation = get(pl, "Depreciation");

  // Working capital adjustments: increase in CA = outflow (negative), increase in CL = inflow (positive)
  const dAR  = delta(get(bs, "Trade Receivables"), get(prevBs, "Trade Receivables"));
  const dInv = delta(get(bs, "Inventory"), get(prevBs, "Inventory"));
  const dOCA = delta(get(bs, "Other Current Assets"), get(prevBs, "Other Current Assets"));
  const dAP  = delta(get(bs, "Trade Payables"), get(prevBs, "Trade Payables"));
  const dOCL = delta(get(bs, "Other Current Liabilities"), get(prevBs, "Other Current Liabilities"));

  const cfoRows: DerivedCFRow[] = [
    { label: "PAT",                        value: pat,                                          note: "from P&L" },
    { label: "Add: Depreciation",          value: depreciation,                                 note: "non-cash add-back from P&L" },
    { label: "Δ Trade Receivables",        value: dAR  !== null ? -dAR  : null,                 note: "increase in AR = cash outflow" },
    { label: "Δ Inventory",                value: dInv !== null ? -dInv : null,                 note: "increase in inventory = cash outflow" },
    { label: "Δ Other Current Assets",     value: dOCA !== null ? -dOCA : null,                 note: "increase = cash outflow" },
    { label: "Δ Trade Payables",           value: dAP  !== null ?  dAP  : null,                 note: "increase in AP = cash inflow" },
    { label: "Δ Other Current Liabilities",value: dOCL !== null ?  dOCL : null,                 note: "increase = cash inflow" },
  ];

  // ── CFI ─────────────────────────────────────────────────────────────────────
  // Capex ≈ –(ΔNet Fixed Assets + Depreciation)
  // Derivation: Closing Net = Opening Net + Additions – Depreciation (ignoring disposals)
  // So: Additions = ΔNet + Depreciation
  const dFixed = delta(get(bs, "Fixed Assets (Net)"), get(prevBs, "Fixed Assets (Net)"));
  let capex: number | null = null;
  if (dFixed !== null && depreciation !== null) {
    capex = -(dFixed + depreciation);
  }

  const cfiRows: DerivedCFRow[] = [
    { label: "Capex (approx.)", value: capex, note: "–(Δ Net Fixed Assets + Depreciation); disposals excluded" },
  ];

  // ── CFF ─────────────────────────────────────────────────────────────────────
  const dLTB = delta(get(bs, "Long Term Borrowings"), get(prevBs, "Long Term Borrowings"));
  const dSTB = delta(get(bs, "Short Term Borrowings"), get(prevBs, "Short Term Borrowings"));

  // Equity raised ≈ Δ Net Worth − PAT  (captures fresh share capital + premium; dividends would make this negative)
  const dNetWorth = delta(get(bs, "Net Worth"), get(prevBs, "Net Worth"));
  let equityRaised: number | null = null;
  if (dNetWorth !== null && pat !== null) {
    equityRaised = dNetWorth - pat;
  } else if (dNetWorth !== null) {
    equityRaised = dNetWorth; // best-effort without PAT
  }

  const cffRows: DerivedCFRow[] = [
    { label: "Δ Long Term Borrowings",  value: dLTB, note: "increase = fresh draw-down (inflow)" },
    { label: "Δ Short Term Borrowings", value: dSTB, note: "increase = fresh draw-down (inflow)" },
    { label: "Equity Raised / (Returned)", value: equityRaised, note: "Δ Net Worth – PAT; positive = fresh equity in, negative = buyback or dividends > PAT" },
  ];

  const cfoTotal = sumNonNull(cfoRows);
  const cfiTotal = sumNonNull(cfiRows);
  const cffTotal = sumNonNull(cffRows);

  let netChange: number | null = null;
  if (cfoTotal !== null || cfiTotal !== null || cffTotal !== null) {
    netChange = (cfoTotal ?? 0) + (cfiTotal ?? 0) + (cffTotal ?? 0);
  }

  const openingCash = get(prevBs, "Cash & Bank");
  let derivedClosingCash: number | null = null;
  if (openingCash !== null && netChange !== null) {
    derivedClosingCash = openingCash + netChange;
  }

  const bsCash = get(bs, "Cash & Bank");
  let reconciliationGap: number | null = null;
  if (derivedClosingCash !== null && bsCash !== null) {
    reconciliationGap = derivedClosingCash - bsCash;
  }

  return {
    years: [prevYear, currYear],
    cfo: { total: cfoTotal, rows: cfoRows },
    cfi: { total: cfiTotal, rows: cfiRows },
    cff: { total: cffTotal, rows: cffRows },
    netChange,
    openingCash,
    derivedClosingCash,
    bsCash,
    reconciliationGap,
  };
}

// Convert a JSON line_items array to a flat dict (prefers override_value).
function toDict(lineItems: unknown): Record<string, number | null> {
  const items = lineItems as { label: string; value: number | null; override_value?: number | null }[] | null;
  if (!Array.isArray(items)) return {};
  const dict: Record<string, number | null> = {};
  for (const item of items) {
    dict[item.label] = item.override_value !== undefined && item.override_value !== null
      ? item.override_value
      : item.value;
  }
  return dict;
}

export function buildDerivedCashFlowSeries(extracted: ExtractedRow[]): DerivedCashFlow[] {
  // Group by statement_type and fiscal_year
  const bsByYear = new Map<number, Record<string, number | null>>();
  const plByYear = new Map<number, Record<string, number | null>>();

  for (const row of extracted) {
    if (row.statement_type === "balance_sheet") {
      bsByYear.set(row.fiscal_year, { ...(bsByYear.get(row.fiscal_year) ?? {}), ...toDict(row.line_items) });
    }
    if (row.statement_type === "profit_loss") {
      plByYear.set(row.fiscal_year, { ...(plByYear.get(row.fiscal_year) ?? {}), ...toDict(row.line_items) });
    }
  }

  const bsYears = Array.from(bsByYear.keys()).sort((a, b) => a - b);
  const result: DerivedCashFlow[] = [];

  for (let i = 1; i < bsYears.length; i++) {
    const prevYear = bsYears[i - 1];
    const currYear = bsYears[i];
    const prevBs = bsByYear.get(prevYear) ?? {};
    const bs     = bsByYear.get(currYear) ?? {};
    const pl     = plByYear.get(currYear) ?? {};
    result.push(deriveCashFlow(prevYear, currYear, pl, bs, prevBs));
  }

  return result;
}
