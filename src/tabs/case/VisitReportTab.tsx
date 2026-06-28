import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { Panel } from "@/components/terminal/Panel";

type CaseRow = Tables<"credit_cases">;

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckStatus = "pending" | "done" | "na";

interface CheckItem {
  status: CheckStatus;
  source: string;
  notes: string;
}

export interface VisitReport {
  checklist: {
    banker_reference:   CheckItem;
    vendor_check:       CheckItem;
    customer_reference: CheckItem;
    site_visit:         CheckItem;
  };
  overall_notes:       string;
  exec_recommendation: string;
}

interface Attachment {
  id: string;
  file_name: string;
  file_path: string;
  mime_type: string;
  category: "photo" | "document";
  caption: string | null;
  uploaded_at: string;
  signedUrl?: string;
}

const DEFAULTS: VisitReport["checklist"] = {
  banker_reference:   { status: "pending", source: "Principal Bank",    notes: "" },
  vendor_check:       { status: "pending", source: "Key Suppliers",     notes: "" },
  customer_reference: { status: "pending", source: "Major Clients",     notes: "" },
  site_visit:         { status: "pending", source: "Business Premises", notes: "" },
};

const CHECK_LABELS: Record<keyof VisitReport["checklist"], string> = {
  banker_reference:   "Banker Reference",
  vendor_check:       "Vendor / Supplier Check",
  customer_reference: "Customer Reference",
  site_visit:         "Site Visit",
};

