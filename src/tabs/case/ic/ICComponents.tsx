import {
  PRODUCTS, RATIO_DISPLAY_NAMES, formatRatio,
} from "@/features/credit/domain";
import type { CaseRow, ExtractedRow, RatioRow, LineItem } from "@/features/case/types";
import { unitAbbr } from "@/features/case/utils";

export const IC_S_CLS: Record<string, string> = {
  green: "text-success", amber: "text-warning", red: "text-destructive", na: "text-muted-foreground",
};
export const IC_B_CLS: Record<string, string> = {
  green: "bg-success text-success-foreground",
  amber: "bg-warning text-warning-foreground",
  red: "bg-destructive text-destructive-foreground",
  na: "bg-muted text-muted-foreground",
};

export function ICSummaryPanel({ cc, ratios }: { cc: CaseRow; ratios: RatioRow[] }) {
  const product = PRODUCTS[cc.product_type];
  const years = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const KEY = ["dscr", "current_ratio", "debt_to_equity", "interest_coverage", "ebitda_margin", "roe"];
  return (
    <div className="space-y-2 text-xs">
      <table className="w-full">
        <tbody>
          <tr className="border-b border-border/30">
            <td className="py-0.5 w-28 text-muted-foreground">Client</td>
            <td className="text-primary font-medium">{cc.client_name}</td>
            <td className="w-24 text-muted-foreground">Product</td>
            <td className="text-primary">{product.short}</td>
          </tr>
          <tr className="border-b border-border/30">
            <td className="py-0.5 text-muted-foreground">Amount</td>
            <td className="text-primary">₹{Number(cc.deal_amount ?? 0).toLocaleString("en-IN")} Cr</td>
            <td className="text-muted-foreground">Tenure</td>
            <td className="text-primary">{cc.tenure_months ?? "—"}M</td>
          </tr>
          <tr className="border-b border-border/30">
            <td className="py-0.5 text-muted-foreground">IRR</td>
            <td className="text-primary">{cc.expected_irr ?? "—"}%</td>
            <td className="text-muted-foreground">Industry</td>
            <td className="text-primary">{cc.industry ?? "—"}</td>
          </tr>
          {cc.end_use && (
            <tr className="border-b border-border/30">
              <td className="py-0.5 text-muted-foreground">End Use</td>
              <td colSpan={3} className="text-foreground/90">{cc.end_use}</td>
            </tr>
          )}
        </tbody>
      </table>
      {ratios.length > 0 && years.length > 0 && (
        <>
          <div className="text-[10px] text-accent font-bold tracking-widest pt-1">KEY RATIO SNAPSHOT</div>
          <table className="w-full">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-0.5">RATIO</th>
                {years.map(y => <th key={y} className="text-right">FY{y}</th>)}
                <th className="text-right">BMK</th>
                <th className="text-right">STATUS</th>
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
                    <td className="py-0.5 text-foreground/90">{RATIO_DISPLAY_NAMES[name] ?? name}</td>
                    {years.map(y => {
                      const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y);
                      return (
                        <td key={y} className="text-right tabular-nums text-primary">
                          {formatRatio(name, r?.ratio_value != null ? Number(r.ratio_value) : null)}
                        </td>
                      );
                    })}
                    <td className="text-right tabular-nums text-muted-foreground">
                      {latest.benchmark != null ? formatRatio(name, Number(latest.benchmark)) : "—"}
                    </td>
                    <td className={`text-right font-bold text-[10px] ${IC_S_CLS[s]}`}>
                      {s === "green" ? "PASS" : s === "red" ? "FAIL" : s === "amber" ? "CAU" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
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
    <span className={calc ? "text-warning/80" : "text-primary"}>
      {icFmt(v)}{abbr && <span className="text-[9px] text-muted-foreground ml-0.5">{abbr}</span>}
    </span>
  );
}

export function ICHistoricalTables({ extracted }: { extracted: ExtractedRow[] }) {
  const years = Array.from(new Set(
    extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year)
  )).sort();
  if (years.length === 0) return <div className="text-muted-foreground text-xs">No historical data extracted.</div>;

  const unit = extracted.find(r => r.unit)?.unit;
  const unitLabel = unit ? `₹ ${unit}` : "₹";
  const abbr = unitAbbr(unit);
  const fyItems = years.map(y => icGetItems(extracted, y));

  const isCalc = (items: LineItem[], label: string) =>
    items.find(i => i.label === label)?.note === "auto-derived";

  const plLabels = ["Turnover", "Cost of Goods Sold", "Gross Profit", "Operating Expenses", "EBITDA", "Depreciation", "EBIT", "Interest Expense", "Profit Before Tax", "Tax", "PAT"];
  const bsLabels = ["Share Capital", "Reserves & Surplus", "Net Worth", "Long Term Borrowings", "Short Term Borrowings", "Total Debt", "Trade Payables", "Other Current Liabilities", "Current Liabilities", "Inventory", "Trade Receivables", "Cash & Bank", "Other Current Assets", "Current Assets", "Fixed Assets (Net)", "Total Assets", "Capital Employed", "Working Capital"];
  const cfLabels = ["Cash from Operations", "Cash from Investing", "Cash from Financing", "Net Change in Cash", "Opening Cash", "Closing Cash"];

  const renderTable = (allLabels: string[], title: string) => {
    // Only show rows where at least one year has a value
    const activeLabels = allLabels.filter(label =>
      fyItems.some(items => icLiVal(items, label) !== null)
    );
    if (activeLabels.length === 0) return null;
    return (
      <div>
        <div className="text-[10px] text-accent font-bold tracking-widest mb-1">{title} · {unitLabel}</div>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-0.5">ITEM</th>
              {years.map(y => <th key={y} className="text-right">FY{y}</th>)}
              {years.length >= 2 && <th className="text-right text-accent">YOY%</th>}
            </tr>
          </thead>
          <tbody>
            {activeLabels.map(label => {
              const vals = fyItems.map(items => icLiVal(items, label));
              const calcFlags = fyItems.map(items => isCalc(items, label));
              const last = vals[vals.length - 1];
              const prev = vals.length >= 2 ? vals[vals.length - 2] : null;
              const yoyPct = (last !== null && prev !== null && prev !== 0)
                ? ((last - prev) / Math.abs(prev)) * 100 : null;
              const anyCalc = calcFlags.some(Boolean);
              return (
                <tr key={label} className="border-b border-border/30">
                  <td className="py-0.5">
                    <span className={anyCalc ? "text-warning/90" : "text-foreground/90"}>{label}</span>
                    {anyCalc && <span className="ml-1 text-[8px] text-warning/70 tracking-widest">CALC</span>}
                  </td>
                  {vals.map((v, i) => (
                    <td key={i} className="text-right tabular-nums">
                      <FV v={v} abbr={abbr} calc={calcFlags[i]} />
                    </td>
                  ))}
                  {years.length >= 2 && (
                    <td className={`text-right tabular-nums text-[11px] ${yoyPct !== null ? (yoyPct > 0 ? "text-success" : yoyPct < 0 ? "text-destructive" : "text-muted-foreground") : "text-muted-foreground"}`}>
                      {yoyPct !== null ? (yoyPct > 0 ? "+" : "") + yoyPct.toFixed(1) + "%" : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const hasCF = fyItems.some(items => cfLabels.some(l => icLiVal(items, l) !== null));

  return (
    <div className="space-y-3">
      {renderTable(plLabels, "P&L SUMMARY")}
      {renderTable(bsLabels, "BALANCE SHEET")}
      {hasCF && renderTable(cfLabels, "CASH FLOW STATEMENT")}
      <div className="text-[9px] text-warning/70 tracking-wider">
        ▸ <span className="text-warning/70">CALC</span> = auto-derived from available data · all other values extracted from source documents
      </div>
    </div>
  );
}

export function ICProjectionsTable({ extracted }: { extracted: ExtractedRow[] }) {
  const projRows = extracted.filter(r => r.statement_type === "projections");
  if (projRows.length === 0) return <div className="text-muted-foreground text-xs">No projection data extracted.</div>;

  const unit = extracted.find(r => r.unit)?.unit;
  const unitLabel = unit ? `₹ ${unit}` : "₹";
  const abbr = unitAbbr(unit);
  const histYears = Array.from(new Set(
    extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year)
  )).sort();
  const projYears = Array.from(new Set(projRows.map(r => r.fiscal_year))).sort();
  const pairs: [string, string][] = [
    ["Turnover", "Projected Turnover"],
    ["EBITDA", "Projected EBITDA"],
    ["PAT", "Projected PAT"],
    ["Net Worth", "Projected Net Worth"],
    ["Total Debt", "Projected Total Debt"],
  ];

  return (
    <div>
      <div className="text-[9px] text-muted-foreground mb-1 tracking-wider">{unitLabel} · (A) Actual · (P) Projected</div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left py-0.5">METRIC</th>
            {histYears.map(y => <th key={y} className="text-right">FY{y}<span className="text-[9px] opacity-60">(A)</span></th>)}
            {projYears.map(y => <th key={y} className="text-right text-accent">FY{y}<span className="text-[9px] opacity-60">(P)</span></th>)}
          </tr>
        </thead>
        <tbody>
          {pairs.map(([histLabel, projLabel]) => (
            <tr key={histLabel} className="border-b border-border/30">
              <td className="py-0.5 text-foreground/90">{histLabel}</td>
              {histYears.map(y => <td key={y} className="text-right tabular-nums"><FV v={icLiVal(icGetItems(extracted, y), histLabel)} abbr={abbr} /></td>)}
              {projYears.map(y => {
                const items = (projRows.find(r => r.fiscal_year === y)?.line_items ?? []) as unknown as LineItem[];
                return <td key={y} className="text-right tabular-nums"><FV v={icLiVal(items, projLabel)} abbr={abbr} /></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ICRatioTable({ ratios }: { ratios: RatioRow[] }) {
  if (ratios.length === 0) return <div className="text-muted-foreground text-xs">No ratios computed. Run ratio analysis first.</div>;
  const years = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const categories = Array.from(new Set(ratios.map(r => r.category)));

  return (
    <div className="space-y-3">
      {categories.map(cat => {
        const names = Array.from(new Set(ratios.filter(r => r.category === cat).map(r => r.ratio_name)));
        return (
          <div key={cat}>
            <div className="text-[10px] text-accent font-bold tracking-widest mb-1">{cat.toUpperCase()}</div>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-0.5">RATIO</th>
                  {years.map(y => <th key={y} className="text-right">FY{y}</th>)}
                  <th className="text-right">BMK</th>
                </tr>
              </thead>
              <tbody>
                {names.map(name => {
                  const latest = ratios.filter(r => r.ratio_name === name).sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
                  const latestStatus = latest?.threshold_status ?? "na";
                  return (
                    <tr key={name} className="border-b border-border/30">
                      <td className="py-0.5 text-foreground/90">{RATIO_DISPLAY_NAMES[name] ?? name}</td>
                      {years.map(y => {
                        const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y);
                        const val = r?.ratio_value != null ? Number(r.ratio_value) : null;
                        const s = r?.threshold_status ?? "na";
                        return (
                          <td key={y} className="text-right pr-1">
                            <span className="tabular-nums text-foreground/90 mr-1">{formatRatio(name, val)}</span>
                            <span className={`px-1 text-[9px] font-bold tracking-widest ${IC_B_CLS[s]}`}>
                              {s === "green" ? "✓" : s === "red" ? "✗" : s === "amber" ? "~" : "—"}
                            </span>
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
    <tr className="border-b border-border/30">
      <td className="py-0.5 w-44 text-muted-foreground">{label}</td>
      <td className="text-primary">{String(value)}</td>
    </tr>
  );
}

export function ICClientProfile({ cc }: { cc: CaseRow }) {
  const product = PRODUCTS[cc.product_type];
  return (
    <div className="space-y-3 text-xs">
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
      {cc.promoter_details && (
        <div>
          <div className="terminal-label mb-1">PROMOTER DETAILS</div>
          <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{cc.promoter_details}</div>
        </div>
      )}
      {cc.group_summary && (
        <div>
          <div className="terminal-label mb-1">GROUP SUMMARY</div>
          <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{cc.group_summary}</div>
        </div>
      )}
    </div>
  );
}

export function ICInvestmentStructure({ cc }: { cc: CaseRow }) {
  const product = PRODUCTS[cc.product_type];
  return (
    <div className="space-y-3 text-xs">
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
          <div className="terminal-label mb-1">END USE OF FUNDS</div>
          <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{cc.end_use}</div>
        </div>
      )}
      {cc.collateral_summary && (
        <div>
          <div className="terminal-label mb-1">COLLATERAL / SECURITY</div>
          <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{cc.collateral_summary}</div>
        </div>
      )}
    </div>
  );
}

export function ICRehbarHistory({ cc }: { cc: CaseRow }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="border border-border/40 bg-surface/30 p-3 space-y-1">
        <div className="text-[10px] text-accent font-bold tracking-widest mb-2">REHBAR FINANCIAL SERVICES — FUNDER PROFILE</div>
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
        <div className="terminal-label mb-1">PRIOR EXPOSURE TO {cc.client_name.toUpperCase()}</div>
        <div className="text-foreground/60 italic text-xs">No prior Rehbar funding history on record for this client. This appears to be a new relationship.</div>
      </div>
    </div>
  );
}

export function ICVisitReference({ cc }: { cc: CaseRow }) {
  return (
    <div className="space-y-3 text-xs">
      {cc.analyst_notes ? (
        <div>
          <div className="terminal-label mb-1">ANALYST NOTES / SITE VISIT OBSERVATIONS</div>
          <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{cc.analyst_notes}</div>
        </div>
      ) : (
        <div className="text-foreground/50 italic">No analyst notes recorded. Add visit report, reference check findings, and executive recommendation via [EDIT] on the case header.</div>
      )}
      <div className="border-t border-border/40 pt-3">
        <div className="terminal-label mb-2">REFERENCE CHECK TEMPLATE</div>
        <table className="w-full">
          <thead className="text-muted-foreground border-b border-border">
            <tr><th className="text-left py-0.5">CHECK TYPE</th><th className="text-left">SOURCE</th><th className="text-left">STATUS</th></tr>
          </thead>
          <tbody>
            {[["Banker Reference","Principal Bank","Pending"],["Vendor/Supplier Check","Key Suppliers","Pending"],["Customer Reference","Major Clients","Pending"],["Site Visit","Business Premises","Pending"]].map(([t,s,st]) => (
              <tr key={t} className="border-b border-border/30">
                <td className="py-0.5 text-foreground/90">{t}</td>
                <td className="text-foreground/60">{s}</td>
                <td className="text-warning">{st}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ICProductSpecifics({ cc }: { cc: CaseRow }) {
  const product = PRODUCTS[cc.product_type];
  return (
    <div className="space-y-3 text-xs">
      <table className="w-full">
        <tbody>
          <ICRow label="Product" value={product.label} />
          <ICRow label="Short Code" value={product.short} />
          <ICRow label="Legal Nature" value={product.legalNature} />
          <ICRow label="Return Mechanism" value={product.returnMechanism} />
        </tbody>
      </table>
      <div>
        <div className="terminal-label mb-2">SOP RULES APPLICABLE TO {product.short}</div>
        <ul className="space-y-1">
          {product.rules.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-warning shrink-0">▸</span>
              <span className="text-foreground/90">{r}</span>
            </li>
          ))}
        </ul>
      </div>
      {cc.policy_exceptions && (
        <div>
          <div className="terminal-label mb-1">POLICY EXCEPTIONS</div>
          <div className="text-warning whitespace-pre-wrap">{cc.policy_exceptions}</div>
        </div>
      )}
    </div>
  );
}
