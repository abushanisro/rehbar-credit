import React from "react";
import { SlideShell } from "./SlideShell";

const DS = {
  navy:     "#0F1B2D",
  gold:     "#F5C518",
  altRow:   "#F5F5F0",
  body:     "#1C1C1E",
  muted:    "#888888",
  green:    "#15803D",
  red:      "#B91C1C",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

const FOOTER_ITEMS = [
  { text: "www.rehbar.co.in" },
  { text: "info@rehbar.co.in" },
  { text: "080 4112 7537" },
];
const ADDRESS = "1/1, The Presidency, #1, St Marks Rd, Bengaluru, Karnataka 560001";

// ── New rich format (generated from IC Deck) ──────────────────────────────────
export type GeneratedRiskItem = {
  title: string;
  risk: string;
  mitigation: string;
  severity?: "high" | "medium" | "low";
};
export type GeneratedRiskCategory = {
  category: string;
  intro?: string;
  items: GeneratedRiskItem[];
};
export type RiskTemplate = {
  categories: GeneratedRiskCategory[];
  generated_at?: string;
};

// ── Old format (from IC Note generation) ─────────────────────────────────────
type OldRiskItem = {
  category: string;
  risk: string;
  mitigant: string;
  severity: string;
};

interface RiskMatrixCardProps {
  risks?: OldRiskItem[];
  riskTemplate?: RiskTemplate | null;
  clientName?: string;
  pageNum: number;
  generating?: boolean;
  onGenerate?: () => void;
}

// ── Severity badge ────────────────────────────────────────────────────────────
function SeverityBadge({ severity }: { severity?: string }) {
  if (!severity) return null;
  const upper = severity.toUpperCase();
  const map: Record<string, { bg: string; color: string }> = {
    HIGH:   { bg: "#FEE2E2", color: "#991B1B" },
    MEDIUM: { bg: "#FEF3C7", color: "#92400E" },
    LOW:    { bg: "#D1FAE5", color: "#065F46" },
  };
  const cfg = map[upper] ?? { bg: "#F3F4F6", color: "#374151" };
  return (
    <span style={{
      display: "inline-block",
      background: cfg.bg,
      color: cfg.color,
      fontSize: 9,
      fontWeight: 700,
      padding: "2px 7px",
      borderRadius: 3,
      letterSpacing: "0.05em",
      flexShrink: 0,
    }}>
      {upper}
    </span>
  );
}

// ── Cover slide ───────────────────────────────────────────────────────────────
function RiskCoverSlide({ clientName }: { clientName?: string }) {
  return (
    <div style={{
      width: "100%",
      maxWidth: 960,
      background: "#FFFFFF",
      boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
      borderRadius: 4,
      overflow: "hidden",
      marginBottom: 24,
      minHeight: 300,
      display: "flex",
      flexDirection: "column",
      position: "relative",
    }}>
      {/* Subtle watermark circles */}
      <div aria-hidden style={{
        position: "absolute", inset: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Ccircle cx='40' cy='40' r='32' fill='none' stroke='%23E8E8E4' stroke-width='1'/%3E%3C/svg%3E")`,
        backgroundSize: "80px 80px", opacity: 0.5, pointerEvents: "none",
      }} />

      {/* Top row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "24px 28px 0", position: "relative" }}>
        <img src="/Rehbar_logo.png" alt="Rehbar" style={{ height: 44, objectFit: "contain", background: "#FFFFFF", borderRadius: 4, padding: "2px 8px" }} />
        <img src="/Rehbar_logo.png" alt="Rehbar" style={{ height: 28, objectFit: "contain", background: "#FFFFFF", borderRadius: 4, padding: "2px 6px" }} />
      </div>

      {/* Centre content */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "32px 48px", position: "relative" }}>
        <div>
          <div style={{
            fontSize: 28,
            fontWeight: 700,
            color: DS.body,
            fontFamily: "'Playfair Display', Georgia, serif",
            lineHeight: 1.25,
            marginBottom: 10,
          }}>
            Risk Assessment &amp; Mitigation
          </div>
          {clientName && (
            <div style={{
              fontSize: 18,
              fontWeight: 600,
              color: DS.navy,
              fontFamily: "'Playfair Display', Georgia, serif",
            }}>
              [{clientName}]
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #E8E8E4", padding: "12px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
        <img src="/Rehbar_logo.png" alt="Rehbar" style={{ height: 28, objectFit: "contain", background: "#FFFFFF", borderRadius: 4, padding: "2px 6px" }} />
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          {FOOTER_ITEMS.map(({ text }) => (
            <span key={text} style={{ fontSize: 9, color: "#888" }}>{text}</span>
          ))}
          <span style={{ fontSize: 9, color: "#888", maxWidth: 140 }}>{ADDRESS}</span>
        </div>
      </div>
    </div>
  );
}

// ── Generated narrative category slide ────────────────────────────────────────
function CategorySlide({ cat, pageNum }: { cat: GeneratedRiskCategory; pageNum: number }) {
  return (
    <SlideShell roman="X" title={`Risk Assessment & Mitigation — ${cat.category}`} pageNum={pageNum}>
      <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
        {cat.intro && (
          <div style={{ margin: "10px 20px 0", padding: "8px 12px", background: "#FFF8E1", border: "1px solid #F5C518", borderRadius: 3, fontSize: 10, color: "#92400E", lineHeight: 1.6, fontStyle: "italic" }}>
            {cat.intro}
          </div>
        )}
        <div style={{ padding: "12px 20px 0" }}>
          {cat.items.map((item, i) => (
            <div key={i} style={{ borderBottom: i < cat.items.length - 1 ? "1px solid #EBEBEB" : "none", padding: "14px 0" }}>
              {/* Title + severity */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 20, height: 20, borderRadius: "50%",
                  background: DS.navy, color: DS.gold,
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: DS.body, fontFamily: "'Playfair Display', Georgia, serif", flex: 1 }}>
                  {item.title}
                </span>
                <SeverityBadge severity={item.severity} />
              </div>
              {/* Risk */}
              <div style={{ display: "flex", gap: 8, paddingLeft: 30, marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: DS.red, flexShrink: 0, minWidth: 48, paddingTop: 1 }}>Risk:</span>
                <span style={{ fontSize: 10.5, color: DS.body, lineHeight: 1.65 }}>{item.risk}</span>
              </div>
              {/* Mitigation */}
              <div style={{ display: "flex", gap: 8, paddingLeft: 30 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: DS.green, flexShrink: 0, minWidth: 68, paddingTop: 1 }}>Mitigation:</span>
                <span style={{ fontSize: 10.5, color: "#4A4A4A", lineHeight: 1.65 }}>{item.mitigation}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SlideShell>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function RiskMatrixCard({ risks, riskTemplate, clientName, pageNum, generating, onGenerate }: RiskMatrixCardProps) {
  return (
    <>
      {/* Cover slide — always shown */}
      <RiskCoverSlide clientName={clientName} />

      {/* Case 1: Generated rich template — narrative layout */}
      {riskTemplate?.categories?.length ? (
        riskTemplate.categories.map((cat, i) => (
          <CategorySlide key={cat.category} cat={cat} pageNum={pageNum + i} />
        ))
      ) : risks && risks.length > 0 ? (
        /* Case 2: IC Note risks — table + generate button */
        <SlideShell
          roman="X"
          title="Risk Assessment & Mitigation"
          pageNum={pageNum}
          generating={generating}
          onGenerate={onGenerate}
        >
          <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
            <div style={{ margin: "10px 20px 0", padding: "7px 12px", background: DS.altRow, borderRadius: 3, fontSize: 10, color: DS.muted, fontStyle: "italic" }}>
              Showing risks from IC Note. Click Generate above to create the full narrative layout.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
              <thead>
                <tr style={{ background: DS.gold }}>
                  {["Category", "Risk", "Mitigant", "Severity"].map((h, i) => (
                    <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: DS.body, width: i === 0 ? "14%" : i === 3 ? "9%" : undefined }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {risks.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow }}>
                    <td style={{ padding: "8px 10px", fontSize: 10.5, color: DS.body, fontWeight: 600, borderBottom: "1px solid #EBEBEB", verticalAlign: "top" }}>{r.category}</td>
                    <td style={{ padding: "8px 10px", fontSize: 10.5, color: DS.body, borderBottom: "1px solid #EBEBEB", verticalAlign: "top", lineHeight: 1.5 }}>{r.risk}</td>
                    <td style={{ padding: "8px 10px", fontSize: 10.5, color: "#4A4A4A", borderBottom: "1px solid #EBEBEB", verticalAlign: "top", lineHeight: 1.5 }}>{r.mitigant}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #EBEBEB", verticalAlign: "top" }}>
                      <SeverityBadge severity={r.severity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SlideShell>
      ) : (
        /* Case 3: Nothing yet — empty + Generate */
        <SlideShell
          roman="X"
          title="Risk Assessment & Mitigation"
          pageNum={pageNum}
          generating={generating}
          onGenerate={onGenerate}
        >
          <div style={{ padding: "20px 24px 16px", fontFamily: DS.bodyFont }}>
            <div style={{ minHeight: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
              <p style={{ fontSize: 11, fontStyle: "italic", color: DS.muted, textAlign: "center", maxWidth: 400, lineHeight: 1.6 }}>
                Generate a structured risk assessment with categories, named risks, and mitigants.
              </p>
              {onGenerate && (
                <button
                  onClick={onGenerate}
                  disabled={generating}
                  style={{ background: DS.navy, color: "#FFFFFF", border: "none", borderRadius: 16, padding: "8px 20px", fontSize: 12, fontFamily: DS.bodyFont, cursor: generating ? "not-allowed" : "pointer", opacity: generating ? 0.7 : 1 }}
                >
                  {generating ? "Generating…" : "✦ Generate"}
                </button>
              )}
            </div>
          </div>
        </SlideShell>
      )}
    </>
  );
}
