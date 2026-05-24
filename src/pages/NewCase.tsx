import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { Panel } from "@/components/terminal/Panel";
import { PRODUCTS, type ProductType } from "@/features/credit/domain";
import { toast } from "sonner";
import { parseAccumnExcel, mapToIndustry as _mapIndustry, mapToConstitution as _mapConstitution, type McaProfile, type Director } from "@/lib/mca-parser";

const INDUSTRIES = [
  "Agriculture & Food Processing",
  "Automotive",
  "Chemicals & Petrochemicals",
  "Construction & Infrastructure",
  "Education",
  "Energy & Utilities",
  "EV Logistics & Transportation",
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
  about: string;
  has_partner: boolean;
  partner_company_name: string;
  assign_name: string;
  assign_email: string;
  assign_role: string;
};

type FileQueueItem = {
  id: string;
  name: string;
  size: string;
  fileType: "pdf" | "image" | "excel";
  excelText?: string;
  status: "pending" | "uploading" | "done" | "error" | "duplicate";
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
  { key: "summary",            label: "About Company" },
];

interface CompanySuggestion {
  id: string; name: string; legal_constitution: string | null;
  industry: string | null; year_established: number | null;
  gstin: string | null; website: string | null; promoter_details: string | null;
}


type TeamMember = { id: string; email: string; full_name: string | null; role: string | null };

