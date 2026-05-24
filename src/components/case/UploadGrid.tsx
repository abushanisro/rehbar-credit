import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { DocRow } from "@/features/case/types";
import type { DocClass } from "@/features/credit/domain";
import type { FinQueueItem, QueueStatus } from "@/features/case/types";

export function UploadGrid({ onUpload, onCancel, onDelete, onEdit, onRetry, busy, docs, progress, progressLabel }: {
  onUpload: (f: File, cls: DocClass, fy: number | null) => void;
  onCancel: () => void;
  onDelete: (doc: DocRow) => void;
  onEdit: (id: string, doc_class: string, fiscal_year: number | null) => void;
  onRetry: (doc: DocRow) => void;
  busy: boolean; docs: DocRow[]; progress: number; progressLabel: string;
}) {
  const DOC_CLASSES: { value: DocClass; label: string }[] = [
    { value: "all_in_one",     label: "ALL-IN-ONE (BS + P&L + CF + PROJ)" },
    { value: "provisional",    label: "PROVISIONAL (UNAUDITED / MANAGEMENT)" },
    { value: "bank_statement", label: "BANK STATEMENT" },
    { value: "gst_return",     label: "GST RETURN" },
    { value: "profit_loss",    label: "PROFIT & LOSS" },
    { value: "balance_sheet",  label: "BALANCE SHEET" },
    { value: "cash_flow",      label: "CASH FLOW" },
    { value: "projections",    label: "PROJECTIONS" },
  ];

  const [globalCls, setGlobalCls]   = useState<DocClass>("all_in_one");
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
    if (/bank|stmt|statement/.test(n))             return "bank_statement";
    if (/gst|gstin|gstr/.test(n))                  return "gst_return";
    if (/provisional|unaudited|mgmt|prov/.test(n)) return "provisional";
    if (/balancesheet|bsheet|bs\d/.test(n))        return "balance_sheet";
    if (/profitloss|pandl|pnl|incomestat/.test(n)) return "profit_loss";
    if (/cashflow|cfs/.test(n))                    return "cash_flow";
    if (/proj|forecast|forcast/.test(n))           return "projections";
    return "all_in_one";
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
  const saveEdit  = (id: string) => { onEdit(id, editClass, editFy ? Number(editFy) : null); setEditingId(null); };

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
  const cellCls = "bg-input border border-border text-primary px-1 py-0.5 text-xs";

  return (
    <div className="space-y-3">

      {/* ── Controls row ─────────────────────────────────────────────────── */}
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="terminal-label block mb-1">Statement Type</label>
          <select value={globalCls} onChange={e => setGlobalCls(e.target.value as DocClass)}
            className="bg-input border border-border px-2 py-1.5 text-sm text-primary">
            {DOC_CLASSES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <label className="terminal-label block mb-1">Fiscal Year (optional)</label>
          <input type="number" placeholder="e.g. 2025" value={globalFy} onChange={e => setGlobalFy(e.target.value)}
            className="bg-input border border-border px-2 py-1.5 text-sm text-primary w-28" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="terminal-label block mb-1">File (PDF / Image / Excel)</label>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const files = Array.from(e.dataTransfer.files); if (files.length) addToQueue(files); }}
            onClick={() => !(busy || queueRunning) && fileInputRef.current?.click()}
            className={`border-2 border-dashed cursor-pointer px-3 py-2 text-center text-xs transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"} ${busy || queueRunning ? "pointer-events-none opacity-40" : ""}`}
          >
            <input ref={fileInputRef} type="file" className="hidden" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv"
              onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) addToQueue(files); e.target.value = ""; }} />
            <span className="text-primary font-bold">⬆ DROP FILES OR CLICK</span>
            <span className="text-muted-foreground ml-1">· Multiple OK</span>
          </div>
        </div>
      </div>

      {/* ── File queue ───────────────────────────────────────────────────── */}
      {fileQueue.length > 0 && (
        <div className="border border-border">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-surface/40">
            <span className="terminal-label text-[10px]">
              {fileQueue.length} FILE{fileQueue.length > 1 ? "S" : ""} QUEUED
              {pendingCount > 0 && ` · ${pendingCount} PENDING`}
            </span>
            <div className="flex gap-2">
              {pendingCount > 0 && !busy && !queueRunning && (
                <button onClick={processAll}
                  className="bg-primary text-primary-foreground px-3 py-0.5 text-[10px] tracking-widest font-bold hover:opacity-90">
                  [EXTRACT {pendingCount} FILE{pendingCount > 1 ? "S" : ""}]
                </button>
              )}
              <button onClick={() => setFileQueue([])}
                className="text-[10px] border border-border text-muted-foreground px-2 py-0.5 hover:text-foreground">
                CLEAR ALL
              </button>
            </div>
          </div>
          <div className="divide-y divide-border/30">
            {fileQueue.map(item => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                <span className={
                  item.status === "done"       ? "text-success shrink-0" :
                  item.status === "error"      ? "text-destructive shrink-0" :
                  item.status === "processing" ? "text-primary shrink-0 animate-pulse" :
                  item.status === "duplicate"  ? "text-warning shrink-0" :
                                                 "text-muted-foreground shrink-0"
                }>
                  {item.status === "done" ? "●" : item.status === "error" ? "✗" : item.status === "processing" ? "▶" : item.status === "duplicate" ? "◎" : "○"}
                </span>
                <span className="truncate flex-1 text-primary min-w-0" title={item.name}>{item.name}</span>
                <span className="text-foreground/40 shrink-0 hidden sm:block">{item.size}</span>
                {item.status === "duplicate" ? (
                  <span className="text-warning text-[9px] tracking-widest shrink-0">ALREADY EXISTS</span>
                ) : (
                  <>
                    <select
                      value={item.stmtType}
                      disabled={item.status !== "pending"}
                      onChange={e => setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, stmtType: e.target.value as DocClass } : qi))}
                      className="bg-input border border-border/60 text-[9px] text-primary px-1 py-0.5 shrink-0 disabled:opacity-40"
                    >
                      {DOC_CLASSES.map(d => (
                        <option key={d.value} value={d.value}>{d.value === "all_in_one" ? "AUTO" : d.value.replace(/_/g, " ").toUpperCase()}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={item.fy}
                      disabled={item.status !== "pending"}
                      onChange={e => setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, fy: e.target.value } : qi))}
                      placeholder="FY"
                      className="bg-input border border-border/60 text-[9px] text-primary px-1 py-0.5 w-12 shrink-0 disabled:opacity-40"
                    />
                  </>
                )}
                {item.status !== "processing" && (
                  <button onClick={() => setFileQueue(q => q.filter(qi => qi.id !== item.id))}
                    className="text-foreground/40 hover:text-destructive hover:bg-destructive/10 px-1.5 py-0.5 border border-transparent hover:border-destructive/20 text-[10px] shrink-0 transition-colors"
                    title="Remove from queue">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      {busy && (
        <div className="border border-warning/40 bg-warning/5 p-3 space-y-2">
          <div className="flex justify-between items-center text-[11px] tracking-widest">
            <span className="text-warning">▸ {progressLabel || "WORKING"}</span>
            <div className="flex items-center gap-3">
              <span className="text-primary font-bold tabular-nums">{progress}%</span>
              <button onClick={onCancel}
                className="text-[10px] border border-destructive/60 text-destructive px-2 py-0.5 hover:bg-destructive/10 tracking-widest">
                [CANCEL]
              </button>
            </div>
          </div>
          <div className="h-2 bg-input border border-border overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progress}%`, boxShadow: "0 0 8px hsl(var(--primary))" }} />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground tracking-widest">
            <span>PARSE</span><span>UPLOAD</span><span>REGISTER</span><span>EXTRACT</span><span>DONE</span>
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground tracking-wider space-y-0.5">
        <div>▸ ALL-IN-ONE (AUTO) detects every statement type and all fiscal years inside one document.</div>
        <div>▸ Statement type is auto-detected from filename — review and override per file before extracting.</div>
        <div>▸ PROJECTIONS do not require a fiscal year. Excel parsed locally — PDF/Image via vision model.</div>
      </div>

      {/* ── Uploaded documents table ──────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-t border-border min-w-[480px]">
          <thead className="text-muted-foreground">
            <tr><th className="text-left py-1">FILE</th><th>TYPE</th><th>CLASS</th><th>FY</th><th>STATUS</th><th></th></tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-muted-foreground py-4">NO DOCUMENTS UPLOADED YET</td></tr>
            ) : docs.map(d => {
              const isEditing = editingId === d.id;
              return (
                <tr key={d.id} className="border-b border-border/30">
                  <td className="py-1 max-w-[180px] truncate"><button type="button" onClick={() => handleDownloadDoc(d)} title="Click to download" className="text-primary hover:underline hover:text-accent cursor-pointer text-left truncate max-w-full">{d.file_name}</button></td>
                  <td className="text-center text-accent">{d.file_type.toUpperCase()}</td>
                  <td className="text-center text-foreground/80 px-1">
                    {isEditing ? (
                      <select value={editClass} onChange={e => setEditClass(e.target.value)} className={cellCls}>
                        {DOC_CLASSES.map(d => <option key={d.value} value={d.value}>{d.value}</option>)}
                      </select>
                    ) : d.doc_class}
                  </td>
                  <td className="text-center px-1">
                    {isEditing
                      ? <input type="number" value={editFy} onChange={e => setEditFy(e.target.value)} placeholder="auto" className={`${cellCls} w-16`} />
                      : (d.fiscal_year ?? "—")}
                  </td>
                  <td className={`text-center ${d.extraction_status === "extracted" ? "text-success" : d.extraction_status === "failed" ? "text-destructive" : d.extraction_status === "running" ? "text-warning animate-pulse" : "text-warning"}`}>
                    <span title={(d as DocRow & { extraction_error?: string }).extraction_error ?? ""}>{d.extraction_status.toUpperCase()}</span>
                    {(d as DocRow & { extraction_error?: string }).extraction_error && d.extraction_status === "failed" && (
                      <div className="text-[9px] text-destructive/60 max-w-[140px] truncate" title={(d as DocRow & { extraction_error?: string }).extraction_error!}>
                        {(d as DocRow & { extraction_error?: string }).extraction_error}
                      </div>
                    )}
                  </td>
                  <td className="text-center pl-2 whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button type="button" onClick={() => saveEdit(d.id)} className="text-green-400 hover:text-green-300 mr-2">✓</button>
                        <button type="button" onClick={() => setEditingId(null)} className="text-foreground/40 hover:text-foreground">✕</button>
                      </>
                    ) : (
                      <>
                        {d.extraction_status !== "extracted" && (
                          <button type="button" onClick={() => onRetry(d)} disabled={busy} title="Re-run extraction" className="text-warning/70 hover:text-warning mr-2 disabled:pointer-events-none text-base leading-none">▶</button>
                        )}
                        <button type="button" onClick={() => startEdit(d)} disabled={busy} className="text-foreground/40 hover:text-primary mr-2 disabled:pointer-events-none">✎</button>
                        <button type="button" onClick={() => onDelete(d)} disabled={busy} className="text-foreground/40 hover:text-red-400 disabled:pointer-events-none">✕</button>
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
