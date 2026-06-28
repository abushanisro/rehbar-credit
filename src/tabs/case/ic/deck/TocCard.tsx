import React from "react";
import { SlideShell } from "./SlideShell";

const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  altRow:  "#F5F5F0",
  body:    "#1C1C1E",
  muted:   "#888888",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

interface TocSection {
  roman: string;
  title: string;
  slideNum: number;
  status: "na" | "generated" | "empty";
}

interface TocCardProps {
  sections: TocSection[];
}

export function TocCard({ sections }: TocCardProps) {
  return (
    <SlideShell title="Table of Content" pageNum={2}>
      <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                background: DS.gold,
              }}
            >
              <th
                style={{
                  width: 48,
                  padding: "7px 10px",
                  textAlign: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  color: DS.body,
                  borderRight: "1px solid rgba(0,0,0,0.08)",
                }}
              >
                §
              </th>
              <th
                style={{
                  padding: "7px 14px",
                  textAlign: "left",
                  fontSize: 10,
                  fontWeight: 700,
                  color: DS.body,
                }}
              >
                Particulars
              </th>
              <th
                style={{
                  width: 80,
                  padding: "7px 14px",
                  textAlign: "right",
                  fontSize: 10,
                  fontWeight: 700,
                  color: DS.body,
                }}
              >
                Page No.
              </th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s, i) => {
              const isNa = s.status === "na";
              const rowBg = i % 2 === 0 ? "#FFFFFF" : DS.altRow;
              return (
                <tr key={s.roman} style={{ background: rowBg }}>
                  <td
                    style={{
                      background: DS.navy,
                      color: "#FFFFFF",
                      width: 40,
                      textAlign: "center",
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "6px 8px",
                      borderRight: "1px solid rgba(0,0,0,0.1)",
                    }}
                  >
                    {s.roman}
                  </td>
                  <td
                    style={{
                      padding: "7px 14px",
                      fontSize: 12,
                      color: isNa ? DS.muted : DS.body,
                    }}
                  >
                    {s.title}
                  </td>
                  <td
                    style={{
                      padding: "7px 14px",
                      textAlign: "right",
                      fontSize: 10,
                      color: DS.muted,
                    }}
                  >
                    {isNa ? "NA" : s.slideNum}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SlideShell>
  );
}
