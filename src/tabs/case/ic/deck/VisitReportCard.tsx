import React, { useEffect, useState } from "react";
import { SlideShell } from "./SlideShell";
import { supabase } from "@/integrations/supabase/client";
import type { IcNoteShape } from "@/tabs/case/ic/ICNoteDocument";

type VisitReport = NonNullable<IcNoteShape["visit_report"]>;
type Checklist  = NonNullable<VisitReport["checklist"]>;

const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  altRow:  "#F5F5F0",
  body:    "#1C1C1E",
  muted:   "#888888",
  green:   "#15803D",
  amber:   "#D97706",
  red:     "#B91C1C",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  done:    { color: DS.green, label: "Done" },
  pending: { color: DS.amber, label: "Pending" },
  na:      { color: DS.muted, label: "N/A" },
};

const CHECK_LABELS: Record<keyof Checklist, string> = {
  banker_reference:   "Banker Reference",
  vendor_check:       "Vendor / Supplier Check",
  customer_reference: "Customer Reference",
  site_visit:         "Site Visit",
};

function fileIcon(name: string): string {
  if (/\.pdf$/i.test(name))       return "📄";
  if (/\.xlsx?$/i.test(name))     return "📊";
  if (/\.docx?$/i.test(name))     return "📝";
  if (/\.zip|\.rar$/i.test(name)) return "🗜️";
  return "📁";
}

interface Attachment {
  id: string;
  file_name: string;
  file_path: string;
  mime_type: string;
  category: "photo" | "document";
  caption: string | null;
  signedUrl?: string;
}

interface Props {
  visitReport: VisitReport | undefined | null;
  caseId: string;
  pageNum: number;
}

export function VisitReportCard({ visitReport, caseId, pageNum }: Props) {
  const [photos, setPhotos] = useState<Attachment[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data, error } = await supabase
          .from("visit_report_attachments" as never)
          .select("*")
          .eq("case_id", caseId)
          .order("uploaded_at", { ascending: true });

        if (error || !data || cancelled) return;

        const rows = data as Omit<Attachment, "signedUrl">[];
        const signed = await Promise.all(
          rows.map(async row => {
            const { data: sd } = await supabase.storage
              .from("case-files")
              .createSignedUrl(row.file_path, 3600);
            return { ...row, signedUrl: sd?.signedUrl ?? "" };
          }),
        );
        if (!cancelled) setPhotos(signed.filter(p => p.signedUrl));
      } catch {
        // silently fail — annexures are supplementary
      }
    }
    load();
    return () => { cancelled = true; };
  }, [caseId]);

  const cl       = visitReport?.checklist ?? {};
  const notes    = visitReport?.overall_notes?.trim() ?? "";
  const execRec  = visitReport?.exec_recommendation?.trim() ?? "";

  const checkKeys = Object.keys(CHECK_LABELS) as (keyof Checklist)[];
  const hasChecklist = checkKeys.some(k => cl[k]?.status || cl[k]?.notes || cl[k]?.source);
  const isEmpty = !hasChecklist && !notes && !execRec && photos.length === 0;

  return (
    <SlideShell roman="XI" title="Visit Report" pageNum={pageNum}>
      {isEmpty ? (
        <div style={{ padding: "32px 24px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic", fontFamily: DS.bodyFont }}>
          No visit report data yet. Fill in the Visit Report tab to populate this section.
        </div>
      ) : (
        <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>

          {/* ── Reference Check Checklist ───────────────────────────────────── */}
          {hasChecklist && (
            <div style={{ margin: "12px 20px 0" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Reference Check Status
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: DS.gold }}>
                    {["Check", "Source / Contact", "Status", "Findings"].map((h, i) => (
                      <th key={h} style={{
                        padding: "7px 10px",
                        textAlign: i === 2 ? "center" : "left",
                        fontSize: 10,
                        fontWeight: 700,
                        color: DS.body,
                        whiteSpace: "nowrap",
                        width: i === 0 ? "22%" : i === 1 ? "22%" : i === 2 ? "10%" : undefined,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {checkKeys.map((key, i) => {
                    const item = cl[key] ?? {};
                    const status = item.status ?? "pending";
                    const ss = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
                    return (
                      <tr key={key} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow, borderBottom: "1px solid #EBEBEB" }}>
                        <td style={{ padding: "7px 10px", fontSize: 11, color: DS.body, fontWeight: 600 }}>
                          {CHECK_LABELS[key]}
                        </td>
                        <td style={{ padding: "7px 10px", fontSize: 10.5, color: DS.muted }}>
                          {item.source || "—"}
                        </td>
                        <td style={{ padding: "7px 10px", textAlign: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: ss.color }}>
                            {ss.label}
                          </span>
                        </td>
                        <td style={{ padding: "7px 10px", fontSize: 10.5, color: DS.body, lineHeight: 1.5 }}>
                          {item.notes || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Site Visit Observations ─────────────────────────────────────── */}
          {notes && (
            <div style={{ margin: "16px 20px 0", padding: "10px 14px", background: DS.altRow, borderLeft: `3px solid ${DS.navy}`, borderRadius: "0 3px 3px 0" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
                Site Visit Observations
              </div>
              <div style={{ fontSize: 11, color: DS.body, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {notes}
              </div>
            </div>
          )}

          {/* ── Executive Recommendation ────────────────────────────────────── */}
          {execRec && (
            <div style={{ margin: "16px 20px 0", padding: "10px 14px", background: "#FFF8E1", borderLeft: `3px solid ${DS.gold}`, borderRadius: "0 3px 3px 0" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
                Executive Recommendation
              </div>
              <div style={{ fontSize: 11, color: DS.body, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {execRec}
              </div>
            </div>
          )}

          {/* ── Annexures ───────────────────────────────────────────────────── */}
          {photos.length > 0 && (() => {
            const photoList = photos.filter(a => a.category === "photo");
            const docList   = photos.filter(a => a.category === "document");
            return (
              <div style={{ margin: "16px 20px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
                  Annexures ({photos.length})
                </div>

                {/* Photos grid */}
                {photoList.length > 0 && (
                  <div style={{ marginBottom: docList.length > 0 ? 14 : 0 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 600, color: DS.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                      Photos ({photoList.length})
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
                      {photoList.map(photo => (
                        <div key={photo.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <img
                            src={photo.signedUrl}
                            alt={photo.caption ?? photo.file_name}
                            style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 3, border: "1px solid #E8E8E4", display: "block" }}
                          />
                          <span style={{ fontSize: 9, color: DS.muted, textAlign: "center", lineHeight: 1.4 }}>
                            {photo.caption || photo.file_name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Documents list */}
                {docList.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9.5, fontWeight: 600, color: DS.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                      Documents ({docList.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {docList.map(doc => (
                        <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: DS.altRow, borderRadius: 3, border: "1px solid #E8E8E4" }}>
                          <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(doc.file_name)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: DS.body, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {doc.file_name}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

        </div>
      )}
    </SlideShell>
  );
}
