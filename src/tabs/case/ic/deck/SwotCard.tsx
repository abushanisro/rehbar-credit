import React from "react";
import { SlideShell } from "./SlideShell";

const DS = {
  muted:   "#888888",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

interface SwotData {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

interface SwotCardProps {
  swot?: SwotData;
  pageNum: number;
  generating?: boolean;
  onGenerate?: () => void;
}

interface QuadrantConfig {
  key: keyof SwotData;
  label: string;
  headerBg: string;
  bodyBg: string;
}

const QUADRANTS: QuadrantConfig[] = [
  { key: "strengths",     label: "Strengths",     headerBg: "#1A4A2E", bodyBg: "#EAF3EC" },
  { key: "weaknesses",    label: "Weaknesses",    headerBg: "#6B1A1A", bodyBg: "#F3EAEA" },
  { key: "opportunities", label: "Opportunities", headerBg: "#0F1B2D", bodyBg: "#EAF0FA" },
  { key: "threats",       label: "Threats",       headerBg: "#6B4B00", bodyBg: "#F5F0E4" },
];

function SwotQuadrant({ config, items }: { config: QuadrantConfig; items: string[] }) {
  return (
    <div style={{ width: "50%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          background: config.headerBg,
          color: "#FFFFFF",
          padding: "8px 14px",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {config.label}
      </div>
      <div
        style={{
          background: config.bodyBg,
          flex: 1,
          minHeight: 120,
          padding: 12,
        }}
      >
        {items.length === 0 ? (
          <p style={{ fontSize: 10, color: DS.muted, fontStyle: "italic", margin: 0 }}>
            No {config.label.toLowerCase()} noted
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {items.map((item, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  gap: 6,
                  fontSize: 11,
                  lineHeight: 1.55,
                  marginBottom: 5,
                  color: "#1C1C1E",
                  alignItems: "flex-start",
                }}
              >
                <span style={{ flexShrink: 0, marginTop: 1, opacity: 0.6 }}>•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function SwotCard({ swot, pageNum, generating, onGenerate }: SwotCardProps) {
  const empty: SwotData = { strengths: [], weaknesses: [], opportunities: [], threats: [] };
  const data = swot ?? empty;

  return (
    <SlideShell roman="XV" title="SWOT Analysis" pageNum={pageNum} generating={generating} onGenerate={onGenerate}>
      <div style={{ fontFamily: DS.bodyFont }}>
        {/* Top row */}
        <div style={{ display: "flex", borderBottom: "1px solid #E8E8E4" }}>
          <SwotQuadrant config={QUADRANTS[0]} items={data.strengths} />
          <div style={{ width: 1, background: "#E8E8E4", flexShrink: 0 }} />
          <SwotQuadrant config={QUADRANTS[1]} items={data.weaknesses} />
        </div>
        {/* Bottom row */}
        <div style={{ display: "flex" }}>
          <SwotQuadrant config={QUADRANTS[2]} items={data.opportunities} />
          <div style={{ width: 1, background: "#E8E8E4", flexShrink: 0 }} />
          <SwotQuadrant config={QUADRANTS[3]} items={data.threats} />
        </div>
      </div>
    </SlideShell>
  );
}
