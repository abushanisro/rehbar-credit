import React from "react";
import { SlideShell } from "./SlideShell";

const DS = {
  body:    "#1C1C1E",
  muted:   "#888888",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

interface CompanyProfileCc {
  client_name: string;
  year_established?: string | null;
  legal_constitution?: string | null;
  industry?: string | null;
}

interface CompanyProfileCardProps {
  cc: CompanyProfileCc;
  company: Record<string, string | null> | null;
}

export function CompanyProfileCard({ cc, company }: CompanyProfileCardProps) {
  const rows: [string, React.ReactNode][] = [
    ["Company", cc.client_name],
    ["Registered Office", company?.registered_address ?? null],
    ["Nature of Business", company?.mca_products_services ?? cc.industry ?? null],
    ["CIN", company?.mca_cin ?? null],
    ["PAN", company?.mca_pan ?? null],
    ["Date of Incorporation", company?.mca_date_of_incorp ?? null],
    ["Paid-up Capital", company?.mca_paid_up_capital ?? null],
    ["Status", company?.mca_status ?? null],
    ["GSTIN", company?.gstin ?? null],
    ["Website", company?.website
      ? <a href={company.website.startsWith("http") ? company.website : `https://${company.website}`} target="_blank" rel="noopener noreferrer" style={{ color: "#0F1B2D", textDecoration: "underline" }}>{company.website}</a>
      : null
    ],
  ];

  return (
    <SlideShell title="Client & Promoter Profile" pageNum={4}>
      <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {rows.map(([label, value], i) => (
              <tr
                key={label as string}
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
                  {value != null && value !== "" ? value : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SlideShell>
  );
}
