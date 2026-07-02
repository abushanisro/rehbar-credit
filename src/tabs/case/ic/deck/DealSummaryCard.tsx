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
  dealWarning?: string | null;
}

function fmtAmount(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 100) return `₹ ${(v / 100).toFixed(2)} Cr`;
  return `₹ ${v.toFixed(2)} L`;
}

export function DealSummaryCard({ cc, dealWarning }: DealSummaryCardProps) {
  const amountDisplay = [cc.product_type, fmtAmount(cc.deal_amount)].filter(Boolean).join("   ");
  const rows: [string, string, boolean][] = [
    ["Product & Amount", amountDisplay, !!dealWarning],
    ["Purpose / End Use", cc.end_use ?? "—", false],
    ["Tenure", cc.tenure_months != null ? `${cc.tenure_months} months` : "—", false],
    ["Expected IRR", cc.expected_irr != null ? `${cc.expected_irr}%` : "—", false],
    ["Industry / Sector", cc.industry ?? "—", false],
    ["Collaterals / Security", cc.collateral_summary ?? "—", false],
    ["Legal Constitution", cc.legal_constitution ?? "—", false],
  ];

  return (
    <SlideShell title="Overview Summary" pageNum={3}>
      <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {rows.map(([label, value, hasWarning], i) => (
              <tr
                key={label}
                style={{
                  borderBottom: "1px solid #E8E8E4",
                  background: hasWarning ? "#FFF8F0" : (i % 2 === 0 ? "#FFFFFF" : "#F5F5F0"),
                }}
              >
                <td
                  style={{
                    width: 180,
                    padding: "9px 20px",
                    fontSize: 11,
                    color: hasWarning ? "#92400E" : DS.muted,
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
                  <span>{value || "—"}</span>
                  {hasWarning && dealWarning && (
                    <span style={{
                      marginLeft: 10,
                      display: "inline-block",
                      background: "#FEF3C7",
                      color: "#92400E",
                      fontSize: 9,
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 3,
                      letterSpacing: "0.04em",
                      verticalAlign: "middle",
                    }}>
                      ⚠ VERIFY UNITS
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SlideShell>
  );
}
