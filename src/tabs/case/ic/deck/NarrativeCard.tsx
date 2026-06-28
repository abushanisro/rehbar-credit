import React from "react";
import { SlideShell } from "./SlideShell";

const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  body:    "#1C1C1E",
  muted:   "#888888",
  amber:   "#B45309",
  altRow:  "#F5F5F0",
  rule:    "#E8E8E4",
  bodyFont:    "'Source Serif 4', Calibri, sans-serif",
  headingFont: "'Playfair Display', Georgia, serif",
} as const;

interface RowItem {
  label: string;
  text?: string;
  items?: string[]; // bulleted sub-list
}

interface NarrativeTemplate {
  rows?: RowItem[];
  flags?: string[];
  // Legacy format kept for backward compatibility
  headline?: string;
  bullets?: string[];
  generated_at?: string;
}

interface NarrativeCardProps {
  roman: string;
  title: string;
  pageNum: number;
  template?: NarrativeTemplate;
  generating?: boolean;
  onGenerate?: () => void;
}

export function NarrativeCard({
  roman,
  title,
  pageNum,
  template,
  generating,
  onGenerate,
}: NarrativeCardProps) {
  const hasBeenGenerated = !!(template?.generated_at);

  // Content can come from the rich "rows" format or legacy "bullets" format
  const hasRows = template?.rows && template.rows.length > 0;
  const hasBullets = template?.bullets && template.bullets.length > 0;
  const hasHeadline = !!(template?.headline && template.headline.trim());
  const hasFlags = template?.flags && template.flags.length > 0;
  const hasContent = hasRows || hasBullets || hasHeadline || hasFlags;

  const generatedAt = template?.generated_at
    ? formatGeneratedAt(template.generated_at)
    : null;

  return (
    <SlideShell
      roman={roman}
      title={title}
      pageNum={pageNum}
      generating={generating}
      onGenerate={hasBeenGenerated ? onGenerate : undefined}
    >
      {hasBeenGenerated && hasContent ? (
        <div style={{ fontFamily: DS.bodyFont }}>
          {/* ── Rich rows format (table layout matching PPTX slides) ── */}
          {hasRows && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {template!.rows!.map((row, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: `1px solid ${DS.rule}`,
                      background: i % 2 === 0 ? "#FFFFFF" : DS.altRow,
                    }}
                  >
                    {/* Label column */}
                    <td
                      style={{
                        width: "22%",
                        padding: "10px 16px",
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: DS.navy,
                        verticalAlign: "top",
                        borderRight: `1px solid ${DS.rule}`,
                        lineHeight: 1.5,
                      }}
                    >
                      {row.label}
                    </td>
                    {/* Content column */}
                    <td
                      style={{
                        padding: "10px 16px",
                        fontSize: 11,
                        color: DS.body,
                        verticalAlign: "top",
                        lineHeight: 1.65,
                      }}
                    >
                      {row.items && row.items.length > 0 ? (
                        /* Bulleted sub-list */
                        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                          {row.items.map((item, j) => (
                            <li
                              key={j}
                              style={{
                                display: "flex",
                                gap: 8,
                                marginBottom: 4,
                                lineHeight: 1.55,
                              }}
                            >
                              <span style={{ color: DS.navy, fontWeight: 700, flexShrink: 0, fontSize: 10 }}>▸</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        /* Paragraph text — preserve newlines */
                        (row.text ?? "").split("\n").map((line, k) => (
                          <span key={k}>
                            {line}
                            {k < (row.text ?? "").split("\n").length - 1 && <br />}
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ── Legacy bullet format ── */}
          {!hasRows && (hasHeadline || hasBullets) && (
            <div style={{ padding: "16px 20px" }}>
              {hasHeadline && (
                <p
                  style={{
                    fontStyle: "italic",
                    fontSize: 12.5,
                    color: "#4A4A4A",
                    marginBottom: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {template!.headline}
                </p>
              )}
              {hasBullets && (
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {template!.bullets!.map((b, i) => (
                    <li
                      key={i}
                      style={{
                        display: "flex",
                        gap: 8,
                        fontSize: 11.5,
                        lineHeight: 1.6,
                        color: DS.body,
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ color: "#555", flexShrink: 0, marginTop: 1 }}>•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── Flags / concerns ── */}
          {hasFlags && (
            <div
              style={{
                borderTop: `1px solid ${DS.rule}`,
                padding: "10px 16px",
                background: "#FFFBF0",
              }}
            >
              {template!.flags!.map((f, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 10.5,
                    color: DS.amber,
                    marginBottom: 4,
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    lineHeight: 1.55,
                  }}
                >
                  <span style={{ flexShrink: 0, fontSize: 11 }}>⚠</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          )}

          {/* Timestamp */}
          {generatedAt && (
            <div
              style={{
                padding: "6px 16px",
                borderTop: `1px solid ${DS.rule}`,
                fontSize: 8.5,
                color: DS.muted,
                fontStyle: "italic",
                background: "#FAFAF8",
              }}
            >
              Generated: {generatedAt}
            </div>
          )}
        </div>
      ) : hasBeenGenerated ? (
        /* Generated but empty — retry */
        <div
          style={{
            minHeight: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <p style={{ fontSize: 11, fontStyle: "italic", color: DS.muted, textAlign: "center" }}>
            Generation returned no content — click Generate in the header to retry.
          </p>
        </div>
      ) : (
        /* Not yet generated */
        <div
          style={{
            minHeight: 200,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 24,
          }}
        >
          <p style={{ fontSize: 11, fontStyle: "italic", color: DS.muted, textAlign: "center" }}>
            Click Generate to fill this section
          </p>
          {onGenerate && (
            <button
              onClick={onGenerate}
              disabled={generating}
              style={{
                background: DS.navy,
                color: "#FFFFFF",
                border: "none",
                borderRadius: 16,
                padding: "8px 20px",
                fontSize: 12,
                fontFamily: DS.bodyFont,
                cursor: generating ? "not-allowed" : "pointer",
                opacity: generating ? 0.7 : 1,
              }}
            >
              {generating ? "Generating…" : "✦ Generate"}
            </button>
          )}
        </div>
      )}
    </SlideShell>
  );
}

function formatGeneratedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}
