import React from "react";
import { SlideShell } from "./SlideShell";
import type { CibilReportRow } from "@/tabs/case/CibilTab";
import type { ExtractedRow } from "@/features/case/types";

const DS = {
  navy:     "#0F1B2D",
  gold:     "#F5C518",
  altRow:   "#F5F5F0",
  body:     "#1C1C1E",
  muted:    "#888888",
  green:    "#15803D",
  red:      "#991B1B",
  rule:     "#E5E7EB",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

// ── Types mirrored from CibilTab (no cross-import of internal types) ──────────
type ConsumerReport = {
  report_type?: "consumer";
  borrower_name?: string;
  perform_score?: number | null;
  pan?: string;
  accounts?: ConsumerAccount[];
  current_balance?: number | null;
  total_disbursed?: number | null;
  total_accounts?: number;
  active_accounts?: number;
};
type ConsumerAccount = {
  account_type?: string;
  status?: string;
  current_balance?: number | null;
  disbursed_amount?: number | null;
  overdue_amount?: number | null;
  has_delinquency?: boolean;
  asset_class?: string;
};
type LineItem = { label: string; value: number | null; override_value?: number | null };
type ProvPeriod = {
  fiscal_year: number;
  months_covered?: number;
  unit?: string;
  pl?: LineItem[];
  bs?: LineItem[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtL(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `₹ ${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function scaleToLakhs(v: number | null, unit: string | null): number | null {
  if (v === null) return null;
  const u = (unit ?? "").toLowerCase();
  if (u.includes("lakh") || u.includes("crore") || u.includes("million") || u.includes("thousand")) return v;
  return v / 100000;
}

function getExtracted(rows: ExtractedRow[], label: string, fy: number): number | null {
  for (const row of rows.filter(r => r.fiscal_year === fy && r.statement_type !== "projections")) {
    const items = (row.line_items as unknown as LineItem[]) ?? [];
    const item = items.find(i => i.label === label);
    if (item) {
      const v = item.override_value ?? item.value;
      return v != null ? scaleToLakhs(Number(v), row.unit) : null;
    }
  }
  return null;
}

function getProvisional(periods: ProvPeriod[], label: string, section: "pl" | "bs"): { value: number | null; fy: number; label: string } | null {
  const sorted = [...periods].sort((a, b) => b.fiscal_year - a.fiscal_year);
  for (const p of sorted) {
    const items = section === "pl" ? (p.pl ?? []) : (p.bs ?? []);
    const item = items.find(i => i.label === label);
    if (item) {
      const v = item.override_value ?? item.value;
      const scaled = v != null ? scaleToLakhs(Number(v), p.unit ?? null) : null;
      return { value: scaled, fy: p.fiscal_year, label: `FY${p.fiscal_year}(P)` };
    }
  }
  return null;
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={3} style={{ background: DS.navy, color: "#FFFFFF", fontSize: 10, fontWeight: 700, padding: "5px 12px", letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </td>
    </tr>
  );
}

// ── Sub-header (column labels) ────────────────────────────────────────────────
function SubHeader() {
  return (
    <tr style={{ background: DS.gold }}>
      <th style={{ padding: "5px 12px", textAlign: "left", fontSize: 9.5, fontWeight: 700, color: DS.body, width: "28%" }}>Category</th>
      <th style={{ padding: "5px 12px", textAlign: "left", fontSize: 9.5, fontWeight: 700, color: DS.body }}>Particulars / Asset Details</th>
      <th style={{ padding: "5px 12px", textAlign: "right", fontSize: 9.5, fontWeight: 700, color: DS.body, whiteSpace: "nowrap" }}>Amount (₹ L)</th>
    </tr>
  );
}

// ── Data row ─────────────────────────────────────────────────────────────────
function DataRow({ category, particulars, amount, isSummary, i }: { category: string; particulars: string; amount: number | null; isSummary?: boolean; i: number }) {
  return (
    <tr style={{ background: isSummary ? "#EEF4FD" : (i % 2 === 0 ? "#FFFFFF" : DS.altRow) }}>
      <td style={{ padding: "6px 12px", fontSize: isSummary ? 11 : 10.5, fontWeight: isSummary ? 700 : 400, color: DS.body, borderBottom: `1px solid ${DS.rule}` }}>
        {category}
      </td>
      <td style={{ padding: "6px 12px", fontSize: 10.5, color: isSummary ? DS.body : DS.muted, fontStyle: isSummary ? "normal" : "normal", borderBottom: `1px solid ${DS.rule}` }}>
        {particulars}
      </td>
      <td style={{ padding: "6px 12px", textAlign: "right", fontSize: isSummary ? 11 : 10.5, fontWeight: isSummary ? 700 : 400, color: DS.body, borderBottom: `1px solid ${DS.rule}`, fontVariantNumeric: "tabular-nums" }}>
        {fmtL(amount)}
      </td>
    </tr>
  );
}

// ── Total row ────────────────────────────────────────────────────────────────
function TotalRow({ label, amount, highlight }: { label: string; amount: number | null; highlight?: boolean }) {
  return (
    <tr style={{ background: highlight ? DS.navy : "#F0F0EA" }}>
      <td colSpan={2} style={{ padding: "7px 12px", fontSize: 11, fontWeight: 700, color: highlight ? "#FFFFFF" : DS.body, borderBottom: `1px solid ${DS.rule}` }}>
        {label}
      </td>
      <td style={{ padding: "7px 12px", textAlign: "right", fontSize: 11, fontWeight: 700, color: highlight ? DS.gold : DS.body, borderBottom: `1px solid ${DS.rule}`, fontVariantNumeric: "tabular-nums" }}>
        {fmtL(amount)}
      </td>
    </tr>
  );
}

// ── Per-promoter personal net worth block ─────────────────────────────────────
function PromoterNetWorth({ row, idx }: { row: CibilReportRow; idx: number }) {
  const rd = row.report_data as ConsumerReport;
  const name = rd.borrower_name || row.borrower_name || "Unknown";
  const pan  = rd.pan || "—";

  // Liabilities — from CIBIL accounts (active only)
  const accounts = (rd.accounts ?? []).filter(a => a.status?.toLowerCase() !== "closed" && (a.current_balance ?? 0) > 0);
  const SECURED_TYPES = new Set(["Home Loan", "Housing Loan", "Mortgage Loan", "Loan Against Property", "Vehicle Loan", "Auto Loan", "Gold Loan", "Two Wheeler Loan"]);
  const secured   = accounts.filter(a => SECURED_TYPES.has(a.account_type ?? ""));
  const unsecured = accounts.filter(a => !SECURED_TYPES.has(a.account_type ?? ""));

  const totalLiabilities = accounts.reduce((s, a) => s + (a.current_balance ?? 0), 0) / 100000; // CIBIL values are in Rs, convert to Lakhs

  // Asset total — unknown without personal statement; show "—"
  const totalAssets: number | null = null;
  const netWorth = totalAssets !== null ? totalAssets - totalLiabilities : null;

  const ASSET_ROWS = [
    { category: "Immovable Properties", particulars: "Land, Buildings, Residential Properties" },
    { category: "Investments",          particulars: "Shares, Bonds, Gold, Mutual Funds" },
    { category: "Bank Balances",         particulars: "Savings / Current Bank Balance" },
    { category: "Fixed Deposits",        particulars: "Bank FDs / Post Office Deposits" },
    { category: "Vehicles",              particulars: "Personal Vehicles" },
  ];

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Promoter header */}
      <div style={{ background: "#F3F4F6", borderRadius: "4px 4px 0 0", padding: "8px 14px", border: `1px solid ${DS.rule}`, borderBottom: "none" }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: DS.navy }}>
          {idx + 1}. {name} — Statement of Net Worth
        </div>
        <div style={{ fontSize: 9.5, color: DS.muted, marginTop: 2 }}>
          PAN: {pan}
          {row.report_date && `  ·  Report Date: ${row.report_date}`}
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${DS.rule}` }}>
        <tbody>
          <SectionHeader label="A. Assets" />
          <SubHeader />
          {ASSET_ROWS.map((r, i) => (
            <DataRow key={r.category} category={r.category} particulars={r.particulars} amount={null} i={i} />
          ))}
          <TotalRow label="Total Assets (A)" amount={totalAssets} />

          <SectionHeader label="B. Liabilities" />
          <SubHeader />
          {secured.length === 0 && unsecured.length === 0 ? (
            <DataRow category="Loans Outstanding" particulars="From CIBIL report — no active accounts found" amount={null} i={0} />
          ) : (
            <>
              {secured.map((a, i) => (
                <DataRow
                  key={i}
                  category="Secured Loans"
                  particulars={a.account_type ?? "Secured Loan"}
                  amount={(a.current_balance ?? 0) / 100000}
                  i={i}
                />
              ))}
              {unsecured.map((a, i) => (
                <DataRow
                  key={i}
                  category="Unsecured Loans"
                  particulars={a.account_type ?? "Unsecured Loan"}
                  amount={(a.current_balance ?? 0) / 100000}
                  i={secured.length + i}
                />
              ))}
            </>
          )}
          <TotalRow label="Total Liabilities (B)" amount={totalLiabilities > 0 ? totalLiabilities : null} />
          <TotalRow label="NET WORTH (A – B)" amount={netWorth} highlight />
        </tbody>
      </table>
      {totalAssets === null && (
        <div style={{ fontSize: 9, color: DS.muted, padding: "4px 0 0 2px", fontStyle: "italic" }}>
          ⓘ Asset details require CA-certified personal financial statement — enter manually or upload to the financial review tab.
        </div>
      )}
    </div>
  );
}

