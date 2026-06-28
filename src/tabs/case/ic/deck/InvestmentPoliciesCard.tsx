import React, { useState } from "react";

const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  body:    "#1C1C1E",
  muted:   "#888888",
  altRow:  "#F5F5F0",
  green:   "#15803D",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

interface InvestmentPoliciesCardProps {
  pageNum: number;
  caseId?: string;
  clientName?: string;
  caseCode?: string | null;
}

export function InvestmentPoliciesCard({ pageNum, caseId, clientName, caseCode }: InvestmentPoliciesCardProps) {
  const [copied, setCopied] = useState(false);

  const portalUrl = caseCode
    ? `${window.location.origin}/ic?case=${encodeURIComponent(caseCode)}`
    : `${window.location.origin}/ic`;

  function copyLink() {
    navigator.clipboard.writeText(portalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const STEPS = [
    { num: "01", title: "Review IC Note", desc: "Read the full credit memo, financial analysis, risk matrix and deal structure." },
    { num: "02", title: "Comment by Section", desc: "Add inline comments on any section — executive summary, financials, ratios, or conditions precedent." },
    { num: "03", title: "Cast Your Vote", desc: "Vote Approve, Conditional Approval, or Decline. Attach notes to your decision." },
    { num: "04", title: "IC Decision Recorded", desc: "Once quorum is met, the final committee decision is locked and routed to the operations team." },
  ];

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 960,
        background: "#FFFFFF",
        boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
        borderRadius: 4,
        overflow: "hidden",
        marginBottom: 24,
        display: "flex",
        flexDirection: "column",
        fontFamily: DS.bodyFont,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "2px solid #E8E8E4" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: DS.body, fontFamily: "'Playfair Display', Georgia, serif" }}>
          Rehbar Investment Approval Policies
        </span>
        <img src="/Rehbar_logo.png" alt="Rehbar" style={{ height: 28, objectFit: "contain", background: "#FFFFFF", borderRadius: 4, padding: "2px 6px" }} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: "24px 28px" }}>

        {/* Case identifier */}
        {(clientName || caseCode) && (
          <div style={{ marginBottom: 20, padding: "10px 14px", background: DS.altRow, borderLeft: `3px solid ${DS.navy}`, borderRadius: "0 3px 3px 0" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
              Case Under Review
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: DS.body }}>
              {clientName ?? "—"}
              {caseCode && <span style={{ fontSize: 11, fontWeight: 400, color: DS.muted, marginLeft: 8 }}>· {caseCode}</span>}
            </div>
          </div>
        )}

        {/* Portal link — main CTA */}
        <div style={{ marginBottom: 24, padding: "18px 20px", background: DS.navy, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: DS.gold, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
              IC Review Portal
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 10 }}>
              Vote, comment, and discuss this case with the Investment Committee
            </div>
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontFamily: "monospace", wordBreak: "break-all" }}
            >
              {portalUrl}
            </a>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, background: DS.gold, color: DS.navy, fontWeight: 700, fontSize: 12, padding: "10px 20px", borderRadius: 4, textDecoration: "none", fontFamily: DS.bodyFont }}
            >
              Open IC Portal
            </a>
            <button
              onClick={copyLink}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid rgba(255,255,255,0.25)", color: copied ? DS.gold : "rgba(255,255,255,0.7)", fontSize: 11, padding: "7px 16px", borderRadius: 4, cursor: "pointer", fontFamily: DS.bodyFont, transition: "color 0.2s" }}
            >
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>
        </div>

        {/* Process steps */}
        <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
          IC Review Process
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {STEPS.map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "12px 14px", background: DS.altRow, borderRadius: 3, border: "1px solid #E8E8E4" }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: DS.navy, flexShrink: 0, opacity: 0.4, lineHeight: 1.5 }}>{step.num}</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: DS.body, marginBottom: 3 }}>{step.title}</div>
                <div style={{ fontSize: 10, color: DS.muted, lineHeight: 1.5 }}>{step.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Policy note */}
        <div style={{ marginTop: 18, padding: "10px 14px", background: "#FFF8E1", border: "1px solid #F5C518", borderRadius: 3, fontSize: 10, color: "#92400E", lineHeight: 1.6 }}>
          <strong>Quorum Policy:</strong> A minimum of 3 IC members must cast a vote for the decision to be binding. Conditional approvals require written conditions to be recorded before the deal proceeds to disbursement.
        </div>

      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #E8E8E4", padding: "6px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "#AAAAAA", fontStyle: "italic" }}>
          Confidential – Rehbar Internal use only
        </span>
        <span style={{ fontSize: 9, color: "#AAAAAA" }}>{pageNum}</span>
      </div>
    </div>
  );
}
