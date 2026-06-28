import React from "react";
import { SlideShell } from "./SlideShell";
import type { CibilReportRow } from "@/tabs/case/CibilTab";

const DS = {
  navy:     "#0F1B2D",
  gold:     "#F5C518",
  altRow:   "#F5F5F0",
  body:     "#1C1C1E",
  muted:    "#888888",
  green:    "#15803D",
  greenBg:  "#D1FAE5",
  amber:    "#92400E",
  amberBg:  "#FEF3C7",
  red:      "#991B1B",
  redBg:    "#FEE2E2",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

type ConsumerReport = {
  report_type?: "consumer";
  borrower_name?: string;
  perform_score?: number | null;
  total_accounts?: number;
  active_accounts?: number;
  overdue_accounts?: number;
  current_balance?: number | null;
  total_disbursed?: number | null;
  inquiries_24m?: number;
  new_accounts_6m?: number;
  report_date?: string;
  pan?: string;
};
type CommercialReport = {
  report_type: "commercial";
  entity_name?: string;
  cibil_rank?: string;
  rank_exclusion_reasons?: string[];
  total_credit_facilities?: number;
  open_credit_facilities?: number;
  delinquent_borrower_cf?: number;
  total_outstanding?: number | null;
  delinquent_outstanding?: number | null;
  total_lenders?: number;
  report_date?: string;
  pan?: string;
};

function fmtAmt(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString("en-IN")}`;
}

function ScoreBadge({ score, rank }: { score?: number | null; rank?: string }) {
  let label = "—";
  let bg = DS.altRow;
  let color = DS.muted;

  if (rank) {
    const n = parseInt(rank.replace(/[^0-9]/g, ""), 10);
    label = rank;
    bg    = n <= 3 ? DS.greenBg : n <= 5 ? DS.amberBg : DS.redBg;
    color = n <= 3 ? DS.green   : n <= 5 ? DS.amber   : DS.red;
  } else if (score != null) {
    label = String(score);
    bg    = score >= 750 ? DS.greenBg : score >= 650 ? DS.amberBg : DS.redBg;
    color = score >= 750 ? DS.green   : score >= 650 ? DS.amber   : DS.red;
  }

  return (
    <span style={{
      display: "inline-block",
      background: bg,
      color,
      fontSize: 11,
      fontWeight: 700,
      padding: "3px 10px",
      borderRadius: 4,
      fontVariantNumeric: "tabular-nums",
      letterSpacing: "0.03em",
    }}>
      {label}
    </span>
  );
}

function ConsumerRow({ row }: { row: CibilReportRow }) {
  const rd = row.report_data as ConsumerReport;
  const name = rd.borrower_name || row.borrower_name || "Unknown";
  const score = rd.perform_score ?? null;
  const isNotScored = score == null;

  return (
    <div style={{ marginBottom: 16, borderRadius: 4, border: "1px solid #E5E7EB", overflow: "hidden" }}>
      {/* Header row */}
      <div style={{ background: "#F9FAFB", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #E5E7EB" }}>
        <ScoreBadge score={score} />
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: DS.body }}>
            {name}
            {isNotScored && <span style={{ marginLeft: 8, fontSize: 10, color: DS.muted, fontWeight: 400 }}>Not Scored</span>}
          </div>
          {(rd.pan || rd.report_date) && (
            <div style={{ fontSize: 9.5, color: DS.muted, marginTop: 1 }}>
              {rd.pan && `PAN: ${rd.pan}`}{rd.pan && rd.report_date && "  ·  "}{rd.report_date}
              <span style={{ marginLeft: 8, fontSize: 9, background: "#F3F4F6", border: "1px solid #E5E7EB", borderRadius: 3, padding: "1px 5px" }}>Consumer</span>
            </div>
          )}
        </div>
      </div>

      {/* Summary table */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: DS.gold }}>
            {["No. of Accts", "Active Accts", "O/Due Accts", "Current Balance", "Amt Disbursed"].map(h => (
              <th key={h} style={{ padding: "5px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, color: DS.body }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: "#FFFFFF" }}>
            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, fontWeight: 700, color: DS.body, fontVariantNumeric: "tabular-nums" }}>{rd.total_accounts ?? "—"}</td>
            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: DS.body, fontVariantNumeric: "tabular-nums" }}>{rd.active_accounts ?? "—"}</td>
            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: (rd.overdue_accounts ?? 0) > 0 ? DS.red : DS.body, fontVariantNumeric: "tabular-nums" }}>{rd.overdue_accounts ?? "—"}</td>
            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: DS.body, fontVariantNumeric: "tabular-nums" }}>{fmtAmt(rd.current_balance)}</td>
            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: DS.body, fontVariantNumeric: "tabular-nums" }}>{fmtAmt(rd.total_disbursed)}</td>
          </tr>
        </tbody>
      </table>

      {/* Note line */}
      <div style={{ padding: "5px 14px", fontSize: 9.5, color: DS.muted, background: "#FAFAFA", borderTop: "1px solid #F3F4F6" }}>
        Inquiries in last 24 Months: {rd.inquiries_24m ?? 0}
        &nbsp;&nbsp;|&nbsp;&nbsp;
        New Account(s) in last 6 Months: {rd.new_accounts_6m ?? 0}
      </div>
    </div>
  );
}

function CommercialRow({ row }: { row: CibilReportRow }) {
  const rd = row.report_data as CommercialReport;
  const name = rd.entity_name || row.borrower_name || "Unknown Entity";
  const hasDelinquency = (rd.delinquent_borrower_cf ?? 0) > 0;

  return (
    <div style={{ marginBottom: 16, borderRadius: 4, border: "1px solid #E5E7EB", overflow: "hidden" }}>
      {/* Header row */}
      <div style={{ background: "#F9FAFB", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #E5E7EB" }}>
        <ScoreBadge rank={rd.cibil_rank} />
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: DS.body }}>
            {name}
            {(rd.rank_exclusion_reasons?.length ?? 0) > 0 && (
              <span style={{ marginLeft: 8, fontSize: 9.5, color: DS.amber, fontWeight: 400 }}>
                {rd.rank_exclusion_reasons![0]}
              </span>
            )}
          </div>
          {(rd.pan || rd.report_date) && (
            <div style={{ fontSize: 9.5, color: DS.muted, marginTop: 1 }}>
              {rd.pan && `PAN: ${rd.pan}`}{rd.pan && rd.report_date && "  ·  "}{rd.report_date}
              <span style={{ marginLeft: 8, fontSize: 9, background: "#F3F4F6", border: "1px solid #E5E7EB", borderRadius: 3, padding: "1px 5px" }}>Commercial</span>
            </div>
          )}
        </div>
      </div>

      {/* Summary table */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: DS.gold }}>
            {["Total Lenders", "Total CFs", "Open CFs", "Delinquent CFs", "Total Outstanding", "Delinquent Outst."].map(h => (
              <th key={h} style={{ padding: "5px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, color: DS.body }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: "#FFFFFF" }}>
            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: DS.body, fontVariantNumeric: "tabular-nums" }}>{rd.total_lenders ?? "—"}</td>
            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, fontWeight: 700, color: DS.body, fontVariantNumeric: "tabular-nums" }}>{rd.total_credit_facilities ?? "—"}</td>
            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: DS.body, fontVariantNumeric: "tabular-nums" }}>{rd.open_credit_facilities ?? "—"}</td>
            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: hasDelinquency ? DS.red : DS.body, fontWeight: hasDelinquency ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>{rd.delinquent_borrower_cf ?? "—"}</td>
            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: DS.body, fontVariantNumeric: "tabular-nums" }}>{fmtAmt(rd.total_outstanding)}</td>
            <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: (rd.delinquent_outstanding ?? 0) > 0 ? DS.red : DS.muted, fontVariantNumeric: "tabular-nums" }}>
              {(rd.delinquent_outstanding ?? 0) > 0 ? fmtAmt(rd.delinquent_outstanding) : "—"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface CibilCardProps {
  cibilData: CibilReportRow[];
  pageNum: number;
}

export function CibilCard({ cibilData, pageNum }: CibilCardProps) {
  return (
    <SlideShell roman="II-b" title="CIBIL Report Summary" pageNum={pageNum}>
      <div style={{ padding: "12px 16px", fontFamily: DS.bodyFont }}>
        {cibilData.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic" }}>
            No CIBIL reports uploaded. Upload from the CIBIL tab.
          </div>
        ) : (
          cibilData.map(row => {
            const rd = row.report_data as { report_type?: string };
            return rd?.report_type === "commercial"
              ? <CommercialRow key={row.id} row={row} />
              : <ConsumerRow key={row.id} row={row} />;
          })
        )}
      </div>
    </SlideShell>
  );
}
