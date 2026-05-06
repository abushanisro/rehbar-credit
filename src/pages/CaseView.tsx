import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { RoomProvider } from "@/liveblocks.config";
import { CollabAvatarStack, TabPresenceDots, LiveCursors } from "@/components/collab/CollabPresence";
import { useMyPresence } from "@/components/collab/useMyPresence";
import { ShareDialog } from "@/components/collab/ShareDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { Panel } from "@/components/terminal/Panel";
import {
  PRODUCTS, CASE_STATUS_META, IC_SECTIONS, RATIO_DISPLAY_NAMES,
  formatRatio, AI_DRAFT_BANNER, type StatementType, type DocClass, type ProductType,
} from "@/features/credit/domain";

const CASE_INDUSTRIES = [
  "Agriculture & Food Processing","Automotive","Chemicals & Petrochemicals",
  "Construction & Infrastructure","Education","Energy & Utilities","EV Logistics & Transportation",
  "Financial Services","Healthcare & Pharmaceuticals","Hospitality & Tourism","IT & Technology",
  "Logistics & Transportation","Manufacturing","Media & Entertainment","Real Estate",
  "Retail & E-commerce","Telecom","Textile & Apparel","Trading","Other",
] as const;
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
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

type QueueStatus = "pending" | "processing" | "done" | "error" | "duplicate";
type UploadQueueItem = {
  id: string; file: File; name: string; size: string;
  status: QueueStatus;
};
type FinQueueItem = UploadQueueItem & { stmtType: DocClass; fy: string };

type EditScanResult = {
  client_name?: string;
  product_type?: ProductType;
  product_type_custom?: string;
  legal_constitution?: string;
  industry?: string;
  year_established?: number;
  promoter_details?: string;
  deal_amount?: number;
  tenure_months?: number;
  expected_irr?: number;
  end_use?: string;
  collateral_summary?: string;
  strategic_rationale?: string;
  website?: string;
  summary?: string;
  confidence?: number;
};

type EditFileQueueItem = {
  id: string;
  name: string;
  size: string;
  fileType: "pdf" | "image" | "excel";
  status: "pending" | "uploading" | "done" | "error" | "duplicate";
  uploadPct: number;
  storagePath?: string;
};

const EDIT_SCANNABLE_FIELDS: { key: keyof EditScanResult; label: string }[] = [
  { key: "client_name",         label: "Client Name" },
  { key: "product_type",        label: "Product Type" },
  { key: "legal_constitution",  label: "Legal Constitution" },
  { key: "industry",            label: "Industry" },
  { key: "year_established",    label: "Year Established" },
  { key: "deal_amount",         label: "Deal Amount (Cr)" },
  { key: "tenure_months",       label: "Tenure (months)" },
  { key: "expected_irr",        label: "Expected IRR (%)" },
  { key: "promoter_details",    label: "Promoter Details" },
  { key: "end_use",             label: "End Use" },
  { key: "collateral_summary",  label: "Collateral" },
  { key: "strategic_rationale", label: "Strategic Rationale" },
  { key: "website",             label: "Website" },
];

// ── Balance sheet auto-computation ────────────────────────────────────────────
// Defines which labels are aggregate totals and what they sum from.
// Order matters: dependencies must come before the rows that depend on them.
const BS_AGGREGATIONS: [string, string[]][] = [
  ["Current Assets",      ["Inventory", "Trade Receivables", "Cash & Bank", "Other Current Assets"]],
  ["Total Assets",        ["Fixed Assets (Net)", "Current Assets"]],
  ["Net Worth",           ["Share Capital", "Reserves & Surplus"]],
  ["Total Debt",          ["Long Term Borrowings", "Short Term Borrowings"]],
  ["Current Liabilities", ["Trade Payables", "Other Current Liabilities"]],
  ["Total Liabilities",   ["Net Worth", "Total Debt", "Current Liabilities"]],
  ["Capital Employed",    ["Net Worth", "Total Debt"]],
];
const BS_TOTAL_LABELS = new Set(BS_AGGREGATIONS.map(([label]) => label));

function recomputeBS(items: LineItem[]): LineItem[] {
  const result = items.map(i => ({ ...i }));
  const getVal = (label: string): number => {
    const it = result.find(i => i.label === label);
    return it != null ? (it.override_value ?? it.value ?? 0) : 0;
  };
  for (const [totalLabel, components] of BS_AGGREGATIONS) {
    const idx = result.findIndex(i => i.label === totalLabel);
    if (idx === -1) continue; // don't create rows that don't exist
    const hasComponents = components.some(c => result.some(i => i.label === c && (i.override_value ?? i.value) != null));
    if (!hasComponents) continue;
    const sum = components.reduce((acc, c) => acc + getVal(c), 0);
    result[idx] = { ...result[idx], override_value: parseFloat(sum.toFixed(2)) };
  }
  return result;
}

// ── Poll financial_documents.extraction_status until done or failed ───────────
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

// ── Wrapper: provides the Liveblocks room scoped to this case ─────────────────
export default function CaseView() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <RoomProvider id={`case-${id}`} initialPresence={{ name: "", email: "", color: "#E8721C", activeTab: "upload", editingField: null, cursor: null }}>
      <CaseViewInner />
    </RoomProvider>
  );
}

