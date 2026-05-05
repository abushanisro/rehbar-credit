import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { Panel } from "@/components/terminal/Panel";
import { PRODUCTS, type ProductType } from "@/features/credit/domain";
import { toast } from "sonner";

const INDUSTRIES = [
  "Agriculture & Food Processing",
  "Automotive",
  "Chemicals & Petrochemicals",
  "Construction & Infrastructure",
  "Education",
  "Energy & Utilities",
  "Financial Services",
  "Healthcare & Pharmaceuticals",
  "Hospitality & Tourism",
  "IT & Technology",
  "Logistics & Transportation",
  "Manufacturing",
  "Media & Entertainment",
  "Real Estate",
  "Retail & E-commerce",
  "Telecom",
  "Textile & Apparel",
  "Trading",
  "Other",
] as const;

type FormState = {
  client_name: string;
  product_type: ProductType;
  product_type_custom: string;
  industry: string;
  industry_custom: string;
  legal_constitution: string;
  year_established: string;
  deal_amount: string;
  tenure_months: string;
  expected_irr: string;
  end_use: string;
  strategic_rationale: string;
  collateral_summary: string;
  promoter_details: string;
  website: string;
};

type FileQueueItem = {
  id: string;
  name: string;
  size: string;
  fileType: "pdf" | "image" | "excel";
  excelText?: string;
  status: "pending" | "uploading" | "done" | "error";
  uploadPct: number;
  storagePath?: string;
};

