import React from "react";
import { SlideShell } from "./SlideShell";
import type { IcNoteShape } from "@/tabs/case/ic/ICNoteDocument";

type RehbarHistory = NonNullable<IcNoteShape["rehbar_history"]>;

const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  altRow:  "#F5F5F0",
  body:    "#1C1C1E",
  muted:   "#888888",
  green:   "#15803D",
  red:     "#B91C1C",
  amber:   "#D97706",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

const STATUS_COLOR: Record<string, string> = {
  Active:       DS.green,
  Closed:       DS.muted,
  NPA:          DS.red,
  Restructured: DS.amber,
  "Written Off": DS.red,
};

function fmtL(v: number | null): string {
  if (v === null) return "—";
  return `₹${v.toLocaleString("en-IN")}L`;
}

interface Props {
  history: RehbarHistory | undefined | null;
  clientName: string;
  pageNum: number;
}

export function RehbarHistoryCard({ history, clientName, pageNum }: Props) {
  const hasPrior = !!history?.has_prior_exposure;
  const facilities = history?.facilities ?? [];
  const refs = history?.credit_references ?? [];
  const notes = history?.analyst_notes?.trim() ?? "";

  const isEmpty = !history || (!hasPrior && !notes && refs.length === 0);

  return (
    <SlideShell roman="IV" title="Rehbar Funding History" pageNum={pageNum}>
      {isEmpty ? (
        <div style={{ padding: "32px 24px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic", fontFamily: DS.bodyFont }}>
          No Rehbar history data yet. Fill in the Rehbar History tab to populate this section.
        </div>
      ) : (
        <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>

          {/* ── Relationship type banner ─────────────────────────────────── */}
          <div style={{
            margin: "12px 20px 0",
            padding: "8px 14px",
            background: hasPrior ? "#FFF8E1" : "#F0FDF4",
            border: `1px solid ${hasPrior ? "#F5C518" : "#86EFAC"}`,
            borderRadius: 3,
            fontSize: 11,
            color: DS.body,
          }}>
            <span style={{ fontWeight: 700, color: hasPrior ? DS.amber : DS.green }}>
              {hasPrior ? "Prior Rehbar Exposure" : "New Relationship"}
            </span>
            {!hasPrior && (
              <span style={{ color: DS.muted, marginLeft: 8 }}>
                — {clientName} has no prior Rehbar/RERL facility history. This is a first-time exposure.
              </span>
            )}
          </div>

          {/* ── Facilities table ─────────────────────────────────────────── */}
          {hasPrior && facilities.length > 0 && (
            <div style={{ margin: "12px 20px 0" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Prior Facilities
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: DS.gold }}>
                    {["Product", "Sanctioned", "Disbursed", "O/S", "Sanction Date", "Closure Date", "Status", "Max DPD", "Notes"].map((h, i) => (
                      <th key={h} style={{ padding: "6px 10px", textAlign: i === 0 ? "left" : "right", fontSize: 9.5, fontWeight: 700, color: DS.body, whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {facilities.map((f, i) => (
                    <tr key={f.id} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow, borderBottom: "1px solid #EBEBEB" }}>
                      <td style={{ padding: "6px 10px", fontSize: 10.5, color: DS.body, fontWeight: 600 }}>{f.product}</td>
                      <td style={{ padding: "6px 10px", fontSize: 10.5, color: DS.body, textAlign: "right" }}>{fmtL(f.sanctioned_amount)}</td>
                      <td style={{ padding: "6px 10px", fontSize: 10.5, color: DS.body, textAlign: "right" }}>{fmtL(f.disbursed_amount)}</td>
                      <td style={{ padding: "6px 10px", fontSize: 10.5, color: DS.body, textAlign: "right" }}>{fmtL(f.outstanding)}</td>
                      <td style={{ padding: "6px 10px", fontSize: 10.5, color: DS.muted, textAlign: "right" }}>{f.sanction_date || "—"}</td>
                      <td style={{ padding: "6px 10px", fontSize: 10.5, color: DS.muted, textAlign: "right" }}>{f.closure_date || "—"}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLOR[f.status] ?? DS.muted }}>
                          {f.status}
                        </span>
                      </td>
                      <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right", color: f.max_dpd != null && f.max_dpd > 0 ? DS.red : DS.green }}>
                        {f.max_dpd != null ? `${f.max_dpd}d` : "—"}
                      </td>
                      <td style={{ padding: "6px 10px", fontSize: 10, color: DS.muted, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Credit references ─────────────────────────────────────────── */}
          {refs.length > 0 && (
            <div style={{ margin: "16px 20px 0" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Credit References
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: DS.gold }}>
                    {["Type", "Entity", "Contact", "Relationship", "Notes"].map((h, i) => (
                      <th key={h} style={{ padding: "6px 10px", textAlign: i === 0 ? "center" : "left", fontSize: 9.5, fontWeight: 700, color: DS.body }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {refs.map((r, i) => (
                    <tr key={r.id} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow, borderBottom: "1px solid #EBEBEB" }}>
                      <td style={{ padding: "6px 10px", textAlign: "center" }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: DS.navy, background: DS.altRow, padding: "2px 6px", borderRadius: 2 }}>
                          {r.ref_type}
                        </span>
                      </td>
                      <td style={{ padding: "6px 10px", fontSize: 10.5, color: DS.body, fontWeight: 600 }}>{r.entity_name || "—"}</td>
                      <td style={{ padding: "6px 10px", fontSize: 10.5, color: DS.muted }}>{r.contact || "—"}</td>
                      <td style={{ padding: "6px 10px", fontSize: 10.5, color: DS.muted }}>{r.relationship || "—"}</td>
                      <td style={{ padding: "6px 10px", fontSize: 10, color: DS.muted }}>{r.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Analyst notes ─────────────────────────────────────────────── */}
          {notes && (
            <div style={{ margin: "16px 20px 12px", padding: "10px 14px", background: DS.altRow, borderLeft: `3px solid ${DS.navy}`, borderRadius: "0 3px 3px 0" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
                Analyst Notes
              </div>
              <div style={{ fontSize: 11, color: DS.body, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {notes}
              </div>
            </div>
          )}

        </div>
      )}
    </SlideShell>
  );
}
