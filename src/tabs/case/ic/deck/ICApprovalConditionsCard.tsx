import React from "react";

interface ICApprovalConditionsCardProps {
  pageNum: number;
  conditions?: string;
}

export function ICApprovalConditionsCard({ pageNum, conditions }: ICApprovalConditionsCardProps) {
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
        fontFamily: "'Source Serif 4', Calibri, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "2px solid #E8E8E4",
        }}
      >
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "#1C1C1E",
            fontFamily: "'Playfair Display', Georgia, serif",
          }}
        >
          IC Approval Conditions
        </span>
        <img src="/Rehbar_logo.png" alt="Rehbar" style={{ height: 28, objectFit: "contain", background: "#FFFFFF", borderRadius: 4, padding: "2px 6px" }} />
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 220,
          padding: "24px 28px",
          position: "relative",
        }}
      >
        {conditions ? (
          <div
            style={{
              fontSize: 12,
              color: "#1C1C1E",
              lineHeight: 1.8,
              whiteSpace: "pre-wrap",
            }}
          >
            {conditions}
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid #E8E8E4",
          padding: "6px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 9, color: "#AAAAAA", fontStyle: "italic" }}>
          Confidential – Rehbar Internal use only
        </span>
        <span style={{ fontSize: 9, color: "#AAAAAA" }}>{pageNum}</span>
      </div>
    </div>
  );
}
