import React from "react";

const DS = {
  navy:        "#0F1B2D",
  gold:        "#8B6914",
  white:       "#FFFFFF",
  muted:       "#888888",
  headingFont: "'Playfair Display', Georgia, serif",
  bodyFont:    "'Source Serif 4', Calibri, sans-serif",
  maxWidth:    960,
} as const;

interface CoverCardProps {
  clientName: string;
  productType: string;
  dealAmount?: number | null;
}

function fmtAmount(v: number): string {
  if (v >= 100) return `INR ${(v / 100).toFixed(2)} Cr`;
  return `INR ${v.toFixed(2)} L`;
}

function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function CoverCard({ clientName, productType, dealAmount }: CoverCardProps) {
  return (
    <div
      style={{
        maxWidth: DS.maxWidth,
        width: "100%",
        background: DS.white,
        boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
        borderRadius: 4,
        overflow: "hidden",
        fontFamily: DS.bodyFont,
        display: "flex",
        flexDirection: "row",
        minHeight: 340,
        position: "relative",
        marginBottom: 24,
      }}
    >
      {/* Last modified stamp */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 16,
          fontSize: 9,
          color: DS.muted,
          fontStyle: "italic",
          zIndex: 10,
        }}
      >
        Last Modified: {todayDDMMYYYY()}
      </div>

      {/* Left panel — navy with circles */}
      <div
        style={{
          width: "40%",
          background: DS.navy,
          position: "relative",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <svg
          width="100%"
          height="100%"
          style={{ position: "absolute", inset: 0 }}
          viewBox="0 0 384 340"
          preserveAspectRatio="xMidYMid slice"
        >
          <circle cx={320} cy={40}  r={90}  fill="rgba(255,255,255,0.09)" />
          <circle cx={60}  cy={120} r={60}  fill="rgba(255,255,255,0.07)" />
          <circle cx={200} cy={200} r={100} fill="rgba(255,255,255,0.08)" />
          <circle cx={360} cy={280} r={70}  fill="rgba(255,255,255,0.06)" />
          <circle cx={40}  cy={300} r={50}  fill="rgba(255,255,255,0.10)" />
          <circle cx={180} cy={50}  r={40}  fill="rgba(255,255,255,0.12)" />
        </svg>
      </div>

      {/* Right panel — white, content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 48px",
          gap: 0,
        }}
      >
        <img
          src="/Rehbar_logo.png"
          alt="Rehbar"
          style={{ width: 120, objectFit: "contain", marginBottom: 8, background: "#FFFFFF", borderRadius: 6, padding: "4px 10px" }}
        />
        <p
          style={{
            fontSize: 11,
            color: DS.muted,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            marginBottom: 0,
            marginTop: 2,
          }}
        >
          Financial Services
        </p>

        <div
          style={{
            width: 48,
            height: 2,
            background: "#E5E5E0",
            margin: "20px 0 16px",
          }}
        />

        <h1
          style={{
            fontFamily: DS.headingFont,
            fontSize: 22,
            fontWeight: 700,
            color: DS.navy,
            textAlign: "center",
            margin: 0,
            lineHeight: 1.25,
          }}
        >
          Investment Proposal
        </h1>

        <h2
          style={{
            fontFamily: DS.headingFont,
            fontSize: 18,
            fontWeight: 700,
            color: DS.navy,
            textAlign: "center",
            margin: "8px 0 0",
            lineHeight: 1.3,
          }}
        >
          {clientName}
        </h2>

        <p
          style={{
            fontSize: 13,
            color: DS.muted,
            textAlign: "center",
            marginTop: 4,
            marginBottom: 0,
          }}
        >
          {productType}
        </p>

        {dealAmount != null && (
          <p
            style={{
              fontSize: 12,
              color: DS.gold,
              textAlign: "center",
              marginTop: 8,
              fontWeight: 600,
            }}
          >
            {fmtAmount(dealAmount)}
          </p>
        )}
      </div>
    </div>
  );
}
