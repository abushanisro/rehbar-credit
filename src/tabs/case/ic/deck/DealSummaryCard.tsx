import React from "react";
import { SlideShell } from "./SlideShell";

const DS = {
  body:    "#1C1C1E",
  muted:   "#888888",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

interface DealSummaryCc {
  client_name: string;
  case_code?: string | null;
  product_type?: string | null;
  deal_amount?: number | null;
  tenure_months?: number | null;
  expected_irr?: number | null;
  end_use?: string | null;
  collateral_summary?: string | null;
  industry?: string | null;
  legal_constitution?: string | null;
}

interface DealSummaryCardProps {
  cc: DealSummaryCc;
}

function fmtAmount(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 100) return `₹ ${(v / 100).toFixed(2)} Cr`;
  return `₹ ${v.toFixed(2)} L`;
}

export function DealSummaryCard({ cc }: DealSummaryCardProps) {
  const rows: [string, string][] = [
    ["Product & Amount", [cc.product_type, fmtAmount(cc.deal_amount)].filter(Boolean).join("   ")],
    ["Purpose / End Use", cc.end_use ?? "—"],
    ["Tenure", cc.tenure_months != null ? `${cc.tenure_months} months` : "—"],
    ["Expected IRR", cc.expected_irr != null ? `${cc.expected_irr}%` : "—"],
    ["Industry / Sector", cc.industry ?? "—"],
    ["Collaterals / Security", cc.collateral_summary ?? "—"],
    ["Legal Constitution", cc.legal_constitution ?? "—"],
  ];

  return (
    <SlideShell title="Overview Summary" pageNum={3}>
      <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
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
                <td
                  style={{
                    width: 180,
                    padding: "9px 20px",
                    fontSize: 11,
                    color: DS.muted,
                    verticalAlign: "top",
                    fontStyle: "normal",
                  }}
                >
                  {label}
                </td>
                <td
                  style={{
                    padding: "9px 20px",
                    fontSize: 12,
                    color: DS.body,
                    lineHeight: 1.5,
                  }}
                >
                  {value || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SlideShell>
  );
}
