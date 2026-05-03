import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { Panel } from "@/components/terminal/Panel";
import {
  PRODUCTS, CASE_STATUS_META, IC_SECTIONS, RATIO_DISPLAY_NAMES,
  formatRatio, AI_DRAFT_BANNER, type StatementType,
} from "@/features/credit/domain";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

type CaseRow = Tables<"credit_cases">;
type DocRow = Tables<"financial_documents">;
type ExtractedRow = Tables<"extracted_financials">;
type RatioRow = Tables<"financial_ratios">;

interface LineItem {
  label: string; value: number | null; confidence: number;
  reviewed: boolean; override_value?: number | null; note?: string;
}

const STATEMENT_TYPES: StatementType[] = ["all_in_one", "profit_loss", "balance_sheet", "cash_flow", "projections"];
const FY_OPTIONAL: StatementType[] = ["projections", "all_in_one"];

export default function CaseView() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [cc, setCc] = useState<CaseRow | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [extracted, setExtracted] = useState<ExtractedRow[]>([]);
  const [ratios, setRatios] = useState<RatioRow[]>([]);
  const [tab, setTab] = useState<"upload" | "review" | "ratios" | "ic_note">("upload");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");

  const reload = useCallback(async () => {
    if (!id) return;
    const [c, d, e, r] = await Promise.all([
      supabase.from("credit_cases").select("*").eq("id", id).single(),
      supabase.from("financial_documents").select("*").eq("case_id", id).order("created_at"),
      supabase.from("extracted_financials").select("*").eq("case_id", id),
      supabase.from("financial_ratios").select("*").eq("case_id", id).order("fiscal_year"),
    ]);
    if (c.data) setCc(c.data);
    setDocs(d.data ?? []);
    setExtracted(e.data ?? []);
    setRatios(r.data ?? []);
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`case-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_cases", filter: `id=eq.${id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "extracted_financials", filter: `case_id=eq.${id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "financial_ratios", filter: `case_id=eq.${id}` }, reload)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, reload]);

  if (!cc) return <TerminalLayout><div className="text-muted-foreground">LOADING CASE...</div></TerminalLayout>;

  const product = PRODUCTS[cc.product_type];
  const statusMeta = CASE_STATUS_META[cc.status];

  const handleUpload = async (file: File, statement_type: StatementType, fiscal_year: number | null) => {
    if (!user) return;
    setBusy(true);
    setProgress(0);
    setProgressLabel("Preparing...");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const isImage = ["jpg","jpeg","png","webp","gif"].includes(ext);
      const isExcel = ext === "xlsx" || ext === "xls" || ext === "csv";
      const fileType = isImage ? "image" : isExcel ? "excel" : "pdf";

      // Stage 1: parse Excel client-side (0 → 15%)
      let excelText: string | undefined;
      if (isExcel) {
        setProgressLabel("Parsing Excel workbook");
        setProgress(5);
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        excelText = wb.SheetNames.map((name) => {
          const sheet = wb.Sheets[name];
          const tsv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
          return `=== SHEET: ${name} ===\n${tsv}`;
        }).join("\n\n");
        setProgress(15);
      }

      // Stage 2: upload to storage with real progress (15 → 60%)
      const path = `${user.id}/${cc.id}/${Date.now()}-${file.name}`;
      setProgressLabel(`Uploading ${(file.size / 1024 / 1024).toFixed(2)} MB`);
      await uploadWithProgress("case-files", path, file, (pct) => {
        setProgress(15 + Math.round(pct * 0.45));
      });
      setProgress(60);

      // Stage 3: register document (60 → 70%)
      setProgressLabel("Registering document");
      const { data: doc, error: dErr } = await supabase.from("financial_documents").insert({
        case_id: cc.id, user_id: user.id, file_path: path, file_name: file.name,
        file_type: fileType, doc_class: statement_type as never,
        fiscal_year, extraction_status: "pending",
      }).select().single();
      if (dErr) throw dErr;
      await supabase.from("credit_cases").update({ status: "extracting" }).eq("id", cc.id);
      setProgress(70);

      // Stage 4: AI extraction (70 → 99%, simulated)
      setProgressLabel("Extracting with Gemini 2.5 Pro");
      const tick = setInterval(() => {
        setProgress((p) => (p < 95 ? p + 1 : p));
      }, 600);

      const { error: fnErr } = await supabase.functions.invoke("extract-financials", {
        body: { case_id: cc.id, document_id: doc.id, statement_type, fiscal_year, excel_text: excelText },
      });
      clearInterval(tick);
      if (fnErr) throw fnErr;

      setProgress(100);
      setProgressLabel("Complete");
      toast.success("Extraction complete");
      await reload();
      setTab("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setTimeout(() => { setBusy(false); setProgress(0); setProgressLabel(""); }, 600);
    }
  };

  const updateLineItem = async (rowId: string, idx: number, override: number | null) => {
    const row = extracted.find((r) => r.id === rowId);
    if (!row) return;
    const items = (row.line_items as unknown as LineItem[]).slice();
    items[idx] = { ...items[idx], override_value: override, reviewed: true };
    await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", rowId);
    await reload();
  };

  const confirmExtraction = async (rowId: string) => {
    await supabase.from("extracted_financials").update({
      confirmed: true, confirmed_at: new Date().toISOString(),
    }).eq("id", rowId);
    toast.success("Extraction confirmed");
    await reload();
  };

  const handleDeleteDoc = async (doc: DocRow) => {
    await supabase.storage.from("case-files").remove([doc.file_path]);
    await supabase.from("financial_documents").delete().eq("id", doc.id);
    toast.success(`${doc.file_name} removed`);
    await reload();
  };

  const handleEditDoc = async (id: string, doc_class: string, fiscal_year: number | null) => {
    await supabase.from("financial_documents").update({ doc_class: doc_class as never, fiscal_year }).eq("id", id);
    toast.success("Document updated");
    await reload();
  };

  const runRatios = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("compute-ratios", { body: { case_id: cc.id } });
      if (error) throw error;
      toast.success("Ratios computed");
      await reload();
      setTab("ratios");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const runNarrative = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("generate-narrative", { body: { case_id: cc.id } });
      if (error) throw error;
      toast.success("IC Note draft generated");
      await reload();
      setTab("ic_note");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const years = Array.from(new Set(ratios.map((r) => r.fiscal_year))).sort();
  const ratioGroups = Array.from(new Set(ratios.map((r) => r.category)));

  const statusColorClass: Record<string, string> = {
    green: "bg-success text-success-foreground",
    amber: "bg-warning text-warning-foreground",
    red: "bg-destructive text-destructive-foreground",
    na: "bg-muted text-muted-foreground",
  };

  const ic = (cc.ic_note ?? null) as null | { sections: Record<string, { markdown: string }>; risks: Array<{ category: string; risk: string; mitigant: string; severity: string }>; conditions_precedent: string[] };

  return (
    <TerminalLayout>
      {/* Header strip */}
      <div className="grid grid-cols-12 gap-3 mb-3">
        <Panel title="CASE" ticker={cc.case_code} className="col-span-4">
          <div className="text-2xl text-primary glow font-bold">{cc.client_name}</div>
          <div className="terminal-label mt-1">{product.label} · {cc.industry || "—"}</div>
        </Panel>
        <Panel title="STATUS" className="col-span-3">
          <div className={`inline-block px-3 py-1 text-xs font-bold tracking-widest bg-${statusMeta.color} text-${statusMeta.color}-foreground`}>
            {statusMeta.label}
          </div>
          <div className="terminal-label mt-2">Stage {statusMeta.pipeline} of 7</div>
        </Panel>
        <Panel title="DEAL TERMS" className="col-span-5">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><div className="terminal-label">AMOUNT</div><div className="text-primary">₹{Number(cc.deal_amount ?? 0).toLocaleString("en-IN")}</div></div>
            <div><div className="terminal-label">TENURE</div><div className="text-primary">{cc.tenure_months ?? "—"}M</div></div>
            <div><div className="terminal-label">IRR</div><div className="text-primary">{cc.expected_irr ?? "—"}%</div></div>
          </div>
        </Panel>
      </div>

      {/* Tabs */}
      <div className="flex border border-border bg-card mb-3">
        {([
          ["upload", "1 · UPLOAD"],
          ["review", "2 · REVIEW EXTRACTION"],
          ["ratios", "3 · RATIO MATRIX"],
          ["ic_note", "4 · IC NOTE"],
        ] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-xs tracking-widest border-r border-border ${tab === k ? "bg-primary text-primary-foreground" : "text-primary/70 hover:bg-surface"}`}
          >{l}</button>
        ))}
      </div>

      {tab === "upload" && (
        <Panel title="UPLOAD FINANCIAL STATEMENTS" ticker="PDF / IMG / XLSX">
          <UploadGrid onUpload={handleUpload} onDelete={handleDeleteDoc} onEdit={handleEditDoc} busy={busy} docs={docs} progress={progress} progressLabel={progressLabel} />
        </Panel>
      )}

      {tab === "review" && (
        <div className="space-y-3">
          {extracted.length === 0 ? (
            <Panel title="NO EXTRACTION YET"><div className="text-muted-foreground text-xs">Upload documents in the previous step to begin extraction.</div></Panel>
          ) : (
            extracted.map((row) => {
              const items = row.line_items as unknown as LineItem[];
              const lows = items.filter((i) => i.confidence < 80).length;
              return (
                <Panel
                  key={row.id}
                  title={`${row.statement_type.toUpperCase()} · FY${row.fiscal_year}`}
                  status={lows > 0 ? "warn" : row.confirmed ? "live" : "idle"}
                  ticker={row.confirmed ? "CONFIRMED" : `${lows} LOW-CONF`}
                  actions={
                    !row.confirmed && (
                      <button onClick={() => confirmExtraction(row.id)} className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 hover:opacity-90">
                        [CONFIRM]
                      </button>
                    )
                  }
                >
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground border-b border-border">
                      <tr><th className="text-left py-1">LINE ITEM</th><th className="text-right">EXTRACTED</th><th className="text-right">CONF</th><th className="text-right">OVERRIDE</th></tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => {
                        const conf = it.confidence;
                        const cls = conf >= 90 ? "text-success" : conf >= 80 ? "text-warning" : "text-destructive";
                        return (
                          <tr key={idx} className="border-b border-border/30">
                            <td className="py-1 text-foreground/90">{it.label}</td>
                            <td className="text-right text-primary">{it.value?.toLocaleString("en-IN") ?? "—"}</td>
                            <td className={`text-right ${cls} font-bold`}>{conf}</td>
                            <td className="text-right">
                              <input
                                type="number"
                                defaultValue={it.override_value ?? ""}
                                placeholder="—"
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? null : Number(e.target.value);
                                  if (v !== (it.override_value ?? null)) updateLineItem(row.id, idx, v);
                                }}
                                className="w-24 bg-input border border-border px-1 text-right text-primary text-xs"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Panel>
              );
            })
          )}
          {extracted.some((r) => r.confirmed) && (
            <button onClick={runRatios} disabled={busy} className="bg-primary text-primary-foreground px-4 py-2 text-xs tracking-widest font-bold disabled:opacity-50">
              {busy ? "COMPUTING..." : "[GENERATE RATIO ANALYSIS →]"}
            </button>
          )}
        </div>
      )}

      {tab === "ratios" && (
        <div className="space-y-3">
          {ratios.length === 0 ? (
            <Panel title="NO RATIOS"><div className="text-muted-foreground text-xs">Confirm extracted financials and run ratio analysis.</div></Panel>
          ) : (
            <>
              {ratioGroups.map((cat) => (
                <Panel key={cat} title={cat.toUpperCase()} ticker="RATIOS">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left py-1">RATIO</th>
                        {years.map((y) => <th key={y} className="text-right">FY{y}</th>)}
                        <th className="text-right">PEER</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(new Set(ratios.filter((r) => r.category === cat).map((r) => r.ratio_name))).map((name) => (
                        <tr key={name} className="border-b border-border/30">
                          <td className="py-1 text-foreground/90">{RATIO_DISPLAY_NAMES[name] ?? name}</td>
                          {years.map((y) => {
                            const r = ratios.find((x) => x.ratio_name === name && x.fiscal_year === y);
                            return (
                              <td key={y} className="text-right">
                                <span className={`inline-block px-2 py-0.5 ${statusColorClass[r?.threshold_status ?? "na"]} font-bold`}>
                                  {formatRatio(name, r?.ratio_value !== null && r?.ratio_value !== undefined ? Number(r.ratio_value) : null)}
                                </span>
                              </td>
                            );
                          })}
                          <td className="text-right text-accent">
                            {ratios.find((x) => x.ratio_name === name)?.benchmark != null
                              ? formatRatio(name, Number(ratios.find((x) => x.ratio_name === name)!.benchmark))
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              ))}
              <button onClick={runNarrative} disabled={busy} className="bg-primary text-primary-foreground px-4 py-2 text-xs tracking-widest font-bold disabled:opacity-50">
                {busy ? "DRAFTING..." : "[GENERATE 12-SECTION IC NOTE →]"}
              </button>
            </>
          )}
        </div>
      )}

      {tab === "ic_note" && (
        <div className="space-y-3">
          {!ic ? (
            <Panel title="NO IC NOTE"><div className="text-muted-foreground text-xs">Compute ratios first, then generate the IC narrative.</div></Panel>
          ) : (
            <>
              <div className="border border-warning bg-warning/10 px-3 py-2 text-warning text-xs tracking-widest">
                ⚠ {AI_DRAFT_BANNER}
              </div>
              {IC_SECTIONS.map((s) => (
                <Panel key={s.id} title={`${s.roman}. ${s.title}`} ticker="DRAFT">
                  <div className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {ic.sections[s.id]?.markdown || "(empty)"}
                  </div>
                </Panel>
              ))}
              <Panel title="RISK REGISTER" ticker="X.MIT">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr><th className="text-left py-1">CATEGORY</th><th className="text-left">RISK</th><th className="text-left">MITIGANT</th><th>SEV</th></tr>
                  </thead>
                  <tbody>
                    {ic.risks?.map((r, i) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="py-1 text-accent uppercase">{r.category}</td>
                        <td className="text-foreground/90">{r.risk}</td>
                        <td className="text-foreground/70">{r.mitigant}</td>
                        <td className={r.severity === "high" ? "text-destructive" : r.severity === "medium" ? "text-warning" : "text-success"}>
                          {r.severity?.toUpperCase()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <Panel title="CONDITIONS PRECEDENT" ticker="CP">
                <ul className="text-xs space-y-1">
                  {ic.conditions_precedent?.map((c, i) => (
                    <li key={i} className="flex gap-2"><span className="text-warning">▸</span><span>{c}</span></li>
                  ))}
                </ul>
              </Panel>
            </>
          )}
        </div>
      )}
    </TerminalLayout>
  );
}

// XHR-based upload to Supabase Storage so we get a real progress event stream.
async function uploadWithProgress(bucket: string, path: string, file: File, onPct: (pct: number) => void): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("x-upsert", "false");
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

function UploadGrid({ onUpload, onDelete, onEdit, busy, docs, progress, progressLabel }: { onUpload: (f: File, t: StatementType, fy: number | null) => void; onDelete: (doc: DocRow) => void; onEdit: (id: string, doc_class: string, fiscal_year: number | null) => void; busy: boolean; docs: DocRow[]; progress: number; progressLabel: string }) {
  const [stmt, setStmt] = useState<StatementType>("all_in_one");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClass, setEditClass] = useState("");
  const [editFy, setEditFy] = useState<string>("");
  const labelFor = (t: StatementType) => t === "all_in_one" ? "ALL-IN-ONE (BS + P&L + CF + PROJ)" : t.replace("_", " ").toUpperCase();

  const startEdit = (d: DocRow) => {
    setEditingId(d.id);
    setEditClass(d.doc_class);
    setEditFy(d.fiscal_year ? String(d.fiscal_year) : "");
  };

  const saveEdit = (id: string) => {
    onEdit(id, editClass, editFy ? Number(editFy) : null);
    setEditingId(null);
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="terminal-label block mb-1">Statement Type</label>
          <select value={stmt} onChange={(e) => setStmt(e.target.value as StatementType)} className="bg-input border border-border px-2 py-1.5 text-sm text-primary">
            {STATEMENT_TYPES.map((t) => <option key={t} value={t}>{labelFor(t)}</option>)}
          </select>
        </div>
        <div>
          <label className="terminal-label block mb-1">File (PDF / Image / Excel)</label>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f, stmt, null); e.target.value = ""; }}
            className="text-xs file:bg-primary file:text-primary-foreground file:border-0 file:px-3 file:py-1.5 file:text-xs file:font-bold file:tracking-widest"
          />
        </div>
      </div>
      {busy && (
        <div className="border border-warning/40 bg-warning/5 p-3 space-y-2">
          <div className="flex justify-between text-[11px] tracking-widest">
            <span className="text-warning">▸ {progressLabel || "WORKING"}</span>
            <span className="text-primary font-bold tabular-nums">{progress}%</span>
          </div>
          <div className="h-2 bg-input border border-border overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progress}%`, boxShadow: "0 0 8px hsl(var(--primary))" }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground tracking-widest">
            <span>PARSE</span><span>UPLOAD</span><span>REGISTER</span><span>EXTRACT</span><span>DONE</span>
          </div>
        </div>
      )}
      <div className="text-[10px] text-muted-foreground tracking-wider">
        ▸ ALL-IN-ONE detects every statement (BS, P&L, CF, Projections) inside one PDF or Excel.
        ▸ PROJECTIONS do not require a fiscal year.
        ▸ Excel parsed locally then sent as text — JPG/PNG/PDF sent directly to vision model.
      </div>
      <table className="w-full text-xs border-t border-border">
        <thead className="text-muted-foreground">
          <tr><th className="text-left py-1">FILE</th><th>TYPE</th><th>CLASS</th><th>FY</th><th>STATUS</th><th></th></tr>
        </thead>
        <tbody>
          {docs.length === 0 ? (
            <tr><td colSpan={6} className="text-center text-muted-foreground py-4">NO DOCUMENTS UPLOADED</td></tr>
          ) : docs.map((d) => {
            const isEditing = editingId === d.id;
            const cellCls = "bg-input border border-border text-primary px-1 py-0.5 text-xs";
            return (
              <tr key={d.id} className="border-b border-border/30">
                <td className="py-1 text-primary max-w-[180px] truncate" title={d.file_name}>{d.file_name}</td>
                <td className="text-center text-accent">{d.file_type.toUpperCase()}</td>

                {/* CLASS — editable */}
                <td className="text-center text-foreground/80 px-1">
                  {isEditing ? (
                    <select value={editClass} onChange={(e) => setEditClass(e.target.value)} className={cellCls}>
                      {["all_in_one","profit_loss","balance_sheet","cash_flow","projections","bank_statement","gst_return","other"].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  ) : d.doc_class}
                </td>

                {/* FY — editable */}
                <td className="text-center px-1">
                  {isEditing ? (
                    <input
                      type="number"
                      value={editFy}
                      onChange={(e) => setEditFy(e.target.value)}
                      placeholder="auto"
                      className={`${cellCls} w-16`}
                    />
                  ) : (d.fiscal_year ?? "—")}
                </td>

                <td className={`text-center ${d.extraction_status === "extracted" ? "text-success" : d.extraction_status === "failed" ? "text-destructive" : "text-warning"}`}>
                  {d.extraction_status.toUpperCase()}
                </td>

                {/* Actions */}
                <td className="text-center pl-2 whitespace-nowrap">
                  {isEditing ? (
                    <>
                      <button type="button" onClick={() => saveEdit(d.id)} className="text-green-400 hover:text-green-300 mr-2" title="Save">✓</button>
                      <button type="button" onClick={() => setEditingId(null)} className="text-foreground/40 hover:text-foreground" title="Cancel">✕</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => startEdit(d)} disabled={busy} className="text-foreground/40 hover:text-primary transition-colors mr-2 disabled:pointer-events-none" title="Edit">✎</button>
                      <button type="button" onClick={() => onDelete(d)} disabled={busy} className="text-foreground/40 hover:text-red-400 transition-colors disabled:pointer-events-none" title="Remove">✕</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
