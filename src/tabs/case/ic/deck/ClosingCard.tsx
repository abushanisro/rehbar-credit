import React from "react";

const DS = {
  white:   "#FFFFFF",
  muted:   "#888888",
  maxWidth: 960,
  headingFont: "'Playfair Display', Georgia, serif",
  bodyFont:    "'Source Serif 4', Calibri, sans-serif",
} as const;

export function ClosingCard() {
  const year = new Date().getFullYear();

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
        marginBottom: 24,
        minHeight: 280,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
          padding: "48px 32px",
          textAlign: "center",
        }}
      >
        <img
          src="/Rehbar_logo.png"
          alt="Rehbar"
          style={{ width: 100, objectFit: "contain", marginBottom: 8, background: "#FFFFFF", borderRadius: 6, padding: "4px 10px" }}
        />
        <p
          style={{
            fontSize: 11,
            color: DS.muted,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          Financial Services
        </p>

        <div
          style={{
            width: 60,
            height: 1,
            background: "#D4D4CE",
            margin: "24px auto 20px",
          }}
        />

        <p
          style={{
            fontSize: 11,
            fontStyle: "italic",
            color: DS.muted,
            maxWidth: 500,
            lineHeight: 1.7,
            margin: 0,
          }}
        >
          This document is confidential and prepared exclusively for the use of Rehbar Financial Services.
          Any reproduction, distribution or use of this information requires prior written consent.
        </p>

        <p
          style={{
            fontSize: 10,
            color: DS.muted,
            marginTop: 24,
          }}
        >
          © Rehbar Financial Services · {year}
        </p>
      </div>
    </div>
  );
}
