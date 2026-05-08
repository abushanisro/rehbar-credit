import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Panel } from "@/components/terminal/Panel";
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { Tables } from "@/integrations/supabase/types";
import type { CaseRow, DocRow, UploadQueueItem, QueueStatus } from "@/features/case/types";

async function pollExtractionStatus(docId: string, signal: AbortSignal): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (signal.aborted) throw new Error("cancelled");
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 2000);
      signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("cancelled")); }, { once: true });
    });
    const { data } = await supabase
      .from("financial_documents")
      .select("extraction_status, extraction_error")
      .eq("id", docId)
      .single();
    if (data?.extraction_status === "extracted") return;
    if (data?.extraction_status === "failed")
      throw new Error(data.extraction_error ?? "Extraction failed");
  }
  throw new Error("Analysis timed out — check Supabase Edge Function logs");
}

export function BankStatementTab({ cc, data, docs, user, onReload }: { cc: CaseRow; data: Tables<"bank_statement_data">[]; docs: DocRow[]; user: { id: string }; onReload: () => Promise<void> }) {
  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState(0);
  const [label, setLabel]       = useState("");
  const [fileQueue, setFileQueue] = useState<UploadQueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editCell, setEditCell] = useState<{ id: string; field: string; value: string } | null>(null);
  const fileRef                 = useRef<HTMLInputElement>(null);

  const fmt = (v: number | null) => v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const commitBankEdit = async () => {
    if (!editCell) return;
    const snap = editCell;
    setEditCell(null);
    const raw = snap.value.trim().replace(/,/g, "");
    const num = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && (isNaN(num!) || !isFinite(num!))) return;
    await supabase.from("bank_statement_data").update({ [snap.field]: num } as any).eq("id", snap.id);
    await onReload();
  };

  const bankNumCell = (id: string, field: string, val: number | null) => {
    if (editCell?.id === id && editCell?.field === field) return (
      <input autoFocus
        className="w-full bg-transparent border-b border-primary text-right tabular-nums outline-none"
        style={{ fontSize: "inherit", fontFamily: "inherit", minWidth: "3rem" }}
        value={editCell.value}
        onChange={e => setEditCell(ec => ec ? { ...ec, value: e.target.value } : ec)}
        onBlur={commitBankEdit}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitBankEdit(); } if (e.key === "Escape") setEditCell(null); }}
      />
    );
    return (
      <span className="cursor-pointer hover:text-primary transition-colors"
        onClick={() => setEditCell({ id, field, value: val == null ? "" : String(val) })}>
        {fmt(val)}
      </span>
    );
  };

  const creditData  = data.filter(r => r.total_credits != null);
  const avgCredits  = creditData.length ? creditData.reduce((s, r) => s + r.total_credits!, 0) / creditData.length : null;
  const debitData   = data.filter(r => r.total_debits != null);
  const avgDebits   = debitData.length ? debitData.reduce((s, r) => s + r.total_debits!, 0) / debitData.length : null;
  const balData     = data.filter(r => r.avg_balance != null);
  const avgBalance  = balData.length ? balData.reduce((s, r) => s + r.avg_balance!, 0) / balData.length : null;
  const totalBounce = data.reduce((s, r) => s + (r.bounce_inward ?? 0), 0);
  const bounceRate  = data.length && totalBounce ? ((totalBounce / data.length)).toFixed(1) : null;
  const bankName    = data[0]?.bank_name;

  const addBankFiles = (files: File[]) => {
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

  const processBankQueue = async () => {
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
      if (isExcel) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        excelText = wb.SheetNames.map(n => `=== SHEET: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t" })}`).join("\n\n");
      }
      setProgress(20); setLabel("Uploading…");
      const path = `${user.id}/${cc.id}/bank-${Date.now()}-${file.name}`;
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
        file_type: fileType as never, doc_class: "bank_statement" as never, extraction_status: "pending",
      }).select().single();
      if (dErr || !doc) throw new Error(dErr?.message ?? "Register failed");
      setProgress(70); setLabel("Queuing extraction…");
      const { data: { session: s2 } } = await supabase.auth.getSession();
      const fnHeaders = { "Content-Type": "application/json", "Authorization": `Bearer ${s2?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };

      // Include any other failed/pending bank statements so they all run together
      const { data: otherDocs } = await supabase.from("financial_documents")
        .select("id")
        .eq("case_id", cc.id)
        .eq("doc_class", "bank_statement")
        .neq("id", doc.id)
        .in("extraction_status", ["failed", "pending"]);
      const allIds = [doc.id, ...(otherDocs?.map((d: { id: string }) => d.id) ?? [])];

      const queueRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-bank-extraction`, {
        method: "POST", headers: fnHeaders,
        body: JSON.stringify({
          case_id: cc.id, user_id: user.id, document_ids: allIds,
          ...(excelText ? { excel_texts: { [doc.id]: excelText } } : {}),
        }),
      });
      if (!queueRes.ok) { const j = await queueRes.json().catch(() => ({})); throw new Error(j.error ?? `Queue failed HTTP ${queueRes.status}`); }

      setProgress(75); setLabel(`Extracting ${allIds.length} statement${allIds.length > 1 ? "s" : ""} in parallel…`);
      const tick = setInterval(() => setProgress(p => p < 94 ? p + 1 : p), 700);
      // Poll the newly registered doc until it completes
      const abort = new AbortController();
      try {
        await pollExtractionStatus(doc.id, abort.signal);
      } finally {
        clearInterval(tick);
      }
      setProgress(100); setLabel("Done");
      toast.success("Bank statements extracted");
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setTimeout(() => { setBusy(false); setProgress(0); setLabel(""); }, 600);
    }
  };

  const failedDocs = docs.filter(d => d.doc_class === "bank_statement" && d.extraction_status === "failed");

  const retryFailed = async () => {
    if (!failedDocs.length) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
      const ids = failedDocs.map(d => d.id);
      await supabase.from("financial_documents").update({ extraction_status: "running", extraction_error: null }).in("id", ids);
      const { error: triggerErr } = await supabase.functions.invoke("trigger-bank-extraction", {
        body: { case_id: cc.id, user_id: user.id, document_ids: ids },
      });
      if (triggerErr) {
        ids.forEach(id => {
          supabase.functions.invoke("extract-bank-statement", {
            body: { case_id: cc.id, document_id: id },
          });
        });
      }
      toast.success(`Re-running ${ids.length} statement${ids.length > 1 ? "s" : ""}`);
      await onReload();
    } catch (e) {
      toast.error("Retry failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const deleteAll = async () => {
    if (!window.confirm("Delete all bank statement data for this case?")) return;
    await supabase.from("bank_statement_data").delete().eq("case_id", cc.id);
    await onReload();
    toast.success("Bank statement data deleted");
  };

  return (
    <div className="space-y-3">
      {/* Upload */}
      <Panel title="BANK STATEMENT UPLOAD" ticker="AI EXTRACTION" status={data.length > 0 ? "live" : "idle"}
        actions={
          <div className="flex gap-2">
            {failedDocs.length > 0 && (
              <button onClick={retryFailed} className="text-[10px] border border-warning/40 text-warning/70 px-2 py-0.5 hover:bg-warning/10">
                [↺ RETRY {failedDocs.length} FAILED]
              </button>
            )}
            {data.length > 0 && <button onClick={deleteAll} className="text-[10px] border border-destructive/40 text-destructive/70 px-2 py-0.5 hover:bg-destructive/10">[DELETE ALL]</button>}
          </div>
        }
      >
        <div className="space-y-3">
          <input ref={fileRef} type="file" className="hidden" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv"
            onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) addBankFiles(files); e.target.value = ""; }} />

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const files = Array.from(e.dataTransfer.files); if (files.length) addBankFiles(files); }}
            onClick={() => !(busy || queueRunning) && fileRef.current?.click()}
            className={`border-2 border-dashed cursor-pointer px-4 py-3 text-center text-xs transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"} ${busy || queueRunning ? "pointer-events-none opacity-40" : ""}`}
          >
            <span className="text-primary font-bold">⬆ DROP BANK STATEMENTS OR CLICK</span>
            <span className="text-muted-foreground ml-1">· Multiple months OK · PDF · Excel · Image</span>
          </div>

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
                    <button onClick={processBankQueue}
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
                      <span className="text-warning text-[9px] tracking-widest shrink-0">ALREADY EXISTS</span>
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

      {data.length > 0 && (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Panel title="AVG MONTHLY CREDITS" ticker={bankName ?? "BANK"}>
              <div className="text-xl font-bold text-success">₹{fmt(avgCredits)}</div>
              <div className="terminal-label mt-1">per month</div>
            </Panel>
            <Panel title="AVG MONTHLY DEBITS">
              <div className="text-xl font-bold text-destructive">₹{fmt(avgDebits)}</div>
              <div className="terminal-label mt-1">per month</div>
            </Panel>
            <Panel title="AVG BALANCE (AMB)" status={avgBalance && avgBalance > 0 ? "live" : "idle"}>
              <div className="text-xl font-bold text-primary">₹{fmt(avgBalance)}</div>
              <div className="terminal-label mt-1">average monthly balance</div>
            </Panel>
            <Panel title="INWARD BOUNCES" status={totalBounce > 0 ? "idle" : "live"}>
              <div className={`text-xl font-bold ${totalBounce > 0 ? "text-destructive" : "text-success"}`}>{totalBounce}</div>
              <div className="terminal-label mt-1">{bounceRate ? `${bounceRate}/month avg` : "nil"}</div>
            </Panel>
          </div>

          {/* Monthly table */}
          <Panel title="MONTHLY BANK ANALYSIS" ticker={`${data.length} MONTHS`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 pr-2">MONTH</th>
                    <th className="text-right pr-2">OPENING</th>
                    <th className="text-right pr-2">CREDITS</th>
                    <th className="text-right pr-2">DEBITS</th>
                    <th className="text-right pr-2">CLOSING</th>
                    <th className="text-right pr-2">AVG BAL</th>
                    <th className="text-right pr-2">EMI OUTFLOW</th>
                    <th className="text-center pr-2">BNCE↓</th>
                    <th className="text-center pr-2">BNCE↑</th>
                    <th className="text-right">NET FLOW</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(row => {
                    const net = row.total_credits != null && row.total_debits != null ? row.total_credits - row.total_debits : null;
                    const bi = row.bounce_inward ?? 0;
                    const bo = row.bounce_outward ?? 0;
                    return (
                      <tr key={row.id} className="border-b border-border/30">
                        <td className="py-1 pr-2 font-medium">{row.month}</td>
                        <td className="text-right pr-2 tabular-nums text-muted-foreground">{bankNumCell(row.id, "opening_balance", row.opening_balance)}</td>
                        <td className="text-right pr-2 tabular-nums text-success">{bankNumCell(row.id, "total_credits", row.total_credits)}</td>
                        <td className="text-right pr-2 tabular-nums text-destructive">{bankNumCell(row.id, "total_debits", row.total_debits)}</td>
                        <td className="text-right pr-2 tabular-nums font-medium">{bankNumCell(row.id, "closing_balance", row.closing_balance)}</td>
                        <td className="text-right pr-2 tabular-nums text-accent">{bankNumCell(row.id, "avg_balance", row.avg_balance)}</td>
                        <td className="text-right pr-2 tabular-nums text-warning">{bankNumCell(row.id, "emi_outflows", row.emi_outflows)}</td>
                        <td className={`text-center pr-2 font-bold ${bi > 0 ? "text-destructive" : "text-muted-foreground"}`}>{bankNumCell(row.id, "bounce_inward", row.bounce_inward)}</td>
                        <td className={`text-center pr-2 font-bold ${bo > 0 ? "text-warning" : "text-muted-foreground"}`}>{bankNumCell(row.id, "bounce_outward", row.bounce_outward)}</td>
                        <td className={`text-right tabular-nums font-bold ${net == null ? "text-muted-foreground" : net >= 0 ? "text-success" : "text-destructive"}`}>{net == null ? "—" : (net >= 0 ? "+" : "") + fmt(net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Chart */}
          {data.length >= 2 && (
            <Panel title="CREDITS vs DEBITS TREND" ticker="MONTHLY CASH FLOW">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.map(r => ({ month: r.month.slice(5), credits: r.total_credits, debits: r.total_debits, balance: r.avg_balance }))} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} width={54} tickFormatter={v => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                    <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                    <Bar dataKey="credits" name="Credits" fill="#22c55e" opacity={0.8} radius={[2,2,0,0]} />
                    <Bar dataKey="debits" name="Debits" fill="#ef4444" opacity={0.8} radius={[2,2,0,0]} />
                    <Line type="monotone" dataKey="balance" name="Avg Balance" stroke="#60a5fa" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}

          {/* Insights */}
          {(() => {
            const obs: { text: string; cls: string }[] = [];
            if (totalBounce > 2) obs.push({ text: `${totalBounce} inward bounces detected across ${data.length} months — signals payment stress`, cls: "text-destructive" });
            else if (totalBounce === 0) obs.push({ text: "Zero inward bounces — clean repayment track record", cls: "text-success" });
            if (avgCredits && avgDebits) {
              const util = avgDebits / avgCredits * 100;
              if (util > 90) obs.push({ text: `High fund utilisation: ${util.toFixed(0)}% of credits consumed as debits — limited buffer`, cls: "text-warning" });
              else obs.push({ text: `Fund utilisation: ${util.toFixed(0)}% of credits consumed — healthy operating buffer`, cls: "text-success" });
            }
            if (avgBalance && avgBalance < 0) obs.push({ text: "Negative average balance detected — possible overdraft usage", cls: "text-destructive" });
            return obs.length > 0 ? (
              <Panel title="BANK ANALYSIS INSIGHTS" ticker="AUTO">
                <div className="space-y-1.5">
                  {obs.map((o, i) => <div key={i} className={`text-xs flex gap-2 ${o.cls}`}><span>▸</span><span>{o.text}</span></div>)}
                </div>
              </Panel>
            ) : null;
          })()}
        </>
      )}
    </div>
  );
}