function CaseViewInner() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTabRaw] = useState<"upload" | "review" | "ratios" | "projections" | "ic_note" | "emi" | "bank" | "gst">("upload");
  const { setEditing } = useMyPresence(user?.user_metadata?.full_name ?? user?.email ?? "Analyst", user?.email ?? "", tab);
  const setTab = (t: typeof tab) => { setTabRaw(t); };
  const [cc, setCc] = useState<CaseRow | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [extracted, setExtracted] = useState<ExtractedRow[]>([]);
  const [ratios, setRatios] = useState<RatioRow[]>([]);
  const [emiPayments, setEmiPayments]       = useState<Tables<"emi_payments">[]>([]);
  const [bankData, setBankData]             = useState<Tables<"bank_statement_data">[]>([]);
  const [gstData, setGstData]               = useState<Tables<"gst_return_data">[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [extractError, setExtractError] = useState<{ title: string; detail?: string; action?: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ stmtType: string; fy: number; label: string; field: "label" | "value" } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [addStmtForm, setAddStmtForm] = useState<{ type: StatementType; fy: string; unit: string } | null>(null);
  const [addingYearFor, setAddingYearFor] = useState<{ stmtType: string; fy: string } | null>(null);
  const [hd, setHd] = useState({
    client_name: "", product_type: "operating_lease" as string, product_type_custom: "",
    industry: "", industry_custom: "", legal_constitution: "", year_established: "",
    principal_borrower: "", promoter_details: "", website: "",
    deal_amount: "", tenure_months: "", expected_irr: "",
    end_use: "", collateral_summary: "", analyst_notes: "", strategic_rationale: "",
  });
  const [editScanFileQueue, setEditScanFileQueue] = useState<EditFileQueueItem[]>([]);
  const [editScanning, setEditScanning] = useState(false);
  const [editScanStage, setEditScanStage] = useState("");
  const [editScanPct, setEditScanPct] = useState(0);
  const [editScanResult, setEditScanResult] = useState<EditScanResult | null>(null);
  const [editWebEnriching, setEditWebEnriching] = useState(false);
  const [editWebEnrichPct, setEditWebEnrichPct] = useState(0);
  const [editDragOver, setEditDragOver] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const editCancelledRef = useRef(false);

  const reload = useCallback(async () => {
    if (!id) return;
    const [c, d, e, r, em, bk, gs] = await Promise.all([
      supabase.from("credit_cases").select("*").eq("id", id).single(),
      supabase.from("financial_documents").select("*").eq("case_id", id).order("created_at"),
      supabase.from("extracted_financials").select("*").eq("case_id", id),
      supabase.from("financial_ratios").select("*").eq("case_id", id).order("fiscal_year"),
      supabase.from("emi_payments").select("*").eq("case_id", id).order("emi_number"),
      supabase.from("bank_statement_data").select("*").eq("case_id", id).order("month"),
      supabase.from("gst_return_data").select("*").eq("case_id", id).order("period"),
    ]);
    if (!c.data) { navigate("/", { replace: true }); return; }
    setCc(c.data);
    setDocs(d.data ?? []);
    setExtracted(e.data ?? []);
    setRatios(r.data ?? []);
    setEmiPayments(em.data ?? []);
    setBankData(bk.data ?? []);
    setGstData(gs.data ?? []);
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  // Realtime: debounce so batch upserts (many rows at once) coalesce into one reload
  // rather than firing one fetch per row and exhausting the browser connection pool.
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(reload, 400);
  }, [reload]);

  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`case-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_cases", filter: `id=eq.${id}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "financial_documents", filter: `case_id=eq.${id}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "extracted_financials", filter: `case_id=eq.${id}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "financial_ratios", filter: `case_id=eq.${id}` }, scheduleReload)
      .subscribe();
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      supabase.removeChannel(ch);
    };
  }, [id, scheduleReload]);

  useEffect(() => {
    if (extractError) {
      const timer = setTimeout(() => setExtractError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [extractError]);

  const FINANCIAL_CLASSES_SET = new Set(["all_in_one", "profit_loss", "balance_sheet", "cash_flow", "projections"]);

  const handleRetry = useCallback(async (doc: DocRow) => {
    if (!user || !cc) return;
    try {
      // Reset this doc to pending immediately so the UI reacts
      await supabase.from("financial_documents")
        .update({ extraction_status: "pending", extraction_error: null })
        .eq("id", doc.id);

      if (doc.doc_class === "bank_statement") {
        // Collect all non-extracted bank statements for this case
        const { data: batchDocs } = await supabase.from("financial_documents")
          .select("id")
          .eq("case_id", cc.id)
          .eq("doc_class", "bank_statement")
          .neq("extraction_status", "extracted");
        const ids = (batchDocs ?? [{ id: doc.id }]).map((d: { id: string }) => d.id);

        await supabase.from("financial_documents")
          .update({ extraction_status: "running", extraction_error: null })
          .in("id", ids);

        // Use supabase.functions.invoke so auth is handled automatically
        const { error: triggerErr } = await supabase.functions.invoke("trigger-bank-extraction", {
          body: { case_id: cc.id, user_id: user.id, document_ids: ids },
        });

        if (triggerErr) {
          // Fallback: call extract-bank-statement for each doc; await all so errors surface
          const results = await Promise.allSettled(
            ids.map(id => supabase.functions.invoke("extract-bank-statement", {
              body: { case_id: cc.id, document_id: id },
            }))
          );
          const failed = results.filter(r => r.status === "rejected" || (r.status === "fulfilled" && r.value.error)).length;
          if (failed > 0) {
            toast.warning(`${ids.length - failed} extracted, ${failed} failed — check error column`);
          } else {
            toast.success(`${ids.length} bank statement${ids.length > 1 ? "s" : ""} extracted`);
          }
        } else {
          toast.success(`Re-running ${ids.length} bank statement${ids.length > 1 ? "s" : ""} in background`);
        }

      } else if (doc.doc_class === "gst_return") {
        await supabase.from("financial_documents")
          .update({ extraction_status: "running", extraction_error: null })
          .eq("id", doc.id);
        const { error } = await supabase.functions.invoke("extract-gst", {
          body: { case_id: cc.id, document_id: doc.id },
        });
        if (error) throw error;
        toast.success("GST re-extraction queued");

      } else if (FINANCIAL_CLASSES_SET.has(doc.doc_class)) {
        await supabase.from("financial_documents")
          .update({ extraction_status: "running", extraction_error: null })
          .eq("id", doc.id);
        const { data: { session: retrySession } } = await supabase.auth.getSession();
        const retryRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-analysis`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${retrySession?.access_token ?? ""}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ case_id: cc.id, user_id: user.id, document_ids: [doc.id] }),
        });
        if (!retryRes.ok) {
          const raw = await retryRes.text().catch(() => "");
          let errMsg = `trigger-analysis HTTP ${retryRes.status}`;
          try { const j = JSON.parse(raw); if (j.error) errMsg = j.error; } catch { /* HTML or empty body */ }
          throw new Error(errMsg);
        }
        toast.success("Analysis re-queued");
      }

      await reload();
    } catch (e) {
      toast.error("Retry failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [user, cc, reload]);

  if (!cc) return <TerminalLayout><div className="text-muted-foreground">LOADING CASE...</div></TerminalLayout>;


  const product = PRODUCTS[cc.product_type];
  const statusMeta = CASE_STATUS_META[cc.status];

  const openHeaderEdit = () => {
    const ind = cc.industry ?? "";
    const knownIndustry = CASE_INDUSTRIES.includes(ind as typeof CASE_INDUSTRIES[number]);
    setHd({
      client_name: cc.client_name,
      product_type: cc.product_type,
      product_type_custom: cc.product_type_custom ?? "",
      industry: knownIndustry ? ind : (ind ? "Other" : ""),
      industry_custom: knownIndustry ? "" : ind,
      legal_constitution: cc.legal_constitution ?? "Pvt Ltd",
      year_established: cc.year_established ? String(cc.year_established) : "",
      principal_borrower: cc.principal_borrower ?? "",
      promoter_details: cc.promoter_details ?? "",
      website: cc.website ?? "",
      deal_amount: cc.deal_amount != null ? String(cc.deal_amount) : "",
      tenure_months: cc.tenure_months != null ? String(cc.tenure_months) : "",
      expected_irr: cc.expected_irr != null ? String(cc.expected_irr) : "",
      end_use: cc.end_use ?? "",
      collateral_summary: cc.collateral_summary ?? "",
      analyst_notes: cc.analyst_notes ?? "",
      strategic_rationale: cc.strategic_rationale ?? "",
    });
    setEditingHeader(true);
  };

  const saveHeader = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedIndustry = hd.industry === "Other" ? hd.industry_custom : hd.industry;
    await supabase.from("credit_cases").update({
      client_name: hd.client_name,
      product_type: hd.product_type as never,
      product_type_custom: hd.product_type === "other" ? hd.product_type_custom || null : null,
      industry: resolvedIndustry || null,
      legal_constitution: hd.legal_constitution || null,
      year_established: hd.year_established ? Number(hd.year_established) : null,
      principal_borrower: hd.principal_borrower || null,
      promoter_details: hd.promoter_details || null,
      website: hd.website || null,
      deal_amount: hd.deal_amount ? Number(hd.deal_amount) : null,
      tenure_months: hd.tenure_months ? Number(hd.tenure_months) : null,
      expected_irr: hd.expected_irr ? Number(hd.expected_irr) : null,
      end_use: hd.end_use || null,
      collateral_summary: hd.collateral_summary || null,
      analyst_notes: hd.analyst_notes || null,
      strategic_rationale: hd.strategic_rationale || null,
    }).eq("id", cc.id);
    toast.success("Case updated");
    setEditingHeader(false);
    await reload();
  };

  const runEditWebEnrich = async () => {
    if (!hd.client_name.trim() && !hd.website.trim()) return;
    setEditWebEnriching(true);
    setEditWebEnrichPct(5);
    setEditScanResult(null);
    const tick = setInterval(() => setEditWebEnrichPct(p => p < 88 ? p + 2 : p), 400);
    try {
      const { data, error } = await supabase.functions.invoke("web-enrich-company", {
        body: {
          company_name: hd.client_name.trim() || undefined,
          website: hd.website.trim() || undefined,
        },
      });
      clearInterval(tick);
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "Enrichment failed");
      setEditWebEnrichPct(100);
      setEditScanResult(data.extracted as EditScanResult);
      toast.success("Company info found — review and apply");
    } catch (e) {
      clearInterval(tick);
      toast.error("Web search failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setTimeout(() => { setEditWebEnriching(false); setEditWebEnrichPct(0); }, 400);
    }
  };

  const applyEditScanned = () => {
    if (!editScanResult) return;
    setHd(f => {
      const next = { ...f };
      if (editScanResult.client_name)         next.client_name         = editScanResult.client_name;
      if (editScanResult.product_type)        next.product_type        = editScanResult.product_type;
      if (editScanResult.product_type_custom) next.product_type_custom = editScanResult.product_type_custom!;
      if (editScanResult.legal_constitution)  next.legal_constitution  = editScanResult.legal_constitution;
      if (editScanResult.year_established)    next.year_established    = String(editScanResult.year_established);
      if (editScanResult.deal_amount != null) next.deal_amount         = String(editScanResult.deal_amount);
      if (editScanResult.tenure_months != null) next.tenure_months     = String(editScanResult.tenure_months);
      if (editScanResult.expected_irr != null)  next.expected_irr      = String(editScanResult.expected_irr);
      if (editScanResult.promoter_details)    next.promoter_details    = editScanResult.promoter_details;
      if (editScanResult.end_use)             next.end_use             = editScanResult.end_use;
      if (editScanResult.collateral_summary)  next.collateral_summary  = editScanResult.collateral_summary;
      if (editScanResult.strategic_rationale) next.strategic_rationale = editScanResult.strategic_rationale;
      if (editScanResult.website)             next.website             = editScanResult.website;
      if (editScanResult.industry) {
        const match = CASE_INDUSTRIES.find(i => i.toLowerCase() === editScanResult.industry!.toLowerCase());
        if (match) {
          next.industry = match;
        } else {
          next.industry = "Other";
          next.industry_custom = editScanResult.industry;
        }
      }
      return next;
    });
    toast.success("Form filled from document");
    setEditScanResult(null);
  };

  const resetEditScan = () => {
    editCancelledRef.current = true;
    setEditScanning(false);
    setEditScanPct(0);
    setEditScanStage("");
    setEditScanFileQueue([]);
    setEditScanResult(null);
  };

  const handleEditScanFiles = async (rawFiles: File[]) => {
    if (!user || rawFiles.length === 0) return;
    editCancelledRef.current = false;

    const makeItem = (f: File): EditFileQueueItem => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const isImage = ["jpg","jpeg","png","webp","gif"].includes(ext);
      const isExcel = ["xlsx","xls","csv"].includes(ext);
      const size = f.size < 1_048_576
        ? `${(f.size / 1024).toFixed(1)} KB`
        : `${(f.size / 1_048_576).toFixed(2)} MB`;
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: f.name, size,
        fileType: isImage ? "image" : isExcel ? "excel" : "pdf",
        status: "pending", uploadPct: 0,
      };
    };

    const seenNames = new Set<string>();
    const initialQueue = rawFiles.map(f => {
      const item = makeItem(f);
      if (seenNames.has(f.name)) return { ...item, status: "duplicate" as const };
      seenNames.add(f.name);
      return item;
    });
    setEditScanFileQueue(initialQueue);
    setEditScanning(true); setEditScanPct(5); setEditScanStage("Preparing…"); setEditScanResult(null);

    const toUpload: Array<{ file_path: string; file_type: "pdf"|"image"|"excel"; file_name: string; excel_text?: string }> = [];

    for (let i = 0; i < rawFiles.length; i++) {
      if (editCancelledRef.current) return;
      const f    = rawFiles[i];
      const item = initialQueue[i];
      if (item.status === "duplicate") continue;

      let excelText: string | undefined;
      if (item.fileType === "excel") {
        setEditScanStage(`Parsing ${item.name}…`);
        const XLSX = await import("xlsx");
        const buf  = await f.arrayBuffer();
        const wb   = XLSX.read(buf, { type: "array" });
        excelText  = wb.SheetNames.map(n =>
          `=== SHEET: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t" })}`
        ).join("\n\n");
      }

      if (editCancelledRef.current) return;
      setEditScanFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "uploading" } : qi));
      setEditScanStage(`Uploading ${i + 1} of ${rawFiles.length}…`);

      const path = `${user.id}/drafts/${Date.now()}-${f.name}`;
      try {
        await uploadWithProgress("case-files", path, f, (pct) => {
          setEditScanFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, uploadPct: pct } : qi));
          const perFile = 50 / rawFiles.length;
          setEditScanPct(Math.min(55, Math.round(5 + i * perFile + (pct / 100) * perFile)));
        });
        setEditScanFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "done", uploadPct: 100, storagePath: path } : qi));
        toUpload.push({ file_path: path, file_type: item.fileType, file_name: item.name, excel_text: excelText });
      } catch (e) {
        if (editCancelledRef.current) return;
        setEditScanFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "error" } : qi));
        toast.error(`Upload failed: ${item.name}`);
      }
    }

    if (editCancelledRef.current || toUpload.length === 0) { setEditScanning(false); return; }

    const docWord = toUpload.length === 1 ? "document" : `${toUpload.length} documents`;
    setEditScanStage(`Claude analysing ${docWord}…`);
    setEditScanPct(60);
    const tick = setInterval(() => {
      if (editCancelledRef.current) { clearInterval(tick); return; }
      setEditScanPct(p => p < 92 ? p + 1 : p);
    }, 500);

    try {
      const { data, error } = await supabase.functions.invoke("extract-case-meta", {
        body: { files: toUpload },
      });
      clearInterval(tick);
      if (editCancelledRef.current) return;

      let result = data;
      // The deployed function may be the old single-file version — auto-fallback
      if ((data as any)?.error === "Missing fields" && toUpload.length > 0) {
        const first = toUpload[0];
        const { data: legacyData, error: legacyErr } = await supabase.functions.invoke("extract-case-meta", {
          body: { file_path: first.file_path, file_type: first.file_type, file_name: first.file_name, excel_text: first.excel_text },
        });
        if (legacyErr || !legacyData?.ok) throw new Error((legacyData as any)?.error ?? legacyErr?.message ?? "Extraction failed");
        result = legacyData;
      } else if (error || !data?.ok) {
        throw new Error((data as any)?.error ?? error?.message ?? "Extraction failed");
      }

      setEditScanPct(100); setEditScanStage("Done");
      setEditScanResult(result.extracted as EditScanResult);
      toast.success(`${toUpload.length} document${toUpload.length > 1 ? "s" : ""} analysed — review and apply below`);
    } catch (e) {
      clearInterval(tick);
      if (!editCancelledRef.current) { toast.error(e instanceof Error ? e.message : "Analysis failed"); setEditScanStage(""); }
    } finally {
      setTimeout(() => { setEditScanning(false); setEditScanPct(0); setEditScanStage(""); }, 600);
    }
  };

  const handleCancelUpload = () => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    // Immediately hide the progress bar; cleanup happens async in the catch block
    setBusy(false);
    setProgress(0);
    setProgressLabel("");
  };

  const FINANCIAL_CLASSES: DocClass[] = ["all_in_one", "profit_loss", "balance_sheet", "cash_flow", "projections"];

  const handleUpload = async (file: File, doc_class: DocClass, fiscal_year: number | null) => {
    if (!user) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true);
    setExtractError(null);
    setProgress(0);
    setProgressLabel("Preparing...");
    let uploadedPath: string | null = null;
    let uploadedDocId: string | null = null;
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const isImage = ["jpg","jpeg","png","webp","gif"].includes(ext);
      const isExcel = ext === "xlsx" || ext === "xls" || ext === "csv";
      const fileType = isImage ? "image" : isExcel ? "excel" : "pdf";

      // Warn on large scanned PDFs — Claude accepts up to ~32 MB per document
      const MAX_PDF_MB = 30;
      if (fileType === "pdf" && file.size > MAX_PDF_MB * 1024 * 1024) {
        const sizeMb = (file.size / 1024 / 1024).toFixed(1);
        toast.warning(`File is ${sizeMb} MB — large scanned PDFs may timeout or exceed Claude's limit. Consider compressing to under ${MAX_PDF_MB} MB.`);
      }

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
      uploadedPath = path;
      setProgressLabel(`Uploading ${(file.size / 1024 / 1024).toFixed(2)} MB`);
      await uploadWithProgress("case-files", path, file, (pct) => {
        setProgress(15 + Math.round(pct * 0.45));
      }, abort.signal);
      if (abort.signal.aborted) throw new Error("cancelled");
      setProgress(60);

      // Stage 3: register document (60 → 70%)
      setProgressLabel("Registering document");
      const { data: doc, error: dErr } = await supabase.from("financial_documents").insert({
        case_id: cc.id, user_id: user.id, file_path: path, file_name: file.name,
        file_type: fileType, doc_class: doc_class as never,
        fiscal_year, extraction_status: "pending",
      }).select().single();
      if (dErr) throw dErr;
      uploadedDocId = doc.id;
      await supabase.from("credit_cases").update({ status: "extracting" }).eq("id", cc.id);
      setProgress(70);

      const { data: { session } } = await supabase.auth.getSession();
      const fnHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token ?? ""}`,
        "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      };

      if (doc_class === "bank_statement") {
        // Stage 4: queue all bank statement docs (this + any existing failed/pending)
        setProgressLabel("Queuing bank statement extraction…");
        const { data: otherDocs } = await supabase.from("financial_documents")
          .select("id")
          .eq("case_id", cc.id)
          .eq("doc_class", "bank_statement")
          .neq("id", doc.id)
          .in("extraction_status", ["failed", "pending"]);
        const allIds = [doc.id, ...(otherDocs?.map((d: { id: string }) => d.id) ?? [])];
        const triggerRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-bank-extraction`, {
          method: "POST", headers: fnHeaders, signal: abort.signal,
          body: JSON.stringify({
            case_id: cc.id, user_id: user.id, document_ids: allIds,
            ...(excelText ? { excel_texts: { [doc.id]: excelText } } : {}),
          }),
        });
        if (!triggerRes.ok) {
          const e = await triggerRes.json().catch(() => ({})) as Record<string, unknown>;
          throw new Error(String(e?.error ?? `Failed to queue extraction (HTTP ${triggerRes.status})`));
        }
        setProgress(75);
        setProgressLabel(`Extracting ${allIds.length} bank statement${allIds.length > 1 ? "s" : ""} in parallel…`);
        const tick = setInterval(() => setProgress((p) => (p < 95 ? p + 1 : p)), 800);
        try {
          await pollExtractionStatus(doc.id, abort.signal);
        } finally {
          clearInterval(tick);
        }
      } else if (doc_class === "gst_return") {
        // Stage 4: synchronous GST extraction
        setProgressLabel("Extracting GST return with AI...");
        const tick = setInterval(() => setProgress((p) => (p < 95 ? p + 1 : p)), 600);
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-gst`, {
          method: "POST", headers: fnHeaders, signal: abort.signal,
          body: JSON.stringify({ case_id: cc.id, document_id: doc.id, excel_text: excelText }),
        });
        clearInterval(tick);
        if (!res.ok) {
          const e = await res.json().catch(() => ({})) as Record<string, unknown>;
          throw new Error(String(e?.error ?? `GST extraction failed (HTTP ${res.status})`));
        }
      } else {
        // Stage 4: queue financial statement analysis (PDF, image, Excel all handled)
        setProgressLabel("Queuing AI analysis...");
        const triggerRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-analysis`,
          {
            method: "POST", headers: fnHeaders, signal: abort.signal,
            body: JSON.stringify({
              case_id: cc.id, document_ids: [doc.id], user_id: user.id,
              ...(excelText ? { excel_texts: { [doc.id]: excelText } } : {}),
            }),
          }
        );
        if (!triggerRes.ok) {
          const err = await triggerRes.json().catch(() => ({})) as Record<string, unknown>;
          throw new Error(String(err?.error ?? `Failed to queue analysis (HTTP ${triggerRes.status})`));
        }
        setProgress(75);

        // Stage 5: poll extraction_status until background task completes
        setProgressLabel("Analysing with AI (running in background)...");
        const tick = setInterval(() => setProgress((p) => (p < 95 ? p + 1 : p)), 800);
        try {
          await pollExtractionStatus(doc.id, abort.signal);
        } finally {
          clearInterval(tick);
        }
      }

      setProgress(100);
      setProgressLabel("Complete");
      toast.success("Extraction complete");
      await reload();
      setTab("review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      if (msg === "cancelled" || msg === "The user aborted a request.") {
        setProgressLabel("Removing uploaded file…");
        if (uploadedDocId) await supabase.from("financial_documents").delete().eq("id", uploadedDocId);
        if (uploadedPath) await supabase.storage.from("case-files").remove([uploadedPath]);
        await reload();
        setProgressLabel("Cancelled");
      } else {
        if (uploadedDocId) {
          await supabase.from("financial_documents")
            .update({ extraction_status: "failed", extraction_error: msg.slice(0, 500) })
            .eq("id", uploadedDocId);
        }
        setExtractError({ title: "Extraction failed", detail: msg });
        await reload();
      }
    } finally {
      abortRef.current = null;
      setTimeout(() => { setBusy(false); setProgress(0); setProgressLabel(""); }, 800);
    }
  };

  const patchItems = async (rowId: string, items: LineItem[]) => {
    await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", rowId);
    await reload();
  };

  const updateCellValue = async (stmtType: string, fy: number, label: string, rawValue: string) => {
    const row = extracted.find(r => r.statement_type === stmtType && r.fiscal_year === fy);
    if (!row) return;
    let items = (row.line_items as unknown as LineItem[]).slice();
    const idx = items.findIndex(i => i.label === label);
    const v = rawValue === "" ? null : Number(rawValue);
    if (idx === -1) items.push({ label, value: v, confidence: 100, reviewed: true, override_value: null, note: "manual" });
    else items[idx] = { ...items[idx], value: v, override_value: null, reviewed: true };
    if (stmtType === "balance_sheet") items = recomputeBS(items);
    await patchItems(row.id, items);
  };

  const updateCellLabel = async (stmtType: string, oldLabel: string, newLabel: string) => {
    if (!newLabel.trim() || newLabel.trim() === oldLabel) { setEditingCell(null); return; }
    const rows = extracted.filter(r => r.statement_type === stmtType);
    for (const row of rows) {
      const items = (row.line_items as unknown as LineItem[]).slice();
      const idx = items.findIndex(i => i.label === oldLabel);
      if (idx !== -1) {
        items[idx] = { ...items[idx], label: newLabel.trim() };
        await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", row.id);
      }
    }
    setEditingCell(null);
    await reload();
  };

  const updateRowNote = async (stmtType: string, fy: number, label: string, note: string) => {
    const row = extracted.find(r => r.statement_type === stmtType && r.fiscal_year === fy);
    if (!row) return;
    const items = (row.line_items as unknown as LineItem[]).slice();
    const idx = items.findIndex(i => i.label === label);
    if (idx !== -1) {
      items[idx] = { ...items[idx], note: note || undefined };
      await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", row.id);
    }
  };

  const addRowToType = async (stmtType: string) => {
    const rows = extracted.filter(r => r.statement_type === stmtType);
    const existing = new Set(rows.flatMap(r => (r.line_items as unknown as LineItem[]).map(i => i.label)));
    let newLabel = "New Item"; let n = 1;
    while (existing.has(newLabel)) { newLabel = `New Item ${++n}`; }
    for (const row of rows) {
      const items = (row.line_items as unknown as LineItem[]).slice();
      items.push({ label: newLabel, value: null, confidence: 100, reviewed: true, override_value: null, note: "manual" });
      await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", row.id);
    }
    await reload();
    const firstFy = rows.sort((a, b) => a.fiscal_year - b.fiscal_year)[0]?.fiscal_year;
    if (firstFy) setEditingCell({ stmtType, fy: firstFy, label: newLabel, field: "label" });
  };

  const deleteRowFromType = async (stmtType: string, label: string) => {
    const rows = extracted.filter(r => r.statement_type === stmtType);
    for (const row of rows) {
      const items = (row.line_items as unknown as LineItem[]).filter(i => i.label !== label);
      await supabase.from("extracted_financials").update({ line_items: items as never }).eq("id", row.id);
    }
    await reload();
  };

  const confirmExtraction = async (rowId: string) => {
    await supabase.from("extracted_financials").update({
      confirmed: true, confirmed_at: new Date().toISOString(),
    }).eq("id", rowId);
    toast.success("Extraction confirmed");
    await reload();
  };

  const deleteExtractedRow = async (rowId: string) => {
    await supabase.from("extracted_financials").delete().eq("id", rowId);
    await reload();
  };

  const createEmptyStatement = async (type: StatementType, fy: number, unit: string) => {
    if (!user) return;
    const exists = extracted.some(r => r.statement_type === type && r.fiscal_year === fy);
    if (exists) { toast.error(`${type.replace(/_/g," ").toUpperCase()} · FY${fy} already exists`); return; }
    const { error } = await supabase.from("extracted_financials").insert({
      case_id: cc.id, user_id: user.id,
      fiscal_year: fy, statement_type: type as never,
      line_items: [], confirmed: false, unit: unit || null,
    });
    if (error) { toast.error(error.message); return; }
    setAddStmtForm(null);
    toast.success(`${type.replace(/_/g," ").toUpperCase()} · FY${fy} created`);
    await reload();
  };

  const addYearColumn = async (stmtType: string, newFy: number) => {
    if (!user) return;
    const exists = extracted.some(r => r.statement_type === stmtType && r.fiscal_year === newFy);
    if (exists) { toast.error(`FY${newFy} already exists for this statement`); return; }
    const anyRow = extracted.find(r => r.statement_type === stmtType);
    const items = anyRow
      ? (anyRow.line_items as unknown as LineItem[]).map(li => ({ label: li.label, value: null, confidence: 100, reviewed: false, override_value: null, note: "manual" }))
      : [];
    const { error } = await supabase.from("extracted_financials").insert({
      case_id: cc.id, user_id: user.id,
      fiscal_year: newFy, statement_type: stmtType as never,
      line_items: items, confirmed: false, unit: anyRow?.unit || null,
    });
    if (error) { toast.error(error.message); return; }
    setAddingYearFor(null);
    toast.success(`FY${newFy} column added`);
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
    setProgress(0);
    setProgressLabel("Preparing case data");
    const LABELS = [
      "Preparing case data",
      "Analysing financials",
      "Drafting sections",
      "Building tables",
      "Finalising note",
    ];
    let p = 0;
    const tick = setInterval(() => {
      p = Math.min(p + 1, 92);
      setProgress(p);
      setProgressLabel(LABELS[Math.min(Math.floor(p / 20), LABELS.length - 1)]);
    }, 600);
    try {
      const { error } = await supabase.functions.invoke("generate-narrative", { body: { case_id: cc.id } });
      clearInterval(tick);
      if (error) throw error;
      setProgress(100);
      setProgressLabel("Complete");
      toast.success("IC Note draft generated");
      await reload();
      setTab("ic_note");
    } catch (e) {
      clearInterval(tick);
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setTimeout(() => { setBusy(false); setProgress(0); setProgressLabel(""); }, 800);
    }
  };

  const years = Array.from(new Set(ratios.map((r) => r.fiscal_year))).sort();
  const ratioGroups = Array.from(new Set(ratios.map((r) => r.category)));

  const statusColorClass: Record<string, string> = {
    green: "bg-success text-success-foreground",
    amber: "bg-warning text-warning-foreground",
    red: "bg-destructive text-destructive-foreground",
    na: "bg-muted text-muted-foreground",
  };
  const statusLabel: Record<string, string> = {
    green: "PASS", amber: "CAUTION", red: "FAIL", na: "—",
  };

  const inputCls = "w-full bg-input border border-border px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-primary";
  const labelCls = "terminal-label block mb-1";
  const sHd = (k: keyof typeof hd) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setHd(p => ({ ...p, [k]: e.target.value }));

  const ic = (cc.ic_note ?? null) as null | {
    sections: Record<string, { markdown: string }>;
    risks: Array<{ category: string; risk: string; mitigant: string; severity: string }>;
    conditions_precedent: string[];
    swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  };

  const topBar = (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground tracking-widest min-w-0">
        <span className="text-primary font-bold">{cc.case_code}</span>
        <span>·</span>
        <span className="truncate">{cc.client_name}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <CollabAvatarStack />
        <ShareDialog caseCode={cc.case_code} clientName={cc.client_name} />
      </div>
    </div>
  );

  return (
    <TerminalLayout topBar={topBar}>
      <LiveCursors />
      {/* Header strip */}
      {editingHeader ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 mb-3">
          <Panel title="EDIT CASE — CLIENT & DEAL INFO" ticker={cc.case_code} className="xl:col-span-8"
            actions={<button type="button" onClick={() => setEditingHeader(false)} className="text-[10px] border border-border text-foreground/60 px-3 py-1 hover:text-foreground">[CANCEL]</button>}
          >
            <form onSubmit={saveHeader} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Product Type *</label>
                  <select className={inputCls} value={hd.product_type} onChange={sHd("product_type")}>
                    {Object.values(PRODUCTS).map(p => (
                      <option key={p.id} value={p.id}>{p.label}{p.isCore ? " ★ CORE" : ""}</option>
                    ))}
                  </select>
                  {hd.product_type === "other" && (
                    <input className={`${inputCls} mt-1`} placeholder="Specify product type…" value={hd.product_type_custom} onChange={sHd("product_type_custom")} />
                  )}
                </div>
                <div>
                  <label className={labelCls}>Client Name *</label>
                  <input required className={inputCls} value={hd.client_name} onChange={sHd("client_name")} />
                </div>
                <div>
                  <label className={labelCls}>Website</label>
                  <input className={inputCls} placeholder="example.com" value={hd.website} onChange={sHd("website")} />
                </div>
                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={runEditWebEnrich}
                    disabled={editWebEnriching || (!hd.client_name.trim() && !hd.website.trim())}
                    className="w-full border border-primary/40 bg-primary/5 text-primary px-4 py-2 text-xs tracking-widest font-bold hover:bg-primary/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {editWebEnriching ? "SEARCHING WEB & FILLING FORM…" : "WEB SEARCH & AUTO-FILL ALL FIELDS"}
                  </button>
                  {!hd.client_name.trim() && !hd.website.trim() && (
                    <p className="text-[10px] text-foreground/40 mt-1 tracking-wider">Enter client name or website above first</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Legal Constitution</label>
                  <select className={inputCls} value={hd.legal_constitution} onChange={sHd("legal_constitution")}>
                    {["Pvt Ltd","Public Ltd","Partnership","LLP","Proprietorship","Individual"].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Industry / Sector</label>
                  <select className={inputCls} value={hd.industry} onChange={sHd("industry")}>
                    <option value="">— Select Industry —</option>
                    {CASE_INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                  {hd.industry === "Other" && (
                    <input className={`${inputCls} mt-1`} placeholder="Specify industry…" value={hd.industry_custom} onChange={sHd("industry_custom")} />
                  )}
                </div>
                <div>
                  <label className={labelCls}>Year Established</label>
                  <input type="number" className={inputCls} value={hd.year_established} onChange={sHd("year_established")} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Promoter Details</label>
                  <textarea className={inputCls} rows={2} placeholder="Key promoters, directors, shareholding pattern…" value={hd.promoter_details} onChange={sHd("promoter_details")} />
                </div>
                <div>
                  <label className={labelCls}>Principal Borrower</label>
                  <input className={inputCls} value={hd.principal_borrower} onChange={sHd("principal_borrower")} />
                </div>
                <div>
                  <label className={labelCls}>Deal Amount (INR Crores)</label>
                  <input type="number" step="0.01" className={inputCls} value={hd.deal_amount} onChange={sHd("deal_amount")} />
                </div>
                <div>
                  <label className={labelCls}>Tenure (months)</label>
                  <input type="number" className={inputCls} value={hd.tenure_months} onChange={sHd("tenure_months")} />
                </div>
                <div>
                  <label className={labelCls}>Expected IRR (%)</label>
                  <input type="number" step="0.01" className={inputCls} value={hd.expected_irr} onChange={sHd("expected_irr")} />
                </div>
              </div>
              <div>
                <label className={labelCls}>End Use of Funds</label>
                <textarea className={inputCls} rows={2} value={hd.end_use} onChange={sHd("end_use")} />
              </div>
              <div>
                <label className={labelCls}>Strategic Rationale (Why Rehbar?)</label>
                <textarea className={inputCls} rows={2} placeholder="Shariya compliance / lender of last resort…" value={hd.strategic_rationale} onChange={sHd("strategic_rationale")} />
              </div>
              <div>
                <label className={labelCls}>Collateral Summary</label>
                <textarea className={inputCls} rows={2} value={hd.collateral_summary} onChange={sHd("collateral_summary")} />
              </div>
              <div>
                <label className={labelCls}>Analyst Notes</label>
                <textarea className={inputCls} rows={2} value={hd.analyst_notes} onChange={sHd("analyst_notes")} />
              </div>
              <button type="submit" className="bg-primary text-primary-foreground px-4 py-2 text-sm tracking-widest font-bold hover:opacity-90">
                [UPDATE CASE →]
              </button>
            </form>
          </Panel>
          <div className="xl:col-span-4 flex flex-col gap-3">
            <Panel title="PRODUCT RULES" ticker={PRODUCTS[hd.product_type as ProductType]?.short ?? "—"} status="warn">
              <div className="space-y-3 text-xs">
                <div>
                  <div className="terminal-label">LEGAL NATURE</div>
                  <div className="text-primary mt-1">{PRODUCTS[hd.product_type as ProductType]?.legalNature}</div>
                </div>
                <div>
                  <div className="terminal-label">RETURN MECHANISM</div>
                  <div className="text-primary mt-1">{PRODUCTS[hd.product_type as ProductType]?.returnMechanism}</div>
                </div>
                <div>
                  <div className="terminal-label">SOP RULES</div>
                  <ul className="mt-1 space-y-1">
                    {PRODUCTS[hd.product_type as ProductType]?.rules.map((r, i) => (
                      <li key={i} className="text-foreground/80 flex gap-2"><span className="text-warning">▸</span><span>{r}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            </Panel>

            {/* AI Document Scan for edit case */}
            <Panel title="AI DOCUMENT SCAN" ticker="CLAUDE/4.6" status="live">
              <div className="space-y-3 text-xs">
                <p className="text-foreground/60 leading-relaxed">
                  Upload a company profile, loan application, CMA, or any relevant document.
                  Claude will read it and auto-fill the edit form.
                </p>
                <div
                  className={`border-2 border-dashed transition-colors cursor-pointer ${
                    editDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  } ${editScanning ? "pointer-events-none opacity-50" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setEditDragOver(true); }}
                  onDragLeave={() => setEditDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setEditDragOver(false); const files = Array.from(e.dataTransfer.files); if (files.length) handleEditScanFiles(files); }}
                  onClick={() => editFileInputRef.current?.click()}
                >
                  <input
                    ref={editFileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp"
                    multiple
                    onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) handleEditScanFiles(files); e.target.value = ""; }}
                  />
                  {editScanFileQueue.length > 0 ? (
                    <div className="px-3 py-2">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="terminal-label text-primary">
                          {editScanFileQueue.length} FILE{editScanFileQueue.length > 1 ? "S" : ""}
                        </span>
                        <span className="text-foreground/40 text-[10px]">· drop more to add</span>
                      </div>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {editScanFileQueue.map(item => (
                          <div key={item.id} className="flex items-center gap-1.5 text-[10px]">
                            <span className={
                              item.status === "done"      ? "text-green-500" :
                              item.status === "error"     ? "text-red-500"   :
                              item.status === "uploading" ? "text-primary"   :
                              item.status === "duplicate" ? "text-yellow-500": "text-foreground/30"
                            }>
                              {item.status === "done" ? "●" : item.status === "error" ? "✗" : item.status === "uploading" ? "▶" : item.status === "duplicate" ? "◎" : "○"}
                            </span>
                            <span className="truncate flex-1 text-primary">{item.name}</span>
                            <span className="text-foreground/40 shrink-0">{item.size}</span>
                            {item.status === "uploading" && (
                              <span className="text-primary shrink-0 w-8 text-right">{item.uploadPct}%</span>
                            )}
                            {item.status === "duplicate" && (
                              <span className="text-yellow-500 shrink-0 text-[9px] tracking-widest">ALREADY EXISTS</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="px-3 py-5 text-center">
                      <div className="text-primary text-lg mb-1">⬆</div>
                      <div className="terminal-label">DROP FILES OR CLICK TO BROWSE</div>
                      <div className="text-foreground/40 mt-1">PDF · Excel · Image · Multiple OK</div>
                    </div>
                  )}
                </div>

                {editWebEnriching && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-foreground/60 text-xs">
                      <span>Searching web &amp; analysing…</span>
                      <span className="font-mono text-primary">{editWebEnrichPct}%</span>
                    </div>
                    <div className="w-full h-1 bg-border">
                      <div className="h-1 bg-primary transition-all duration-300" style={{ width: `${editWebEnrichPct}%` }} />
                    </div>
                  </div>
                )}

                {editScanning && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-foreground/60">
                      <span>{editScanStage}</span>
                      <span>{editScanPct}%</span>
                    </div>
                    <div className="w-full h-1 bg-border">
                      <div className="h-1 bg-primary transition-all duration-300" style={{ width: `${editScanPct}%` }} />
                    </div>
                    <button
                      type="button"
                      onClick={resetEditScan}
                      className="w-full border border-border text-foreground/50 py-1 text-xs tracking-widest hover:border-red-500 hover:text-red-400 transition-colors"
                    >
                      [CANCEL]
                    </button>
                  </div>
                )}

                {editScanResult && (
                  <div className="space-y-2">
                    {editScanResult.summary && (
                      <div className="border border-border p-2 bg-input/30">
                        <div className="terminal-label mb-1">AI SUMMARY</div>
                        <p className="text-foreground/80 leading-relaxed">{editScanResult.summary}</p>
                        {editScanResult.confidence != null && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="flex-1 h-0.5 bg-border">
                              <div
                                className={`h-0.5 ${editScanResult.confidence >= 70 ? "bg-green-500" : editScanResult.confidence >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
                                style={{ width: `${editScanResult.confidence}%` }}
                              />
                            </div>
                            <span className="text-foreground/50">{editScanResult.confidence}% conf.</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="terminal-label">EXTRACTED FIELDS</div>
                    <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
                      {EDIT_SCANNABLE_FIELDS.map(({ key, label }) => {
                        const val = editScanResult[key];
                        if (val == null || val === "") return null;
                        return (
                          <div key={key} className="flex gap-2">
                            <span className="text-foreground/40 shrink-0 w-28">{label}</span>
                            <span className="text-primary truncate">{String(val)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={applyEditScanned}
                      className="w-full bg-primary text-primary-foreground py-1.5 text-xs tracking-widest font-bold hover:opacity-90"
                    >
                      [APPLY TO FORM]
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditScanResult(null); setEditScanFileQueue([]); }}
                      className="w-full border border-border text-foreground/50 py-1 text-xs tracking-widest hover:border-primary/50"
                    >
                      DISCARD
                    </button>
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      ) : (
        /* ── Header (always visible) + optional detail panel below ─────────── */
        <div className="space-y-3 mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-3">
            <Panel title="CASE" ticker={cc.case_code} className="sm:col-span-2 xl:col-span-4"
              actions={<button onClick={openHeaderEdit} className="text-[10px] text-foreground/40 hover:text-primary tracking-widest">[EDIT]</button>}
            >
              <div className="text-2xl text-primary glow font-bold">{cc.client_name}</div>
              <div className="terminal-label mt-1">{product.label} · {cc.industry || "—"}</div>
              {(cc as unknown as { company_id?: string }).company_id ? (
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => navigate(`/companies/${(cc as unknown as { company_id: string }).company_id}`)}
                    className="inline-flex items-center gap-1 text-[9px] tracking-widest border border-success/40 text-success bg-success/10 px-1.5 py-0.5 hover:bg-success/20 transition-colors"
                  >
                    ● MASTER DATA LINKED
                  </button>
                  <button
                    onClick={async () => {
                      await supabase.from("credit_cases").update({ company_id: null } as never).eq("id", cc.id);
                      await reload();
                      toast.success("Company unlinked");
                    }}
                    className="text-[9px] tracking-widest text-muted-foreground hover:text-destructive transition-colors"
                  >
                    [UNLINK]
                  </button>
                </div>
              ) : (
                <div className="mt-1.5 text-[9px] tracking-widest text-muted-foreground/40">— NOT LINKED TO MASTER DATA</div>
              )}
            </Panel>
            <Panel title="STATUS" className="xl:col-span-3">
              <div className={`inline-block px-3 py-1 text-xs font-bold tracking-widest bg-${statusMeta.color} text-${statusMeta.color}-foreground`}>
                {statusMeta.label}
              </div>
              <div className="terminal-label mt-2">Stage {statusMeta.pipeline} of 7</div>
            </Panel>
            <Panel title="DEAL TERMS" className="xl:col-span-5"
              actions={<button onClick={openHeaderEdit} className="text-[10px] text-foreground/40 hover:text-primary tracking-widest">[EDIT]</button>}
            >
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="terminal-label">AMOUNT</div><div className="text-primary">₹{Number(cc.deal_amount ?? 0).toLocaleString("en-IN")} Cr</div></div>
                <div><div className="terminal-label">TENURE</div><div className="text-primary">{cc.tenure_months ?? "—"}M</div></div>
                <div><div className="terminal-label">IRR</div><div className="text-primary">{cc.expected_irr ?? "—"}%</div></div>
              </div>
            </Panel>
          </div>

          <Panel title="COMPANY DETAILS" ticker={cc.case_code}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-xs">
              {([
                ["Legal Constitution",  cc.legal_constitution],
                ["Industry / Sector",   cc.industry],
                ["Year Established",    cc.year_established],
                ["Principal Borrower",  cc.principal_borrower],
                ["Website",             cc.website],
              ] as const).map(([label, val]) => val != null && val !== "" ? (
                <div key={label}>
                  <div className="terminal-label">{label}</div>
                  <div className="text-primary mt-0.5">{String(val)}</div>
                </div>
              ) : null)}
            </div>
            {(cc.end_use || cc.collateral_summary || cc.strategic_rationale || cc.promoter_details || cc.analyst_notes) && (
              <div className="border-t border-border/40 mt-3 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                {([
                  ["End Use of Funds",    cc.end_use],
                  ["Collateral Summary",  cc.collateral_summary],
                  ["Strategic Rationale", cc.strategic_rationale],
                  ["Promoter Details",    cc.promoter_details],
                  ["Analyst Notes",       cc.analyst_notes],
                ] as const).map(([label, val]) => val ? (
                  <div key={label}>
                    <div className="terminal-label">{label}</div>
                    <div className="text-foreground/90 mt-0.5 leading-relaxed whitespace-pre-wrap">{val}</div>
                  </div>
                ) : null)}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* Tabs */}
      <div className="overflow-x-auto -mx-3 px-3 mb-3">
        <div className="flex border border-border bg-card min-w-max">
          {([
            ["upload",      "1 · UPLOAD"],
            ["review",      "2 · REVIEW"],
            ["ratios",      "3 · RATIOS"],
            ["projections", "4 · PROJ"],
            ["bank",        "5 · BANK"],
            ["gst",         "6 · GST"],
            ["ic_note",     "7 · IC NOTE"],
            ["emi",         "8 · EMI"],
          ] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 sm:px-4 py-2 text-xs tracking-widest border-r border-border whitespace-nowrap flex items-center gap-1 ${tab === k ? "bg-primary text-primary-foreground" : "text-primary/70 hover:bg-surface"}`}
            >{l}<TabPresenceDots tabKey={k} /></button>
          ))}
        </div>
      </div>

      {tab === "upload" && (
        <Panel title="UPLOAD FINANCIAL STATEMENTS" ticker="PDF / IMG / XLSX">
          {extractError && (
            <div className="mb-3 border border-destructive/50 bg-destructive/10 px-3 py-2 space-y-1">
            <div className="flex items-center justify-between gap-2 border-b border-destructive/20 pb-1 mb-1.5">
                <span className="text-destructive font-bold text-xs tracking-widest">✕ {extractError.title.toUpperCase()}</span>
                <button 
                  onClick={() => setExtractError(null)} 
                  className="text-destructive hover:bg-destructive/20 px-1.5 py-0.5 border border-destructive/30 text-[10px] font-bold transition-colors"
                >[CLOSE]</button>
              </div>
              {extractError.detail && (
                <div className="text-destructive/80 text-[11px] tracking-wide">{extractError.detail}</div>
              )}
              {extractError.action && (
                <div className="text-warning text-[11px] tracking-wide">▸ {extractError.action}</div>
              )}
            </div>
          )}
          <UploadGrid onUpload={(f, cls, fy) => handleUpload(f, cls, fy)} onCancel={handleCancelUpload} onDelete={handleDeleteDoc} onEdit={handleEditDoc} onRetry={handleRetry} busy={busy} docs={docs} progress={progress} progressLabel={progressLabel} />
        </Panel>
      )}

      {tab === "review" && (
        <div className="space-y-3">
          {extracted.length === 0 ? (
            <Panel title="NO EXTRACTION YET"><div className="text-muted-foreground text-xs">Upload documents in the previous step to begin extraction.</div></Panel>
          ) : (() => {
            // Standard label order per type for consistent row ordering
            const STD_ORDER: Record<string, string[]> = {
              profit_loss: ["Turnover","Cost of Goods Sold","Gross Profit","Operating Expenses","EBITDA","Depreciation","EBIT","Interest Expense","Profit Before Tax","Tax","PAT"],
              balance_sheet: ["Share Capital","Reserves & Surplus","Net Worth","Long Term Borrowings","Short Term Borrowings","Total Debt","Trade Payables","Other Current Liabilities","Current Liabilities","Total Liabilities","Fixed Assets (Net)","Inventory","Trade Receivables","Cash & Bank","Other Current Assets","Current Assets","Total Assets","Capital Employed"],
              cash_flow: ["Cash from Operations","Cash from Investing","Cash from Financing","Net Change in Cash","Opening Cash","Closing Cash"],
              projections: ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"],
            };
            const stmtTypes = Array.from(new Set(extracted.map(r => r.statement_type)));
            return stmtTypes.map(type => {
              const typeRows = extracted.filter(r => r.statement_type === type).sort((a, b) => a.fiscal_year - b.fiscal_year);
              const years = typeRows.map(r => r.fiscal_year);
              const unit = typeRows.find(r => r.unit)?.unit;
              const abbr = unitAbbr(unit);
              const allConfirmed = typeRows.every(r => r.confirmed);
              const anyLow = typeRows.some(r => (r.line_items as unknown as LineItem[]).some(i => i.confidence < 80));
              // Build ordered union of labels
              const std = STD_ORDER[type] ?? [];
              const seen = new Set<string>(std.filter(l => typeRows.some(r => (r.line_items as unknown as LineItem[]).some(i => i.label === l))));
              for (const row of typeRows)
                for (const it of (row.line_items as unknown as LineItem[]))
                  if (!seen.has(it.label)) { seen.add(it.label); }
              const labels = [...seen];

              return (
                <Panel
                  key={type}
                  title={`${type.replace(/_/g," ").toUpperCase()}${unit ? `  ·  ${fmtUnit(unit)}` : ""}`}
                  status={anyLow ? "warn" : allConfirmed ? "live" : "idle"}
                  ticker={allConfirmed ? "ALL CONFIRMED" : `${years.length} YEAR${years.length !== 1 ? "S" : ""}`}
                  actions={
                    <div className="flex gap-1.5 items-center">
                      {!allConfirmed && (
                        <button
                          onClick={() => Promise.all(typeRows.filter(r => !r.confirmed).map(r => confirmExtraction(r.id)))}
                          className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 hover:opacity-90 tracking-widest"
                        >[CONFIRM ALL]</button>
                      )}
                      <button
                        onClick={() => { if (window.confirm(`Delete ALL ${type.replace(/_/g," ").toUpperCase()} data (${years.length} year${years.length !== 1 ? "s" : ""})?`)) Promise.all(typeRows.map(r => deleteExtractedRow(r.id))); }}
                        className="text-[10px] border border-destructive/40 text-destructive/70 px-2 py-0.5 hover:bg-destructive/10 hover:border-destructive hover:text-destructive tracking-widest"
                      >[DELETE]</button>
                    </div>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground border-b border-border">
                        <tr>
                          <th className="text-left py-1 pr-3 min-w-[160px]">LINE ITEM</th>
                          {years.map(fy => {
                            const fyRow = typeRows.find(r => r.fiscal_year === fy)!;
                            return (
                              <th key={fy} className="text-right pr-2 min-w-[100px]">
                                <div className="flex items-center justify-end gap-1">
                                  <span>FY{fy}</span>
                                  {!fyRow.confirmed
                                    ? <button onClick={() => confirmExtraction(fyRow.id)} className="text-[8px] text-primary/60 hover:text-primary px-0.5" title="Confirm this year">✓</button>
                                    : <span className="text-[8px] text-success">✓</span>
                                  }
                                  <button
                                    onClick={() => { if (window.confirm(`Delete FY${fy}?`)) deleteExtractedRow(fyRow.id); }}
                                    className="text-[8px] text-destructive/40 hover:text-destructive px-0.5"
                                    title="Delete this year column"
                                  >✕</button>
                                </div>
                              </th>
                            );
                          })}
                          <th className="text-right pr-2 min-w-[90px]">
                            {addingYearFor?.stmtType === type ? (
                              <div className="flex gap-1 items-center justify-end">
                                <input
                                  type="number"
                                  autoFocus
                                  placeholder="e.g. 2023"
                                  value={addingYearFor.fy}
                                  onChange={e => setAddingYearFor({ stmtType: type, fy: e.target.value })}
                                  onKeyDown={e => { if (e.key === "Enter" && addingYearFor.fy) addYearColumn(type, Number(addingYearFor.fy)); if (e.key === "Escape") setAddingYearFor(null); }}
                                  className="bg-input border border-accent/60 px-1 py-0.5 text-[10px] text-primary w-20 focus:outline-none"
                                />
                                <button onClick={() => addingYearFor.fy && addYearColumn(type, Number(addingYearFor.fy))} className="text-[9px] text-accent hover:text-accent/80">ADD</button>
                                <button onClick={() => setAddingYearFor(null)} className="text-[9px] text-foreground/40 hover:text-foreground">✕</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setAddingYearFor({ stmtType: type, fy: "" })}
                                className="text-[9px] text-accent/60 hover:text-accent tracking-widest"
                              >+ YEAR</button>
                            )}
                          </th>
                          <th className="text-left pl-3 min-w-[140px]">NOTE</th>
                          <th className="w-5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {labels.map(label => {
                          const isEditingLabel = editingCell?.field === "label" && editingCell.stmtType === type && editingCell.label === label;
                          // Best AI note: first non-empty, non-manual note across all years (newest → oldest)
                          const bestNote = [...typeRows].reverse().reduce<string>((found, row) => {
                            if (found) return found;
                            const it = (row.line_items as unknown as LineItem[]).find(i => i.label === label);
                            const n = it?.note ?? "";
                            return (n && n !== "manual" && n !== "auto-derived") ? n : "";
                          }, "");
                          return (
                            <tr key={label} className={`border-b border-border/30 group ${type === "balance_sheet" && BS_TOTAL_LABELS.has(label) ? "bg-surface/60 font-semibold" : ""}`}>
                              <td className="py-0.5 pr-3">
                                {isEditingLabel ? (
                                  <input
                                    autoFocus
                                    defaultValue={label}
                                    onBlur={e => updateCellLabel(type, label, e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); }}
                                    className="w-full bg-input border border-primary px-1 text-primary text-xs"
                                  />
                                ) : (
                                  <span
                                    className="cursor-pointer hover:text-primary text-foreground/90"
                                    title="Click to rename (updates all years)"
                                    onClick={() => setEditingCell({ stmtType: type, fy: years[0] ?? 0, label, field: "label" })}
                                  >{label}</span>
                                )}
                              </td>
                              {years.map(fy => {
                                const fyRow = typeRows.find(r => r.fiscal_year === fy);
                                const item = fyRow ? (fyRow.line_items as unknown as LineItem[]).find(i => i.label === label) : undefined;
                                const val = item ? (item.override_value ?? item.value) : null;
                                const conf = item?.confidence ?? 100;
                                const confCls = conf >= 90 ? "text-primary" : conf >= 80 ? "text-warning" : "text-destructive";
                                const isEditingVal = editingCell?.field === "value" && editingCell.stmtType === type && editingCell.fy === fy && editingCell.label === label;
                                return (
                                  <td key={fy} className="text-right tabular-nums pr-2">
                                    {isEditingVal ? (
                                      <input
                                        autoFocus
                                        type="number"
                                        defaultValue={val ?? ""}
                                        onBlur={e => { setEditingCell(null); setEditing(null); updateCellValue(type, fy, label, e.target.value); }}
                                        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); }}
                                        className="w-24 bg-input border border-primary px-1 text-right text-primary text-xs"
                                      />
                                    ) : (
                                      <span
                                        className={`cursor-pointer hover:text-primary ${confCls}`}
                                        title={`Confidence: ${conf} — click to edit`}
                                        onClick={() => { setEditingCell({ stmtType: type, fy, label, field: "value" }); setEditing(`${type}.${fy}.${label}`); }}
                                      >
                                        {val != null ? val.toLocaleString("en-IN") : <span className="text-muted-foreground">—</span>}
                                        {abbr && val != null && <span className="text-[9px] text-muted-foreground ml-0.5">{abbr}</span>}
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                              <td />{/* spacer under + YEAR header */}
                              <td className="pl-3">
                                <input
                                  type="text"
                                  key={`${type}-${label}-note`}
                                  defaultValue={bestNote}
                                  placeholder="add note…"
                                  onBlur={async e => {
                                    const v = e.target.value;
                                    await Promise.all(typeRows.map(row => updateRowNote(type, row.fiscal_year, label, v)));
                                    await reload();
                                  }}
                                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                  className="w-full bg-transparent border-b border-border/40 focus:border-primary px-0 text-muted-foreground focus:text-primary text-xs outline-none placeholder:text-border/60"
                                />
                              </td>
                              <td className="text-center">
                                <button
                                  onClick={() => deleteRowFromType(type, label)}
                                  className="opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive text-[10px] px-1"
                                  title="Remove this row from all years"
                                >✕</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button
                    onClick={() => addRowToType(type)}
                    className="mt-2 text-[10px] border border-dashed border-border/60 text-muted-foreground hover:border-primary hover:text-primary px-3 py-1 w-full tracking-widest"
                  >+ ADD ROW</button>

                  {/* ── Balance sheet tally check ────────────────────────── */}
                  {type === "balance_sheet" && (
                    <div className="mt-3 border border-border/50 bg-surface p-3 space-y-2">
                      <div className="text-[9px] text-muted-foreground tracking-widest mb-1">
                        BALANCE CHECK &nbsp;·&nbsp; Total Assets = Net Worth + Total Debt + Current Liabilities
                      </div>
                      {years.map(fy => {
                        const fyRow = typeRows.find(r => r.fiscal_year === fy);
                        const items = (fyRow?.line_items ?? []) as unknown as LineItem[];
                        const get = (lbl: string) => { const it = items.find(i => i.label === lbl); return it != null ? (it.override_value ?? it.value ?? 0) : 0; };
                        const assets   = get("Total Assets");
                        const nw       = get("Net Worth");
                        const debt     = get("Total Debt");
                        const currLiab = get("Current Liabilities");
                        const liabSide = nw + debt + currLiab;
                        const diff     = parseFloat((assets - liabSide).toFixed(2));
                        const balanced = Math.abs(diff) < 0.01;
                        const unit     = fyRow?.unit;
                        const fmt      = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
                        const au       = unitAbbr(unit ?? "");
                        return (
                          <div key={fy} className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs px-2 py-1.5 border ${balanced ? "border-success/30 bg-success/5" : "border-destructive/40 bg-destructive/5"}`}>
                            <span className="text-muted-foreground font-bold">FY{fy}</span>
                            <span>Assets <span className="text-primary tabular-nums font-bold">{fmt(assets)}{au ? ` ${au}` : ""}</span></span>
                            <span className="text-muted-foreground">=</span>
                            <span>NW <span className="text-primary tabular-nums">{fmt(nw)}</span> + Debt <span className="text-primary tabular-nums">{fmt(debt)}</span> + CL <span className="text-primary tabular-nums">{fmt(currLiab)}</span> = <span className="text-primary tabular-nums font-bold">{fmt(liabSide)}{au ? ` ${au}` : ""}</span></span>
                            <span className={`ml-auto font-bold tracking-widest text-[10px] ${balanced ? "text-success" : "text-destructive"}`}>
                              {balanced ? "✓ BALANCED" : `DIFF ${diff > 0 ? "+" : ""}${fmt(diff)}${au ? ` ${au}` : ""} — adjust an asset or liability`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ── Year-over-year comparison chart ─────────────────── */}
                  {years.length >= 1 && (() => {
                    const METRICS: Record<string, { key: string; color: string; name: string }[]> = {
                      profit_loss: [
                        { key: "Turnover",       color: "#22c55e", name: "Turnover" },
                        { key: "EBITDA",         color: "#f59e0b", name: "EBITDA" },
                        { key: "PAT",            color: "#60a5fa", name: "PAT" },
                      ],
                      balance_sheet: [
                        { key: "Total Assets",   color: "#60a5fa", name: "Total Assets" },
                        { key: "Net Worth",      color: "#22c55e", name: "Net Worth" },
                        { key: "Total Debt",     color: "#ef4444", name: "Total Debt" },
                      ],
                      cash_flow: [
                        { key: "Cash from Operations", color: "#22c55e", name: "Operations" },
                        { key: "Cash from Investing",  color: "#f59e0b", name: "Investing" },
                        { key: "Cash from Financing",  color: "#60a5fa", name: "Financing" },
                      ],
                      projections: [
                        { key: "Projected Turnover", color: "#22c55e", name: "Revenue (P)" },
                        { key: "Projected EBITDA",   color: "#f59e0b", name: "EBITDA (P)" },
                        { key: "Projected PAT",      color: "#60a5fa", name: "PAT (P)" },
                      ],
                    };
                    const metrics = METRICS[type] ?? [];
                    const chartData = years.map(fy => {
                      const row = typeRows.find(r => r.fiscal_year === fy);
                      const items = (row?.line_items ?? []) as unknown as LineItem[];
                      const entry: Record<string, number | string | null> = { fy: `FY${fy}` };
                      for (const m of metrics) {
                        const it = items.find(i => i.label === m.key);
                        entry[m.key] = it ? (it.override_value ?? it.value) : null;
                      }
                      return entry;
                    });
                    const hasData = chartData.some(d => metrics.some(m => d[m.key] != null));
                    if (!hasData) return null;
                    return (
                      <div className="mt-4 border-t border-border/40 pt-3">
                        <div className="text-[9px] text-muted-foreground tracking-widest mb-2">
                          YEAR-ON-YEAR COMPARISON{unit ? ` · ₹ ${unit}` : ""}
                        </div>
                        <div className="h-44">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                              <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                              <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} width={54}
                                tickFormatter={v => Math.abs(v) >= 1000 ? `${(v/1000).toFixed(1)}K` : String(v)} />
                              <RTooltip
                                contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", fontSize: 11 }}
                                formatter={(v: number, name: string) => [v != null ? v.toLocaleString("en-IN") : "—", name]}
                              />
                              <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                              {metrics.map((m, i) => (
                                <Bar key={m.key} dataKey={m.key} name={m.name} fill={m.color}
                                  opacity={0.85} radius={[2, 2, 0, 0]}
                                  barSize={years.length > 4 ? 10 : years.length > 2 ? 14 : 20} />
                              ))}
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  })()}
                  <StatementInsights type={type} typeRows={typeRows} years={years} unit={unit} />
                </Panel>
              );
            });
          })()}
          {/* ── Add Statement Box ──────────────────────────────────────────── */}
          {addStmtForm ? (
            <Panel title="NEW STATEMENT BOX" ticker="MANUAL ENTRY" status="warn">
              <div className="flex gap-3 items-end flex-wrap">
                <div>
                  <label className="terminal-label block mb-1">Statement Type</label>
                  <select
                    value={addStmtForm.type}
                    onChange={e => setAddStmtForm(f => f && ({ ...f, type: e.target.value as StatementType }))}
                    className="bg-input border border-border px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-primary"
                  >
                    {(["profit_loss","balance_sheet","cash_flow","projections"] as StatementType[]).map(t => (
                      <option key={t} value={t}>{t.replace(/_/g," ").toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="terminal-label block mb-1">Fiscal Year</label>
                  <input
                    type="number"
                    autoFocus
                    placeholder="e.g. 2023"
                    value={addStmtForm.fy}
                    onChange={e => setAddStmtForm(f => f && ({ ...f, fy: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === "Enter" && addStmtForm.fy) createEmptyStatement(addStmtForm.type, Number(addStmtForm.fy), addStmtForm.unit);
                      if (e.key === "Escape") setAddStmtForm(null);
                    }}
                    className="bg-input border border-border px-2 py-1.5 text-sm text-primary w-28 focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="terminal-label block mb-1">Unit</label>
                  <input
                    placeholder="e.g. Crores"
                    value={addStmtForm.unit}
                    onChange={e => setAddStmtForm(f => f && ({ ...f, unit: e.target.value }))}
                    className="bg-input border border-border px-2 py-1.5 text-sm text-primary w-28 focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={!addStmtForm.fy}
                    onClick={() => addStmtForm.fy && createEmptyStatement(addStmtForm.type, Number(addStmtForm.fy), addStmtForm.unit)}
                    className="bg-primary text-primary-foreground px-4 py-1.5 text-xs tracking-widest font-bold hover:opacity-90 disabled:opacity-40"
                  >[CREATE]</button>
                  <button
                    onClick={() => setAddStmtForm(null)}
                    className="border border-border text-foreground/50 px-3 py-1.5 text-xs tracking-widest hover:text-foreground"
                  >[CANCEL]</button>
                </div>
              </div>
            </Panel>
          ) : (
            <button
              onClick={() => setAddStmtForm({ type: "profit_loss", fy: "", unit: extracted.find(r => r.unit)?.unit ?? "" })}
              className="w-full text-[10px] border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary py-2.5 tracking-widest"
            >+ ADD STATEMENT BOX</button>
          )}
          {extracted.some((r) => r.confirmed) && (
            <button onClick={runRatios} disabled={busy} className="bg-primary text-primary-foreground px-4 py-2 text-xs tracking-widest font-bold disabled:opacity-50">
              {busy ? "COMPUTING..." : "[GENERATE RATIO ANALYSIS →]"}
            </button>
          )}
          {/* Auto-derived fields panel */}
          {extracted.length > 0 && (() => {
            const histYears = Array.from(new Set(extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year))).sort();
            const derivedRows: { fy: number; label: string; value: number }[] = [];
            for (const fy of histYears) {
              const raw: LineItem[] = [];
              const seen = new Set<string>();
              for (const row of extracted.filter(r => r.fiscal_year === fy && r.statement_type !== "projections"))
                for (const it of (row.line_items as unknown as LineItem[]) ?? [])
                  if (!seen.has(it.label)) { raw.push(it); seen.add(it.label); }
              for (const it of deriveFinancialItems(raw))
                if (it.note === "auto-derived" && it.value !== null && Number.isFinite(Number(it.value)))
                  derivedRows.push({ fy, label: it.label, value: Number(it.value) });
            }
            if (derivedRows.length === 0) return null;
            return (
              <Panel title="AUTO-DERIVED FIELDS" ticker="CALC" status="warn">
                <div className="text-[9px] text-warning/80 mb-2 tracking-wider">
                  ▸ Not in uploaded documents — auto-calculated from extracted data. Review before use.
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[360px]">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr><th className="text-left py-0.5">LINE ITEM</th><th className="text-right">FY</th><th className="text-right">CALCULATED VALUE</th></tr>
                  </thead>
                  <tbody>
                    {derivedRows.map((r, i) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="py-0.5 text-warning/90">{r.label}</td>
                        <td className="text-right text-muted-foreground">FY{r.fy}</td>
                        <td className="text-right tabular-nums text-warning">{r.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </Panel>
            );
          })()}
          {extracted.length > 0 && (
            <DownloadBar onExcel={async () => {
              const stmtTypes = Array.from(new Set(extracted.map(r => r.statement_type)));
              const sheets = stmtTypes.map(type => {
                const rows: (string | number | null)[][] = [["FY", "Unit", "Line Item", "Extracted Value", "Override Value", "Confidence", "Reviewed"]];
                for (const row of extracted.filter(r => r.statement_type === type)) {
                  for (const it of (row.line_items as unknown as LineItem[]) ?? []) {
                    rows.push([row.fiscal_year ?? "—", row.unit ?? "", it.label, it.value ?? "", it.override_value ?? "", it.confidence, it.reviewed ? "Yes" : "No"]);
                  }
                }
                return { name: type.replace(/_/g, " "), rows };
              });
              await dlExcel(sheets, `${cc.case_code}_extraction.xlsx`);
            }} />
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
                  <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[400px]">
                    <thead className="text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left py-1">RATIO</th>
                        {years.map((y) => (
                          <th key={y} className="text-right pr-1">FY{y}</th>
                        ))}
                        <th className="text-right">BENCHMARK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(new Set(ratios.filter((r) => r.category === cat).map((r) => r.ratio_name))).map((name) => (
                        <tr key={name} className="border-b border-border/30">
                          <td className="py-1 text-foreground/90">{RATIO_DISPLAY_NAMES[name] ?? name}</td>
                          {years.map((y) => {
                            const r = ratios.find((x) => x.ratio_name === name && x.fiscal_year === y);
                            const status = r?.threshold_status ?? "na";
                            const val = r?.ratio_value !== null && r?.ratio_value !== undefined ? Number(r.ratio_value) : null;
                            return (
                              <td key={y} className="text-right pr-1">
                                <div className="inline-flex items-center gap-1.5 justify-end">
                                  <span className="tabular-nums text-foreground/90">{formatRatio(name, val)}</span>
                                  <span className={`px-1.5 py-0 text-[9px] tracking-widest font-bold leading-5 ${statusColorClass[status]}`}>
                                    {statusLabel[status]}
                                  </span>
                                </div>
                              </td>
                            );
                          })}
                          <td className="text-right text-accent tabular-nums">
                            {(() => {
                              const bm = ratios.find((x) => x.ratio_name === name)?.benchmark;
                              return bm != null ? formatRatio(name, Number(bm)) : "—";
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </Panel>
              ))}
              <button onClick={() => setTab("projections")} className="bg-surface border border-border text-primary px-4 py-2 text-xs tracking-widest font-bold hover:bg-primary/10">
                [VIEW PROJECTIONS &amp; ANALYTICS →]
              </button>
              <DownloadBar
                onExcel={async () => {
                  const hdr: (string|number|null)[] = ["Category", "Ratio", ...years.map(y => `FY${y}`), "Benchmark", "Status"];
                  const rows: (string|number|null)[][] = [hdr];
                  for (const cat of ratioGroups) {
                    for (const name of Array.from(new Set(ratios.filter(r => r.category === cat).map(r => r.ratio_name)))) {
                      const latest = ratios.filter(r => r.ratio_name === name).sort((a,b) => b.fiscal_year - a.fiscal_year)[0];
                      rows.push([cat, RATIO_DISPLAY_NAMES[name] ?? name,
                        ...years.map(y => { const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y); return r?.ratio_value != null ? formatRatio(name, Number(r.ratio_value)) : "—"; }),
                        latest?.benchmark != null ? formatRatio(name, Number(latest.benchmark)) : "—",
                        latest?.threshold_status?.toUpperCase() ?? "—",
                      ]);
                    }
                  }
                  await dlExcel([{ name: "Ratios", rows }], `${cc.case_code}_ratios.xlsx`);
                }}
                onPdf={() => {
                  let html = `<h1>${cc.client_name} — Financial Ratio Matrix</h1>
<div class="meta"><div class="mi"><div class="lbl">Case</div><div class="val">${cc.case_code}</div></div><div class="mi"><div class="lbl">Amount</div><div class="val">₹${cc.deal_amount ?? "—"} Cr</div></div><div class="mi"><div class="lbl">Tenure</div><div class="val">${cc.tenure_months ?? "—"}M</div></div><div class="mi"><div class="lbl">IRR</div><div class="val">${cc.expected_irr ?? "—"}%</div></div></div>`;
                  for (const cat of ratioGroups) {
                    html += `<div class="sec"><h2>${cat}</h2><table><thead><tr><th>Ratio</th>${years.map(y=>`<th>FY${y}</th>`).join("")}<th>Benchmark</th><th>Status</th></tr></thead><tbody>`;
                    for (const name of Array.from(new Set(ratios.filter(r=>r.category===cat).map(r=>r.ratio_name)))) {
                      const latest = ratios.filter(r=>r.ratio_name===name).sort((a,b)=>b.fiscal_year-a.fiscal_year)[0];
                      const s = latest?.threshold_status ?? "na";
                      const cls = s==="green"?"pass":s==="red"?"fail":s==="amber"?"caution":"";
                      html += `<tr><td>${RATIO_DISPLAY_NAMES[name]??name}</td>${years.map(y=>{const r=ratios.find(x=>x.ratio_name===name&&x.fiscal_year===y);return`<td>${r?.ratio_value!=null?formatRatio(name,Number(r.ratio_value)):"—"}</td>`;}).join("")}<td>${latest?.benchmark!=null?formatRatio(name,Number(latest.benchmark)):"—"}</td><td class="${cls}">${s.toUpperCase()}</td></tr>`;
                    }
                    html += `</tbody></table></div>`;
                  }
                  dlPdf(html, `${cc.case_code} Ratios`);
                }}
              />
            </>
          )}
        </div>
      )}

      {tab === "projections" && (
        <div className="space-y-3">
          <ProjectionsTab
            extracted={extracted}
            cc={cc}
            busy={busy}
            progress={progress}
            progressLabel={progressLabel}
            onGenerateNote={runNarrative}
          />
          {extracted.some(r => r.statement_type === "projections") && (
            <DownloadBar onExcel={async () => {
              const projRows = extracted.filter(r => r.statement_type === "projections");
              const histRows = extracted.filter(r => r.statement_type !== "projections");
              const projYears = Array.from(new Set(projRows.map(r => r.fiscal_year))).sort();
              const liVal = (items: LineItem[], label: string) => { const it = items.find(i=>i.label===label); if(!it) return null; return it.override_value??it.value; };
              const getHist = (fy: number): LineItem[] => { const r: LineItem[] = []; const s = new Set<string>(); for (const row of histRows.filter(x=>x.fiscal_year===fy)) for (const it of (row.line_items as unknown as LineItem[])??[]) if(!s.has(it.label)){r.push(it);s.add(it.label);} return r; };
              const projLabels = ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"];
              const hdr: (string|number|null)[] = ["Metric", ...projYears.map(y=>`FY${y} (P)`)];
              const rows: (string|number|null)[][] = [hdr];
              for (const lb of projLabels) rows.push([lb, ...projYears.map(y => liVal((projRows.find(r=>r.fiscal_year===y)?.line_items??[]) as unknown as LineItem[], lb) ?? "—")]);
              const unit = extracted.find(r=>r.unit)?.unit ?? "";
              await dlExcel([{ name: "Projections", rows }, { name: "Meta", rows: [["Unit", unit], ["Case", cc.case_code], ["Client", cc.client_name]] }], `${cc.case_code}_projections.xlsx`);
            }} />
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
              {IC_SECTIONS.map((s) => {
                const aiMd = ic.sections[s.id]?.markdown || "";
                if (s.id === "executive_summary") return (
                  <Panel key={s.id} title={`${s.roman}. ${s.title}`} ticker="DRAFT">
                    <ICSummaryPanel cc={cc} ratios={ratios} />
                    <BulletOnlyMd text={aiMd} />
                  </Panel>
                );
                if (s.id === "historical_financial") return (
                  <Panel key={s.id} title={`${s.roman}. ${s.title}`} ticker="DRAFT">
                    <ICHistoricalTables extracted={extracted} />
                    <BulletOnlyMd text={aiMd} />
                  </Panel>
                );
                if (s.id === "projections") return (
                  <Panel key={s.id} title={`${s.roman}. ${s.title}`} ticker="DRAFT">
                    <ICProjectionsTable extracted={extracted} />
                    <BulletOnlyMd text={aiMd} />
                  </Panel>
                );
                if (s.id === "key_ratios") return (
                  <Panel key={s.id} title={`${s.roman}. ${s.title}`} ticker="DRAFT">
                    <ICRatioTable ratios={ratios} />
                  </Panel>
                );
                if (s.id === "client_promoter") return (
                  <Panel key={s.id} title={`${s.roman}. ${s.title}`} ticker="DRAFT">
                    <ICClientProfile cc={cc} />
                    <BulletOnlyMd text={aiMd} />
                  </Panel>
                );
                if (s.id === "investment_structure") return (
                  <Panel key={s.id} title={`${s.roman}. ${s.title}`} ticker="DRAFT">
                    <ICInvestmentStructure cc={cc} />
                    <BulletOnlyMd text={aiMd} />
                  </Panel>
                );
                if (s.id === "rehbar_funding_history") return (
                  <Panel key={s.id} title={`${s.roman}. ${s.title}`} ticker="DRAFT">
                    <ICRehbarHistory cc={cc} />
                    <BulletOnlyMd text={aiMd} />
                  </Panel>
                );
                if (s.id === "visit_reference") return (
                  <Panel key={s.id} title={`${s.roman}. ${s.title}`} ticker="DRAFT">
                    <ICVisitReference cc={cc} />
                    <BulletOnlyMd text={aiMd} />
                  </Panel>
                );
                if (s.id === "product_specifics") return (
                  <Panel key={s.id} title={`${s.roman}. ${s.title}`} ticker="DRAFT">
                    <ICProductSpecifics cc={cc} />
                    <BulletOnlyMd text={aiMd} />
                  </Panel>
                );
                return (
                  <Panel key={s.id} title={`${s.roman}. ${s.title}`} ticker="DRAFT">
                    <BulletOnlyMd text={aiMd} />
                  </Panel>
                );
              })}
              <Panel title="RISK REGISTER" ticker="X.MIT">
                <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[360px]">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr><th className="text-left py-1">CATEGORY</th><th className="text-left">RISK</th><th className="text-left">MITIGANT</th><th>SEV</th></tr>
                  </thead>
                  <tbody>
                    {ic.risks?.map((r: { category: string; risk: string; mitigant: string; severity: string }, i: number) => (
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
                </div>
              </Panel>
              <Panel title="CONDITIONS PRECEDENT" ticker="CP">
                <ul className="text-xs space-y-1">
                  {ic.conditions_precedent?.map((c, i) => (
                    <li key={i} className="flex gap-2"><span className="text-warning">▸</span><span>{c}</span></li>
                  ))}
                </ul>
              </Panel>

              {ic.swot && (
                <Panel title="SWOT ANALYSIS" ticker="XIII · STRATEGIC">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Strengths */}
                    <div className="border border-success/30 bg-success/5 p-3 space-y-1.5">
                      <div className="text-[9px] tracking-widest text-success font-bold mb-2">+ STRENGTHS</div>
                      {ic.swot.strengths?.map((s, i) => (
                        <div key={i} className="flex gap-2 text-xs">
                          <span className="text-success font-bold shrink-0 mt-px">+</span>
                          <span className="text-foreground/90">{s}</span>
                        </div>
                      ))}
                    </div>
                    {/* Weaknesses */}
                    <div className="border border-destructive/30 bg-destructive/5 p-3 space-y-1.5">
                      <div className="text-[9px] tracking-widest text-destructive font-bold mb-2">− WEAKNESSES</div>
                      {ic.swot.weaknesses?.map((w, i) => (
                        <div key={i} className="flex gap-2 text-xs">
                          <span className="text-destructive font-bold shrink-0 mt-px">−</span>
                          <span className="text-foreground/90">{w}</span>
                        </div>
                      ))}
                    </div>
                    {/* Opportunities */}
                    <div className="border border-accent/30 bg-accent/5 p-3 space-y-1.5">
                      <div className="text-[9px] tracking-widest text-accent font-bold mb-2">+ OPPORTUNITIES</div>
                      {ic.swot.opportunities?.map((o, i) => (
                        <div key={i} className="flex gap-2 text-xs">
                          <span className="text-accent font-bold shrink-0 mt-px">+</span>
                          <span className="text-foreground/90">{o}</span>
                        </div>
                      ))}
                    </div>
                    {/* Threats */}
                    <div className="border border-warning/30 bg-warning/5 p-3 space-y-1.5">
                      <div className="text-[9px] tracking-widest text-warning font-bold mb-2">▲ THREATS</div>
                      {ic.swot.threats?.map((t, i) => (
                        <div key={i} className="flex gap-2 text-xs">
                          <span className="text-warning font-bold shrink-0 mt-px">▲</span>
                          <span className="text-foreground/90">{t}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Panel>
              )}
              <ICFinalRecommendation cc={cc} ratios={ratios} extracted={extracted} ic={ic!} />
              <DownloadBar onPdf={() => dlPdf(buildIcNoteHtml(cc, extracted, ratios, ic!), `${cc.case_code} IC Note`)} />
            </>
          )}
        </div>
      )}
      {tab === "emi" && (
        <EmiTracker cc={cc} payments={emiPayments} user={user!} onReload={reload} />
      )}
      {tab === "bank" && (
        <BankStatementTab cc={cc} data={bankData} docs={docs} user={user!} onReload={reload} />
      )}
      {tab === "gst" && (
        <GstTab cc={cc} data={gstData} extracted={extracted} user={user!} onReload={reload} docs={docs} />
      )}
    </TerminalLayout>
  );
}

// ─── Bank Statement Tab ───────────────────────────────────────────────────────
function BankStatementTab({ cc, data, docs, user, onReload }: { cc: CaseRow; data: Tables<"bank_statement_data">[]; docs: DocRow[]; user: { id: string }; onReload: () => Promise<void> }) {
  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState(0);
  const [label, setLabel]       = useState("");
  const [fileQueue, setFileQueue] = useState<UploadQueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editCell, setEditCell] = useState<{ id: string; field: string; value: string } | null>(null);
  const fileRef                 = useRef<HTMLInputElement>(null);

  const fmt = (v: number | null) => v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const fmtN = (v: number | null) => v == null ? null : v.toLocaleString("en-IN", { maximumFractionDigits: 0 });

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

// ─── GST Tab ─────────────────────────────────────────────────────────────────
function GstTab({ cc, data, extracted, user, onReload, docs }: { cc: CaseRow; data: Tables<"gst_return_data">[]; extracted: ExtractedRow[]; user: { id: string }; onReload: () => Promise<void>; docs: DocRow[] }) {
  const [busy, setBusy]           = useState(false);
  const [progress, setProgress]   = useState(0);
  const [label, setLabel]         = useState("");
  const [fileQueue, setFileQueue] = useState<UploadQueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const [editCell, setEditCell]   = useState<{ id: string; field: string; value: string } | null>(null);
  const fileRef                   = useRef<HTMLInputElement>(null);

  const fmt = (v: number | null) => v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const commitGstNum = async () => {
    if (!editCell) return;
    const snap = editCell;
    setEditCell(null);
    const raw = snap.value.trim().replace(/,/g, "");
    const num = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && (isNaN(num!) || !isFinite(num!))) return;
    await supabase.from("gst_return_data").update({ [snap.field]: num } as any).eq("id", snap.id);
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
      <span className="cursor-pointer hover:text-primary transition-colors"
        onClick={() => setEditCell({ id, field, value: val == null ? "" : String(val) })}>
        {fmt(val)}
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
      <span className={`cursor-pointer hover:text-primary transition-colors ${cls}`}
        onClick={() => setEditCell({ id, field, value: val ?? "" })}>
        {val ?? "—"}
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
      <span className={`cursor-pointer hover:underline decoration-dotted underline-offset-2 text-[9px] font-bold tracking-widest ${statusCls(val)}`}
        onClick={() => setEditCell({ id, field: "filing_status", value: val })}>
        {val.toUpperCase().replace("_", " ")}
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
      if (isExcel) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        excelText = wb.SheetNames.map(n => `=== SHEET: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t" })}`).join("\n\n");
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
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-gst`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${s2?.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ case_id: cc.id, document_id: doc.id, excel_text: excelText }),
      });
      clearInterval(tick);
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? `HTTP ${res.status}`); }
      const result = await res.json();
      setProgress(100); setLabel("Done");
      toast.success(`GST data extracted — ${result.periods_extracted} periods${result.gstin ? ` · GSTIN: ${result.gstin}` : ""}`);
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

  const statusCls = (s: string) => s === "filed" ? "text-success" : s === "late" ? "text-warning" : "text-destructive";

  return (
    <div className="space-y-3">
      {/* Upload */}
      <Panel title="GST RETURN UPLOAD" ticker="GSTR-1 / GSTR-3B / GSTR-9" status={data.length > 0 ? "live" : "idle"}
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
            <span className="text-primary font-bold">⬆ DROP GST RETURNS OR CLICK</span>
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
          <Panel title="GST PERIOD-WISE DETAILS" ticker="ALL RETURNS">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 pr-2">PERIOD</th>
                    <th className="text-left pr-2">TYPE</th>
                    <th className="text-right pr-2">TAXABLE</th>
                    <th className="text-right pr-2">EXEMPT</th>
                    <th className="text-right pr-2">TOTAL TURNOVER</th>
                    <th className="text-right pr-2">OUTPUT TAX</th>
                    <th className="text-right pr-2">ITC</th>
                    <th className="text-right pr-2">NET TAX</th>
                    <th className="text-center pr-2">STATUS</th>
                    <th className="text-left">FILED ON</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(row => (
                    <tr key={row.id} className="border-b border-border/30">
                      <td className="py-1 pr-2 font-medium">{gstTxtCell(row.id, "period", row.period)}</td>
                      <td className="pr-2 text-accent text-[10px]">{gstTxtCell(row.id, "return_type", row.return_type)}</td>
                      <td className="text-right pr-2 tabular-nums">{gstNumCell(row.id, "taxable_turnover", row.taxable_turnover)}</td>
                      <td className="text-right pr-2 tabular-nums text-muted-foreground">{gstNumCell(row.id, "exempt_turnover", row.exempt_turnover)}</td>
                      <td className="text-right pr-2 tabular-nums font-medium">{gstNumCell(row.id, "total_turnover", row.total_turnover)}</td>
                      <td className="text-right pr-2 tabular-nums text-warning">{gstNumCell(row.id, "output_tax", row.output_tax)}</td>
                      <td className="text-right pr-2 tabular-nums text-accent">{gstNumCell(row.id, "itc_claimed", row.itc_claimed)}</td>
                      <td className="text-right pr-2 tabular-nums font-bold">{gstNumCell(row.id, "net_tax_paid", row.net_tax_paid)}</td>
                      <td className="text-center pr-2">{gstStatusCell(row.id, row.filing_status)}</td>
                      <td className="text-muted-foreground text-[10px]">{gstTxtCell(row.id, "filing_date", row.filing_date ?? null)}</td>
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
    </div>
  );
}

// ─── EMI Tracker ─────────────────────────────────────────────────────────────
type EmiRow = Tables<"emi_payments">;

function calcEmiSchedule(principal: number, annualRatePct: number, tenureMonths: number, startDate: Date): Omit<EmiRow, "id"|"case_id"|"user_id"|"created_at"|"updated_at"|"status"|"paid_amount"|"paid_date"|"remarks">[] {
  const r = annualRatePct / 12 / 100;
  const emi = r === 0
    ? principal / tenureMonths
    : (principal * r * Math.pow(1 + r, tenureMonths)) / (Math.pow(1 + r, tenureMonths) - 1);
  const rows = [];
  let balance = principal;
  for (let i = 1; i <= tenureMonths; i++) {
    const interest = r === 0 ? 0 : balance * r;
    const principalComp = emi - interest;
    balance = Math.max(0, balance - principalComp);
    const due = new Date(startDate);
    due.setMonth(due.getMonth() + i);
    rows.push({
      emi_number: i,
      due_date: due.toISOString().split("T")[0],
      emi_amount: +emi.toFixed(2),
      principal_component: +principalComp.toFixed(2),
      interest_component: +interest.toFixed(2),
      outstanding_balance: +balance.toFixed(2),
    });
  }
  return rows;
}

function EmiTracker({ cc, payments, user, onReload }: { cc: CaseRow; payments: EmiRow[]; user: { id: string }; onReload: () => Promise<void> }) {
  const [principal, setPrincipal]   = useState(String(cc.deal_amount ?? ""));
  const [rate, setRate]             = useState(String(cc.expected_irr ?? ""));
  const [tenure, setTenure]         = useState(String(cc.tenure_months ?? ""));
  const [startDate, setStartDate]   = useState(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return d.toISOString().split("T")[0]; });
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [markingId, setMarkingId]   = useState<string | null>(null);
  const [editRemarks, setEditRemarks] = useState<{ id: string; val: string } | null>(null);

  const today = new Date().toISOString().split("T")[0];

  const hasSchedule = payments.length > 0;

  const paidCount    = payments.filter(p => p.status === "paid").length;
  const overdueCount = payments.filter(p => p.status !== "paid" && p.due_date < today).length;
  const pendingCount = payments.filter(p => p.status === "pending" && p.due_date >= today).length;
  const totalPaid    = payments.filter(p => p.status === "paid").reduce((s, p) => s + Number(p.paid_amount ?? p.emi_amount), 0);
  const totalEmi     = payments.reduce((s, p) => s + Number(p.emi_amount), 0);
  const nextDue      = payments.find(p => p.status !== "paid" && p.due_date >= today);
  const progressPct  = hasSchedule ? Math.round((paidCount / payments.length) * 100) : 0;

  const fmt = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  const generateSchedule = async () => {
    const P = Number(principal), r = Number(rate), n = Number(tenure);
    if (!P || !r || !n || !startDate) { toast.error("Fill principal, rate, tenure and start date"); return; }
    setGenerating(true);
    try {
      // Delete existing schedule first
      if (payments.length > 0) {
        await supabase.from("emi_payments").delete().eq("case_id", cc.id);
      }
      const schedule = calcEmiSchedule(P, r, n, new Date(startDate));
      const rows = schedule.map(s => ({ ...s, case_id: cc.id, user_id: user.id, status: "pending" }));
      // Insert in batches of 50
      for (let i = 0; i < rows.length; i += 50) {
        const { error } = await supabase.from("emi_payments").insert(rows.slice(i, i + 50) as never);
        if (error) throw error;
      }
      toast.success(`EMI schedule generated — ${n} instalments of ₹${fmt(rows[0]?.emi_amount ?? 0)} Cr`);
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate schedule");
    } finally { setGenerating(false); }
  };

  const markPaid = async (row: EmiRow, paidAmt?: number) => {
    setMarkingId(row.id);
    await supabase.from("emi_payments").update({
      status: "paid",
      paid_amount: paidAmt ?? row.emi_amount,
      paid_date: today,
    }).eq("id", row.id);
    await onReload();
    setMarkingId(null);
  };

  const markPending = async (id: string) => {
    setMarkingId(id);
    await supabase.from("emi_payments").update({ status: "pending", paid_amount: null, paid_date: null }).eq("id", id);
    await onReload();
    setMarkingId(null);
  };

  const saveRemarks = async (id: string, val: string) => {
    await supabase.from("emi_payments").update({ remarks: val || null }).eq("id", id);
    setEditRemarks(null);
    await onReload();
  };

  const statusCls = (row: EmiRow) => {
    if (row.status === "paid") return "text-success";
    if (row.due_date < today) return "text-destructive";
    return "text-warning";
  };
  const statusLabel = (row: EmiRow) => {
    if (row.status === "paid") return "PAID";
    if (row.due_date < today) return "OVERDUE";
    return "PENDING";
  };

  const inputCls = "bg-input border border-border px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-primary";

  return (
    <div className="space-y-3">
      {/* Setup panel */}
      <Panel title="EMI SCHEDULE SETUP" ticker="AMORTISATION" status={hasSchedule ? "live" : "idle"}>
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="terminal-label block mb-1">Principal (₹ Cr)</label>
            <input type="number" step="0.01" value={principal} onChange={e => setPrincipal(e.target.value)}
              placeholder={String(cc.deal_amount ?? "e.g. 5")} className={`${inputCls} w-28`} />
          </div>
          <div>
            <label className="terminal-label block mb-1">Annual Rate (%)</label>
            <input type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)}
              placeholder={String(cc.expected_irr ?? "e.g. 15")} className={`${inputCls} w-24`} />
          </div>
          <div>
            <label className="terminal-label block mb-1">Tenure (months)</label>
            <input type="number" value={tenure} onChange={e => setTenure(e.target.value)}
              placeholder={String(cc.tenure_months ?? "e.g. 36")} className={`${inputCls} w-24`} />
          </div>
          <div>
            <label className="terminal-label block mb-1">First EMI Due</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`${inputCls} w-36`} />
          </div>
          <button
            onClick={generateSchedule}
            disabled={generating}
            className="bg-primary text-primary-foreground px-4 py-1.5 text-xs tracking-widest font-bold hover:opacity-90 disabled:opacity-40"
          >{generating ? "GENERATING…" : hasSchedule ? "[REGENERATE SCHEDULE]" : "[GENERATE SCHEDULE]"}</button>
          {hasSchedule && (
            <button
              onClick={async () => {
                if (!window.confirm(`Delete all ${payments.length} EMI records for this case? This cannot be undone.`)) return;
                setDeleting(true);
                await supabase.from("emi_payments").delete().eq("case_id", cc.id);
                toast.success("EMI schedule deleted");
                await onReload();
                setDeleting(false);
              }}
              disabled={deleting}
              className="border border-destructive/50 text-destructive/80 px-4 py-1.5 text-xs tracking-widest font-bold hover:bg-destructive/10 hover:border-destructive disabled:opacity-40"
            >{deleting ? "DELETING…" : "[DELETE SCHEDULE]"}</button>
          )}
        </div>
        {Number(principal) > 0 && Number(rate) > 0 && Number(tenure) > 0 && (() => {
          const r = Number(rate) / 12 / 100;
          const n = Number(tenure);
          const P = Number(principal);
          const emi = r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
          const total = emi * n;
          return (
            <div className="mt-3 flex gap-6 text-xs border-t border-border/40 pt-3">
              <div><div className="terminal-label">MONTHLY EMI</div><div className="text-primary font-bold text-sm mt-0.5">₹{fmt(emi)} Cr</div></div>
              <div><div className="terminal-label">TOTAL OUTFLOW</div><div className="text-primary font-bold text-sm mt-0.5">₹{fmt(total)} Cr</div></div>
              <div><div className="terminal-label">TOTAL INTEREST</div><div className="text-warning font-bold text-sm mt-0.5">₹{fmt(total - P)} Cr</div></div>
            </div>
          );
        })()}
      </Panel>

      {/* Summary cards */}
      {hasSchedule && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Panel title="PROGRESS" ticker={`${progressPct}%`} status="live">
            <div className="text-2xl font-bold text-primary">{paidCount}<span className="text-sm text-muted-foreground">/{payments.length}</span></div>
            <div className="terminal-label mt-1">EMIs PAID</div>
            <div className="mt-2 h-1.5 bg-border overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </Panel>
          <Panel title="OVERDUE" ticker="ACTION NEEDED" status={overdueCount > 0 ? "idle" : "live"}>
            <div className={`text-2xl font-bold ${overdueCount > 0 ? "text-destructive" : "text-success"}`}>{overdueCount}</div>
            <div className="terminal-label mt-1">EMIs OVERDUE</div>
          </Panel>
          <Panel title="TOTAL COLLECTED" ticker="RECEIVED">
            <div className="text-2xl font-bold text-success">₹{fmt(totalPaid)}</div>
            <div className="terminal-label mt-1">of ₹{fmt(totalEmi)} Cr</div>
          </Panel>
          <Panel title="NEXT DUE" ticker={nextDue ? nextDue.due_date : "—"} status={nextDue && nextDue.due_date < today ? "idle" : "warn"}>
            <div className="text-lg font-bold text-primary">{nextDue ? `EMI #${nextDue.emi_number}` : "ALL PAID"}</div>
            <div className="terminal-label mt-1">{nextDue ? `₹${fmt(nextDue.emi_amount)} Cr` : "Schedule complete"}</div>
          </Panel>
        </div>
      )}

      {/* Schedule table */}
      {hasSchedule && (
        <Panel title="REPAYMENT SCHEDULE" ticker={`${payments.length} INSTALMENTS`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 pr-2">#</th>
                  <th className="text-left pr-2">DUE DATE</th>
                  <th className="text-right pr-2">EMI AMT</th>
                  <th className="text-right pr-2">PRINCIPAL</th>
                  <th className="text-right pr-2">INTEREST</th>
                  <th className="text-right pr-2">BALANCE</th>
                  <th className="text-center pr-2">STATUS</th>
                  <th className="text-left pr-2">PAID ON</th>
                  <th className="text-left">REMARKS</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {payments.map(row => {
                  const isOverdue = row.status !== "paid" && row.due_date < today;
                  return (
                    <tr key={row.id} className={`border-b border-border/30 group ${isOverdue ? "bg-destructive/5" : row.status === "paid" ? "opacity-60" : ""}`}>
                      <td className="py-1 pr-2 text-muted-foreground">{row.emi_number}</td>
                      <td className="pr-2">{row.due_date}</td>
                      <td className="text-right pr-2 tabular-nums font-medium">₹{fmt(row.emi_amount)}</td>
                      <td className="text-right pr-2 tabular-nums text-success">₹{fmt(row.principal_component)}</td>
                      <td className="text-right pr-2 tabular-nums text-warning">₹{fmt(row.interest_component)}</td>
                      <td className="text-right pr-2 tabular-nums">₹{fmt(row.outstanding_balance)}</td>
                      <td className="text-center pr-2">
                        <span className={`text-[9px] font-bold tracking-widest ${statusCls(row)}`}>{statusLabel(row)}</span>
                      </td>
                      <td className="pr-2 text-muted-foreground">{row.paid_date ?? "—"}</td>
                      <td className="pr-2">
                        {editRemarks?.id === row.id ? (
                          <input
                            autoFocus
                            value={editRemarks.val}
                            onChange={e => setEditRemarks({ id: row.id, val: e.target.value })}
                            onBlur={() => saveRemarks(row.id, editRemarks.val)}
                            onKeyDown={e => { if (e.key === "Enter") saveRemarks(row.id, editRemarks.val); if (e.key === "Escape") setEditRemarks(null); }}
                            className="bg-input border border-primary px-1 text-primary text-xs w-28 outline-none"
                          />
                        ) : (
                          <span
                            className="text-muted-foreground cursor-pointer hover:text-primary"
                            onClick={() => setEditRemarks({ id: row.id, val: row.remarks ?? "" })}
                          >{row.remarks || <span className="text-border/60 text-[10px]">add note…</span>}</span>
                        )}
                      </td>
                      <td className="text-right">
                        {markingId === row.id ? (
                          <span className="text-[9px] text-muted-foreground">…</span>
                        ) : row.status === "paid" ? (
                          <button onClick={() => markPending(row.id)} className="text-[9px] border border-border text-muted-foreground px-2 py-0.5 hover:text-foreground opacity-0 group-hover:opacity-100">UNDO</button>
                        ) : (
                          <button onClick={() => markPaid(row)} className="text-[9px] bg-success/10 border border-success/40 text-success px-2 py-0.5 hover:bg-success/20 tracking-widest">MARK PAID</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ─── Download helpers ────────────────────────────────────────────────────────

async function dlExcel(
  sheets: { name: string; rows: (string | number | null | undefined)[][] }[],
  filename: string,
) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

function dlPdf(html: string, title: string) {
  const win = window.open("", "_blank", "width=1000,height=800");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Courier New",monospace;font-size:10px;color:#000;background:#fff;padding:24px 32px}
    h1{font-size:14px;font-weight:bold;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:16px;letter-spacing:2px;text-transform:uppercase}
    h2{font-size:11px;font-weight:bold;margin:18px 0 6px;padding:4px 8px;background:#000;color:#fff;letter-spacing:1px;text-transform:uppercase}
    h3{font-size:10px;font-weight:bold;margin:10px 0 4px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #ccc;padding-bottom:2px}
    table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:9px}
    th{text-align:left;border-bottom:2px solid #000;padding:3px 8px;font-weight:bold;text-transform:uppercase;font-size:8px;letter-spacing:0.5px}
    td{border-bottom:1px dashed #ddd;padding:3px 8px;vertical-align:top}
    .meta{display:flex;gap:32px;margin-bottom:16px;font-size:9px;border-bottom:1px solid #ccc;padding-bottom:10px}
    .mi .lbl{font-size:8px;text-transform:uppercase;color:#666;letter-spacing:0.5px}
    .mi .val{font-weight:bold;font-size:11px}
    ul{list-style:none;padding:0}
    li{margin-bottom:3px;padding-left:14px;position:relative;font-size:9px}
    li::before{content:">";position:absolute;left:0;color:#666}
    .pass{color:#16a34a;font-weight:bold}
    .fail{color:#dc2626;font-weight:bold}
    .caution{color:#d97706;font-weight:bold}
    .sec{margin-bottom:20px;page-break-inside:avoid}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:8px}
    .lbl{font-size:8px;text-transform:uppercase;color:#666;letter-spacing:0.5px;margin-bottom:1px}
    .val{font-size:10px}
    .disc{font-size:8px;color:#999;border-top:1px solid #ccc;margin-top:20px;padding-top:8px;font-style:italic}
    @media print{body{padding:10px 14px}}
  </style></head><body>${html}<div class="disc">AI-GENERATED DRAFT — REQUIRES ANALYST REVIEW. NO CREDIT RECOMMENDATION IS MADE BY AI. © REHBAR FINANCIAL SERVICES</div></body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

function DownloadBar({ onExcel, onPdf }: { onExcel?: () => void; onPdf?: () => void }) {
  return (
    <div className="flex items-center gap-2 pt-3 mt-1 border-t border-border/40">
      <span className="text-[10px] text-muted-foreground tracking-widest">↓ DOWNLOAD</span>
      {onExcel && (
        <button onClick={onExcel} className="text-[10px] border border-border text-primary px-3 py-1 hover:bg-primary/10 tracking-widest font-bold">
          [EXCEL]
        </button>
      )}
      {onPdf && (
        <button onClick={onPdf} className="text-[10px] border border-border text-primary px-3 py-1 hover:bg-primary/10 tracking-widest font-bold">
          [PDF]
        </button>
      )}
    </div>
  );
}

// ─── ICFinalRecommendation ───────────────────────────────────────────────────
function ICFinalRecommendation({ cc, ratios, extracted, ic }: {
  cc: CaseRow;
  ratios: RatioRow[];
  extracted: ExtractedRow[];
  ic: { sections: Record<string, { markdown: string }>; risks: Array<{ category: string; risk: string; mitigant: string; severity: string }>; conditions_precedent: string[]; swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] } };
}) {
  const histYears = Array.from(new Set(extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year))).sort();
  const lastFy = histYears[histYears.length - 1];
  const unit = extracted.find(r => r.unit)?.unit ?? "";
  const abbr = unitAbbr(unit);

  const getVal = (fy: number, label: string): number | null => {
    for (const row of extracted.filter(r => r.fiscal_year === fy && r.statement_type !== "projections")) {
      const it = (row.line_items as unknown as LineItem[]).find(i => i.label === label);
      if (it) { const v = it.override_value ?? it.value; return v !== null && Number.isFinite(Number(v)) ? Number(v) : null; }
    }
    return null;
  };

  const fmt = (v: number | null) => v === null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const pct = (v: number | null) => v === null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";

  // Ratio scorecard
  const latestRatioMap = new Map<string, RatioRow>();
  for (const r of ratios) {
    const existing = latestRatioMap.get(r.ratio_name);
    if (!existing || r.fiscal_year > existing.fiscal_year) latestRatioMap.set(r.ratio_name, r);
  }
  const latestRatios = Array.from(latestRatioMap.values());
  const greenCount = latestRatios.filter(r => r.threshold_status === "green").length;
  const amberCount = latestRatios.filter(r => r.threshold_status === "amber").length;
  const redCount   = latestRatios.filter(r => r.threshold_status === "red").length;
  const total = greenCount + amberCount + redCount;

  const verdict = total === 0
    ? "AWAITING RATIO ANALYSIS"
    : redCount >= 3 ? "NOT RECOMMENDED"
    : redCount >= 1 || amberCount >= 3 ? "CONDITIONAL APPROVAL"
    : "RECOMMEND APPROVAL";

  const verdictColor = verdict === "NOT RECOMMENDED" ? "text-destructive border-destructive/40 bg-destructive/5"
    : verdict === "CONDITIONAL APPROVAL" ? "text-warning border-warning/40 bg-warning/5"
    : verdict === "RECOMMEND APPROVAL" ? "text-success border-success/40 bg-success/5"
    : "text-muted-foreground border-border bg-muted/10";

  // Key financial snapshot (latest year)
  const turnover = lastFy ? getVal(lastFy, "Turnover") : null;
  const ebitda   = lastFy ? getVal(lastFy, "EBITDA") : null;
  const pat      = lastFy ? getVal(lastFy, "PAT") : null;
  const nw       = lastFy ? getVal(lastFy, "Net Worth") : null;
  const td       = lastFy ? getVal(lastFy, "Total Debt") : null;
  const ebitdaMgn = turnover && ebitda ? (ebitda / turnover) * 100 : null;
  const patMgn    = turnover && pat    ? (pat    / turnover) * 100 : null;
  const de        = nw && nw !== 0 && td ? td / nw : null;
  const intExp    = lastFy ? getVal(lastFy, "Interest Expense") : null;
  const icr       = ebitda && intExp && intExp > 0 ? ebitda / intExp : null;

  // Revenue CAGR
  const firstFy = histYears[0];
  const rev0 = firstFy ? getVal(firstFy, "Turnover") : null;
  const revN = lastFy  ? getVal(lastFy,  "Turnover") : null;
  const nYrs = histYears.length - 1;
  const revCAGR = rev0 && revN && nYrs > 0 && rev0 > 0 ? (Math.pow(revN / rev0, 1 / nYrs) - 1) * 100 : null;

  // Strengths & concerns from ratios
  const strengths = latestRatios.filter(r => r.threshold_status === "green").map(r => RATIO_DISPLAY_NAMES[r.ratio_name] ?? r.ratio_name);
  const concerns  = latestRatios.filter(r => r.threshold_status === "red").map(r => RATIO_DISPLAY_NAMES[r.ratio_name] ?? r.ratio_name);
  const cautions  = latestRatios.filter(r => r.threshold_status === "amber").map(r => RATIO_DISPLAY_NAMES[r.ratio_name] ?? r.ratio_name);

  // AI exec recommendation from visit_reference section
  const execAi = ic.sections["visit_reference"]?.markdown ?? "";

  const metricRow = (label: string, value: string | null, note?: string) =>
    value ? (
      <div key={label} className="flex items-baseline justify-between gap-2 py-0.5 border-b border-border/20">
        <span className="text-foreground/60 text-[10px]">{label}</span>
        <div className="text-right">
          <span className="text-primary tabular-nums text-xs font-medium">{value}</span>
          {note && <span className="text-muted-foreground text-[9px] ml-1.5">{note}</span>}
        </div>
      </div>
    ) : null;

  return (
    <Panel title="FINAL CREDIT RECOMMENDATION" ticker="IC DECISION" status={redCount >= 3 ? "idle" : amberCount >= 3 || redCount >= 1 ? "warn" : "live"}>
      <div className="space-y-4">
        {/* Disclaimer */}
        <div className="text-[9px] text-warning/80 tracking-wider border border-warning/30 bg-warning/5 px-2 py-1.5">
          ⚠ AI-ASSISTED ANALYSIS · FINAL DECISION RESTS WITH INVESTMENT COMMITTEE · NOT A SUBSTITUTE FOR ANALYST JUDGEMENT
        </div>

        {/* Verdict */}
        <div className={`border px-4 py-3 text-center ${verdictColor}`}>
          <div className="text-xl font-bold tracking-widest">{verdict}</div>
          <div className="text-[10px] mt-1 opacity-70">{cc.client_name} · {cc.product_type.replace(/_/g, " ").toUpperCase()} · ₹{cc.deal_amount ?? "—"} Cr · {cc.tenure_months ?? "—"}M · {cc.expected_irr ?? "—"}% IRR</div>
        </div>

        {/* Ratio scorecard */}
        {total > 0 && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="border border-success/30 bg-success/5 py-2">
              <div className="text-xl font-bold text-success">{greenCount}</div>
              <div className="text-[8px] text-success/70 tracking-widest">RATIOS PASS</div>
            </div>
            <div className="border border-warning/30 bg-warning/5 py-2">
              <div className="text-xl font-bold text-warning">{amberCount}</div>
              <div className="text-[8px] text-warning/70 tracking-widest">RATIOS CAUTION</div>
            </div>
            <div className="border border-destructive/30 bg-destructive/5 py-2">
              <div className="text-xl font-bold text-destructive">{redCount}</div>
              <div className="text-[8px] text-destructive/70 tracking-widest">RATIOS FAIL</div>
            </div>
          </div>
        )}

        {/* Financial snapshot */}
        {lastFy && (
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-1.5">KEY FINANCIAL SNAPSHOT · FY{lastFy}{unit ? ` · ₹ ${unit}` : ""}</div>
            <div className="space-y-0">
              {metricRow("Revenue (Turnover)", turnover ? fmt(turnover) + (abbr ? ` ${abbr}` : "") : null)}
              {metricRow("EBITDA Margin", ebitdaMgn ? pct(ebitdaMgn) : null, ebitda ? `(${fmt(ebitda)}${abbr ? ` ${abbr}` : ""})` : undefined)}
              {metricRow("PAT Margin", patMgn ? pct(patMgn) : null, pat ? `(${fmt(pat)}${abbr ? ` ${abbr}` : ""})` : undefined)}
              {metricRow("Debt / Equity", de ? de.toFixed(2) + "x" : null, de !== null ? (de <= 1.5 ? "Conservative" : de <= 3 ? "Moderate" : "High leverage") : undefined)}
              {metricRow("Interest Coverage", icr ? icr.toFixed(2) + "x" : null, icr !== null ? (icr >= 3 ? "Comfortable" : icr >= 1.5 ? "Adequate" : "Tight") : undefined)}
              {metricRow("Revenue CAGR", revCAGR !== null ? pct(revCAGR) : null, histYears.length >= 2 ? `FY${firstFy}–FY${lastFy}` : undefined)}
            </div>
          </div>
        )}

        {/* Strengths & Concerns */}
        <div className="grid grid-cols-2 gap-3">
          {strengths.length > 0 && (
            <div>
              <div className="text-[9px] text-success tracking-widest mb-1.5">+ FINANCIAL STRENGTHS</div>
              <div className="space-y-1">
                {strengths.map((s, i) => (
                  <div key={i} className="flex gap-1.5 text-[10px]">
                    <span className="text-success shrink-0">✓</span>
                    <span className="text-foreground/80">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(concerns.length > 0 || cautions.length > 0) && (
            <div>
              {concerns.length > 0 && (
                <>
                  <div className="text-[9px] text-destructive tracking-widest mb-1.5">✕ RED FLAGS</div>
                  <div className="space-y-1 mb-2">
                    {concerns.map((c, i) => (
                      <div key={i} className="flex gap-1.5 text-[10px]">
                        <span className="text-destructive shrink-0">✕</span>
                        <span className="text-foreground/80">{c}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {cautions.length > 0 && (
                <>
                  <div className="text-[9px] text-warning tracking-widest mb-1.5">▲ WATCH ITEMS</div>
                  <div className="space-y-1">
                    {cautions.map((c, i) => (
                      <div key={i} className="flex gap-1.5 text-[10px]">
                        <span className="text-warning shrink-0">▲</span>
                        <span className="text-foreground/80">{c}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Conditions Precedent */}
        {ic.conditions_precedent?.length > 0 && (
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-1.5">CONDITIONS PRECEDENT</div>
            <div className="space-y-0.5">
              {ic.conditions_precedent.map((c, i) => (
                <div key={i} className="flex gap-1.5 text-[10px]">
                  <span className="text-accent shrink-0">▸</span>
                  <span className="text-foreground/80">{c}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI exec text from visit_reference */}
        {execAi && (
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-1.5">ANALYST OBSERVATIONS</div>
            <BulletOnlyMd text={execAi} />
          </div>
        )}
      </div>
    </Panel>
  );
}

// ─── StatementInsights ───────────────────────────────────────────────────────
function StatementInsights({ type, typeRows, years, unit }: {
  type: string;
  typeRows: ExtractedRow[];
  years: number[];
  unit: string | null | undefined;
}) {
  if (years.length === 0) return null;

  const abbr = unit ? ` ${unit}` : "";

  const getVal = (fy: number, label: string): number | null => {
    const row = typeRows.find(r => r.fiscal_year === fy);
    if (!row) return null;
    const it = (row.line_items as unknown as LineItem[]).find(i => i.label === label);
    if (!it) return null;
    const v = it.override_value ?? it.value;
    return (v !== null && Number.isFinite(Number(v))) ? Number(v) : null;
  };

  const fmt = (v: number | null, dp = 1) =>
    v === null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: dp });

  const pct = (v: number | null) => v === null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";

  const cagr = (first: number | null, last: number | null, n: number) =>
    first && last && n > 0 && first > 0 ? (Math.pow(last / first, 1 / n) - 1) * 100 : null;

  const yoy = (prev: number | null, curr: number | null) =>
    prev && curr && prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : null;

  type Insight = { label: string; value: string; status: "green" | "amber" | "red" | "neutral"; note: string };
  const insights: Insight[] = [];

  const firstFy = years[0];
  const lastFy = years[years.length - 1];
  const nYears = years.length - 1;
  const prevFy = years.length >= 2 ? years[years.length - 2] : null;

  if (type === "profit_loss") {
    const rev0 = getVal(firstFy, "Turnover"), revN = getVal(lastFy, "Turnover");
    const revCAGR = cagr(rev0, revN, nYears);
    const revYOY = prevFy ? yoy(getVal(prevFy, "Turnover"), revN) : null;
    if (revCAGR !== null) insights.push({
      label: "Revenue CAGR", value: pct(revCAGR),
      status: revCAGR >= 10 ? "green" : revCAGR >= 0 ? "amber" : "red",
      note: `FY${firstFy}→FY${lastFy}: ${fmt(rev0)}→${fmt(revN)}${abbr}`,
    });
    if (revYOY !== null && prevFy) insights.push({
      label: `Revenue YoY (FY${prevFy}→${lastFy})`, value: pct(revYOY),
      status: revYOY >= 10 ? "green" : revYOY >= 0 ? "amber" : "red",
      note: revYOY > 0 ? "Positive growth momentum" : "Revenue contracted — monitor closely",
    });

    const ebitda = getVal(lastFy, "EBITDA"), turnover = getVal(lastFy, "Turnover");
    const ebitdaMgn = ebitda && turnover ? (ebitda / turnover) * 100 : null;
    if (ebitdaMgn !== null) insights.push({
      label: "EBITDA Margin (latest)", value: pct(ebitdaMgn),
      status: ebitdaMgn >= 15 ? "green" : ebitdaMgn >= 8 ? "amber" : "red",
      note: ebitdaMgn >= 15 ? "Healthy operating profitability" : ebitdaMgn >= 8 ? "Moderate margins — scope for improvement" : "Thin margins — cost structure review needed",
    });

    const pat = getVal(lastFy, "PAT"), pat0 = getVal(firstFy, "PAT");
    const patMgn = pat && turnover ? (pat / turnover) * 100 : null;
    if (patMgn !== null) insights.push({
      label: "PAT Margin (latest)", value: pct(patMgn),
      status: patMgn >= 8 ? "green" : patMgn >= 3 ? "amber" : "red",
      note: patMgn >= 8 ? "Strong net profitability" : patMgn >= 3 ? "Modest net margins" : "Low net margins — check interest burden & tax",
    });
    const patCAGR = cagr(pat0, pat, nYears);
    if (patCAGR !== null) insights.push({
      label: "PAT CAGR", value: pct(patCAGR),
      status: patCAGR >= 10 ? "green" : patCAGR >= 0 ? "amber" : "red",
      note: `Profit growth ${patCAGR >= 10 ? "outpacing" : patCAGR >= 0 ? "tracking" : "lagging"} revenue`,
    });

    const intExp = getVal(lastFy, "Interest Expense");
    const icr = ebitda && intExp && intExp > 0 ? ebitda / intExp : null;
    if (icr !== null) insights.push({
      label: "Interest Coverage (EBITDA/Int)", value: icr.toFixed(2) + "x",
      status: icr >= 3 ? "green" : icr >= 1.5 ? "amber" : "red",
      note: icr >= 3 ? "Comfortable debt service capacity" : icr >= 1.5 ? "Adequate but watch leverage" : "Tight coverage — high repayment risk",
    });
  }

  if (type === "balance_sheet") {
    const nw = getVal(lastFy, "Net Worth"), nw0 = getVal(firstFy, "Net Worth");
    const nwCAGR = cagr(nw0, nw, nYears);
    if (nwCAGR !== null) insights.push({
      label: "Net Worth CAGR", value: pct(nwCAGR),
      status: nwCAGR >= 10 ? "green" : nwCAGR >= 0 ? "amber" : "red",
      note: `FY${firstFy}→FY${lastFy}: ${fmt(nw0)}→${fmt(nw)}${abbr}`,
    });

    const ltd = getVal(lastFy, "Long Term Borrowings"), std = getVal(lastFy, "Short Term Borrowings");
    const td = getVal(lastFy, "Total Debt") ?? ((ltd ?? 0) + (std ?? 0));
    if (nw && nw !== 0) {
      const de = td / nw;
      insights.push({
        label: "Debt / Equity (latest)", value: de.toFixed(2) + "x",
        status: de <= 1.5 ? "green" : de <= 3 ? "amber" : "red",
        note: de <= 1.5 ? "Conservative leverage" : de <= 3 ? "Moderate leverage — monitor" : "High leverage — elevated financial risk",
      });
    }

    const ca = getVal(lastFy, "Current Assets"), cl = getVal(lastFy, "Current Liabilities");
    if (ca && cl && cl !== 0) {
      const cr = ca / cl;
      insights.push({
        label: "Current Ratio (latest)", value: cr.toFixed(2) + "x",
        status: cr >= 1.5 ? "green" : cr >= 1 ? "amber" : "red",
        note: cr >= 1.5 ? "Healthy short-term liquidity" : cr >= 1 ? "Tight liquidity — watch working capital" : "Current liabilities exceed current assets",
      });
    }

    const ta = getVal(lastFy, "Total Assets");
    if (ta && nw) {
      const roa = (getVal(lastFy, "PAT") ?? 0) / ta * 100;
      if (roa !== 0) insights.push({
        label: "Return on Assets (latest)", value: pct(roa),
        status: roa >= 5 ? "green" : roa >= 2 ? "amber" : "red",
        note: roa >= 5 ? "Efficient asset utilisation" : roa >= 2 ? "Moderate asset returns" : "Assets generating low returns",
      });
    }

    const tdYOY = prevFy ? yoy(getVal(prevFy, "Total Debt"), td) : null;
    if (tdYOY !== null) insights.push({
      label: `Debt Growth YoY (FY${prevFy}→${lastFy})`, value: pct(tdYOY),
      status: tdYOY <= 0 ? "green" : tdYOY <= 15 ? "amber" : "red",
      note: tdYOY <= 0 ? "Debt reducing — positive deleveraging" : tdYOY <= 15 ? "Moderate debt build-up" : "Rapid debt growth — assess repayment capacity",
    });
  }

  if (type === "cash_flow") {
    const cfo = getVal(lastFy, "Cash from Operations");
    const cfi = getVal(lastFy, "Cash from Investing");
    const cff = getVal(lastFy, "Cash from Financing");
    if (cfo !== null) insights.push({
      label: "Operating Cash Flow (latest)", value: fmt(cfo) + abbr,
      status: cfo > 0 ? "green" : "red",
      note: cfo > 0 ? "Business generating positive operating cash" : "Negative operating cash — working capital strain or losses",
    });
    if (cfi !== null) insights.push({
      label: "Investing Cash Flow (latest)", value: fmt(cfi) + abbr,
      status: cfi < 0 ? "green" : "amber",
      note: cfi < 0 ? "Investing in growth (capex/acquisitions)" : "Positive — asset disposals or low capex",
    });
    if (cff !== null) insights.push({
      label: "Financing Cash Flow (latest)", value: fmt(cff) + abbr,
      status: "neutral",
      note: cff > 0 ? "Net borrowing or capital raised" : "Debt repayment / dividend outflows",
    });
    if (cfo !== null && cfi !== null) {
      const fcf = cfo + cfi;
      insights.push({
        label: "Free Cash Flow (CFO + CFI)", value: fmt(fcf) + abbr,
        status: fcf > 0 ? "green" : "red",
        note: fcf > 0 ? "Positive FCF — able to service debt from operations" : "Negative FCF — reliant on external financing",
      });
    }
  }

  if (type === "projections") {
    const rev0p = getVal(years[0], "Projected Turnover"), revNp = getVal(lastFy, "Projected Turnover");
    const projCAGR = cagr(rev0p, revNp, nYears);
    if (projCAGR !== null) insights.push({
      label: "Projected Revenue CAGR", value: pct(projCAGR),
      status: projCAGR >= 10 ? "green" : projCAGR >= 5 ? "amber" : "red",
      note: projCAGR >= 20 ? "Aggressive growth — validate assumptions carefully" : projCAGR >= 10 ? "Realistic growth trajectory" : "Conservative projections",
    });

    const pebitda = getVal(lastFy, "Projected EBITDA"), prev = getVal(lastFy, "Projected Turnover");
    const pemgn = pebitda && prev ? (pebitda / prev) * 100 : null;
    if (pemgn !== null) insights.push({
      label: "Projected EBITDA Margin (terminal)", value: pct(pemgn),
      status: pemgn >= 15 ? "green" : pemgn >= 8 ? "amber" : "red",
      note: pemgn >= 15 ? "Strong projected profitability" : "Validate margin expansion assumptions",
    });

    const ppat = getVal(lastFy, "Projected PAT"), pnw = getVal(lastFy, "Projected Net Worth");
    if (ppat && pnw && pnw !== 0) {
      const roe = (ppat / pnw) * 100;
      insights.push({
        label: "Projected ROE (terminal)", value: pct(roe),
        status: roe >= 15 ? "green" : roe >= 8 ? "amber" : "red",
        note: roe >= 15 ? "Attractive return on equity projected" : "Moderate projected returns",
      });
    }
  }

  if (insights.length === 0) return null;

  const colorMap = {
    green: { bg: "bg-success/10", border: "border-success/30", text: "text-success", dot: "bg-success" },
    amber: { bg: "bg-warning/10", border: "border-warning/30", text: "text-warning", dot: "bg-warning" },
    red:   { bg: "bg-destructive/10", border: "border-destructive/30", text: "text-destructive", dot: "bg-destructive" },
    neutral:{ bg: "bg-muted/20", border: "border-border/40", text: "text-foreground/70", dot: "bg-muted-foreground" },
  };

  const counts = { green: insights.filter(i => i.status === "green").length, amber: insights.filter(i => i.status === "amber").length, red: insights.filter(i => i.status === "red").length };
  const verdict = counts.red >= 2 ? "CONCERNS FLAGGED" : counts.red === 1 || counts.amber >= 3 ? "REVIEW REQUIRED" : "FINANCIALS HEALTHY";
  const verdictColor = counts.red >= 2 ? "text-destructive" : counts.red === 1 || counts.amber >= 3 ? "text-warning" : "text-success";

  return (
    <div className="mt-4 border border-border/50 bg-card/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[9px] tracking-widest text-muted-foreground">ANALYST INSIGHTS</div>
        <div className={`text-[10px] font-bold tracking-widest ${verdictColor}`}>{verdict}</div>
      </div>
      <div className="flex gap-2 text-[9px] tracking-widest">
        <span className="text-success">{counts.green} PASS</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-warning">{counts.amber} REVIEW</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-destructive">{counts.red} CONCERN</span>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {insights.map((ins, i) => {
          const c = colorMap[ins.status];
          return (
            <div key={i} className={`flex items-start gap-2 border ${c.border} ${c.bg} px-2 py-1.5 rounded-sm`}>
              <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${c.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-foreground/80">{ins.label}</span>
                  <span className={`text-[11px] font-bold tabular-nums shrink-0 ${c.text}`}>{ins.value}</span>
                </div>
                <div className="text-[9px] text-muted-foreground mt-0.5">{ins.note}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildIcNoteHtml(
  cc: CaseRow,
  extracted: ExtractedRow[],
  ratios: RatioRow[],
  ic: { sections: Record<string,{markdown:string}>; risks: Array<{category:string;risk:string;mitigant:string;severity:string}>; conditions_precedent: string[]; swot?: {strengths:string[];weaknesses:string[];opportunities:string[];threats:string[]} },
): string {
  const product = PRODUCTS[cc.product_type];
  const fyYears = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const ratioGroups = Array.from(new Set(ratios.map(r => r.category)));
  const histExtracted = extracted.filter(r => r.statement_type !== "projections");
  const histYears = Array.from(new Set(histExtracted.map(r => r.fiscal_year))).sort();
  const projRows = extracted.filter(r => r.statement_type === "projections");
  const projYears = Array.from(new Set(projRows.map(r => r.fiscal_year))).sort();
  const unit = extracted.find(r => r.unit)?.unit ?? "";
  const ul = unit ? `₹ ${unit}` : "₹";

  const bul = (md: string) => {
    const items = md.split("\n").filter(l => /^[-*]\s/.test(l.trim())).map(l => l.trim().replace(/^[-*]\s+/,""));
    return items.length ? `<ul>${items.map(b=>`<li>${b}</li>`).join("")}</ul>` : "";
  };
  const tblRow = (label: string, ...vals: (string|number|null|undefined)[]) =>
    `<tr><td class="lbl">${label}</td>${vals.map(v=>`<td>${v??'—'}</td>`).join("")}</tr>`;
  const dataTable = (headers: string[], rows: (string|number|null|undefined)[][], caption?: string) =>
    `${caption?`<h3>${caption}</h3>`:""}<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??'—'}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

  const KEY_RATIOS = ["dscr","current_ratio","debt_to_equity","interest_coverage","ebitda_margin","roe"];

  let h = `<h1>${cc.client_name} — IC APPRAISAL NOTE</h1>
<div class="meta">
  <div class="mi"><div class="lbl">Case</div><div class="val">${cc.case_code}</div></div>
  <div class="mi"><div class="lbl">Amount</div><div class="val">₹${cc.deal_amount??'—'} Cr</div></div>
  <div class="mi"><div class="lbl">Tenure</div><div class="val">${cc.tenure_months??'—'}M</div></div>
  <div class="mi"><div class="lbl">IRR</div><div class="val">${cc.expected_irr??'—'}%</div></div>
  <div class="mi"><div class="lbl">Product</div><div class="val">${product.label}</div></div>
  <div class="mi"><div class="lbl">Industry</div><div class="val">${cc.industry??'—'}</div></div>
</div>`;

  // ── I. Executive Summary ──────────────────────────────────────────────────
  h += `<div class="sec"><h2>I. Executive Summary</h2>`;
  h += `<table><tbody>
    ${tblRow("Client", cc.client_name, "Product", product.label)}
    ${tblRow("Amount", `₹${cc.deal_amount??'—'} Cr`, "Tenure", `${cc.tenure_months??'—'}M`)}
    ${tblRow("IRR", `${cc.expected_irr??'—'}%`, "Industry", cc.industry)}
    ${cc.end_use?tblRow("End Use","<i>"+cc.end_use+"</i>"):""}
  </tbody></table>`;
  if (fyYears.length > 0 && KEY_RATIOS.some(n => ratios.find(r=>r.ratio_name===n))) {
    h += dataTable(["Ratio",...fyYears.map(y=>`FY${y}`),"Benchmark","Status"],
      KEY_RATIOS.flatMap(name => {
        const rows = ratios.filter(r=>r.ratio_name===name);
        if (!rows.length) return [];
        const latest = rows.sort((a,b)=>b.fiscal_year-a.fiscal_year)[0];
        const s = latest.threshold_status??"na";
        const cls = s==="green"?"✓":s==="red"?"✗":s==="amber"?"~":"—";
        return [[`${RATIO_DISPLAY_NAMES[name]??name} ${cls}`,...fyYears.map(y=>{const r=ratios.find(x=>x.ratio_name===name&&x.fiscal_year===y);return r?.ratio_value!=null?formatRatio(name,Number(r.ratio_value)):"—";}),latest.benchmark!=null?formatRatio(name,Number(latest.benchmark)):"—",s.toUpperCase()]];
      }), "Key Ratio Snapshot");
  }
  h += bul(ic.sections["executive_summary"]?.markdown??"");
  h += `</div>`;

  // ── II. Client & Promoter ─────────────────────────────────────────────────
  h += `<div class="sec"><h2>II. Client &amp; Promoter Profile</h2>`;
  h += `<table><tbody>
    ${tblRow("Client Name", cc.client_name)}
    ${tblRow("Legal Constitution", cc.legal_constitution)}
    ${tblRow("Industry / Sector", cc.industry)}
    ${tblRow("Year Established", cc.year_established)}
    ${tblRow("Product Applied", product.label)}
    ${tblRow("Principal Borrower", cc.principal_borrower)}
    ${tblRow("Website", cc.website)}
  </tbody></table>`;
  if (cc.promoter_details) h += `<p><b>Promoter Details:</b><br>${cc.promoter_details}</p>`;
  if (cc.group_summary) h += `<p><b>Group Summary:</b><br>${cc.group_summary}</p>`;
  h += bul(ic.sections["client_promoter"]?.markdown??"");
  h += `</div>`;

  // ── III. Investment Structure ─────────────────────────────────────────────
  h += `<div class="sec"><h2>III. Proposed Investment Structure</h2>`;
  h += `<table><tbody>
    ${tblRow("Product", product.label)}
    ${tblRow("Legal Nature", product.legalNature)}
    ${tblRow("Return Mechanism", product.returnMechanism)}
    ${tblRow("Proposed Amount", `₹${cc.deal_amount??'—'} Crores`)}
    ${tblRow("Tenure", `${cc.tenure_months??'—'} Months`)}
    ${tblRow("Expected IRR", `${cc.expected_irr??'—'}%`)}
    ${cc.residual_value!=null?tblRow("Residual Value",`₹${cc.residual_value}`):""}
    ${cc.security_deposit!=null?tblRow("Security Deposit",`₹${cc.security_deposit}`):""}
  </tbody></table>`;
  if (cc.end_use) h += `<p><b>End Use of Funds:</b><br>${cc.end_use}</p>`;
  if (cc.collateral_summary) h += `<p><b>Collateral / Security:</b><br>${cc.collateral_summary}</p>`;
  h += bul(ic.sections["investment_structure"]?.markdown??"");
  h += `</div>`;

  // ── IV. Rehbar Funding History ────────────────────────────────────────────
  h += `<div class="sec"><h2>IV. Rehbar Funding History</h2>`;
  h += `<table><tbody>
    ${tblRow("Funder", "Rehbar Financial Services")}
    ${tblRow("Business Model", "Sharia-compliant NBFC — asset financing & structured credit")}
    ${tblRow("Core Products", "Operating Lease · Finance Lease · PLS · Project Finance · Trade Finance · Home Loan")}
    ${tblRow("Prior Exposure", `No prior Rehbar funding history on record for ${cc.client_name}. New relationship.`)}
  </tbody></table>`;
  h += bul(ic.sections["rehbar_funding_history"]?.markdown??"");
  h += `</div>`;

  // ── V. Historical Financials ──────────────────────────────────────────────
  h += `<div class="sec"><h2>V. Historical Financial Analysis</h2>`;
  if (histYears.length > 0) {
    const fyItems = histYears.map(y => icGetItems(extracted, y));
    const yoyPct = (vals: (number|null)[]) => {
      const l = vals[vals.length-1], p = vals.length>=2?vals[vals.length-2]:null;
      return (l!==null&&p!==null&&p!==0) ? ((l!-p!)/Math.abs(p!)*100).toFixed(1)+"%" : "—";
    };
    for (const [labels, caption] of [
      [["Turnover","Gross Profit","EBITDA","EBIT","Interest Expense","PAT"], `P&L Summary (${ul})`],
      [["Net Worth","Total Debt","Current Assets","Fixed Assets (Net)","Total Assets","Capital Employed"], `Balance Sheet (${ul})`],
    ] as [string[], string][]) {
      h += dataTable(
        ["Item",...histYears.map(y=>`FY${y}`),...(histYears.length>=2?["YoY%"]:[])],
        labels.map(label => {
          const vals = fyItems.map(items => icLiVal(items, label));
          return [label, ...vals.map(v=>icFmt(v)), ...(histYears.length>=2?[yoyPct(vals)]:[])];
        }),
        caption,
      );
    }
  }
  h += bul(ic.sections["historical_financial"]?.markdown??"");
  h += `</div>`;

  // ── VI. Projections ───────────────────────────────────────────────────────
  h += `<div class="sec"><h2>VI. Projections &amp; Estimates</h2>`;
  if (projRows.length > 0) {
    const actCols = histYears;
    const pairs: [string,string][] = [
      ["Turnover","Projected Turnover"],["EBITDA","Projected EBITDA"],["PAT","Projected PAT"],
      ["Net Worth","Projected Net Worth"],["Total Debt","Projected Total Debt"],
    ];
    h += dataTable(
      ["Metric",...actCols.map(y=>`FY${y}(A)`),...projYears.map(y=>`FY${y}(P)`)],
      pairs.map(([hl,pl]) => [
        hl,
        ...actCols.map(y=>icFmt(icLiVal(icGetItems(extracted,y),hl))),
        ...projYears.map(y=>icFmt(icLiVal((projRows.find(r=>r.fiscal_year===y)?.line_items??[]) as unknown as LineItem[],pl))),
      ]),
      `Historical vs Projected (${ul})`,
    );
  }
  h += bul(ic.sections["projections"]?.markdown??"");
  h += `</div>`;

  // ── VII. Key Financial Ratios ─────────────────────────────────────────────
  h += `<div class="sec"><h2>VII. Key Financial Ratios</h2>`;
  for (const cat of ratioGroups) {
    const names = Array.from(new Set(ratios.filter(r=>r.category===cat).map(r=>r.ratio_name)));
    h += dataTable(
      ["Ratio",...fyYears.map(y=>`FY${y}`),"Benchmark","Status"],
      names.map(name => {
        const latest = ratios.filter(r=>r.ratio_name===name).sort((a,b)=>b.fiscal_year-a.fiscal_year)[0];
        const s = latest?.threshold_status??"na";
        return [
          RATIO_DISPLAY_NAMES[name]??name,
          ...fyYears.map(y=>{const r=ratios.find(x=>x.ratio_name===name&&x.fiscal_year===y);return r?.ratio_value!=null?formatRatio(name,Number(r.ratio_value)):"—";}),
          latest?.benchmark!=null?formatRatio(name,Number(latest.benchmark)):"—",
          s.toUpperCase(),
        ];
      }),
      cat,
    );
  }
  h += `</div>`;

  // ── VIII. Cash Flow ───────────────────────────────────────────────────────
  h += `<div class="sec"><h2>VIII. Cash Flow Statement</h2>`;
  if (histYears.length > 0) {
    const fyItems = histYears.map(y => icGetItems(extracted, y));
    const cfLabels = ["Cash from Operations","Cash from Investing","Cash from Financing","Net Change in Cash","Opening Cash","Closing Cash"];
    const cfRows = cfLabels
      .map(label => ({ label, vals: fyItems.map(items => icLiVal(items, label)) }))
      .filter(({ vals }) => vals.some(v => v !== null));
    if (cfRows.length) {
      h += dataTable(["Item",...histYears.map(y=>`FY${y}`)], cfRows.map(({label,vals})=>[label,...vals.map(v=>icFmt(v))]), `Cash Flow (${ul})`);
    }
  }
  h += bul(ic.sections["cash_flow"]?.markdown??"");
  h += `</div>`;

  // ── IX. Due Diligence ─────────────────────────────────────────────────────
  h += `<div class="sec"><h2>IX. Due Diligence Excerpts</h2>`;
  h += bul(ic.sections["due_diligence"]?.markdown??"") || `<p style="color:#999;font-style:italic">Analyst to complete.</p>`;
  h += `</div>`;

  // ── X. Risk Assessment ────────────────────────────────────────────────────
  h += `<div class="sec"><h2>X. Risk Assessment &amp; Mitigation</h2>`;
  h += bul(ic.sections["risk_assessment"]?.markdown??"");
  h += `</div>`;

  // ── XI. Visit & Reference ─────────────────────────────────────────────────
  h += `<div class="sec"><h2>XI. Visit Report, Reference Checks &amp; Exec Recommendation</h2>`;
  if (cc.analyst_notes) h += `<p><b>Analyst Notes:</b><br>${cc.analyst_notes}</p>`;
  h += bul(ic.sections["visit_reference"]?.markdown??"");
  h += dataTable(["Check Type","Source","Status"],[
    ["Banker Reference","Principal Bank","Pending"],
    ["Vendor / Supplier Check","Key Suppliers","Pending"],
    ["Customer Reference","Major Clients","Pending"],
    ["Site Visit","Business Premises","Pending"],
  ], "Reference Check Template");
  h += `</div>`;

  // ── XII. Product Specifics ────────────────────────────────────────────────
  h += `<div class="sec"><h2>XII. Specific Product Requirements &amp; Exemptions</h2>`;
  h += `<table><tbody>
    ${tblRow("Product", product.label)}
    ${tblRow("Legal Nature", product.legalNature)}
    ${tblRow("Return Mechanism", product.returnMechanism)}
  </tbody></table>`;
  h += `<ul>${product.rules.map(r=>`<li>${r}</li>`).join("")}</ul>`;
  if (cc.policy_exceptions) h += `<p><b>Policy Exceptions:</b> ${cc.policy_exceptions}</p>`;
  h += bul(ic.sections["product_specifics"]?.markdown??"");
  h += `</div>`;

  // ── Risk Register ─────────────────────────────────────────────────────────
  if (ic.risks?.length) {
    h += `<div class="sec"><h2>Risk Register</h2>
    <table><thead><tr><th>Category</th><th>Risk</th><th>Mitigant</th><th>Severity</th></tr></thead><tbody>`;
    ic.risks.forEach(r => {
      const cls = r.severity==="high"?"fail":r.severity==="medium"?"caution":"pass";
      h += `<tr><td>${r.category}</td><td>${r.risk}</td><td>${r.mitigant}</td><td class="${cls}">${r.severity?.toUpperCase()}</td></tr>`;
    });
    h += `</tbody></table></div>`;
  }

  // ── Conditions Precedent ──────────────────────────────────────────────────
  if (ic.conditions_precedent?.length) {
    h += `<div class="sec"><h2>Conditions Precedent</h2><ul>${ic.conditions_precedent.map(c=>`<li>${c}</li>`).join("")}</ul></div>`;
  }

  // ── SWOT ──────────────────────────────────────────────────────────────────
  if (ic.swot) {
    h += `<div class="sec"><h2>SWOT Analysis</h2><div class="grid2">`;
    ([["Strengths",ic.swot.strengths],["Weaknesses",ic.swot.weaknesses],["Opportunities",ic.swot.opportunities],["Threats",ic.swot.threats]] as [string,string[]][]).forEach(([label,items]) => {
      h += `<div><h3>${label}</h3><ul>${items.map(i=>`<li>${i}</li>`).join("")}</ul></div>`;
    });
    h += `</div></div>`;
  }

  return h;
}


// XHR-based upload to Supabase Storage so we get a real progress event stream.
async function uploadWithProgress(bucket: string, path: string, file: File, onPct: (pct: number) => void, signal?: AbortSignal): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`;
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
    xhr.onabort = () => reject(new Error("cancelled"));
    if (signal) {
      if (signal.aborted) { xhr.abort(); return; }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

function UploadGrid({ onUpload, onCancel, onDelete, onEdit, onRetry, busy, docs, progress, progressLabel }: {
  onUpload: (f: File, cls: DocClass, fy: number | null) => void;
  onCancel: () => void;
  onDelete: (doc: DocRow) => void;
  onEdit: (id: string, doc_class: string, fiscal_year: number | null) => void;
  onRetry: (doc: DocRow) => void;
  busy: boolean; docs: DocRow[]; progress: number; progressLabel: string;
}) {
  const DOC_CLASSES: { value: DocClass; label: string }[] = [
    { value: "all_in_one",     label: "ALL-IN-ONE (BS + P&L + CF + PROJ)" },
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

// ─── Unit helpers (shared across tabs) ──────────────────────────────────────

/** Abbreviated unit label: "Lakhs" → "L", "Crores" → "Cr", etc. */
function unitAbbr(unit: string | null | undefined): string {
  if (!unit) return "";
  const u = unit.toLowerCase();
  if (u.includes("crore")) return "Cr";
  if (u.includes("lakh"))  return "L";
  if (u.includes("million")) return "M";
  if (u.includes("thousand")) return "K";
  return "";
}

/** Full normalised unit label for panel tickers: "Lakhs" → "₹ Lakhs", "USD Millions" → "USD Millions" */
function fmtUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  const u = unit.trim();
  if (/^inr/i.test(u)) return "₹ " + u.replace(/^inr\s*/i, "").trim();
  if (/lakh|crore|thousand/i.test(u)) return "₹ " + u;
  return u;
}

// ─── Projections Tab ────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  backgroundColor: "#0d1117",
  border: "1px solid #1f2937",
  color: "#e2e8f0",
  fontSize: "11px",
  borderRadius: "2px",
};

function ProjectionsTab({
  extracted,
  cc,
  busy,
  progress,
  progressLabel,
  onGenerateNote,
}: {
  extracted: ExtractedRow[];
  cc: CaseRow;
  busy: boolean;
  progress: number;
  progressLabel: string;
  onGenerateNote: () => void;
}) {
  const projRows = extracted.filter((r) => r.statement_type === "projections");
  const histPL   = extracted.filter((r) => r.statement_type === "profit_loss");
  const histBS   = extracted.filter((r) => r.statement_type === "balance_sheet");

  // Detect unit from any available extraction row
  const unit = projRows[0]?.unit ?? histPL[0]?.unit ?? null;
  const abbr = unitAbbr(unit);
  const unitTicker = fmtUnit(unit);

  const liVal = (items: LineItem[], label: string): number | null => {
    const it = items.find((i) => i.label === label);
    if (!it) return null;
    return it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
  };

  const fmt  = (n: number | null | undefined, dec = 2): string =>
    n === null || n === undefined || !Number.isFinite(n as number)
      ? "—"
      : (n as number).toLocaleString("en-IN", { maximumFractionDigits: dec, minimumFractionDigits: dec });

  const pct = (n: number | null | undefined): string =>
    n === null || n === undefined || !Number.isFinite(n as number) ? "—" : (n as number).toFixed(1) + "%";

  if (projRows.length === 0) {
    return (
      <Panel title="NO PROJECTION DATA" ticker="UPLOAD REQUIRED">
        <div className="text-muted-foreground text-xs leading-relaxed">
          No projection rows found. Upload a document containing financial projections and extract
          it with the <strong>projections</strong> or <strong>all-in-one</strong> statement type.
        </div>
      </Panel>
    );
  }

  // ── Core projection data ──────────────────────────────────────────────────
  const projYears = [...new Set(projRows.map((r) => r.fiscal_year))].sort();

  const projData = projYears.map((fy) => {
    const items = ((projRows.find((r) => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]);
    const turnover  = liVal(items, "Projected Turnover");
    const ebitda    = liVal(items, "Projected EBITDA");
    const pat       = liVal(items, "Projected PAT");
    const networth  = liVal(items, "Projected Net Worth");
    const totalDebt = liVal(items, "Projected Total Debt");
    return { fy, turnover, ebitda, pat, networth, totalDebt };
  });

  const projMetrics = projData.map((d, i) => {
    const prev         = i > 0 ? projData[i - 1] : null;
    const ebitdaMargin = d.turnover && d.ebitda    ? (d.ebitda / d.turnover) * 100 : null;
    const patMargin    = d.turnover && d.pat       ? (d.pat   / d.turnover) * 100 : null;
    const debtEbitda   = d.ebitda && d.ebitda !== 0 && d.totalDebt ? d.totalDebt / d.ebitda : null;
    const roe          = d.networth && d.networth !== 0 && d.pat   ? (d.pat / d.networth) * 100 : null;
    const revGrowth    = prev?.turnover && d.turnover && prev.turnover !== 0
      ? ((d.turnover - prev.turnover) / Math.abs(prev.turnover)) * 100 : null;
    return { ...d, ebitdaMargin, patMargin, debtEbitda, roe, revGrowth };
  });

  // ── CAGR helpers ─────────────────────────────────────────────────────────
  const cagr = (first: number | null, last: number | null, n: number): number | null =>
    first && last && n > 0 && first > 0 ? (Math.pow(last / first, 1 / n) - 1) * 100 : null;

  const nYears = projData.length - 1;
  const revCAGR = cagr(projData[0]?.turnover ?? null, projData[nYears]?.turnover ?? null, nYears);
  const final   = projMetrics[projMetrics.length - 1];

  // ── Historical data (for bridge chart) ──────────────────────────────────
  const histYears = [...new Set(histPL.map((r) => r.fiscal_year))].sort();
  const histData  = histYears.map((fy) => {
    const plItems = ((histPL.find((r) => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]);
    const bsItems = ((histBS.find((r) => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]);
    return {
      fy,
      turnover:  liVal(plItems, "Turnover"),
      ebitda:    liVal(plItems, "EBITDA"),
      totalDebt: liVal(bsItems, "Total Debt"),
    };
  });

  // ── Chart datasets ────────────────────────────────────────────────────────
  const revenueData  = projMetrics.map((d) => ({
    fy: `FY${d.fy}`, turnover: d.turnover,
    growth: d.revGrowth !== null ? +d.revGrowth.toFixed(1) : null,
  }));

  const marginsData  = projMetrics.map((d) => ({
    fy: `FY${d.fy}`,
    ebitdaMargin: d.ebitdaMargin !== null ? +d.ebitdaMargin.toFixed(1) : null,
    patMargin:    d.patMargin    !== null ? +d.patMargin.toFixed(1)    : null,
  }));

  const bridgeData = [
    ...histData.map((d)  => ({ label: `FY${d.fy}`,    actual: d.turnover, projected: null })),
    ...projData.map((d)  => ({ label: `FY${d.fy}*`,   actual: null, projected: d.turnover })),
  ];
  const lastHistLabel = histData.length ? `FY${histData[histData.length - 1].fy}` : null;

  const debtData = projMetrics.map((d) => ({
    fy: `FY${d.fy}`,
    totalDebt: d.totalDebt,
    debtEbitda: d.debtEbitda !== null ? +d.debtEbitda.toFixed(2) : null,
  }));

  // ── Derived analytics rows ────────────────────────────────────────────────
  const analyticsRows: Array<{ label: string; get: (m: typeof projMetrics[0]) => string; color?: string }> = [
    { label: "EBITDA Margin",        get: (m) => pct(m.ebitdaMargin) },
    { label: "PAT / Net Profit Margin", get: (m) => pct(m.patMargin) },
    { label: "Return on Net Worth",  get: (m) => pct(m.roe) },
    { label: "Debt / EBITDA",        get: (m) => m.debtEbitda !== null ? m.debtEbitda.toFixed(2) + "x" : "—" },
    { label: "Revenue Growth YoY",   get: (m) => m.revGrowth !== null ? (m.revGrowth > 0 ? "+" : "") + m.revGrowth.toFixed(1) + "%" : "—" },
  ];

  const projLineItems = [
    "Projected Turnover",
    "Projected EBITDA",
    "Projected PAT",
    "Projected Net Worth",
    "Projected Total Debt",
  ];

  const debtColor = (v: number | null | undefined) =>
    v === null || v === undefined ? "text-foreground/50" : v < 3 ? "text-success" : v < 5 ? "text-warning" : "text-destructive";

  return (
    <div className="space-y-3">

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Panel title="REVENUE CAGR" ticker={nYears > 0 ? `${nYears}Y PROJ` : "1Y"}>
          <div className={`text-2xl font-bold glow ${revCAGR !== null && revCAGR > 0 ? "text-success" : "text-destructive"}`}>
            {revCAGR !== null ? (revCAGR > 0 ? "+" : "") + revCAGR.toFixed(1) + "%" : "—"}
          </div>
          <div className="terminal-label mt-1">Projected period</div>
        </Panel>
        <Panel title="FINAL EBITDA %" ticker={`FY${final?.fy ?? "—"}`}>
          <div className="text-2xl font-bold text-warning glow">{pct(final?.ebitdaMargin)}</div>
          <div className="terminal-label mt-1">Last projected FY</div>
        </Panel>
        <Panel title="FINAL PAT %" ticker={`FY${final?.fy ?? "—"}`}>
          <div className={`text-2xl font-bold glow ${(final?.patMargin ?? 0) > 0 ? "text-success" : "text-destructive"}`}>
            {pct(final?.patMargin)}
          </div>
          <div className="terminal-label mt-1">Last projected FY</div>
        </Panel>
        <Panel title="DEBT / EBITDA" ticker={`FY${final?.fy ?? "—"}`}>
          <div className={`text-2xl font-bold glow ${debtColor(final?.debtEbitda)}`}>
            {final?.debtEbitda != null ? final.debtEbitda.toFixed(2) + "x" : "—"}
          </div>
          <div className="terminal-label mt-1">Last projected FY</div>
        </Panel>
      </div>

      {/* ── Charts Row 1 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Panel title="PROJECTED REVENUE GROWTH" ticker="TURNOVER">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={revenueData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fill: "#6b7280", fontSize: 10 }} width={55} />
                <YAxis yAxisId="r" orientation="right" tick={{ fill: "#f59e0b", fontSize: 10 }} unit="%" width={38} />
                <RTooltip contentStyle={TOOLTIP_STYLE} />
                <Bar yAxisId="l" dataKey="turnover" fill="#22c55e" opacity={0.85} name="Turnover" radius={[2,2,0,0]} />
                <Line yAxisId="r" type="monotone" dataKey="growth" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 3 }} name="Growth %" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1 tracking-wider">▸ Bars = revenue · Amber line = YoY growth %</div>
        </Panel>

        <Panel title="PROJECTED MARGIN TREND" ticker="EBITDA + PAT">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={marginsData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} unit="%" width={40} />
                <RTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => v.toFixed(1) + "%"} />
                <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                <Line type="monotone" dataKey="ebitdaMargin" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 3 }} name="EBITDA %" connectNulls />
                <Line type="monotone" dataKey="patMargin"    stroke="#60a5fa" strokeWidth={2} dot={{ fill: "#60a5fa", r: 3 }} name="PAT %"   connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1 tracking-wider">▸ Amber = EBITDA margin · Blue = PAT margin</div>
        </Panel>
      </div>

      {/* ── Charts Row 2 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Panel title="HISTORICAL vs PROJECTED REVENUE" ticker="BRIDGE">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bridgeData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} width={55} />
                <RTooltip contentStyle={TOOLTIP_STYLE} />
                {lastHistLabel && <ReferenceLine x={lastHistLabel} stroke="#374151" strokeDasharray="4 2" label={{ value: "PROJ →", fill: "#6b7280", fontSize: 9 }} />}
                <Bar dataKey="actual"    fill="#4b5563" name="Actual"    radius={[2,2,0,0]} />
                <Bar dataKey="projected" fill="#22c55e" opacity={0.7} name="Projected" radius={[2,2,0,0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1 tracking-wider">▸ Grey = historical actuals · Green = projections</div>
        </Panel>

        <Panel title="DEBT TRAJECTORY" ticker="TOTAL DEBT + COVERAGE">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={debtData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fill: "#6b7280", fontSize: 10 }} width={55} />
                <YAxis yAxisId="r" orientation="right" tick={{ fill: "#f59e0b", fontSize: 10 }} unit="x" width={38} />
                <RTooltip contentStyle={TOOLTIP_STYLE} />
                <Bar  yAxisId="l" dataKey="totalDebt"  fill="#ef4444" opacity={0.6} name="Total Debt" radius={[2,2,0,0]} />
                <Line yAxisId="r" type="monotone" dataKey="debtEbitda" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 3 }} name="Debt/EBITDA" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1 tracking-wider">▸ Red bars = total debt · Amber line = Debt/EBITDA</div>
        </Panel>
      </div>

      {/* ── Projected Financials Table ────────────────────────────────────── */}
      <Panel title="PROJECTED FINANCIAL STATEMENTS" ticker={unitTicker || "DOC UNITS"}>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-1">LINE ITEM</th>
              {projYears.map((y) => <th key={y} className="text-right">FY{y}</th>)}
              {nYears > 0 && <th className="text-right text-accent">CAGR</th>}
            </tr>
          </thead>
          <tbody>
            {projLineItems.map((label) => {
              const values = projYears.map((fy) =>
                liVal(((projRows.find((r) => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]), label)
              );
              const itemCagr = cagr(values[0] ?? null, values[values.length - 1] ?? null, nYears);
              return (
                <tr key={label} className="border-b border-border/30">
                  <td className="py-1.5 text-foreground/90 font-medium">{label}</td>
                  {values.map((v, i) => (
                    <td key={projYears[i]} className="text-right tabular-nums text-primary">
                      {fmt(v)}{abbr && v !== null && <span className="text-[9px] text-muted-foreground ml-0.5">{abbr}</span>}
                    </td>
                  ))}
                  {nYears > 0 && (
                    <td className={`text-right tabular-nums font-bold text-[10px] ${itemCagr !== null && itemCagr > 0 ? "text-success" : itemCagr !== null && itemCagr < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {itemCagr !== null ? (itemCagr > 0 ? "+" : "") + itemCagr.toFixed(1) + "%" : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* ── Projection Analytics Matrix ───────────────────────────────────── */}
      <Panel title="PROJECTION ANALYTICS MATRIX" ticker={unitTicker ? `DERIVED RATIOS · ${unitTicker}` : "DERIVED RATIOS"}>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-1">METRIC</th>
              {projYears.map((y) => <th key={y} className="text-right pr-2">FY{y}</th>)}
            </tr>
          </thead>
          <tbody>
            {analyticsRows.map(({ label, get }) => (
              <tr key={label} className="border-b border-border/30">
                <td className="py-1.5 text-foreground/90">{label}</td>
                {projMetrics.map((m) => (
                  <td key={m.fy} className="text-right tabular-nums text-primary pr-2">{get(m)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[9px] text-muted-foreground mt-2 tracking-wider border-t border-border/30 pt-2">
          ▸ Values in {unitTicker || "document units"} · YoY growth from first projected FY
        </div>
      </Panel>

      {/* ── Generate IC Note ─────────────────────────────────────────────── */}
      {busy && (
        <div className="border border-primary/40 bg-primary/5 p-3 space-y-2">
          <div className="flex justify-between text-[11px] tracking-widest">
            <span className="text-primary">▸ {progressLabel || "DRAFTING IC NOTE"}</span>
            <span className="text-primary font-bold tabular-nums">{progress}%</span>
          </div>
          <div className="h-2 bg-input border border-border overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progress}%`, boxShadow: "0 0 8px hsl(var(--primary))" }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground tracking-widest">
            <span>PREP</span><span>ANALYSE</span><span>DRAFT</span><span>BUILD</span><span>DONE</span>
          </div>
        </div>
      )}
      <button
        onClick={onGenerateNote}
        disabled={busy}
        className="bg-primary text-primary-foreground px-4 py-2 text-xs tracking-widest font-bold disabled:opacity-50"
      >
        {busy ? "DRAFTING..." : "[GENERATE 12-SECTION IC NOTE →]"}
      </button>

    </div>
  );
}

// ─── Markdown Renderer ───────────────────────────────────────────────────────

function inlineMd(raw: string): string {
  return raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.06);padding:0 3px;border-radius:2px">$1</code>');
}

const isSeparator = (line: string) => /^\|[\s|:-]+\|$/.test(line.trim());

function MdTable({ lines }: { lines: string[] }) {
  const dataLines = lines.filter((l) => !isSeparator(l));
  if (dataLines.length === 0) return null;
  const parse = (l: string) =>
    l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const [header, ...body] = dataLines;
  const heads = parse(header);
  return (
    <div className="overflow-x-auto my-1">
      <table className="w-full text-xs border-t border-border">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            {heads.map((h, i) => (
              <th key={i} className={`py-1 font-semibold tracking-wide ${i === 0 ? "text-left" : "text-right"}`}
                dangerouslySetInnerHTML={{ __html: inlineMd(h) }}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => {
            const cells = parse(row);
            return (
              <tr key={ri} className="border-b border-border/30 hover:bg-surface/30">
                {cells.map((cell, ci) => {
                  const isStatus = /^(PASS|FAIL|CAUTION)$/i.test(cell.trim());
                  const statusCls = isStatus
                    ? /pass/i.test(cell) ? "text-success font-bold"
                    : /fail/i.test(cell) ? "text-destructive font-bold"
                    : "text-warning font-bold"
                    : "";
                  return (
                    <td key={ci}
                      className={`py-1 ${ci === 0 ? "text-left text-foreground/90" : "text-right tabular-nums text-primary"} ${statusCls}`}
                      dangerouslySetInnerHTML={{ __html: inlineMd(cell) }}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── IC Note Data-Driven Override Components ────────────────────────────────

const IC_S_CLS: Record<string, string> = {
  green: "text-success", amber: "text-warning", red: "text-destructive", na: "text-muted-foreground",
};
const IC_B_CLS: Record<string, string> = {
  green: "bg-success text-success-foreground",
  amber: "bg-warning text-warning-foreground",
  red: "bg-destructive text-destructive-foreground",
  na: "bg-muted text-muted-foreground",
};

function ICSummaryPanel({ cc, ratios }: { cc: CaseRow; ratios: RatioRow[] }) {
  const product = PRODUCTS[cc.product_type];
  const years = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const KEY = ["dscr", "current_ratio", "debt_to_equity", "interest_coverage", "ebitda_margin", "roe"];
  return (
    <div className="space-y-2 text-xs">
      <table className="w-full">
        <tbody>
          <tr className="border-b border-border/30">
            <td className="py-0.5 w-28 text-muted-foreground">Client</td>
            <td className="text-primary font-medium">{cc.client_name}</td>
            <td className="w-24 text-muted-foreground">Product</td>
            <td className="text-primary">{product.short}</td>
          </tr>
          <tr className="border-b border-border/30">
            <td className="py-0.5 text-muted-foreground">Amount</td>
            <td className="text-primary">₹{Number(cc.deal_amount ?? 0).toLocaleString("en-IN")} Cr</td>
            <td className="text-muted-foreground">Tenure</td>
            <td className="text-primary">{cc.tenure_months ?? "—"}M</td>
          </tr>
          <tr className="border-b border-border/30">
            <td className="py-0.5 text-muted-foreground">IRR</td>
            <td className="text-primary">{cc.expected_irr ?? "—"}%</td>
            <td className="text-muted-foreground">Industry</td>
            <td className="text-primary">{cc.industry ?? "—"}</td>
          </tr>
          {cc.end_use && (
            <tr className="border-b border-border/30">
              <td className="py-0.5 text-muted-foreground">End Use</td>
              <td colSpan={3} className="text-foreground/90">{cc.end_use}</td>
            </tr>
          )}
        </tbody>
      </table>
      {ratios.length > 0 && years.length > 0 && (
        <>
          <div className="text-[10px] text-accent font-bold tracking-widest pt-1">KEY RATIO SNAPSHOT</div>
          <table className="w-full">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-0.5">RATIO</th>
                {years.map(y => <th key={y} className="text-right">FY{y}</th>)}
                <th className="text-right">BMK</th>
                <th className="text-right">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {KEY.map(name => {
                const rows = ratios.filter(r => r.ratio_name === name);
                if (rows.length === 0) return null;
                const latest = rows.sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
                const s = latest.threshold_status ?? "na";
                return (
                  <tr key={name} className="border-b border-border/30">
                    <td className="py-0.5 text-foreground/90">{RATIO_DISPLAY_NAMES[name] ?? name}</td>
                    {years.map(y => {
                      const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y);
                      return (
                        <td key={y} className="text-right tabular-nums text-primary">
                          {formatRatio(name, r?.ratio_value != null ? Number(r.ratio_value) : null)}
                        </td>
                      );
                    })}
                    <td className="text-right tabular-nums text-muted-foreground">
                      {latest.benchmark != null ? formatRatio(name, Number(latest.benchmark)) : "—"}
                    </td>
                    <td className={`text-right font-bold text-[10px] ${IC_S_CLS[s]}`}>
                      {s === "green" ? "PASS" : s === "red" ? "FAIL" : s === "amber" ? "CAU" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function icGetItems(extracted: ExtractedRow[], fy: number): LineItem[] {
  const raw: LineItem[] = [];
  const seen = new Set<string>();
  for (const row of extracted.filter(r => r.fiscal_year === fy && r.statement_type !== "projections")) {
    for (const it of (row.line_items as unknown as LineItem[]) ?? []) {
      if (!seen.has(it.label)) { raw.push(it); seen.add(it.label); }
    }
  }
  return deriveFinancialItems(raw);
}

function deriveFinancialItems(items: LineItem[]): LineItem[] {
  const result = [...items];

  const get = (label: string): number | null => {
    const it = result.find(i => i.label === label);
    if (!it) return null;
    const v = it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
    return v !== null && Number.isFinite(Number(v)) ? Number(v) : null;
  };

  const add = (label: string, value: number) => {
    if (result.find(i => i.label === label)) return;
    result.push({ label, value, confidence: 70, reviewed: false, note: "auto-derived", override_value: null });
  };

  // ── P&L derivations ────────────────────────────────────────────────────
  const turnover     = get("Turnover");
  const cogs         = get("Cost of Goods Sold");
  const grossProfit  = get("Gross Profit");
  const opEx         = get("Operating Expenses");
  const ebitda       = get("EBITDA");
  const depn         = get("Depreciation");
  const ebit         = get("EBIT");
  const interest     = get("Interest Expense");
  const pbt          = get("Profit Before Tax");
  const tax          = get("Tax");
  const pat          = get("PAT");

  if (grossProfit === null && turnover !== null && cogs !== null)
    add("Gross Profit", turnover - cogs);
  const gp = grossProfit ?? get("Gross Profit");
  if (ebitda === null && gp !== null && opEx !== null)
    add("EBITDA", gp - opEx);
  const eb = ebitda ?? get("EBITDA");
  if (ebit === null && eb !== null && depn !== null)
    add("EBIT", eb - depn);
  const ei = ebit ?? get("EBIT");
  if (pbt === null && ei !== null && interest !== null)
    add("Profit Before Tax", ei - interest);
  const pb = pbt ?? get("Profit Before Tax");
  if (pat === null && pb !== null && tax !== null)
    add("PAT", pb - tax);
  if (pat === null && pb !== null && tax === null)
    add("PAT", pb);

  // ── Balance Sheet derivations ──────────────────────────────────────────
  const shareCapital = get("Share Capital");
  const reserves     = get("Reserves & Surplus");
  const netWorth     = get("Net Worth");
  const ltBorrow     = get("Long Term Borrowings");
  const stBorrow     = get("Short Term Borrowings");
  const totalDebt    = get("Total Debt");
  const inventory    = get("Inventory");
  const receivables  = get("Trade Receivables");
  const cash         = get("Cash & Bank");
  const otherCA      = get("Other Current Assets");
  const currentAssets= get("Current Assets");
  const tradePay     = get("Trade Payables");
  const otherCL      = get("Other Current Liabilities");
  const currentLiab  = get("Current Liabilities");
  const fixedAssets  = get("Fixed Assets (Net)");
  const totalAssets  = get("Total Assets");

  if (netWorth === null && shareCapital !== null && reserves !== null)
    add("Net Worth", shareCapital + reserves);

  if (totalDebt === null) {
    const lt = ltBorrow ?? 0;
    const st = stBorrow ?? 0;
    if (ltBorrow !== null || stBorrow !== null)
      add("Total Debt", lt + st);
  }

  const nw = netWorth ?? get("Net Worth");
  const lt = ltBorrow ?? 0;
  if (get("Capital Employed") === null && nw !== null)
    add("Capital Employed", nw + lt);

  if (currentAssets === null) {
    const parts = [inventory, receivables, cash, otherCA].filter((v): v is number => v !== null);
    if (parts.length >= 2) add("Current Assets", parts.reduce((a, b) => a + b, 0));
  }

  if (get("Current Liabilities") === null) {
    const stB = stBorrow ?? 0;
    const tp  = tradePay ?? 0;
    const cl  = otherCL  ?? 0;
    if (stBorrow !== null || tradePay !== null || otherCL !== null)
      add("Current Liabilities", stB + tp + cl);
  }

  const ca = currentAssets ?? get("Current Assets");
  const cl = currentLiab  ?? get("Current Liabilities");
  if (get("Working Capital") === null && ca !== null && cl !== null)
    add("Working Capital", ca - cl);

  if (totalAssets === null && fixedAssets !== null && ca !== null)
    add("Total Assets", fixedAssets + ca);

  return result;
}

function icLiVal(items: LineItem[], label: string): number | null {
  const it = items.find(i => i.label === label);
  if (!it) return null;
  return it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
}

function icFmt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function FV({ v, abbr, calc }: { v: number | null | undefined; abbr: string; calc?: boolean }) {
  if (v === null || v === undefined || !Number.isFinite(v as number))
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className={calc ? "text-warning/80" : "text-primary"}>
      {icFmt(v)}{abbr && <span className="text-[9px] text-muted-foreground ml-0.5">{abbr}</span>}
    </span>
  );
}

function ICHistoricalTables({ extracted }: { extracted: ExtractedRow[] }) {
  const years = Array.from(new Set(
    extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year)
  )).sort();
  if (years.length === 0) return <div className="text-muted-foreground text-xs">No historical data extracted.</div>;

  const unit = extracted.find(r => r.unit)?.unit;
  const unitLabel = unit ? `₹ ${unit}` : "₹";
  const abbr = unitAbbr(unit);
  const fyItems = years.map(y => icGetItems(extracted, y));

  const isCalc = (items: LineItem[], label: string) =>
    items.find(i => i.label === label)?.note === "auto-derived";

  const plLabels = ["Turnover", "Cost of Goods Sold", "Gross Profit", "Operating Expenses", "EBITDA", "Depreciation", "EBIT", "Interest Expense", "Profit Before Tax", "Tax", "PAT"];
  const bsLabels = ["Share Capital", "Reserves & Surplus", "Net Worth", "Long Term Borrowings", "Short Term Borrowings", "Total Debt", "Trade Payables", "Other Current Liabilities", "Current Liabilities", "Inventory", "Trade Receivables", "Cash & Bank", "Other Current Assets", "Current Assets", "Fixed Assets (Net)", "Total Assets", "Capital Employed", "Working Capital"];
  const cfLabels = ["Cash from Operations", "Cash from Investing", "Cash from Financing", "Net Change in Cash", "Opening Cash", "Closing Cash"];

  const renderTable = (allLabels: string[], title: string) => {
    // Only show rows where at least one year has a value
    const activeLabels = allLabels.filter(label =>
      fyItems.some(items => icLiVal(items, label) !== null)
    );
    if (activeLabels.length === 0) return null;
    return (
      <div>
        <div className="text-[10px] text-accent font-bold tracking-widest mb-1">{title} · {unitLabel}</div>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-0.5">ITEM</th>
              {years.map(y => <th key={y} className="text-right">FY{y}</th>)}
              {years.length >= 2 && <th className="text-right text-accent">YOY%</th>}
            </tr>
          </thead>
          <tbody>
            {activeLabels.map(label => {
              const vals = fyItems.map(items => icLiVal(items, label));
              const calcFlags = fyItems.map(items => isCalc(items, label));
              const last = vals[vals.length - 1];
              const prev = vals.length >= 2 ? vals[vals.length - 2] : null;
              const yoyPct = (last !== null && prev !== null && prev !== 0)
                ? ((last - prev) / Math.abs(prev)) * 100 : null;
              const anyCalc = calcFlags.some(Boolean);
              return (
                <tr key={label} className="border-b border-border/30">
                  <td className="py-0.5">
                    <span className={anyCalc ? "text-warning/90" : "text-foreground/90"}>{label}</span>
                    {anyCalc && <span className="ml-1 text-[8px] text-warning/70 tracking-widest">CALC</span>}
                  </td>
                  {vals.map((v, i) => (
                    <td key={i} className="text-right tabular-nums">
                      <FV v={v} abbr={abbr} calc={calcFlags[i]} />
                    </td>
                  ))}
                  {years.length >= 2 && (
                    <td className={`text-right tabular-nums text-[11px] ${yoyPct !== null ? (yoyPct > 0 ? "text-success" : yoyPct < 0 ? "text-destructive" : "text-muted-foreground") : "text-muted-foreground"}`}>
                      {yoyPct !== null ? (yoyPct > 0 ? "+" : "") + yoyPct.toFixed(1) + "%" : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const hasCF = fyItems.some(items => cfLabels.some(l => icLiVal(items, l) !== null));

  return (
    <div className="space-y-3">
      {renderTable(plLabels, "P&L SUMMARY")}
      {renderTable(bsLabels, "BALANCE SHEET")}
      {hasCF && renderTable(cfLabels, "CASH FLOW STATEMENT")}
      <div className="text-[9px] text-warning/70 tracking-wider">
        ▸ <span className="text-warning/70">CALC</span> = auto-derived from available data · all other values extracted from source documents
      </div>
    </div>
  );
}

function ICProjectionsTable({ extracted }: { extracted: ExtractedRow[] }) {
  const projRows = extracted.filter(r => r.statement_type === "projections");
  if (projRows.length === 0) return <div className="text-muted-foreground text-xs">No projection data extracted.</div>;

  const unit = extracted.find(r => r.unit)?.unit;
  const unitLabel = unit ? `₹ ${unit}` : "₹";
  const abbr = unitAbbr(unit);
  const histYears = Array.from(new Set(
    extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year)
  )).sort();
  const projYears = Array.from(new Set(projRows.map(r => r.fiscal_year))).sort();
  const pairs: [string, string][] = [
    ["Turnover", "Projected Turnover"],
    ["EBITDA", "Projected EBITDA"],
    ["PAT", "Projected PAT"],
    ["Net Worth", "Projected Net Worth"],
    ["Total Debt", "Projected Total Debt"],
  ];

  return (
    <div>
      <div className="text-[9px] text-muted-foreground mb-1 tracking-wider">{unitLabel} · (A) Actual · (P) Projected</div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left py-0.5">METRIC</th>
            {histYears.map(y => <th key={y} className="text-right">FY{y}<span className="text-[9px] opacity-60">(A)</span></th>)}
            {projYears.map(y => <th key={y} className="text-right text-accent">FY{y}<span className="text-[9px] opacity-60">(P)</span></th>)}
          </tr>
        </thead>
        <tbody>
          {pairs.map(([histLabel, projLabel]) => (
            <tr key={histLabel} className="border-b border-border/30">
              <td className="py-0.5 text-foreground/90">{histLabel}</td>
              {histYears.map(y => <td key={y} className="text-right tabular-nums"><FV v={icLiVal(icGetItems(extracted, y), histLabel)} abbr={abbr} /></td>)}
              {projYears.map(y => {
                const items = (projRows.find(r => r.fiscal_year === y)?.line_items ?? []) as unknown as LineItem[];
                return <td key={y} className="text-right tabular-nums"><FV v={icLiVal(items, projLabel)} abbr={abbr} /></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ICRatioTable({ ratios }: { ratios: RatioRow[] }) {
  if (ratios.length === 0) return <div className="text-muted-foreground text-xs">No ratios computed. Run ratio analysis first.</div>;
  const years = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const categories = Array.from(new Set(ratios.map(r => r.category)));

  return (
    <div className="space-y-3">
      {categories.map(cat => {
        const names = Array.from(new Set(ratios.filter(r => r.category === cat).map(r => r.ratio_name)));
        return (
          <div key={cat}>
            <div className="text-[10px] text-accent font-bold tracking-widest mb-1">{cat.toUpperCase()}</div>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-0.5">RATIO</th>
                  {years.map(y => <th key={y} className="text-right">FY{y}</th>)}
                  <th className="text-right">BMK</th>
                </tr>
              </thead>
              <tbody>
                {names.map(name => {
                  const latest = ratios.filter(r => r.ratio_name === name).sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
                  const latestStatus = latest?.threshold_status ?? "na";
                  return (
                    <tr key={name} className="border-b border-border/30">
                      <td className="py-0.5 text-foreground/90">{RATIO_DISPLAY_NAMES[name] ?? name}</td>
                      {years.map(y => {
                        const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y);
                        const val = r?.ratio_value != null ? Number(r.ratio_value) : null;
                        const s = r?.threshold_status ?? "na";
                        return (
                          <td key={y} className="text-right pr-1">
                            <span className="tabular-nums text-foreground/90 mr-1">{formatRatio(name, val)}</span>
                            <span className={`px-1 text-[9px] font-bold tracking-widest ${IC_B_CLS[s]}`}>
                              {s === "green" ? "✓" : s === "red" ? "✗" : s === "amber" ? "~" : "—"}
                            </span>
                          </td>
                        );
                      })}
                      <td className="text-right tabular-nums text-muted-foreground">
                        {latest?.benchmark != null ? formatRatio(name, Number(latest.benchmark)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function ICRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <tr className="border-b border-border/30">
      <td className="py-0.5 w-44 text-muted-foreground">{label}</td>
      <td className="text-primary">{String(value)}</td>
    </tr>
  );
}

function ICClientProfile({ cc }: { cc: CaseRow }) {
  const product = PRODUCTS[cc.product_type];
  return (
    <div className="space-y-3 text-xs">
      <table className="w-full">
        <tbody>
          <ICRow label="Client Name" value={cc.client_name} />
          <ICRow label="Legal Constitution" value={cc.legal_constitution} />
          <ICRow label="Industry / Sector" value={cc.industry} />
          <ICRow label="Year Established" value={cc.year_established} />
          <ICRow label="Product Applied For" value={product.label} />
          <ICRow label="Principal Borrower" value={cc.principal_borrower} />
          <ICRow label="Website" value={cc.website} />
        </tbody>
      </table>
      {cc.promoter_details && (
        <div>
          <div className="terminal-label mb-1">PROMOTER DETAILS</div>
          <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{cc.promoter_details}</div>
        </div>
      )}
      {cc.group_summary && (
        <div>
          <div className="terminal-label mb-1">GROUP SUMMARY</div>
          <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{cc.group_summary}</div>
        </div>
      )}
    </div>
  );
}

function ICInvestmentStructure({ cc }: { cc: CaseRow }) {
  const product = PRODUCTS[cc.product_type];
  return (
    <div className="space-y-3 text-xs">
      <table className="w-full">
        <tbody>
          <ICRow label="Product / Facility Type" value={product.label} />
          <ICRow label="Legal Nature" value={product.legalNature} />
          <ICRow label="Return Mechanism" value={product.returnMechanism} />
          <ICRow label="Proposed Amount" value={cc.deal_amount != null ? `₹${Number(cc.deal_amount).toLocaleString("en-IN")} Crores` : null} />
          <ICRow label="Tenure" value={cc.tenure_months != null ? `${cc.tenure_months} Months` : null} />
          <ICRow label="Expected IRR" value={cc.expected_irr != null ? `${cc.expected_irr}%` : null} />
          <ICRow label="Residual Value" value={cc.residual_value != null ? `₹${Number(cc.residual_value).toLocaleString("en-IN")}` : null} />
          <ICRow label="Security Deposit" value={cc.security_deposit != null ? `₹${Number(cc.security_deposit).toLocaleString("en-IN")}` : null} />
        </tbody>
      </table>
      {cc.end_use && (
        <div>
          <div className="terminal-label mb-1">END USE OF FUNDS</div>
          <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{cc.end_use}</div>
        </div>
      )}
      {cc.collateral_summary && (
        <div>
          <div className="terminal-label mb-1">COLLATERAL / SECURITY</div>
          <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{cc.collateral_summary}</div>
        </div>
      )}
    </div>
  );
}

function ICRehbarHistory({ cc }: { cc: CaseRow }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="border border-border/40 bg-surface/30 p-3 space-y-1">
        <div className="text-[10px] text-accent font-bold tracking-widest mb-2">REHBAR FINANCIAL SERVICES — FUNDER PROFILE</div>
        <table className="w-full">
          <tbody>
            <ICRow label="Legal Entity" value="Rehbar Financial Services" />
            <ICRow label="Business Model" value="Sharia-compliant NBFC — asset financing & structured credit" />
            <ICRow label="Core Products" value="Operating Lease · Finance Lease · PLS · Project Finance · Trade Finance · Home Loan" />
            <ICRow label="Return Framework" value="Fixed rental / IRR / profit-share depending on product" />
            <ICRow label="Website" value="rehbar.co.in" />
          </tbody>
        </table>
      </div>
      <div>
        <div className="terminal-label mb-1">PRIOR EXPOSURE TO {cc.client_name.toUpperCase()}</div>
        <div className="text-foreground/60 italic text-xs">No prior Rehbar funding history on record for this client. This appears to be a new relationship.</div>
      </div>
    </div>
  );
}

function ICVisitReference({ cc }: { cc: CaseRow }) {
  return (
    <div className="space-y-3 text-xs">
      {cc.analyst_notes ? (
        <div>
          <div className="terminal-label mb-1">ANALYST NOTES / SITE VISIT OBSERVATIONS</div>
          <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{cc.analyst_notes}</div>
        </div>
      ) : (
        <div className="text-foreground/50 italic">No analyst notes recorded. Add visit report, reference check findings, and executive recommendation via [EDIT] on the case header.</div>
      )}
      <div className="border-t border-border/40 pt-3">
        <div className="terminal-label mb-2">REFERENCE CHECK TEMPLATE</div>
        <table className="w-full">
          <thead className="text-muted-foreground border-b border-border">
            <tr><th className="text-left py-0.5">CHECK TYPE</th><th className="text-left">SOURCE</th><th className="text-left">STATUS</th></tr>
          </thead>
          <tbody>
            {[["Banker Reference","Principal Bank","Pending"],["Vendor/Supplier Check","Key Suppliers","Pending"],["Customer Reference","Major Clients","Pending"],["Site Visit","Business Premises","Pending"]].map(([t,s,st]) => (
              <tr key={t} className="border-b border-border/30">
                <td className="py-0.5 text-foreground/90">{t}</td>
                <td className="text-foreground/60">{s}</td>
                <td className="text-warning">{st}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ICProductSpecifics({ cc }: { cc: CaseRow }) {
  const product = PRODUCTS[cc.product_type];
  return (
    <div className="space-y-3 text-xs">
      <table className="w-full">
        <tbody>
          <ICRow label="Product" value={product.label} />
          <ICRow label="Short Code" value={product.short} />
          <ICRow label="Legal Nature" value={product.legalNature} />
          <ICRow label="Return Mechanism" value={product.returnMechanism} />
        </tbody>
      </table>
      <div>
        <div className="terminal-label mb-2">SOP RULES APPLICABLE TO {product.short}</div>
        <ul className="space-y-1">
          {product.rules.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-warning shrink-0">▸</span>
              <span className="text-foreground/90">{r}</span>
            </li>
          ))}
        </ul>
      </div>
      {cc.policy_exceptions && (
        <div>
          <div className="terminal-label mb-1">POLICY EXCEPTIONS</div>
          <div className="text-warning whitespace-pre-wrap">{cc.policy_exceptions}</div>
        </div>
      )}
    </div>
  );
}

function BulletOnlyMd({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();
    if (trim.startsWith("|")) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { block.push(lines[i]); i++; }
      out.push(<MdTable key={`t-${i}`} lines={block} />);
      continue;
    }
    if (/^[-*]\s/.test(trim)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        bullets.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={`ul-${i}`} className="space-y-0.5 my-1">
          {bullets.map((b, bi) => (
            <li key={bi} className="flex gap-2 text-xs">
              <span className="text-warning shrink-0 mt-0.5">▸</span>
              <span className="text-foreground/90" dangerouslySetInnerHTML={{ __html: inlineMd(b) }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }
    if (trim.startsWith("### ")) {
      out.push(<div key={`h3-${i}`} className="text-[10px] font-bold text-accent tracking-widest mt-2 mb-0.5 uppercase">{trim.slice(4)}</div>);
      i++; continue;
    }
    if (trim.startsWith("## ") || trim.startsWith("# ")) {
      out.push(<div key={`h-${i}`} className="text-xs font-bold text-primary mt-2 mb-0.5">{trim.replace(/^#+\s+/, "")}</div>);
      i++; continue;
    }
    i++; // skip prose paragraphs
  }
  if (out.length === 0) return null;
  return <div className="space-y-1 text-xs mt-2">{out}</div>;
}

function MdRenderer({ text }: { text: string }) {
  if (!text) return <div className="text-muted-foreground text-xs italic">(empty)</div>;

  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();

    // Table block
    if (trim.startsWith("|")) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        block.push(lines[i]);
        i++;
      }
      out.push(<MdTable key={`t-${i}`} lines={block} />);
      continue;
    }

    // Bullet list block
    if (/^[-*]\s/.test(trim)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        bullets.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={`ul-${i}`} className="space-y-0.5 my-1">
          {bullets.map((b, bi) => (
            <li key={bi} className="flex gap-2 text-xs">
              <span className="text-warning shrink-0 mt-0.5">▸</span>
              <span className="text-foreground/90" dangerouslySetInnerHTML={{ __html: inlineMd(b) }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Headings
    if (trim.startsWith("### ")) {
      out.push(<div key={`h3-${i}`} className="text-[10px] font-bold text-accent tracking-widest mt-2 mb-0.5 uppercase">{trim.slice(4)}</div>);
      i++; continue;
    }
    if (trim.startsWith("## ") || trim.startsWith("# ")) {
      const t = trim.replace(/^#+\s+/, "");
      out.push(<div key={`h-${i}`} className="text-xs font-bold text-primary mt-2 mb-0.5">{t}</div>);
      i++; continue;
    }

    // Empty line — small gap
    if (trim === "") { i++; continue; }

    // Regular line
    out.push(
      <p key={`p-${i}`} className="text-xs text-foreground/90 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: inlineMd(trim) }}
      />
    );
    i++;
  }

  return <div className="space-y-1 text-xs">{out}</div>;
}
