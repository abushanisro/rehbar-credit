import React from "react";

interface AnnexuresCardProps {
  clientName: string;
  subtitle?: string; // defaults to "Annexures"
}

const FOOTER_ITEMS = [
  { icon: "🌐", text: "www.rehbar.co.in" },
  { icon: "✉", text: "info@rehbar.co.in" },
  { icon: "📞", text: "080 4112 7537" },
];

const ADDRESS = "1/1, The Presidency, #1, St Marks Rd, Bengaluru, Karnataka 560001";

export function AnnexuresCard({ clientName, subtitle = "Annexures" }: AnnexuresCardProps) {
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
        minHeight: 300,
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Watermark background — repeating R pattern */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Ccircle cx='40' cy='40' r='32' fill='none' stroke='%23E8E8E4' stroke-width='1'/%3E%3C/svg%3E")`,
          backgroundSize: "80px 80px",
          opacity: 0.6,
          pointerEvents: "none",
        }}
      />

      {/* Top row: Rehbar logo + R icon */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "24px 28px 0", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/Rehbar_logo.png" alt="Rehbar" style={{ height: 44, objectFit: "contain", background: "#FFFFFF", borderRadius: 4, padding: "2px 8px" }} />
        </div>
        <img src="/Rehbar_logo.png" alt="Rehbar" style={{ height: 28, objectFit: "contain", background: "#FFFFFF", borderRadius: 4, padding: "2px 6px" }} />
      </div>

      {/* Center content */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "32px 48px", position: "relative" }}>
        <div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: "#1C1C1E",
              fontFamily: "'Playfair Display', Georgia, serif",
              lineHeight: 1.3,
              marginBottom: 8,
            }}
          >
            {subtitle}
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#1C1C1E",
              fontFamily: "'Playfair Display', Georgia, serif",
            }}
          >
            [{clientName}]
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid #E8E8E4",
          padding: "12px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/Rehbar_logo.png" alt="Rehbar" style={{ height: 28, objectFit: "contain", background: "#FFFFFF", borderRadius: 4, padding: "2px 6px" }} />
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          {FOOTER_ITEMS.map(({ icon, text }) => (
            <span key={text} style={{ fontSize: 9, color: "#888", display: "flex", alignItems: "center", gap: 4 }}>
              <span>{icon}</span>{text}
            </span>
          ))}
          <span style={{ fontSize: 9, color: "#888", maxWidth: 140 }}>{ADDRESS}</span>
        </div>
      </div>
    </div>
  );
}
