import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Panel } from "@/components/terminal/Panel";
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { Tables } from "@/integrations/supabase/types";
import type { CaseRow, DocRow, ExtractedRow, UploadQueueItem, QueueStatus, AccumnReport } from "@/features/case/types";
import { extractPdfText } from "@/lib/pdf-text-extractor";
import { AccumnDashboard } from "./AccumnDashboard";

export function GstTab({ cc, data, extracted, user, onReload, docs, accumnData }: {
  cc: CaseRow;
  data: Tables<"gst_return_data">[];
  extracted: ExtractedRow[];
  user: { id: string };
  onReload: () => Promise<void>;
  docs: DocRow[];
  accumnData: AccumnReport | null;
}) {
  const [busy, setBusy]           = useState(false);
  const [progress, setProgress]   = useState(0);
  const [label, setLabel]         = useState("");
  const [fileQueue, setFileQueue] = useState<UploadQueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const [editCell, setEditCell]   = useState<{ id: string; field: string; value: string } | null>(null);
  const fileRef                   = useRef<HTMLInputElement>(null);

  // ── Accumn-specific import state ──────────────────────────────────────────
  const [accumnBusy, setAccumnBusy]         = useState(false);
  const [accumnProgress, setAccumnProgress] = useState(0);
  const [accumnLabel, setAccumnLabel]       = useState("");

  const accumnFileRef                       = useRef<HTMLInputElement>(null);

  const fmt = (v: number | null) => v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const commitGstNum = async () => {
    if (!editCell) return;
    const snap = editCell;
    setEditCell(null);
    const raw = snap.value.trim().replace(/,/g, "");
    const num = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && (isNaN(num!) || !isFinite(num!))) return;

    const row = data.find(r => r.id === snap.id);
    const patch: Record<string, number | null> = { [snap.field]: num };

    if (snap.field === "taxable_turnover")
      patch.total_turnover = (num ?? 0) + (row?.exempt_turnover ?? 0);
    else if (snap.field === "exempt_turnover")
      patch.total_turnover = (row?.taxable_turnover ?? 0) + (num ?? 0);
    else if (snap.field === "output_tax")
      patch.net_tax_paid = (num ?? 0) - (row?.itc_claimed ?? 0);
    else if (snap.field === "itc_claimed")
      patch.net_tax_paid = (row?.output_tax ?? 0) - (num ?? 0);

    await supabase.from("gst_return_data").update(patch as any).eq("id", snap.id);
    await onReload();
  };

  const commitGstText = async () => {
    if (!editCell) return;
    const snap = editCell;
    setEditCell(null);
    const val = snap.value.trim() || null;
    await supabase.from("gst_return_data").update({ [snap.field]: val } as any).eq("id", snap.id);
    await onReload();
  };

  const addGstRow = async () => {
    await supabase.from("gst_return_data").insert({
      case_id: cc.id, user_id: user.id,
      period: "", filing_status: "filed",
    } as any);
    await onReload();
  };

  const deleteGstRow = async (id: string) => {
    await supabase.from("gst_return_data").delete().eq("id", id);
    await onReload();
  };

  const gstNumCell = (id: string, field: string, val: number | null) => {
    if (editCell?.id === id && editCell?.field === field) return (
      <input autoFocus
        className="w-full bg-transparent border-b border-primary text-right tabular-nums outline-none"
        style={{ fontSize: "inherit", fontFamily: "inherit", minWidth: "3rem" }}
        value={editCell.value}
        onChange={e => setEditCell(ec => ec ? { ...ec, value: e.target.value } : ec)}
        onBlur={commitGstNum}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitGstNum(); } if (e.key === "Escape") setEditCell(null); }}
      />
    );
    return (
      <span className="cursor-pointer group inline-flex items-center gap-0.5 justify-end w-full"
        onClick={() => setEditCell({ id, field, value: val == null ? "" : String(val) })}>
        <span className="border-b border-dotted border-transparent group-hover:border-primary/50 group-hover:text-primary transition-colors">{fmt(val)}</span>
        <span className="opacity-0 group-hover:opacity-30 text-[8px] text-primary">✎</span>
      </span>
    );
  };

  const gstTxtCell = (id: string, field: string, val: string | null, cls = "") => {
    if (editCell?.id === id && editCell?.field === field) return (
      <input autoFocus
        className="w-full bg-transparent border-b border-primary outline-none"
        style={{ fontSize: "inherit", fontFamily: "inherit", minWidth: "3rem" }}
        value={editCell.value}
        onChange={e => setEditCell(ec => ec ? { ...ec, value: e.target.value } : ec)}
        onBlur={commitGstText}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitGstText(); } if (e.key === "Escape") setEditCell(null); }}
      />
    );
    return (
      <span className={`cursor-pointer group inline-flex items-center gap-0.5 ${cls}`}
        onClick={() => setEditCell({ id, field, value: val ?? "" })}>
        <span className="border-b border-dotted border-transparent group-hover:border-primary/50 group-hover:text-primary transition-colors">{val ?? "—"}</span>
        <span className="opacity-0 group-hover:opacity-30 text-[8px] text-primary">✎</span>
      </span>
    );
  };

  const gstStatusCell = (id: string, val: string) => {
    if (editCell?.id === id && editCell?.field === "filing_status") return (
      <select autoFocus
        className="bg-background border border-primary text-[9px] font-bold tracking-widest outline-none cursor-pointer"
        value={editCell.value}
        onChange={async e => {
          const snap = { id, value: e.target.value };
          setEditCell(null);
          await supabase.from("gst_return_data").update({ filing_status: snap.value }).eq("id", snap.id);
          await onReload();
        }}
        onBlur={() => setEditCell(null)}
      >
        <option value="filed">FILED</option>
        <option value="late">LATE</option>
        <option value="not_filed">NOT FILED</option>
      </select>
    );
    return (
      <span className={`cursor-pointer group inline-flex items-center gap-0.5 text-[9px] font-bold tracking-widest ${statusCls(val)}`}
        onClick={() => setEditCell({ id, field: "filing_status", value: val })}>
        <span className="border-b border-dotted border-transparent group-hover:border-current">{val.toUpperCase().replace("_", " ")}</span>
        <span className="opacity-0 group-hover:opacity-30 text-[8px]">✎</span>
      </span>
    );
  };

  const totalTurnover = data.reduce((s, r) => s + (r.total_turnover ?? 0), 0);
  const totalTax      = data.reduce((s, r) => s + (r.net_tax_paid ?? 0), 0);
  const totalItc      = data.reduce((s, r) => s + (r.itc_claimed ?? 0), 0);
  const lateCount     = data.filter(r => r.filing_status === "late").length;
  const notFiledCount = data.filter(r => r.filing_status === "not_filed").length;
  const gstin         = data[0]?.gstin;

  // Declared P&L turnover for comparison
  const plTurnover = (() => {
    const years = Array.from(new Set(extracted.filter(r => r.statement_type === "profit_loss").map(r => r.fiscal_year))).sort();
    const latestFy = years[years.length - 1];
    if (!latestFy) return null;
    const row = extracted.find(r => r.statement_type === "profit_loss" && r.fiscal_year === latestFy);
    const it = (row?.line_items as { label: string; value: number | null }[] | undefined)?.find(i => i.label === "Turnover");
    return it?.value ?? null;
  })();

  const addGstFiles = (files: File[]) => {
    setFileQueue(q => {
      const existingNames = new Set([...q.map(i => i.name), ...docs.map(d => d.file_name)]);
      return [...q, ...files.map(f => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f, name: f.name,
        size: f.size < 1_048_576 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / 1_048_576).toFixed(2)} MB`,
        status: (existingNames.has(f.name) ? "duplicate" : "pending") as QueueStatus,
      }))];
    });
  };

  const processGstQueue = async () => {
    const pending = fileQueue.filter(i => i.status === "pending");
    if (!pending.length) return;
    setQueueRunning(true);
    for (const item of pending) {
      setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "processing" } : qi));
      await handleUpload(item.file);
      setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "done" } : qi));
    }
    setQueueRunning(false);
  };

  const handleUpload = async (file: File) => {
    setBusy(true); setProgress(5); setLabel("Reading file…");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isExcel = ["xlsx","xls","csv"].includes(ext);
      let excelText: string | undefined;
      let pdfText: string | undefined;
      if (isExcel) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        excelText = wb.SheetNames.map(n => `=== SHEET: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t" })}`).join("\n\n");
      } else if (ext === "pdf") {
        setLabel("Reading PDF text…");
        pdfText = await extractPdfText(file);
      }
      setProgress(20); setLabel("Uploading…");
      const path = `${user.id}/${cc.id}/gst-${Date.now()}-${file.name}`;
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/case-files/${path.split("/").map(encodeURIComponent).join("/")}`;
      await new Promise<void>((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Authorization", `Bearer ${session?.access_token}`);
        xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
        xhr.setRequestHeader("x-upsert", "false");
        if (file.type) xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(20 + Math.round((e.loaded/e.total)*40)); };
        xhr.onload = () => xhr.status < 300 ? res() : rej(new Error(`Upload ${xhr.status}`));
        xhr.onerror = () => rej(new Error("Network error"));
        xhr.send(file);
      });
      setProgress(65); setLabel("Registering document…");
      const fileType = isExcel ? "excel" : ["jpg","jpeg","png","webp"].includes(ext) ? "image" : "pdf";
      const { data: doc, error: dErr } = await supabase.from("financial_documents").insert({
        case_id: cc.id, user_id: user.id, file_path: path, file_name: file.name,
        file_type: fileType as never, doc_class: "gst_return" as never, extraction_status: "pending",
      }).select().single();
      if (dErr || !doc) throw new Error(dErr?.message ?? "Register failed");

      setProgress(70); setLabel("Extracting with AI…");
      const tick = setInterval(() => setProgress(p => p < 94 ? p + 1 : p), 700);
      const { data: { session: s2 } } = await supabase.auth.getSession();
      const authH = { "Content-Type": "application/json", "Authorization": `Bearer ${s2?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
      const base = import.meta.env.VITE_SUPABASE_URL;

      // Run basic GST + Accumn extraction in parallel (Accumn only for PDFs)
      const [gstRes, accumnRes] = await Promise.all([
        fetch(`${base}/functions/v1/extract-gst`, {
          method: "POST", headers: authH,
          body: JSON.stringify({ case_id: cc.id, document_id: doc.id, excel_text: excelText }),
        }),
        fileType === "pdf"
          ? fetch(`${base}/functions/v1/extract-gst-accumn`, {
              method: "POST", headers: authH,
              body: JSON.stringify({ case_id: cc.id, document_id: doc.id, pdf_text: pdfText }),
            }).catch(() => null)
          : Promise.resolve(null),
      ]);
      clearInterval(tick);

      const gstResult  = await gstRes.json().catch(() => ({})) as Record<string,unknown>;
      const accumnResult = accumnRes ? await accumnRes.json().catch(() => ({})) as Record<string,unknown> : null;
      const isAccumn = Boolean(accumnResult?.is_accumn);

      setProgress(100); setLabel("Done");

      if (!gstRes.ok && !isAccumn) {
        throw new Error((gstResult.error as string) ?? `HTTP ${gstRes.status}`);
      }
      if (gstRes.ok && (gstResult.periods_extracted as number) > 0) {
        toast.success(`GST data extracted — ${gstResult.periods_extracted} periods${gstResult.gstin ? ` · GSTIN: ${gstResult.gstin}` : ""}`);
      }
      if (isAccumn) {
        toast.success("Accumn GST analytical report extracted");
      }
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setTimeout(() => { setBusy(false); setProgress(0); setLabel(""); }, 600);
    }
  };

  const deleteAll = async () => {
    if (!window.confirm("Delete all GST return data for this case?")) return;
    await supabase.from("gst_return_data").delete().eq("case_id", cc.id);
    await onReload();
    toast.success("GST data deleted");
  };

  const clearAccumn = async () => {
    if (!window.confirm("Delete the Accumn analytical report for this case?")) return;
    const dbRaw = supabase as unknown as { from: (t: string) => { delete: () => { eq: (c: string, v: string) => Promise<unknown> } } };
    await dbRaw.from("gst_accumn_reports").delete().eq("case_id", cc.id);
    await onReload();
    toast.success("Accumn report cleared");
  };

  const handleAccumnImport = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "pdf") { toast.error("Accumn import only accepts PDF files"); return; }
    setAccumnBusy(true); setAccumnProgress(5); setAccumnLabel("Reading PDF text…");
    try {
      const pdfText = await extractPdfText(file);
      setAccumnProgress(20); setAccumnLabel("Uploading…");

      const path = `${user.id}/${cc.id}/accumn-${Date.now()}-${file.name}`;
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/case-files/${path.split("/").map(encodeURIComponent).join("/")}`;
      await new Promise<void>((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Authorization", `Bearer ${session?.access_token}`);
        xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
        xhr.setRequestHeader("x-upsert", "true");
        xhr.setRequestHeader("Content-Type", "application/pdf");
        xhr.upload.onprogress = e => { if (e.lengthComputable) setAccumnProgress(20 + Math.round((e.loaded / e.total) * 30)); };
        xhr.onload = () => xhr.status < 300 ? res() : rej(new Error(`Upload ${xhr.status}`));
        xhr.onerror = () => rej(new Error("Network error"));
        xhr.send(file);
      });

      setAccumnProgress(55); setAccumnLabel("Registering…");
      const { data: doc, error: dErr } = await supabase.from("financial_documents").insert({
        case_id: cc.id, user_id: user.id, file_path: path, file_name: file.name,
        file_type: "pdf" as never, doc_class: "gst_return" as never, extraction_status: "pending",
      }).select().single();
      if (dErr || !doc) throw new Error(dErr?.message ?? "Register failed");

      setAccumnProgress(60); setAccumnLabel("Extracting with AI…");
      const tick = setInterval(() => setAccumnProgress(p => p < 94 ? p + 1 : p), 800);
      const { data: { session: s2 } } = await supabase.auth.getSession();
      const authH = { "Content-Type": "application/json", "Authorization": `Bearer ${s2?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
      const base = import.meta.env.VITE_SUPABASE_URL;

      const res = await fetch(`${base}/functions/v1/extract-gst-accumn`, {
        method: "POST", headers: authH,
        body: JSON.stringify({ case_id: cc.id, document_id: doc.id, pdf_text: pdfText }),
      });
      clearInterval(tick);

      const result = await res.json().catch(() => ({})) as Record<string, unknown>;
      setAccumnProgress(100); setAccumnLabel("Done");

      if (!res.ok) throw new Error((result.error as string) ?? `HTTP ${res.status}`);
      if (!result.is_accumn) {
        toast.warning("This PDF was not recognised as an Accumn GST analytical report");
      } else {
        toast.success("Accumn GST report extracted successfully");
      }
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setTimeout(() => { setAccumnBusy(false); setAccumnProgress(0); setAccumnLabel(""); }, 600);
    }
  };

  const statusCls = (s: string) => s === "filed" ? "text-success" : s === "late" ? "text-warning" : "text-destructive";

  return (
    <div className="space-y-3">
      {/* Upload */}
      <Panel title="GST RETURNS" ticker="GSTR-1 / GSTR-3B / GSTR-9 · UPLOAD & ANALYSIS" status={data.length > 0 ? "live" : "idle"}
        actions={data.length > 0 ? <button onClick={deleteAll} className="text-[10px] border border-destructive/40 text-destructive/70 px-2 py-0.5 hover:bg-destructive/10">[DELETE ALL]</button> : undefined}
      >
        <div className="space-y-3">
          <input ref={fileRef} type="file" className="hidden" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv"
            onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) addGstFiles(files); e.target.value = ""; }} />

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const files = Array.from(e.dataTransfer.files); if (files.length) addGstFiles(files); }}
            onClick={() => !(busy || queueRunning) && fileRef.current?.click()}
            className={`border-2 border-dashed cursor-pointer px-4 py-3 text-center text-xs transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"} ${busy || queueRunning ? "pointer-events-none opacity-40" : ""}`}
          >
            <span className="text-primary font-bold">⬆ DROP GST FILE OR CLICK</span>
            <span className="text-muted-foreground ml-1">· GSTR-1 / GSTR-3B / GSTR-9 · Multiple OK</span>
          </div>
          {gstin && <div className="text-[10px] text-accent tracking-wider">GSTIN: {gstin}</div>}

          {/* Queue */}
          {fileQueue.length > 0 && (
            <div className="border border-border">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-surface/40">
                <span className="terminal-label text-[10px]">
                  {fileQueue.length} FILE{fileQueue.length > 1 ? "S" : ""}
                  {fileQueue.filter(i => i.status === "pending").length > 0 && ` · ${fileQueue.filter(i => i.status === "pending").length} PENDING`}
                </span>
                <div className="flex gap-2">
                  {fileQueue.some(i => i.status === "pending") && !busy && !queueRunning && (
                    <button onClick={processGstQueue}
                      className="bg-primary text-primary-foreground px-3 py-0.5 text-[10px] tracking-widest font-bold hover:opacity-90">
                      [EXTRACT {fileQueue.filter(i => i.status === "pending").length} FILE{fileQueue.filter(i => i.status === "pending").length > 1 ? "S" : ""}]
                    </button>
                  )}
                  <button onClick={() => setFileQueue([])} className="text-[10px] border border-border text-muted-foreground px-2 py-0.5 hover:text-foreground">CLEAR</button>
                </div>
              </div>
              <div className="divide-y divide-border/30">
                {fileQueue.map(item => (
                  <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                    <span className={item.status === "done" ? "text-success" : item.status === "error" ? "text-destructive" : item.status === "processing" ? "text-primary animate-pulse" : item.status === "duplicate" ? "text-warning" : "text-muted-foreground"}>
                      {item.status === "done" ? "●" : item.status === "error" ? "✗" : item.status === "processing" ? "▶" : item.status === "duplicate" ? "◎" : "○"}
                    </span>
                    <span className="truncate flex-1 text-primary">{item.name}</span>
                    <span className="text-foreground/40 shrink-0">{item.size}</span>
                    {item.status === "duplicate" && (
                      <button
                        onClick={() => setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "pending" as QueueStatus } : qi))}
                        className="text-warning text-[9px] tracking-widest shrink-0 border border-warning/40 px-1.5 py-0.5 hover:text-foreground hover:border-foreground/40 transition-colors"
                      >RE-EXTRACT</button>
                    )}
                    {item.status === "pending" && (
                      <button onClick={() => setFileQueue(q => q.filter(qi => qi.id !== item.id))} className="text-foreground/30 hover:text-destructive text-[10px]">✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Progress */}
          {busy && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-muted-foreground"><span>{label}</span><span>{progress}%</span></div>
              <div className="h-1.5 bg-border"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
            </div>
          )}
        </div>
      </Panel>

      {/* ── Accumn PDF Import ─────────────────────────────────────────────── */}
      <Panel
        title="ACCUMN ANALYTICAL REPORT"
        ticker="GST ADVISORY PDF · AI EXTRACTION"
        status={accumnData?.is_accumn ? "live" : "idle"}
        actions={accumnData?.is_accumn ? (
          <button onClick={clearAccumn} className="text-[10px] border border-destructive/40 text-destructive/70 px-2 py-0.5 hover:bg-destructive/10">[CLEAR]</button>
        ) : undefined}
      >
        <div className="flex items-center gap-2">
          <input ref={accumnFileRef} type="file" className="hidden" accept=".pdf"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleAccumnImport(f); e.target.value = ""; }} />
          <button
            onClick={() => accumnFileRef.current?.click()}
            disabled={accumnBusy}
            className="text-[10px] tracking-widest border border-primary/40 text-primary/70 hover:bg-primary/10 px-3 py-1.5 disabled:opacity-50 flex items-center gap-1.5"
          >{accumnBusy ? "IMPORTING…" : "⬆ IMPORT ACCUMN PDF"}</button>
          <span className="text-[9px] text-muted-foreground/50 tracking-wide">Accumn GST Advisory Report · PDF only</span>
          {accumnData?.is_accumn && !accumnBusy && (
            <span className="flex items-center gap-1.5 ml-2">
              <span className="text-success text-xs">●</span>
              <span className="text-foreground font-medium text-[10px]">{accumnData.company_profile?.name ?? "Accumn Report"} loaded</span>
              {accumnData.company_profile?.gstin && (
                <span className="text-muted-foreground font-mono text-[10px]">{accumnData.company_profile.gstin}</span>
              )}
            </span>
          )}
        </div>

        {accumnBusy && (
          <div className="space-y-1 mt-2">
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>{accumnLabel}</span><span>{accumnProgress}%</span></div>
            <div className="h-1.5 bg-border"><div className="h-full bg-accent transition-all" style={{ width: `${accumnProgress}%` }} /></div>
          </div>
        )}
      </Panel>

      {data.length > 0 && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Panel title="TOTAL GST TURNOVER" ticker={`${data.length} PERIODS`}>
              <div className="text-xl font-bold text-primary">₹{fmt(totalTurnover)}</div>
              <div className="terminal-label mt-1">all periods combined</div>
            </Panel>
            <Panel title="NET TAX PAID">
              <div className="text-xl font-bold text-warning">₹{fmt(totalTax)}</div>
              <div className="terminal-label mt-1">after ITC utilisation</div>
            </Panel>
            <Panel title="ITC CLAIMED">
              <div className="text-xl font-bold text-accent">₹{fmt(totalItc)}</div>
              <div className="terminal-label mt-1">input tax credit</div>
            </Panel>
            <Panel title="FILING COMPLIANCE" status={notFiledCount > 0 ? "idle" : lateCount > 0 ? "warn" : "live"}>
              <div className={`text-xl font-bold ${notFiledCount > 0 ? "text-destructive" : lateCount > 0 ? "text-warning" : "text-success"}`}>
                {notFiledCount > 0 ? `${notFiledCount} NOT FILED` : lateCount > 0 ? `${lateCount} LATE` : "COMPLIANT"}
              </div>
              <div className="terminal-label mt-1">{data.length} returns checked</div>
            </Panel>
          </div>

          {/* P&L vs GST comparison */}
          {plTurnover && totalTurnover > 0 && (
            <Panel title="GST TURNOVER vs P&L DECLARED TURNOVER" ticker="CONSISTENCY CHECK" status={Math.abs(totalTurnover - plTurnover) / plTurnover > 0.15 ? "warn" : "live"}>
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="terminal-label">GST TURNOVER</div>
                  <div className="text-primary font-bold text-lg mt-1">₹{fmt(totalTurnover)}</div>
                </div>
                <div>
                  <div className="terminal-label">P&L DECLARED (latest FY)</div>
                  <div className="text-primary font-bold text-lg mt-1">₹{fmt(plTurnover)}</div>
                </div>
                <div>
                  <div className="terminal-label">VARIANCE</div>
                  {(() => {
                    const diff = totalTurnover - plTurnover;
                    const pct = (diff / plTurnover * 100).toFixed(1);
                    const cls = Math.abs(diff/plTurnover) > 0.15 ? "text-destructive" : "text-success";
                    return <div className={`font-bold text-lg mt-1 ${cls}`}>{diff >= 0 ? "+" : ""}{fmt(diff)} ({pct}%)</div>;
                  })()}
                </div>
              </div>
              {Math.abs(totalTurnover - plTurnover) / plTurnover > 0.15 && (
                <div className="mt-2 text-[10px] text-warning tracking-wider">
                  ▲ Variance exceeds 15% — reconcile GST returns with audited financials before credit decision
                </div>
              )}
            </Panel>
          )}

          {/* Period table */}
          <Panel title="GST PERIOD-WISE DETAILS" ticker="ALL RETURNS"
            actions={
              <button onClick={addGstRow}
                className="text-[10px] tracking-widest border border-primary/40 text-primary/70 hover:bg-primary/10 px-2 py-0.5">
                + ADD ROW
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 pr-2">PERIOD</th>
                    <th className="text-left pr-2">TYPE</th>
                    <th className="text-left pr-2">GSTIN</th>
                    <th className="text-right pr-2">TAXABLE</th>
                    <th className="text-right pr-2">EXEMPT</th>
                    <th className="text-right pr-2">TOTAL TURNOVER</th>
                    <th className="text-right pr-2">OUTPUT TAX</th>
                    <th className="text-right pr-2">ITC</th>
                    <th className="text-right pr-2">NET TAX</th>
                    <th className="text-center pr-2">STATUS</th>
                    <th className="text-left pr-2">FILED ON</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(row => (
                    <tr key={row.id} className="border-b border-border/30 group/row">
                      <td className="py-1 pr-2 font-medium">{gstTxtCell(row.id, "period", row.period)}</td>
                      <td className="pr-2 text-accent text-[10px]">{gstTxtCell(row.id, "return_type", row.return_type)}</td>
                      <td className="pr-2 font-mono text-[10px] text-muted-foreground">{gstTxtCell(row.id, "gstin", row.gstin)}</td>
                      <td className="text-right pr-2 tabular-nums">{gstNumCell(row.id, "taxable_turnover", row.taxable_turnover)}</td>
                      <td className="text-right pr-2 tabular-nums text-muted-foreground">{gstNumCell(row.id, "exempt_turnover", row.exempt_turnover)}</td>
                      <td className="text-right pr-2 tabular-nums font-medium">{gstNumCell(row.id, "total_turnover", row.total_turnover)}</td>
                      <td className="text-right pr-2 tabular-nums text-warning">{gstNumCell(row.id, "output_tax", row.output_tax)}</td>
                      <td className="text-right pr-2 tabular-nums text-accent">{gstNumCell(row.id, "itc_claimed", row.itc_claimed)}</td>
                      <td className="text-right pr-2 tabular-nums font-bold">{gstNumCell(row.id, "net_tax_paid", row.net_tax_paid)}</td>
                      <td className="text-center pr-2">{gstStatusCell(row.id, row.filing_status)}</td>
                      <td className="text-muted-foreground text-[10px] pr-2">{gstTxtCell(row.id, "filing_date", row.filing_date ?? null)}</td>
                      <td className="w-4">
                        <button
                          onClick={() => deleteGstRow(row.id)}
                          className="opacity-0 group-hover/row:opacity-60 hover:!opacity-100 text-destructive text-[10px] transition-opacity"
                          title="Delete row"
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Turnover chart */}
          {data.length >= 2 && (
            <Panel title="GST TURNOVER TREND" ticker="PERIOD-WISE">
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.map(r => ({ period: r.period.length > 7 ? r.period : r.period.slice(5), taxable: r.taxable_turnover, tax: r.net_tax_paid }))} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="period" tick={{ fill: "#6b7280", fontSize: 9 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} width={54} tickFormatter={v => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                    <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                    <Bar dataKey="taxable" name="Taxable Turnover" fill="#22c55e" opacity={0.85} radius={[2,2,0,0]} />
                    <Line type="monotone" dataKey="tax" name="Net Tax Paid" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}
        </>
      )}

      {/* Accumn Analytical Report Dashboard */}
      {accumnData?.is_accumn && (
        <AccumnDashboard data={accumnData} onClear={clearAccumn} />
      )}
    </div>
  );
}
