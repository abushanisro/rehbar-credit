import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { DocRow } from "@/features/case/types";
import type { DocClass } from "@/features/credit/domain";
import type { FinQueueItem, QueueStatus } from "@/features/case/types";

const ALL_DOC_CLASSES: { value: DocClass; label: string }[] = [
  { value: "all_in_one",     label: "All-in-One (BS + P&L + CF + Projections)" },
  { value: "provisional",    label: "Provisional (Unaudited / Management)" },
  { value: "bank_statement", label: "Bank Statement" },
  { value: "gst_return",     label: "GST Return" },
  { value: "cibil_report",   label: "CIBIL Report" },
  { value: "profit_loss",    label: "Profit & Loss" },
  { value: "balance_sheet",  label: "Balance Sheet" },
  { value: "cash_flow",      label: "Cash Flow" },
  { value: "projections",    label: "Projections" },
];

export function UploadGrid({
  onUpload, onCancel, onDelete, onEdit, onRetry,
  busy, docs, progress, progressLabel,
  defaultClass = "all_in_one",
  allowedClasses,
  showFy = true,
  showClass = true,
  hint,
}: {
  onUpload: (f: File, cls: DocClass, fy: number | null) => void;
  onCancel?: () => void;
  onDelete: (doc: DocRow) => void;
  onEdit?: (id: string, doc_class: string, fiscal_year: number | null) => void;
  onRetry: (doc: DocRow) => void;
  busy: boolean;
  docs: DocRow[];
  progress: number;
  progressLabel: string;
  defaultClass?: DocClass;
  allowedClasses?: DocClass[];
  showFy?: boolean;
  showClass?: boolean;
  hint?: string[];
}) {
  const docClasses = allowedClasses
    ? ALL_DOC_CLASSES.filter(d => allowedClasses.includes(d.value))
    : ALL_DOC_CLASSES;

  const [globalCls, setGlobalCls]   = useState<DocClass>(defaultClass);
  const [globalFy, setGlobalFy]     = useState("");
  const [fileQueue, setFileQueue]   = useState<FinQueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [dragOver, setDragOver]     = useState(false);
  const fileInputRef                = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editClass, setEditClass]   = useState("");
  const [editFy, setEditFy]         = useState("");

  function autoDetect(filename: string): DocClass {
    const n = filename.toLowerCase().replace(/[\s_\-\.]/g, "");
    if (allowedClasses?.length === 1) return allowedClasses[0];
    if (/bank|stmt|statement/.test(n))             return "bank_statement";
    if (/gst|gstin|gstr/.test(n))                  return "gst_return";
    if (/cibil|credit.*report|crif/.test(n))       return "cibil_report";
    if (/provisional|unaudited|mgmt|prov/.test(n)) return "provisional";
    if (/balancesheet|bsheet|bs\d/.test(n))        return "balance_sheet";
    if (/profitloss|pandl|pnl|incomestat/.test(n)) return "profit_loss";
    if (/cashflow|cfs/.test(n))                    return "cash_flow";
    if (/proj|forecast|forcast/.test(n))           return "projections";
    return defaultClass;
  }

  function makeSize(f: File) {
    return f.size < 1_048_576 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / 1_048_576).toFixed(2)} MB`;
  }

  const addToQueue = (files: File[]) => {
    setFileQueue(q => {
      const existingNames = new Set([...q.map(i => i.name), ...docs.map(d => d.file_name)]);
      return [
        ...q,
        ...files.map(f => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file: f, name: f.name, size: makeSize(f),
          stmtType: autoDetect(f.name),
          fy: globalFy,
          status: (existingNames.has(f.name) ? "duplicate" : "pending") as QueueStatus,
        })),
      ];
    });
  };

  const processAll = async () => {
    const pending = fileQueue.filter(i => i.status === "pending");
    if (!pending.length) return;
    setQueueRunning(true);
    for (const item of pending) {
      setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "processing" } : qi));
      await (onUpload(item.file, item.stmtType, item.fy ? Number(item.fy) : null) as unknown as Promise<void>);
      setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "done" } : qi));
    }
    setQueueRunning(false);
  };

  const startEdit = (d: DocRow) => { setEditingId(d.id); setEditClass(d.doc_class); setEditFy(d.fiscal_year ? String(d.fiscal_year) : ""); };
  const saveEdit  = (id: string) => { onEdit?.(id, editClass, editFy ? Number(editFy) : null); setEditingId(null); };

  const handleDownloadDoc = async (d: DocRow) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { toast.error("Not authenticated"); return; }
    try {
      const encodedPath = d.file_path.split("/").map(encodeURIComponent).join("/");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/authenticated/case-files/${encodedPath}`;
      const res = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      if (!res.ok) { const body = await res.text().catch(() => ""); throw new Error(`${res.status}: ${body}`); }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = d.file_name;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      toast.error("Download failed: " + (e instanceof Error ? e.message : "unknown error"));
    }
  };

  const pendingCount = fileQueue.filter(i => i.status === "pending").length;
  const cellCls = "bg-background border border-border rounded text-foreground px-1 py-0.5 text-xs";

  const statusColor = (d: DocRow) =>
    d.extraction_status === "extracted" ? "text-green-600" :
    d.extraction_status === "failed"    ? "text-destructive" :
    d.extraction_status === "running"   ? "text-primary animate-pulse" : "text-amber-600";

  return (
    <div className="space-y-4">

      {/* ── Controls row ─────────────────────────────────────────────────── */}
      <div className="flex gap-3 items-end flex-wrap">
        {showClass && docClasses.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Statement Type</label>
            <select value={globalCls} onChange={e => setGlobalCls(e.target.value as DocClass)}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
              {docClasses.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
        )}
        {showFy && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Fiscal Year <span className="text-muted-foreground font-normal">(optional)</span></label>
            <input type="number" placeholder="e.g. 2025" value={globalFy} onChange={e => setGlobalFy(e.target.value)}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-sm text-foreground w-28 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          </div>
        )}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-foreground mb-1.5">File <span className="text-muted-foreground font-normal">(PDF / Image / Excel)</span></label>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const files = Array.from(e.dataTransfer.files); if (files.length) addToQueue(files); }}
            onClick={() => !(busy || queueRunning) && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg cursor-pointer px-4 py-3 text-center text-sm transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/20"} ${busy || queueRunning ? "pointer-events-none opacity-40" : ""}`}
          >
            <input ref={fileInputRef} type="file" className="hidden" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv"
              onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) addToQueue(files); e.target.value = ""; }} />
            <span className="text-primary font-semibold">Drop files here or click to browse</span>
            <span className="text-muted-foreground ml-1">· Multiple OK</span>
          </div>
        </div>
      </div>

      {/* ── File queue ───────────────────────────────────────────────────── */}
      {fileQueue.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
            <span className="text-xs text-muted-foreground">
              {fileQueue.length} file{fileQueue.length > 1 ? "s" : ""} queued
              {pendingCount > 0 && ` · ${pendingCount} pending`}
            </span>
            <div className="flex gap-2">
              {pendingCount > 0 && !busy && !queueRunning && (
                <button onClick={processAll}
                  className="bg-primary text-primary-foreground rounded-md px-3 py-1 text-xs font-medium hover:bg-primary/90 transition-colors">
                  Extract {pendingCount} file{pendingCount > 1 ? "s" : ""}
                </button>
              )}
              <button onClick={() => setFileQueue([])}
                className="text-xs border border-border rounded text-muted-foreground px-2 py-1 hover:text-foreground transition-colors">
                Clear all
              </button>
            </div>
          </div>
          <div className="divide-y divide-border/30">
            {fileQueue.map(item => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className={
                  item.status === "done"       ? "text-green-600 shrink-0" :
                  item.status === "error"      ? "text-destructive shrink-0" :
                  item.status === "processing" ? "text-primary shrink-0 animate-pulse" :
                  item.status === "duplicate"  ? "text-amber-500 shrink-0" :
                                                 "text-muted-foreground shrink-0"
                }>●</span>
                <span className="truncate flex-1 text-foreground min-w-0" title={item.name}>{item.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs hidden sm:block">{item.size}</span>
                {item.status === "duplicate" ? (
                  <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">Already exists</span>
                ) : (
                  <>
                    {showClass && docClasses.length > 1 && (
                      <select
                        value={item.stmtType}
                        disabled={item.status !== "pending"}
                        onChange={e => setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, stmtType: e.target.value as DocClass } : qi))}
                        className="bg-background border border-border/60 rounded text-xs text-foreground px-1 py-0.5 shrink-0 disabled:opacity-40"
                      >
                        {docClasses.map(d => (
                          <option key={d.value} value={d.value}>{d.label}</option>
                        ))}
                      </select>
                    )}
                    {showFy && (
                      <input
                        type="number"
                        value={item.fy}
                        disabled={item.status !== "pending"}
                        onChange={e => setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, fy: e.target.value } : qi))}
                        placeholder="FY"
                        className="bg-background border border-border/60 rounded text-xs text-foreground px-1 py-0.5 w-14 shrink-0 disabled:opacity-40"
                      />
                    )}
                  </>
                )}
                {item.status !== "processing" && (
                  <button onClick={() => setFileQueue(q => q.filter(qi => qi.id !== item.id))}
                    className="text-muted-foreground hover:text-destructive text-sm shrink-0 transition-colors"
                    title="Remove from queue">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      {busy && (
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className="text-foreground">{progressLabel || "Processing…"}</span>
            <div className="flex items-center gap-3">
              <span className="text-primary font-medium tabular-nums">{progress}%</span>
              {onCancel && (
                <button onClick={onCancel}
                  className="text-xs border border-destructive/60 rounded text-destructive px-2 py-1 hover:bg-destructive/10 transition-colors">
                  Cancel
                </button>
              )}
            </div>
          </div>
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Parse</span><span>Upload</span><span>Register</span><span>Extract</span><span>Done</span>
          </div>
        </div>
      )}

      {/* ── Help text ────────────────────────────────────────────────────── */}
      {hint && hint.length > 0 && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {hint.map((h, i) => <div key={i}>· {h}</div>)}
        </div>
      )}

      {/* ── Uploaded documents table ──────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border border-border rounded-lg overflow-hidden min-w-[480px]">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left py-2 px-3 font-medium text-muted-foreground">File</th>
              <th className="py-2 px-2 font-medium text-muted-foreground">Type</th>
              {showClass && <th className="py-2 px-2 font-medium text-muted-foreground">Class</th>}
              {showFy   && <th className="py-2 px-2 font-medium text-muted-foreground">FY</th>}
              <th className="py-2 px-2 font-medium text-muted-foreground">Status</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr><td colSpan={showClass && showFy ? 6 : showClass || showFy ? 5 : 4} className="text-center text-muted-foreground py-6 text-sm">No documents uploaded yet</td></tr>
            ) : docs.map(d => {
              const isEditing = editingId === d.id;
              return (
                <tr key={d.id} className="border-t border-border/40 hover:bg-muted/10 transition-colors">
                  <td className="py-2 px-3 max-w-[200px] truncate">
                    <button type="button" onClick={() => handleDownloadDoc(d)} title="Click to download"
                      className="text-primary hover:underline text-left truncate max-w-full">
                      {d.file_name}
                    </button>
                  </td>
                  <td className="text-center px-2 text-muted-foreground capitalize">{d.file_type}</td>
                  {showClass && (
                    <td className="text-center px-2">
                      {isEditing ? (
                        <select value={editClass} onChange={e => setEditClass(e.target.value)} className={cellCls}>
                          {ALL_DOC_CLASSES.map(d => <option key={d.value} value={d.value}>{d.value}</option>)}
                        </select>
                      ) : (
                        <span className="text-foreground/70">{d.doc_class}</span>
                      )}
                    </td>
                  )}
                  {showFy && (
                    <td className="text-center px-2">
                      {isEditing
                        ? <input type="number" value={editFy} onChange={e => setEditFy(e.target.value)} placeholder="auto" className={`${cellCls} w-16`} />
                        : (d.fiscal_year ?? "—")}
                    </td>
                  )}
                  <td className={`text-center px-2 font-medium ${statusColor(d)}`}>
                    <span title={(d as DocRow & { extraction_error?: string }).extraction_error ?? ""}>
                      {d.extraction_status === "extracted" ? "Done" :
                       d.extraction_status === "failed"    ? "Failed" :
                       d.extraction_status === "running"   ? "Running…" : "Pending"}
                    </span>
                    {(d as DocRow & { extraction_error?: string }).extraction_error && d.extraction_status === "failed" && (
                      <div className="text-destructive/60 max-w-[160px] truncate text-xs font-normal"
                        title={(d as DocRow & { extraction_error?: string }).extraction_error!}>
                        {(d as DocRow & { extraction_error?: string }).extraction_error}
                      </div>
                    )}
                  </td>
                  <td className="text-center px-2 whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button type="button" onClick={() => saveEdit(d.id)} className="text-green-600 hover:text-green-700 mr-2">✓</button>
                        <button type="button" onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">✕</button>
                      </>
                    ) : (
                      <>
                        {d.extraction_status !== "extracted" && (
                          <button type="button" onClick={() => onRetry(d)} disabled={busy}
                            title="Re-run extraction"
                            className="text-amber-500 hover:text-amber-600 mr-2 disabled:pointer-events-none">↺</button>
                        )}
                        {onEdit && (
                          <button type="button" onClick={() => startEdit(d)} disabled={busy}
                            className="text-muted-foreground hover:text-primary mr-2 disabled:pointer-events-none">✎</button>
                        )}
                        <button type="button" onClick={() => onDelete(d)} disabled={busy}
                          className="text-muted-foreground hover:text-destructive disabled:pointer-events-none">✕</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
