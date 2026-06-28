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

interface DirectorsCardProps {
  directors: Record<string, string | null>[];
}

const COLS: { key: string; label: string; width?: number | string }[] = [
  { key: "name",          label: "Name",         width: "22%" },
  { key: "din",           label: "DIN",          width: "14%" },
  { key: "designation",   label: "Designation",  width: "20%" },
  { key: "shareholding",  label: "Shareholding", width: "14%" },
  { key: "age",           label: "Age",          width: "8%" },
  { key: "pan",           label: "PAN",          width: "12%" },
];

export function DirectorsCard({ directors }: DirectorsCardProps) {
  return (
    <SlideShell title="Corporate Governance – Directors & Key Persons" pageNum={5}>
      <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
        {directors.length === 0 ? (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              fontSize: 11,
              color: DS.muted,
              fontStyle: "italic",
            }}
          >
            No director data available
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: DS.gold }}>
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    style={{
                      width: c.width,
                      padding: "7px 12px",
                      textAlign: "left",
                      fontSize: 10,
                      fontWeight: 700,
                      color: DS.body,
                      borderRight: "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {directors.map((d, i) => (
                <tr
                  key={i}
                  style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow }}
                >
                  {COLS.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        padding: "7px 12px",
                        fontSize: 11,
                        color: c.key === "name" ? DS.body : DS.muted,
                        fontWeight: c.key === "name" ? 600 : 400,
                        borderBottom: "1px solid #EBEBEB",
                        borderRight: "1px solid rgba(0,0,0,0.04)",
                        verticalAlign: "top",
                      }}
                    >
                      {d[c.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SlideShell>
  );
}
