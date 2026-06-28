import React from "react";
import { SlideShell } from "./SlideShell";

const DS = {
  body:    "#1C1C1E",
  muted:   "#888888",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

interface ConditionsPrecedentCardProps {
  conditions: string[];
  pageNum: number;
}

export function ConditionsPrecedentCard({ conditions, pageNum }: ConditionsPrecedentCardProps) {
  return (
    <SlideShell roman="XIV" title="Conditions Precedent" pageNum={pageNum}>
      <div style={{ padding: "16px 24px 20px", fontFamily: DS.bodyFont }}>
        {conditions.length === 0 ? (
          <div
            style={{
              padding: "32px 20px",
              textAlign: "center",
              fontSize: 11,
              color: DS.muted,
              fontStyle: "italic",
            }}
          >
            No conditions set — generate IC Note first
          </div>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {conditions.map((c, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  fontSize: 12,
                  color: DS.body,
                  lineHeight: 1.6,
                  padding: "9px 0",
                  borderBottom: i < conditions.length - 1 ? "1px solid #E8E8E4" : "none",
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    minWidth: 22,
                    color: DS.muted,
                    fontSize: 11,
                    paddingTop: 1,
                  }}
                >
                  {i + 1}.
                </span>
                <span>{c}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </SlideShell>
  );
}