// ── Source of income table ────────────────────────────────────────────────────
function SourceOfIncome({ extracted, provisional }: { extracted: ExtractedRow[]; provisional: ProvPeriod[] }) {
  const histRows = extracted.filter(r => r.statement_type !== "projections");
  const histYears = Array.from(new Set(histRows.map(r => r.fiscal_year))).sort().slice(-3);

  const prov = provisional?.length
    ? [...provisional].sort((a, b) => b.fiscal_year - a.fiscal_year)[0]
    : null;
  const provLabel = prov ? `FY${prov.fiscal_year}(P)` : null;

  const P_L_ROWS = [
    { label: "Turnover / Net Revenue",  keys: ["Turnover", "Net Sales", "Revenue", "Total Income"] },
    { label: "Cost of Goods Sold",      keys: ["Cost of Goods Sold", "COGS", "Direct Costs"] },
    { label: "Gross Profit",            keys: ["Gross Profit"] },
    { label: "EBITDA",                  keys: ["EBITDA"] },
    { label: "Interest Expense",        keys: ["Interest Expense", "Finance Costs"] },
    { label: "PAT (Net Profit)",         keys: ["PAT", "EAT", "Net Profit", "Profit After Tax"] },
  ];
  const BS_ROWS = [
    { label: "Net Worth",               keys: ["Net Worth", "Shareholders Equity", "Total Equity"] },
    { label: "Total Debt",              keys: ["Total Debt", "Total Borrowings"] },
    { label: "Cash & Bank",             keys: ["Cash & Bank", "Cash & Cash Equivalents", "Cash and Bank Balances"] },
  ];

  function getFirst(row: ExtractedRow[], fy: number, keys: string[]): number | null {
    for (const key of keys) {
      const v = getExtracted(row, key, fy);
      if (v !== null) return v;
    }
    return null;
  }
  function getProvFirst(keys: string[], section: "pl" | "bs"): number | null {
    if (!prov) return null;
    const items = section === "pl" ? (prov.pl ?? []) : (prov.bs ?? []);
    for (const key of keys) {
      const item = items.find(i => i.label === key);
      if (item) { const v = item.override_value ?? item.value; return v != null ? scaleToLakhs(Number(v), prov.unit ?? null) : null; }
    }
    return null;
  }

  const yearCols = histYears.map(y => `FY${y}`);
  if (provLabel) yearCols.push(provLabel);

  const allYearsEmpty = histYears.length === 0 && !prov;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: DS.navy, padding: "6px 0 4px", borderBottom: `2px solid ${DS.gold}`, marginBottom: 6 }}>
        Source of Income (Company Financials)
      </div>
      {allYearsEmpty ? (
        <div style={{ padding: "16px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic" }}>
          No financial data available. Upload financials from the Financial Review tab.
        </div>
      ) : (
        <>
          {/* P&L */}
          <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Profit & Loss</div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
            <thead>
              <tr style={{ background: DS.gold }}>
                <th style={{ padding: "5px 12px", textAlign: "left", fontSize: 9.5, fontWeight: 700, color: DS.body, width: "34%" }}>Item</th>
                {histYears.map(y => <th key={y} style={{ padding: "5px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, color: DS.body }}>FY{y}</th>)}
                {provLabel && <th style={{ padding: "5px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, color: DS.body }}>{provLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {P_L_ROWS.map((r, i) => {
                const vals = histYears.map(y => getFirst(histRows, y, r.keys));
                const provVal = getProvFirst(r.keys, "pl");
                const hasData = vals.some(v => v !== null) || (provLabel && provVal !== null);
                if (!hasData) return null;
                return (
                  <tr key={r.label} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow }}>
                    <td style={{ padding: "5px 12px", fontSize: 10.5, color: DS.body, borderBottom: `1px solid ${DS.rule}`, fontWeight: r.label.includes("Turnover") || r.label.includes("PAT") ? 600 : 400 }}>{r.label}</td>
                    {vals.map((v, vi) => <td key={vi} style={{ padding: "5px 10px", textAlign: "right", fontSize: 10.5, color: DS.body, borderBottom: `1px solid ${DS.rule}`, fontVariantNumeric: "tabular-nums" }}>{fmtL(v)}</td>)}
                    {provLabel && <td style={{ padding: "5px 10px", textAlign: "right", fontSize: 10.5, color: "#1D4ED8", borderBottom: `1px solid ${DS.rule}`, fontVariantNumeric: "tabular-nums" }}>{fmtL(provVal)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Balance Sheet (NW + Debt) */}
          <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Balance Sheet Highlights</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: DS.gold }}>
                <th style={{ padding: "5px 12px", textAlign: "left", fontSize: 9.5, fontWeight: 700, color: DS.body, width: "34%" }}>Item</th>
                {histYears.map(y => <th key={y} style={{ padding: "5px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, color: DS.body }}>FY{y}</th>)}
                {provLabel && <th style={{ padding: "5px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, color: DS.body }}>{provLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {BS_ROWS.map((r, i) => {
                const vals = histYears.map(y => getFirst(histRows, y, r.keys));
                const provVal = getProvFirst(r.keys, "bs");
                const hasData = vals.some(v => v !== null) || (provLabel && provVal !== null);
                if (!hasData) return null;
                return (
                  <tr key={r.label} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow }}>
                    <td style={{ padding: "5px 12px", fontSize: 10.5, fontWeight: 600, color: DS.body, borderBottom: `1px solid ${DS.rule}` }}>{r.label}</td>
                    {vals.map((v, vi) => <td key={vi} style={{ padding: "5px 10px", textAlign: "right", fontSize: 10.5, color: DS.body, borderBottom: `1px solid ${DS.rule}`, fontVariantNumeric: "tabular-nums" }}>{fmtL(v)}</td>)}
                    {provLabel && <td style={{ padding: "5px 10px", textAlign: "right", fontSize: 10.5, color: "#1D4ED8", borderBottom: `1px solid ${DS.rule}`, fontVariantNumeric: "tabular-nums" }}>{fmtL(provVal)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {provLabel && (
            <div style={{ fontSize: 9, color: DS.muted, marginTop: 3, fontStyle: "italic" }}>
              {provLabel} = Provisional/Unaudited (from Provisional tab)
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface NetWorthCardProps {
  cibilData: CibilReportRow[];
  extracted: ExtractedRow[];
  provisional: ProvPeriod[] | undefined;
  pageNum: number;
}

export function NetWorthCard({ cibilData, extracted, provisional, pageNum }: NetWorthCardProps) {
  const consumerReports = cibilData.filter(row => {
    const rd = row.report_data as ConsumerReport;
    return !rd?.report_type || rd.report_type === "consumer";
  });

  return (
    <SlideShell roman="II-c" title="Net Worth and Sources of Income" pageNum={pageNum}>
      <div style={{ padding: "12px 16px", fontFamily: DS.bodyFont }}>
        {/* Promoter personal net worth statements */}
        {consumerReports.length > 0 ? (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Promoter / Director — Personal Net Worth Statements
            </div>
            {consumerReports.map((row, idx) => (
              <PromoterNetWorth key={row.id} row={row} idx={idx} />
            ))}
          </>
        ) : (
          <div style={{ padding: "16px", background: DS.altRow, borderRadius: 4, marginBottom: 12, fontSize: 10.5, color: DS.muted, fontStyle: "italic" }}>
            No promoter CIBIL reports found. Upload consumer CIBIL reports from the CIBIL tab to populate personal net worth statements.
          </div>
        )}

        {/* Company source of income */}
        <SourceOfIncome extracted={extracted} provisional={provisional ?? []} />
      </div>
    </SlideShell>
  );
}