const STATUS_CYCLE: Record<CheckStatus, CheckStatus> = { pending: "done", done: "na", na: "pending" };

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status, onClick }: { status: CheckStatus; onClick: () => void }) {
  const map: Record<CheckStatus, string> = {
    pending: "bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200",
    done:    "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200",
    na:      "bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200",
  };
  const label: Record<CheckStatus, string> = { pending: "Pending", done: "Done", na: "N/A" };
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to change status"
      className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-bold tracking-widest border cursor-pointer transition-colors select-none rounded-sm ${map[status]}`}
    >
      {label[status].toUpperCase()}
    </button>
  );
}

// ── File icon ─────────────────────────────────────────────────────────────────

function fileIcon(name: string) {
  if (name.match(/\.pdf$/i))       return "📄";
  if (name.match(/\.xlsx?$/i))     return "📊";
  if (name.match(/\.docx?$/i))     return "📝";
  if (name.match(/\.zip|\.rar$/i)) return "🗜️";
  return "📁";
}

// ── Main component ────────────────────────────────────────────────────────────

export function VisitReportTab({
  cc,
  user,
  onReload,
}: {
  cc: CaseRow;
  user: { id: string };
  onReload: () => Promise<void>;
}) {
  const fileRef   = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loadingAtts, setLoadingAtts] = useState(true);

  // ── Load report state from ic_note ────────────────────────────────────────

  const getInitial = (): VisitReport => {
    const vr = ((cc.ic_note as Record<string, unknown> | null)?.["visit_report"] as Partial<VisitReport>) ?? {};
    const cl = (vr.checklist ?? {}) as Partial<VisitReport["checklist"]>;
    return {
      checklist: {
        banker_reference:   { ...DEFAULTS.banker_reference,   ...(cl.banker_reference   ?? {}) },
        vendor_check:       { ...DEFAULTS.vendor_check,       ...(cl.vendor_check       ?? {}) },
        customer_reference: { ...DEFAULTS.customer_reference, ...(cl.customer_reference ?? {}) },
        site_visit:         { ...DEFAULTS.site_visit,         ...(cl.site_visit         ?? {}) },
      },
      overall_notes:       vr.overall_notes       ?? "",
      exec_recommendation: vr.exec_recommendation ?? "",
    };
  };

  const [report, setReport] = useState<VisitReport>(getInitial);

  // ── Load attachments from DB + sign URLs ──────────────────────────────────

  const loadAttachments = async () => {
    setLoadingAtts(true);
    try {
      const { data, error } = await supabase
        .from("visit_report_attachments" as never)
        .select("*")
        .eq("case_id", cc.id)
        .order("uploaded_at", { ascending: true });

      if (error) throw error;

      const rows = (data ?? []) as Omit<Attachment, "signedUrl">[];

      // Batch-sign URLs (60 min TTL)
      const signed = await Promise.all(
        rows.map(async row => {
          const { data: sd } = await supabase.storage
            .from("case-files")
            .createSignedUrl(row.file_path, 3600);
          return { ...row, signedUrl: sd?.signedUrl ?? "" };
        }),
      );
      setAttachments(signed);
    } catch (e) {
      toast.error("Failed to load attachments");
      console.error(e);
    } finally {
      setLoadingAtts(false);
    }
  };

  useEffect(() => { loadAttachments(); }, [cc.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ───────────────────────────────────────────────────────────────

  function patchCheck(key: keyof VisitReport["checklist"], field: keyof CheckItem, val: string) {
    setReport(r => ({ ...r, checklist: { ...r.checklist, [key]: { ...r.checklist[key], [field]: val } } }));
  }

  function cycleStatus(key: keyof VisitReport["checklist"]) {
    setReport(r => ({
      ...r,
      checklist: { ...r.checklist, [key]: { ...r.checklist[key], status: STATUS_CYCLE[r.checklist[key].status] } },
    }));
  }

  // ── Save notes / checklist to ic_note ─────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    try {
      const existing = (cc.ic_note as Record<string, unknown> | null) ?? {};
      const { error } = await supabase
        .from("credit_cases")
        .update({ ic_note: { ...existing, visit_report: report } })
        .eq("id", cc.id);
      if (error) throw error;
      await onReload();
      toast.success("Visit report saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ── Upload files ──────────────────────────────────────────────────────────

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const path = `${user.id}/${cc.id}/visit/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("case-files").upload(path, file);
        if (upErr) throw upErr;

        const isImage = file.type.startsWith("image/");
        const { error: dbErr } = await supabase
          .from("visit_report_attachments" as never)
          .insert({
            case_id:   cc.id,
            user_id:   user.id,
            file_name: file.name,
            file_path: path,
            mime_type: file.type || "application/octet-stream",
            category:  isImage ? "photo" : "document",
          } as never);
        if (dbErr) throw dbErr;

        toast.success(`Uploaded: ${file.name}`);
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
    }
    await loadAttachments();
    setUploading(false);
  }

  // ── Delete attachment ─────────────────────────────────────────────────────

  async function removeAttachment(att: Attachment) {
    try {
      await supabase.storage.from("case-files").remove([att.file_path]);
      await supabase.from("visit_report_attachments" as never).delete().eq("id", att.id);
      await loadAttachments();
      toast.success("Removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const doneCount = (Object.values(report.checklist) as CheckItem[]).filter(c => c.status === "done").length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Completion ────────────────────────────────────────────────────── */}
      <Panel
        title="Visit Report"
        ticker="XI — Site Visit & Reference Checks"
        status={doneCount === 4 ? "live" : doneCount > 0 ? "warn" : "idle"}
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Reference checks complete</span>
            <span className="font-medium text-foreground">{doneCount} / 4</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 rounded-full"
              style={{ width: `${(doneCount / 4) * 100}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Click a status badge to cycle: Pending → Done → N/A
          </p>
        </div>
      </Panel>

      {/* ── Checklist ─────────────────────────────────────────────────────── */}
      <Panel title="Reference Check Status" ticker="Checklist" status="idle">
        <div className="divide-y divide-border">
          {(Object.keys(CHECK_LABELS) as Array<keyof VisitReport["checklist"]>).map(key => {
            const item = report.checklist[key];
            return (
              <div key={key} className="py-4 first:pt-0 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-foreground">{CHECK_LABELS[key]}</div>
                  </div>
                  <StatusPill status={item.status} onClick={() => cycleStatus(key)} />
                </div>
                <div className="grid gap-2">
                  <div className="space-y-1">
                    <label className="text-[9px] tracking-widest text-muted-foreground uppercase font-medium">Source / Contact</label>
                    <input
                      type="text"
                      value={item.source}
                      onChange={e => patchCheck(key, "source", e.target.value)}
                      placeholder="e.g. SBI Branch Manager — Poonamallee"
                      className="w-full text-xs bg-background border border-border px-3 py-2 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary rounded-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] tracking-widest text-muted-foreground uppercase font-medium">Findings / Notes</label>
                    <textarea
                      rows={2}
                      value={item.notes}
                      onChange={e => patchCheck(key, "notes", e.target.value)}
                      placeholder="Key observations from this reference check…"
                      className="w-full text-xs bg-background border border-border px-3 py-2 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary resize-none rounded-sm"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* ── Site visit notes ──────────────────────────────────────────────── */}
      <Panel title="Site Visit Observations" ticker="Notes" status="idle">
        <div className="space-y-1">
          <label className="text-[9px] tracking-widest text-muted-foreground uppercase font-medium">
            Detailed observations
          </label>
          <textarea
            rows={6}
            value={report.overall_notes}
            onChange={e => setReport(r => ({ ...r, overall_notes: e.target.value }))}
            placeholder="Describe what was observed: physical premises, equipment / inventory present, employee headcount, business activity level, neighbourhood, any concerns or red flags…"
            className="w-full text-sm bg-background border border-border px-3 py-2.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary resize-y rounded-sm"
          />
        </div>
      </Panel>

      {/* ── Exec recommendation ───────────────────────────────────────────── */}
      <Panel title="Executive Recommendation" ticker="Analyst Sign-off" status="idle">
        <div className="space-y-1">
          <label className="text-[9px] tracking-widest text-muted-foreground uppercase font-medium">
            Overall credit assessment & recommendation
          </label>
          <textarea
            rows={5}
            value={report.exec_recommendation}
            onChange={e => setReport(r => ({ ...r, exec_recommendation: e.target.value }))}
            placeholder="Analyst's overall view: creditworthiness, deal conditions, pre-disbursement requirements, red flags from visit or reference checks…"
            className="w-full text-sm bg-background border border-border px-3 py-2.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary resize-y rounded-sm"
          />
        </div>
      </Panel>

      {/* ── Save notes ────────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs tracking-widest font-medium border border-primary text-primary px-6 py-2 hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-40 rounded-sm"
        >
          {saving ? "SAVING…" : "SAVE REPORT"}
        </button>
      </div>

      {/* ── Annexures ─────────────────────────────────────────────────────── */}
      <Panel
        title="Annexures"
        ticker={attachments.length > 0 ? `${attachments.length} file${attachments.length !== 1 ? "s" : ""}` : "Attach files"}
        status={attachments.length > 0 ? "live" : "idle"}
        actions={
          <label
            className={`text-[9px] tracking-widest border px-2 py-1 cursor-pointer transition-colors rounded-sm ${
              uploading
                ? "border-muted text-muted-foreground opacity-40 pointer-events-none"
                : "border-primary text-primary hover:bg-primary hover:text-primary-foreground"
            }`}
          >
            {uploading ? "UPLOADING…" : "+ ATTACH"}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.pdf,.xlsx,.xls,.doc,.docx,.zip"
              className="hidden"
              disabled={uploading}
              onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
            />
          </label>
        }
      >
        {/* Drop zone */}
        <div
          className="border-2 border-dashed border-border/60 rounded-sm p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          onClick={() => !uploading && fileRef.current?.click()}
        >
          {uploading ? (
            <div className="space-y-2">
              <div className="text-2xl animate-bounce">⬆️</div>
              <div className="text-xs text-primary animate-pulse">Uploading…</div>
            </div>
          ) : (
            <>
              <div className="text-3xl mb-2">📎</div>
              <div className="text-sm text-muted-foreground font-medium">Drop files here or click to browse</div>
              <div className="text-[10px] text-muted-foreground/60 mt-1">
                JPG · PNG · PDF · Excel · Word · ZIP
              </div>
            </>
          )}
        </div>

        {/* Gallery / file list */}
        {loadingAtts ? (
          <div className="mt-4 text-xs text-muted-foreground animate-pulse">Loading attachments…</div>
        ) : attachments.length > 0 ? (
          <div className="mt-4">
            {/* Photos grid */}
            {attachments.filter(a => a.category === "photo").length > 0 && (
              <div className="mb-4">
                <div className="text-[9px] tracking-widest text-muted-foreground uppercase font-medium mb-2">
                  Photos ({attachments.filter(a => a.category === "photo").length})
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {attachments.filter(a => a.category === "photo").map(att => (
                    <div key={att.id} className="border border-border rounded-sm overflow-hidden relative group bg-muted/10">
                      <a href={att.signedUrl} target="_blank" rel="noopener noreferrer" className="block">
                        <img
                          src={att.signedUrl}
                          alt={att.file_name}
                          className="w-full h-36 object-cover"
                        />
                      </a>
                      <div className="p-2 border-t border-border/50">
                        <div className="text-[9px] text-foreground/80 truncate font-medium" title={att.file_name}>
                          {att.file_name}
                        </div>
                        <div className="text-[8px] text-muted-foreground mt-0.5">
                          {new Date(att.uploaded_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </div>
                      </div>
                      <button
                        onClick={() => removeAttachment(att)}
                        className="absolute top-1.5 right-1.5 w-6 h-6 bg-destructive text-destructive-foreground text-xs rounded-sm items-center justify-center hidden group-hover:flex shadow-sm"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Documents list */}
            {attachments.filter(a => a.category === "document").length > 0 && (
              <div>
                <div className="text-[9px] tracking-widest text-muted-foreground uppercase font-medium mb-2">
                  Documents ({attachments.filter(a => a.category === "document").length})
                </div>
                <div className="space-y-2">
                  {attachments.filter(a => a.category === "document").map(att => (
                    <div key={att.id} className="flex items-center gap-3 border border-border rounded-sm px-3 py-2.5 group relative bg-muted/10 hover:bg-muted/20 transition-colors">
                      <span className="text-xl shrink-0">{fileIcon(att.file_name)}</span>
                      <div className="flex-1 min-w-0">
                        <a
                          href={att.signedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-primary hover:underline truncate block"
                          title={att.file_name}
                        >
                          {att.file_name}
                        </a>
                        <div className="text-[9px] text-muted-foreground">
                          {new Date(att.uploaded_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </div>
                      </div>
                      <button
                        onClick={() => removeAttachment(att)}
                        className="shrink-0 w-6 h-6 bg-destructive text-destructive-foreground text-xs rounded-sm items-center justify-center hidden group-hover:flex"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 text-[10px] text-muted-foreground/60 text-center">
            No files attached yet
          </div>
        )}
      </Panel>
    </div>
  );
}