export default function NewCase() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
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
    about: "",
    has_partner: false,
    partner_company_name: "",
    assign_name: "",
    assign_email: "",
    assign_role: "analyst",
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
  const mcaFileInputRef = useRef<HTMLInputElement>(null);
  const [mcaProfile, setMcaProfile] = useState<McaProfile | null>(null);
  const [mcaImporting, setMcaImporting] = useState(false);

  const product = PRODUCTS[form.product_type];

  // ── Company search ────────────────────────────────────────────────────────
  const searchCompanies = useCallback(async (q: string) => {
    if (q.length < 2) { setCompanySuggestions([]); setShowSuggestions(false); return; }
    const { data } = await supabase.from("companies")
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

  // ── load team members for assignee picker ─────────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from("profiles").select("id,email,full_name"),
      supabase.from("user_roles").select("user_id,role"),
    ]).then(([{ data: profiles }, { data: roles }]) => {
      const roleMap = Object.fromEntries((roles ?? []).map(r => [r.user_id, r.role as string]));
      setTeamMembers(
        (profiles ?? [])
          .filter(p => p.email && p.id !== user?.id)
          .map(p => ({ id: p.id, email: p.email!, full_name: p.full_name ?? null, role: roleMap[p.id] ?? null }))
          .sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email))
      );
    });
  }, [user?.id]);

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
      if (scanResult.summary)            next.about              = scanResult.summary;

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

  const handleMcaExcelImport = async (file: File) => {
    setMcaImporting(true);
    try {
      const { profile, companyName, websiteUrl } = await parseAccumnExcel(file);
      setMcaProfile(profile);

      const industry = _mapIndustry(profile.sector || profile.nse_sector || "");
      const constitution = _mapConstitution(profile.category || "", profile.mca_type || "");
      let yearEst = "";
      if (profile.date_of_incorporation) {
        const parts = profile.date_of_incorporation.split("/");
        const yr = parts.length === 3 ? parts[2] : parts[0];
        if (yr && yr.length === 4) yearEst = yr;
      }

      setForm(f => ({
        ...f,
        client_name: companyName || f.client_name,
        website: websiteUrl || f.website,
        year_established: yearEst || f.year_established,
        industry: industry && INDUSTRIES.includes(industry as typeof INDUSTRIES[number]) ? industry : f.industry,
        legal_constitution: constitution || f.legal_constitution,
        promoter_details: "",
      }));

      toast.success(
        `Imported: ${companyName || "Company"} · ${profile.directors.length} director${profile.directors.length !== 1 ? "s" : ""}`
      );
    } catch (err) {
      console.error(err);
      toast.error("Failed to parse Excel — check the file format");
    } finally {
      setMcaImporting(false);
      if (mcaFileInputRef.current) mcaFileInputRef.current.value = "";
    }
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

    const seenNames = new Set<string>();
    const initialQueue = rawFiles.map(f => {
      const item = makeItem(f);
      if (seenNames.has(f.name)) return { ...item, status: "duplicate" as const };
      seenNames.add(f.name);
      return item;
    });
    setFileQueue(initialQueue);
    setScanning(true); setScanPct(5); setScanStage("Preparing…"); setScanResult(null);

    const toUpload: Array<{ file_path: string; file_type: "pdf"|"image"|"excel"; file_name: string; excel_text?: string }> = [];

    for (let i = 0; i < rawFiles.length; i++) {
      if (cancelledRef.current) return;
      const f    = rawFiles[i];
      const item = initialQueue[i];

      if (item.status === "duplicate") continue;

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

  // ── helpers to save MCA data to a company record ─────────────────────────
  const saveMcaToCompany = async (companyId: string) => {
    if (!mcaProfile) return;
    await supabase.from("companies").update({
      mca_cin: mcaProfile.cin ?? null,
      mca_pan: mcaProfile.pan ?? null,
      mca_lei: mcaProfile.lei ?? null,
      mca_category: mcaProfile.category ?? null,
      mca_sub_category: mcaProfile.sub_category ?? null,
      mca_type: mcaProfile.mca_type ?? null,
      mca_authorized_capital: mcaProfile.authorized_capital ?? null,
      mca_paid_up_capital: mcaProfile.paid_up_capital ?? null,
      mca_status: mcaProfile.mca_status ?? null,
      mca_nse_sector: mcaProfile.nse_sector ?? null,
      mca_sector: mcaProfile.sector ?? null,
      mca_products_services: mcaProfile.products_services ?? null,
      mca_email: mcaProfile.email ?? null,
      mca_telephone: mcaProfile.telephone ?? null,
      mca_date_of_incorp: mcaProfile.date_of_incorporation ?? null,
      mca_date_last_bs: mcaProfile.date_of_last_bs ?? null,
      mca_date_last_agm: mcaProfile.date_of_last_agm ?? null,
      mca_about: mcaProfile.about ?? null,
    }).eq("id", companyId);

    if (mcaProfile.directors.length > 0) {
      await supabase.from("company_directors").delete().eq("company_id", companyId);
      await supabase.from("company_directors").insert(
        mcaProfile.directors.map((d: import("@/lib/mca-parser").Director) => ({ ...d, company_id: companyId }))
      );
    }
  };

  // ── case submit ───────────────────────────────────────────────────────────
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    const code = `RH-${Date.now().toString(36).toUpperCase()}`;

    const resolvedIndustry =
      form.industry === "Other" ? form.industry_custom : form.industry;

    // Always auto-create a company if not already linked (web search, MCA import, or manual entry)
    let companyId = selectedCompanyId || null;
    if (!companyId && form.client_name.trim()) {
      const { data: newCo, error: coErr } = await supabase.from("companies").insert({
        name: form.client_name.trim(),
        legal_constitution: form.legal_constitution || null,
        industry: resolvedIndustry || null,
        year_established: form.year_established ? Number(form.year_established) : null,
        website: form.website || null,
        promoter_details: form.promoter_details || null,
        notes: form.about || null,
        registered_address: mcaProfile?.raw_address || null,
        created_by: user.id,
      }).select("id").single();
      if (!coErr && newCo?.id) companyId = newCo.id;
    } else if (companyId && (form.about || form.promoter_details || form.website)) {
      // Update existing linked company with any enriched data from web search
      await supabase.from("companies").update({
        ...(form.website         ? { website:          form.website }         : {}),
        ...(form.promoter_details? { promoter_details: form.promoter_details } : {}),
        ...(form.about           ? { notes:            form.about }            : {}),
        ...(form.year_established? { year_established: Number(form.year_established) } : {}),
      }).eq("id", companyId);
    }

    const { data, error } = await supabase.from("credit_cases").insert({
      user_id: user.id,
      case_code: code,
      client_name: form.client_name,
      company_id: companyId,
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
      ...(form.has_partner ? {
        ic_note: {
          has_partner: true,
          partner_company_name: form.partner_company_name.trim() || null,
        },
      } : {}),
    }).select().single();

    setSubmitting(false);
    if (error) { toast.error(error.message); return; }

    // Save MCA data to the company (whether newly created or pre-existing)
    if (mcaProfile && companyId) await saveMcaToCompany(companyId);

    // Resolve final assignee email — "__new__" is the picker placeholder, not a real email
    const assignEmail = (form.assign_email && form.assign_email !== "__new__")
      ? form.assign_email.trim()
      : "";
    const assignName = form.assign_name.trim();

    if (assignEmail) {
      const { data: inviteData, error: inviteErr } = await supabase.functions.invoke("invite-user", {
        body: {
          email:            assignEmail,
          name:             assignName || undefined,
          role:             form.assign_role,
          case_code:        code,
          client_name:      form.client_name,
          invited_by_email: user.email ?? "",
        },
      });
      if (inviteErr) {
        toast.error(`Case created but invite failed: ${inviteErr.message}`);
      } else if (inviteData?.already_exists) {
        toast.success(`Case ${code} created · assigned to ${assignName || assignEmail}`);
      } else {
        toast.success(`Case ${code} created · invite sent to ${assignEmail}`);
      }
    } else {
      toast.success(`Case ${code} created`);
    }

    navigate(`/case/${data.id}`);
  };

  // ── styles ────────────────────────────────────────────────────────────────
  const inputCls = "w-full bg-input border border-border px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-primary";
  const labelCls = "terminal-label block mb-1";

  return (
    <TerminalLayout>
      <div className="space-y-3">
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

              {/* MCA / Corpository Excel import */}
              <div className="col-span-2">
                <input
                  ref={mcaFileInputRef}
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleMcaExcelImport(f);
                  }}
                />
                <button
                  type="button"
                  onClick={() => mcaFileInputRef.current?.click()}
                  disabled={mcaImporting}
                  className="w-full border border-border bg-surface-2 text-muted-foreground px-4 py-2 text-xs tracking-widest font-bold hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {mcaImporting ? "IMPORTING MCA EXCEL…" : "↑ IMPORT CORPOSITORY / MCA EXCEL  (auto-fills company + directors)"}
                </button>
                {mcaProfile && (
                  <p className="text-[10px] text-success mt-1 tracking-wider">
                    ● MCA profile imported — {mcaProfile.directors.length} director{mcaProfile.directors.length !== 1 ? "s" : ""} · see Directors tab below
                    {mcaProfile.cin ? ` · CIN: ${mcaProfile.cin}` : ""}
                    <button
                      type="button"
                      onClick={() => setMcaProfile(null)}
                      className="ml-2 text-destructive hover:opacity-70"
                    >
                      ✕ clear
                    </button>
                  </p>
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
            <div>
              <label className={labelCls}>About Company</label>
              <textarea
                className={inputCls}
                rows={3}
                placeholder="AI-generated or manual company overview — saved to company profile"
                value={form.about}
                onChange={set("about")}
              />
            </div>

            {/* Partner Company Toggle */}
            <div className="border border-border bg-surface/40 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, has_partner: !f.has_partner, partner_company_name: f.has_partner ? "" : f.partner_company_name }))}
                  className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${form.has_partner ? "bg-primary" : "bg-border"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.has_partner ? "left-[22px]" : "left-0.5"}`} />
                </button>
                <span className="text-xs tracking-widest font-bold text-foreground/80">DOES THIS DEAL INVOLVE A PARTNER / GROUP COMPANY?</span>
              </div>
              {form.has_partner && (
                <div>
                  <label className={labelCls}>Partner Company Name</label>
                  <input
                    className={inputCls}
                    placeholder="e.g. ABC Holdings Pvt Ltd"
                    value={form.partner_company_name}
                    onChange={set("partner_company_name")}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 tracking-wide">
                    Partner financials can be entered in the REVIEW tab after case creation.
                  </p>
                </div>
              )}
            </div>

            {/* Assign To */}
            <div className="border border-border bg-surface/40 px-3 py-2.5 space-y-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">▶ ASSIGN TO</div>

              {/* Existing team member picker */}
              {teamMembers.length > 0 && (
                <div>
                  <label className={labelCls}>Pick from team</label>
                  <select
                    className={inputCls}
                    value={form.assign_email}
                    onChange={e => {
                      const picked = teamMembers.find(m => m.email === e.target.value);
                      if (picked) {
                        setForm(f => ({
                          ...f,
                          assign_email: picked.email,
                          assign_name:  picked.full_name ?? "",
                          assign_role:  picked.role ?? "analyst",
                        }));
                      } else {
                        setForm(f => ({ ...f, assign_email: "", assign_name: "", assign_role: "analyst" }));
                      }
                    }}
                  >
                    <option value="">— Select team member —</option>
                    {teamMembers.map(m => {
                      const roleLabel: Record<string,string> = { admin:"ADM", analyst:"ANL", business_development:"BD", ic_member:"IC", credit_committee:"CC", operations:"OPS" };
                      const badge = m.role ? `[${roleLabel[m.role] ?? m.role.toUpperCase()}]` : "";
                      return (
                        <option key={m.id} value={m.email}>
                          {m.full_name ? `${m.full_name} — ${m.email}` : m.email} {badge}
                        </option>
                      );
                    })}
                    <option value="__new__">+ Invite someone new…</option>
                  </select>
                </div>
              )}

              {/* Show manual inputs when "Invite new" is selected OR no team yet */}
              {(teamMembers.length === 0 || form.assign_email === "__new__" || (form.assign_email && !teamMembers.find(m => m.email === form.assign_email))) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Name (optional)</label>
                    <input
                      type="text"
                      className={inputCls}
                      placeholder="Full name"
                      value={form.assign_email === "__new__" ? form.assign_name : form.assign_name}
                      onChange={set("assign_name")}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Email *</label>
                    <input
                      type="email"
                      className={inputCls}
                      placeholder="analyst@rehbar.co.in"
                      value={form.assign_email === "__new__" ? "" : form.assign_email}
                      onChange={e => setForm(f => ({ ...f, assign_email: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              {/* Role selector — always shown when someone is assigned */}
              {form.assign_email && form.assign_email !== "__new__" && (
                <div>
                  <label className={labelCls}>Role</label>
                  <select className={inputCls} value={form.assign_role} onChange={set("assign_role")}>
                    <option value="analyst">Credit Analyst</option>
                    <option value="business_development">Business Development</option>
                    <option value="ic_member">IC Member</option>
                    <option value="credit_committee">Credit Committee</option>
                    <option value="operations">Operations</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
              )}

              {form.assign_email && form.assign_email !== "__new__" && (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground tracking-wide">
                    Assigned to <span className="text-primary font-bold">{form.assign_name || form.assign_email}</span>
                    {!teamMembers.find(m => m.email === form.assign_email) && " · invite email will be sent"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, assign_email: "", assign_name: "", assign_role: "analyst" }))}
                    className="text-[9px] text-muted-foreground/50 hover:text-destructive tracking-widest"
                  >
                    CLEAR ✕
                  </button>
                </div>
              )}
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

      {/* ── MCA PROFILE + DIRECTORS — full width, below grid ─────────────── */}
      {mcaProfile && (
        <div className="space-y-3">

          {/* Company MCA details */}
          <Panel title="MCA / CORPOSITORY PROFILE" ticker={mcaProfile.cin ?? "IMPORTED"} status="live">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-xs">
              {[
                { label: "CIN",                value: mcaProfile.cin },
                { label: "PAN",                value: mcaProfile.pan },
                { label: "LEI",                value: mcaProfile.lei },
                { label: "CATEGORY",           value: mcaProfile.category },
                { label: "SUB CATEGORY",       value: mcaProfile.sub_category },
                { label: "COMPANY TYPE",       value: mcaProfile.mca_type },
                { label: "AUTH. CAPITAL",      value: mcaProfile.authorized_capital },
                { label: "PAID UP CAPITAL",    value: mcaProfile.paid_up_capital },
                { label: "STATUS",             value: mcaProfile.mca_status },
                { label: "NSE SECTOR",         value: mcaProfile.nse_sector },
                { label: "SECTOR",             value: mcaProfile.sector },
                { label: "PRODUCTS/SERVICES",  value: mcaProfile.products_services },
                { label: "EMAIL",              value: mcaProfile.email },
                { label: "TELEPHONE",          value: mcaProfile.telephone },
                { label: "INCORPORATION DATE", value: mcaProfile.date_of_incorporation },
                { label: "LAST BALANCE SHEET", value: mcaProfile.date_of_last_bs },
                { label: "LAST AGM",           value: mcaProfile.date_of_last_agm },
              ].filter(f => f.value).map(f => (
                <div key={f.label}>
                  <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">{f.label}</div>
                  <div className="text-primary font-mono">{f.value}</div>
                </div>
              ))}
              {mcaProfile.raw_address && (
                <div className="col-span-2 sm:col-span-3 lg:col-span-5">
                  <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">REGISTERED ADDRESS</div>
                  <div className="text-primary">{mcaProfile.raw_address}</div>
                </div>
              )}
            </div>
          </Panel>

          {/* Directors table */}
          {mcaProfile.directors.length > 0 && (
            <Panel title="DIRECTORS" ticker={`${mcaProfile.directors.length} DIRECTORS`} status="live">
              <div className="overflow-x-auto">
                <table className="text-[11px] font-mono border-collapse" style={{ minWidth: "2400px" }}>
                  <thead>
                    <tr className="border-b border-border bg-surface/60 text-[9px] tracking-widest text-muted-foreground">
                      {["NAME","DIN","PAN","DIN STATUS","DSC STATUS","DOB","AGE","GENDER","NATIONALITY",
                        "DESIGNATION","CATEGORY","APPOINTED CURRENT","ORIGINALLY APPOINTED",
                        "CESSATION","% SHAREHOLDING","EMAIL","PHONE","REMARKS","ADDRESS"].map(h => (
                        <th key={h} className="text-left py-2 px-3 font-normal whitespace-nowrap border-r border-border/30">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mcaProfile.directors.map((d, i) => {
                      const dm = d.designation?.match(/^(.+?)\((.+?)\)$/);
                      const role = dm ? dm[1].trim() : (d.designation || "");
                      const cat  = dm ? dm[2].trim() : "";
                      return (
                        <tr key={i} className="border-b border-border/40 hover:bg-surface-2 transition-colors align-top">
                          <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                            <div className="font-bold text-primary">{d.name}</div>
                            {d.dob && <div className="text-[9px] text-muted-foreground mt-0.5">DOB: {d.dob}</div>}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.din || "—"}</td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.pan || "—"}</td>
                          <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                            {d.din_status ? <span className={`text-[9px] font-bold tracking-widest ${d.din_status.toLowerCase() === "approved" ? "text-success" : "text-muted-foreground"}`}>{d.din_status.toUpperCase()}</span> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.dsc_status || "—"}</td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.dob || "—"}</td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.age || "—"}</td>
                          <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                            {d.gender ? <span className={`text-[9px] font-bold tracking-widest ${d.gender.toLowerCase() === "female" ? "text-accent" : "text-primary"}`}>{d.gender.toUpperCase()}</span> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.nationality || "—"}</td>
                          <td className="py-2 px-3 whitespace-nowrap border-r border-border/20 text-primary">{role || "—"}</td>
                          <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                            {cat && cat !== "-" ? <span className="text-accent text-[9px] tracking-widest">{cat}</span> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.appointed_current || "—"}</td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.originally_appointed || "—"}</td>
                          <td className="py-2 px-3 whitespace-nowrap border-r border-border/20">
                            {d.cessation_date && d.cessation_date !== "-"
                              ? <span className="text-[9px] font-bold tracking-widest text-destructive">{d.cessation_date}</span>
                              : <span className="text-[9px] text-success font-bold tracking-widest">ACTIVE</span>}
                          </td>
                          <td className="py-2 px-3 border-r border-border/20 whitespace-nowrap">
                            {d.shareholding ? (() => {
                              const m = String(d.shareholding).match(/^(.+?)\s*(\(.+\))$/);
                              return m ? <><div className="text-muted-foreground">{m[1].trim()}</div><div className="text-[8px] text-muted-foreground/50 mt-0.5">{m[2]}</div></> : <span className="text-muted-foreground">{d.shareholding}</span>;
                            })() : "—"}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.email || "—"}</td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">{d.phone || "—"}</td>
                          <td className="py-2 px-3 border-r border-border/20" style={{maxWidth:"180px"}}>
                            <div className="text-muted-foreground text-[10px] leading-snug line-clamp-2" style={{wordBreak:"break-word"}} title={d.remarks||""}>{d.remarks || "—"}</div>
                          </td>
                          <td className="py-2 px-3" style={{maxWidth:"200px"}}>
                            <div className="text-muted-foreground text-[10px] leading-snug line-clamp-2" style={{wordBreak:"break-word"}} title={d.address||""}>{d.address || "—"}</div>
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
      )}

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