type ScanResult = {
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

const SCANNABLE_FIELDS: { key: keyof ScanResult; label: string }[] = [
  { key: "client_name",        label: "Client Name" },
  { key: "product_type",       label: "Product Type" },
  { key: "legal_constitution", label: "Legal Constitution" },
  { key: "industry",           label: "Industry" },
  { key: "year_established",   label: "Year Established" },
  { key: "deal_amount",        label: "Deal Amount (Cr)" },
  { key: "tenure_months",      label: "Tenure (months)" },
  { key: "expected_irr",       label: "Expected IRR (%)" },
  { key: "promoter_details",   label: "Promoter Details" },
  { key: "end_use",            label: "End Use" },
  { key: "collateral_summary", label: "Collateral" },
  { key: "strategic_rationale",label: "Strategic Rationale" },
  { key: "website",            label: "Website" },
];

interface CompanySuggestion {
  id: string; name: string; legal_constitution: string | null;
  industry: string | null; year_established: number | null;
  gstin: string | null; website: string | null; promoter_details: string | null;
}

export default function NewCase() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    searchParams.get("company_id")
  );
  const [companySuggestions, setCompanySuggestions] = useState<CompanySuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const companySearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggBoxRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<FormState>({
    client_name: searchParams.get("company_name") ?? "",
    product_type: "operating_lease",
    product_type_custom: "",
    industry: "",
    industry_custom: "",
    legal_constitution: "Pvt Ltd",
    year_established: "",
    deal_amount: "",
    tenure_months: "",
    expected_irr: "",
    end_use: "",
    strategic_rationale: "",
    collateral_summary: "",
    promoter_details: "",
    website: "",
  });

  const [scanning, setScanning] = useState(false);
  const [scanStage, setScanStage] = useState("");
  const [scanPct, setScanPct] = useState(0);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [webEnriching, setWebEnriching] = useState(false);
  const [webEnrichPct, setWebEnrichPct] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [fileQueue, setFileQueue] = useState<FileQueueItem[]>([]);
  const cancelledRef = useRef(false);
  const currentXhrRef = useRef<XMLHttpRequest | null>(null);

  const product = PRODUCTS[form.product_type];

  // ── Company search ────────────────────────────────────────────────────────
  const searchCompanies = useCallback(async (q: string) => {
    if (q.length < 2) { setCompanySuggestions([]); setShowSuggestions(false); return; }
    const db = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
    const { data } = await db.from("companies")
      .select("id,name,legal_constitution,industry,year_established,gstin,website,promoter_details")
      .ilike("name", `%${q}%`)
      .limit(6);
    setCompanySuggestions((data ?? []) as CompanySuggestion[]);
    setShowSuggestions(true);
  }, []);

  const runWebEnrich = useCallback(async () => {
    if (!form.client_name.trim() && !form.website.trim()) return;
    setWebEnriching(true);
    setWebEnrichPct(5);
    setScanResult(null);
    const tick = setInterval(() => setWebEnrichPct(p => p < 88 ? p + 2 : p), 400);
    try {
      const { data, error } = await supabase.functions.invoke("web-enrich-company", {
        body: {
          company_name: form.client_name.trim() || undefined,
          website: form.website.trim() || undefined,
        },
      });
      clearInterval(tick);
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "Enrichment failed");
      setWebEnrichPct(100);
      setScanResult(data.extracted as ScanResult);
      toast.success("Company info found — review and apply");
    } catch (e) {
      clearInterval(tick);
      toast.error("Web search failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setTimeout(() => { setWebEnriching(false); setWebEnrichPct(0); }, 400);
    }
  }, [form.client_name, form.website]);

  const onClientNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setForm(f => ({ ...f, client_name: val }));
    setSelectedCompanyId(null);
    if (companySearchRef.current) clearTimeout(companySearchRef.current);
    companySearchRef.current = setTimeout(() => searchCompanies(val), 280);
  };

  const pickCompany = (co: CompanySuggestion) => {
    setSelectedCompanyId(co.id);
    setForm(f => ({
      ...f,
      client_name: co.name,
      legal_constitution: co.legal_constitution ?? f.legal_constitution,
      industry: co.industry && INDUSTRIES.includes(co.industry as typeof INDUSTRIES[number])
        ? co.industry : f.industry,
      year_established: co.year_established ? String(co.year_established) : f.year_established,
      website: co.website ?? f.website,
      promoter_details: co.promoter_details ?? f.promoter_details,
    }));
    setCompanySuggestions([]);
    setShowSuggestions(false);
    toast.success(`Linked to ${co.name} — form pre-filled`);
  };

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (suggBoxRef.current && !suggBoxRef.current.contains(e.target as Node))
        setShowSuggestions(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── form helpers ──────────────────────────────────────────────────────────
  const set = (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const applyScanned = () => {
    if (!scanResult) return;
    setForm((f) => {
      const next = { ...f };
      if (scanResult.client_name)        next.client_name        = scanResult.client_name;
      if (scanResult.product_type)       next.product_type       = scanResult.product_type;
      if (scanResult.product_type_custom)next.product_type_custom= scanResult.product_type_custom!;
      if (scanResult.legal_constitution) next.legal_constitution = scanResult.legal_constitution;
      if (scanResult.year_established)   next.year_established   = String(scanResult.year_established);
      if (scanResult.deal_amount != null) next.deal_amount        = String(scanResult.deal_amount);
      if (scanResult.tenure_months != null) next.tenure_months   = String(scanResult.tenure_months);
      if (scanResult.expected_irr != null)  next.expected_irr    = String(scanResult.expected_irr);
      if (scanResult.promoter_details)   next.promoter_details   = scanResult.promoter_details;
      if (scanResult.end_use)            next.end_use            = scanResult.end_use;
      if (scanResult.collateral_summary) next.collateral_summary = scanResult.collateral_summary;
      if (scanResult.strategic_rationale)next.strategic_rationale= scanResult.strategic_rationale;
      if (scanResult.website)            next.website            = scanResult.website;

      // industry: match against list or set "Other"
      if (scanResult.industry) {
        const match = INDUSTRIES.find(
          (i) => i.toLowerCase() === scanResult.industry!.toLowerCase()
        );
        if (match) {
          next.industry = match;
        } else {
          next.industry = "Other";
          next.industry_custom = scanResult.industry;
        }
      }
      return next;
    });
    toast.success("Form filled from document");
    setScanResult(null);
  };

  const resetScan = () => {
    cancelledRef.current = true;
    currentXhrRef.current?.abort();
    setScanning(false);
    setScanPct(0);
    setScanStage("");
    setFileQueue([]);
    setScanResult(null);
  };

  // ── multi-document scan ───────────────────────────────────────────────────
  const handleScanFiles = useCallback(async (rawFiles: File[]) => {
    if (!user || rawFiles.length === 0) return;
    cancelledRef.current = false;

    const makeItem = (f: File): FileQueueItem => {
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

    const initialQueue = rawFiles.map(makeItem);
    setFileQueue(initialQueue);
    setScanning(true); setScanPct(5); setScanStage("Preparing…"); setScanResult(null);

    const toUpload: Array<{ file_path: string; file_type: "pdf"|"image"|"excel"; file_name: string; excel_text?: string }> = [];

    for (let i = 0; i < rawFiles.length; i++) {
      if (cancelledRef.current) return;
      const f    = rawFiles[i];
      const item = initialQueue[i];

      // Parse Excel client-side
      let excelText: string | undefined;
      if (item.fileType === "excel") {
        setScanStage(`Parsing ${item.name}…`);
        const XLSX = await import("xlsx");
        const buf  = await f.arrayBuffer();
        const wb   = XLSX.read(buf, { type: "array" });
        excelText  = wb.SheetNames.map(n =>
          `=== SHEET: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t" })}`
        ).join("\n\n");
      }

      if (cancelledRef.current) return;

      setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "uploading" } : qi));
      setScanStage(`Uploading ${i + 1} of ${rawFiles.length}…`);

      const path = `${user.id}/drafts/${Date.now()}-${f.name}`;
      try {
        await uploadWithProgress(path, f, (pct) => {
          setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, uploadPct: pct } : qi));
          const perFile = 50 / rawFiles.length;
          setScanPct(Math.min(55, Math.round(5 + i * perFile + (pct / 100) * perFile)));
        }, currentXhrRef);
        setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "done", uploadPct: 100, storagePath: path } : qi));
        toUpload.push({ file_path: path, file_type: item.fileType, file_name: item.name, excel_text: excelText });
      } catch (e) {
        if (cancelledRef.current) return;
        setFileQueue(q => q.map(qi => qi.id === item.id ? { ...qi, status: "error" } : qi));
        toast.error(`Upload failed: ${item.name}`);
      }
    }

    if (cancelledRef.current || toUpload.length === 0) { setScanning(false); return; }

    const docWord = toUpload.length === 1 ? "document" : `${toUpload.length} documents`;
    setScanStage(`Claude analysing ${docWord}…`);
    setScanPct(60);
    const tick = setInterval(() => {
      if (cancelledRef.current) { clearInterval(tick); return; }
      setScanPct(p => p < 92 ? p + 1 : p);
    }, 500);

    try {
      const { data, error } = await supabase.functions.invoke("extract-case-meta", {
        body: { files: toUpload },
      });
      clearInterval(tick);
      if (cancelledRef.current) return;
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "Extraction failed");
      setScanPct(100); setScanStage("Done");
      setScanResult(data.extracted as ScanResult);
      toast.success(`${toUpload.length} document${toUpload.length > 1 ? "s" : ""} analysed — review and apply below`);
    } catch (e) {
      clearInterval(tick);
      if (!cancelledRef.current) { toast.error(e instanceof Error ? e.message : "Analysis failed"); setScanStage(""); }
    } finally {
      setTimeout(() => { setScanning(false); setScanPct(0); setScanStage(""); }, 600);
    }
  }, [user]);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) handleScanFiles(files);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleScanFiles(files);
  };

  // ── case submit ───────────────────────────────────────────────────────────
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    const code = `RH-${Date.now().toString(36).toUpperCase()}`;

    const resolvedIndustry =
      form.industry === "Other" ? form.industry_custom : form.industry;

    const { data, error } = await (supabase.from("credit_cases") as any).insert({
      user_id: user.id,
      case_code: code,
      client_name: form.client_name,
      company_id: selectedCompanyId || null,
      product_type: form.product_type,
      product_type_custom: form.product_type === "other" ? form.product_type_custom || null : null,
      industry: resolvedIndustry || null,
      legal_constitution: form.legal_constitution || null,
      year_established: form.year_established ? Number(form.year_established) : null,
      deal_amount: form.deal_amount ? Number(form.deal_amount) : null,
      tenure_months: form.tenure_months ? Number(form.tenure_months) : null,
      expected_irr: form.expected_irr ? Number(form.expected_irr) : null,
      end_use: form.end_use || null,
      strategic_rationale: form.strategic_rationale || null,
      collateral_summary: form.collateral_summary || null,
      promoter_details: form.promoter_details || null,
      website: form.website || null,
      delivery_email: user.email ?? "",
      status: "draft",
    }).select().single();

    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Case ${code} created`);
    navigate(`/case/${data.id}`);
  };

  // ── styles ────────────────────────────────────────────────────────────────
  const inputCls = "w-full bg-input border border-border px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-primary";
  const labelCls = "terminal-label block mb-1";

  return (
    <TerminalLayout>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">

        {/* ── LEFT: case form ─────────────────────────────────────────────── */}
        <Panel title="NEW CREDIT CASE — CLIENT & DEAL INFO" ticker="REHBAR/NEW" className="xl:col-span-8">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

              <div>
                <label className={labelCls}>Product Type *</label>
                <select className={inputCls} value={form.product_type} onChange={set("product_type")}>
                  {Object.values(PRODUCTS).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} {p.isCore ? "★ CORE" : ""}
                    </option>
                  ))}
                </select>
                {form.product_type === "other" && (
                  <input
                    className={`${inputCls} mt-1`}
                    placeholder="Specify product type…"
                    value={form.product_type_custom}
                    onChange={set("product_type_custom")}
                  />
                )}
              </div>

              <div ref={suggBoxRef} className="relative">
                <label className={labelCls}>Client Name *</label>
                <div className="relative">
                  <input
                    required
                    className={inputCls}
                    value={form.client_name}
                    onChange={onClientNameChange}
                    onFocus={() => form.client_name.length >= 2 && setShowSuggestions(companySuggestions.length > 0)}
                    placeholder="Type to search existing companies…"
                    autoComplete="off"
                  />
                  {selectedCompanyId && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-success font-bold tracking-widest">● LINKED</span>
                  )}
                </div>
                {showSuggestions && companySuggestions.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 top-full border border-border bg-card shadow-xl mt-px max-h-52 overflow-y-auto">
                    {companySuggestions.map(co => (
                      <button
                        key={co.id}
                        type="button"
                        onClick={() => pickCompany(co)}
                        className="w-full text-left px-3 py-2 hover:bg-surface-2 border-b border-border/40 transition-colors"
                      >
                        <div className="text-xs font-bold text-primary">{co.name}</div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">
                          {[co.legal_constitution, co.industry, co.gstin].filter(Boolean).join(" · ")}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className={labelCls}>Website</label>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="example.com or https://example.in"
                  value={form.website}
                  onChange={set("website")}
                />
              </div>

              <div className="col-span-2">
                <button
                  type="button"
                  onClick={runWebEnrich}
                  disabled={webEnriching || (!form.client_name.trim() && !form.website.trim())}
                  className="w-full border border-primary/40 bg-primary/5 text-primary px-4 py-2 text-xs tracking-widest font-bold hover:bg-primary/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {webEnriching ? "SEARCHING WEB & FILLING FORM…" : "WEB SEARCH & AUTO-FILL ALL FIELDS"}
                </button>
                {!form.client_name.trim() && !form.website.trim() && (
                  <p className="text-[10px] text-foreground/40 mt-1 tracking-wider">Enter client name or website above first</p>
                )}
              </div>

              <div>
                <label className={labelCls}>Legal Constitution</label>
                <select className={inputCls} value={form.legal_constitution} onChange={set("legal_constitution")}>
                  <option>Pvt Ltd</option>
                  <option>Public Ltd</option>
                  <option>Partnership</option>
                  <option>LLP</option>
                  <option>Proprietorship</option>
                  <option>Individual</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>Industry / Sector</label>
                <select className={inputCls} value={form.industry} onChange={set("industry")}>
                  <option value="">— Select Industry —</option>
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
                {form.industry === "Other" && (
                  <input
                    className={`${inputCls} mt-1`}
                    placeholder="Specify industry / sector…"
                    value={form.industry_custom}
                    onChange={set("industry_custom")}
                  />
                )}
              </div>

              <div className="col-span-2">
                <label className={labelCls}>Promoter Details</label>
                <textarea
                  className={inputCls}
                  rows={2}
                  placeholder="Key promoters, directors, shareholding pattern…"
                  value={form.promoter_details}
                  onChange={set("promoter_details")}
                />
              </div>

              <div>
                <label className={labelCls}>Year Established</label>
                <input type="number" className={inputCls} value={form.year_established} onChange={set("year_established")} />
              </div>

              <div>
                <label className={labelCls}>Deal Amount (INR Crores)</label>
                <input type="number" step="0.01" className={inputCls} placeholder="e.g. 2.50" value={form.deal_amount} onChange={set("deal_amount")} />
              </div>

              <div>
                <label className={labelCls}>Tenure (months)</label>
                <input type="number" className={inputCls} value={form.tenure_months} onChange={set("tenure_months")} />
              </div>

              <div>
                <label className={labelCls}>Expected IRR (%)</label>
                <input type="number" step="0.01" className={inputCls} value={form.expected_irr} onChange={set("expected_irr")} />
              </div>

            </div>

            <div>
              <label className={labelCls}>End Use of Funds</label>
              <textarea className={inputCls} rows={2} value={form.end_use} onChange={set("end_use")} />
            </div>
            <div>
              <label className={labelCls}>Strategic Rationale (Why Rehbar?)</label>
              <textarea className={inputCls} rows={2} value={form.strategic_rationale} onChange={set("strategic_rationale")} placeholder="Shariya compliance / one of financing co. / lender of last resort" />
            </div>
            <div>
              <label className={labelCls}>Collateral Summary</label>
              <textarea className={inputCls} rows={2} value={form.collateral_summary} onChange={set("collateral_summary")} />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="bg-primary text-primary-foreground px-4 py-2 text-sm tracking-widest font-bold hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "CREATING..." : "[CREATE CASE → UPLOAD DOCS]"}
            </button>
          </form>
        </Panel>

        {/* ── RIGHT: product rules + AI scan ──────────────────────────────── */}
        <div className="xl:col-span-4 flex flex-col gap-3">

          {/* Product Rules */}
          <Panel title="PRODUCT RULES" ticker={product.short} status="warn">
            <div className="space-y-3 text-xs">
              <div>
                <div className="terminal-label">LEGAL NATURE</div>
                <div className="text-primary mt-1">{product.legalNature}</div>
              </div>
              <div>
                <div className="terminal-label">RETURN MECHANISM</div>
                <div className="text-primary mt-1">{product.returnMechanism}</div>
              </div>
              <div>
                <div className="terminal-label">SOP RULES</div>
                <ul className="mt-1 space-y-1">
                  {product.rules.map((r, i) => (
                    <li key={i} className="text-foreground/80 flex gap-2">
                      <span className="text-warning">▸</span><span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>

          {/* AI Document Scan */}
          <Panel title="AI DOCUMENT SCAN" ticker="CLAUDE/4.6" status="live">
            <div className="space-y-3 text-xs">

              <p className="text-foreground/60 leading-relaxed">
                Upload a company profile, loan application, CMA, or any relevant document.
                Claude will read it end-to-end and auto-fill the form.
              </p>

              {/* Drop zone */}
              <div
                className={`border-2 border-dashed transition-colors cursor-pointer ${
                  dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                } ${scanning ? "pointer-events-none opacity-50" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp"
                  multiple
                  onChange={onFileInput}
                />
                {fileQueue.length > 0 ? (
                  <div className="px-3 py-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="terminal-label text-primary">
                        {fileQueue.length} FILE{fileQueue.length > 1 ? "S" : ""}
                      </span>
                      <span className="text-foreground/40 text-[10px]">· drop more to add</span>
                    </div>
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {fileQueue.map(item => (
                        <div key={item.id} className="flex items-center gap-1.5 text-[10px]">
                          <span className={
                            item.status === "done"     ? "text-green-500" :
                            item.status === "error"    ? "text-red-500"   :
                            item.status === "uploading"? "text-primary"   : "text-foreground/30"
                          }>
                            {item.status === "done" ? "●" : item.status === "error" ? "✗" : item.status === "uploading" ? "▶" : "○"}
                          </span>
                          <span className="truncate flex-1 text-primary">{item.name}</span>
                          <span className="text-foreground/40 shrink-0">{item.size}</span>
                          {item.status === "uploading" && (
                            <span className="text-primary shrink-0 w-8 text-right">{item.uploadPct}%</span>
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

              {/* Web search progress */}
              {webEnriching && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-foreground/60 text-xs">
                    <span>Searching web &amp; analysing…</span>
                    <span className="font-mono text-primary">{webEnrichPct}%</span>
                  </div>
                  <div className="w-full h-1 bg-border">
                    <div
                      className="h-1 bg-primary transition-all duration-300"
                      style={{ width: `${webEnrichPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Document scan progress */}
              {scanning && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-foreground/60">
                    <span>{scanStage}</span>
                    <span>{scanPct}%</span>
                  </div>
                  <div className="w-full h-1 bg-border">
                    <div
                      className="h-1 bg-primary transition-all duration-300"
                      style={{ width: `${scanPct}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={resetScan}
                    className="w-full border border-border text-foreground/50 py-1 text-xs tracking-widest hover:border-red-500 hover:text-red-400 transition-colors"
                  >
                    [CANCEL]
                  </button>
                </div>
              )}

              {/* Results */}
              {scanResult && (
                <div className="space-y-2">
                  {/* Summary box */}
                  {scanResult.summary && (
                    <div className="border border-border p-2 bg-input/30">
                      <div className="terminal-label mb-1">AI SUMMARY</div>
                      <p className="text-foreground/80 leading-relaxed">{scanResult.summary}</p>
                      {scanResult.confidence != null && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="flex-1 h-0.5 bg-border">
                            <div
                              className={`h-0.5 ${scanResult.confidence >= 70 ? "bg-green-500" : scanResult.confidence >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
                              style={{ width: `${scanResult.confidence}%` }}
                            />
                          </div>
                          <span className="text-foreground/50">{scanResult.confidence}% conf.</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Field preview */}
                  <div className="terminal-label">EXTRACTED FIELDS</div>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
                    {SCANNABLE_FIELDS.map(({ key, label }) => {
                      const val = scanResult[key];
                      if (val == null || val === "") return null;
                      return (
                        <div key={key} className="flex gap-2">
                          <span className="text-foreground/40 shrink-0 w-28">{label}</span>
                          <span className="text-primary truncate">{String(val)}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Apply button */}
                  <button
                    type="button"
                    onClick={applyScanned}
                    className="w-full bg-primary text-primary-foreground py-1.5 text-xs tracking-widest font-bold hover:opacity-90"
                  >
                    [APPLY TO FORM]
                  </button>
                  <button
                    type="button"
                    onClick={() => { setScanResult(null); setFileQueue([]); }}
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
    </TerminalLayout>
  );
}

// ── XHR upload with progress ─────────────────────────────────────────────────
async function uploadWithProgress(
  path: string,
  file: File,
  onPct: (pct: number) => void,
  xhrRef?: React.MutableRefObject<XMLHttpRequest | null>,
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/case-files/${encodeURIComponent(path)}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (xhrRef) xhrRef.current = xhr;
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("x-upsert", "false");
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}
