import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { Panel } from "@/components/terminal/Panel";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyRow {
  id: string; name: string; legal_constitution: string | null;
  industry: string | null; year_established: number | null;
  gstin: string | null; website: string | null;
  promoter_details: string | null; registered_address: string | null;
  notes: string | null; is_active: boolean; created_at: string;
}

interface CaseRow {
  id: string; case_code: string; client_name: string;
  status: string; product_type: string; deal_amount: number | null;
  tenure_months: number | null; expected_irr: number | null;
  created_at: string; user_id: string;
}

interface FinRow {
  fiscal_year: number; statement_type: string;
  line_items: unknown; unit: string | null;
}

interface TrendPoint {
  fy: string;
  turnover: number | null; ebitda: number | null; pat: number | null;
  netWorth: number | null; totalDebt: number | null;
}

const INDUSTRIES = [
  "Agriculture & Food Processing","Automotive","Chemicals & Petrochemicals",
  "Construction & Infrastructure","Education","Energy & Utilities",
  "Financial Services","Healthcare & Pharmaceuticals","Hospitality & Tourism",
  "IT & Technology","Logistics & Transportation","Manufacturing",
  "Media & Entertainment","Real Estate","Retail & E-commerce",
  "Telecom","Textile & Apparel","Trading","Other",
];
const CONSTITUTIONS = ["Pvt Ltd","Public Ltd","Partnership","LLP","Proprietorship","Individual"];

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:       { label: "DRAFT",       color: "text-muted-foreground" },
  extracting:  { label: "EXTRACTING",  color: "text-warning" },
  extracted:   { label: "EXTRACTED",   color: "text-accent" },
  analysis:    { label: "ANALYSIS",    color: "text-accent" },
  narrative:   { label: "NARRATIVE",   color: "text-accent" },
  ic_review:   { label: "IC REVIEW",   color: "text-primary" },
  approved:    { label: "APPROVED",    color: "text-success" },
  declined:    { label: "DECLINED",    color: "text-destructive" },
  on_hold:     { label: "ON HOLD",     color: "text-warning" },
  disbursed:   { label: "DISBURSED",   color: "text-success" },
  closed:      { label: "CLOSED",      color: "text-muted-foreground" },
};

function lv(items: { label: string; value: number | null; override_value?: number | null }[], label: string): number | null {
  const it = items.find(i => i.label === label);
  if (!it) return null;
  const v = it.override_value ?? it.value;
  return (v !== null && v !== undefined && Number.isFinite(Number(v))) ? Number(v) : null;
}

const inputCls = "w-full bg-input border border-border px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary placeholder:text-muted-foreground/40";
const labelCls = "block text-[9px] tracking-widest text-muted-foreground mb-1 uppercase";

type Tab = "overview" | "deals" | "financials";

// ── Component ─────────────────────────────────────────────────────────────────

export default function CompanyView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [company, setCompany] = useState<CompanyRow | null>(null);
  const [cases, setCases]     = useState<CaseRow[]>([]);
  const [financials, setFinancials] = useState<FinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<Tab>("overview");
  const [editing, setEditing]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm]       = useState({
    name: "", legal_constitution: "", industry: "",
    year_established: "", gstin: "", website: "",
    promoter_details: "", registered_address: "", notes: "",
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const db = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
    const [{ data: co }, { data: cs }, { data: fin }] = await Promise.all([
      db.from("companies").select("*").eq("id", id).single(),
      supabase.from("credit_cases")
        .select("id,case_code,client_name,status,product_type,deal_amount,tenure_months,expected_irr,created_at,user_id")
        .eq("company_id" as never, id)
        .order("created_at", { ascending: false }),
      supabase.from("extracted_financials")
        .select("fiscal_year,statement_type,line_items,unit")
        .in("case_id" as never, []) as ReturnType<typeof supabase.from>, // filled below
    ]);

    setCompany(co as CompanyRow ?? null);
    const caseList = (cs ?? []) as CaseRow[];
    setCases(caseList);

    // Load financials across all cases for this company
    if (caseList.length > 0) {
      const { data: finData } = await supabase
        .from("extracted_financials")
        .select("fiscal_year,statement_type,line_items,unit")
        .in("case_id", caseList.map(c => c.id));
      setFinancials((finData ?? []) as FinRow[]);
    } else {
      setFinancials([]);
    }

    setLoading(false);
    void fin; // unused — loaded above
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const openEdit = () => {
    if (!company) return;
    setForm({
      name: company.name,
      legal_constitution: company.legal_constitution ?? "",
      industry: company.industry ?? "",
      year_established: company.year_established ? String(company.year_established) : "",
      gstin: company.gstin ?? "",
      website: company.website ?? "",
      promoter_details: company.promoter_details ?? "",
      registered_address: company.registered_address ?? "",
      notes: company.notes ?? "",
    });
    setEditing(true);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !form.name.trim()) return;
    setSaving(true);
    const db = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
    const { error } = await db.from("companies").update({
      name: form.name.trim(),
      legal_constitution: form.legal_constitution || null,
      industry: form.industry || null,
      year_established: form.year_established ? Number(form.year_established) : null,
      gstin: form.gstin || null,
      website: form.website || null,
      promoter_details: form.promoter_details || null,
      registered_address: form.registered_address || null,
      notes: form.notes || null,
    }).eq("id", id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Company updated");
    setEditing(false);
    load();
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const deleteCompany = async () => {
    if (!id) return;
    setDeleting(true);
    const db = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
    const { error } = await db.from("companies").delete().eq("id", id);
    setDeleting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Company removed from master data");
    navigate("/companies");
  };

  // ── Financial trend data ───────────────────────────────────────────────────
  const trendData: TrendPoint[] = (() => {
    const fyMap = new Map<number, { label: string; value: number | null; override_value?: number | null }[]>();
    for (const row of financials) {
      if (row.statement_type === "projections") continue;
      const items = (row.line_items as { label: string; value: number | null; override_value?: number | null }[]) ?? [];
      const existing = fyMap.get(row.fiscal_year) ?? [];
      const seen = new Set(existing.map(i => i.label));
      fyMap.set(row.fiscal_year, [...existing, ...items.filter(i => !seen.has(i.label))]);
    }
    return [...fyMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([fy, items]) => ({
        fy: `FY${fy}`,
        turnover: lv(items, "Turnover"),
        ebitda:   lv(items, "EBITDA"),
        pat:      lv(items, "PAT"),
        netWorth: lv(items, "Net Worth"),
        totalDebt: lv(items, "Total Debt"),
      }));
  })();

  const totalExposure = cases.reduce((s, c) => s + (c.deal_amount ?? 0), 0);
  const activeCases   = cases.filter(c => ["draft","extracting","extracted","analysis","narrative","ic_review"].includes(c.status)).length;

  if (loading) return (
    <TerminalLayout>
      <div className="text-muted-foreground text-xs tracking-widest text-center py-16">LOADING…</div>
    </TerminalLayout>
  );

  if (!company) return (
    <TerminalLayout>
      <div className="text-destructive text-xs tracking-widest text-center py-16">COMPANY NOT FOUND</div>
    </TerminalLayout>
  );

  return (
    <TerminalLayout>
      <div className="space-y-3">

        {/* ── Breadcrumb ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground tracking-widest">
          <button onClick={() => navigate("/companies")} className="hover:text-primary transition-colors">
            ← MASTER DATA
          </button>
          <span>/</span>
          <span className="text-primary font-bold">{company.name.toUpperCase()}</span>
        </div>

        {/* ── Company header ─────────────────────────────────────────────── */}
        <div className="border border-border bg-card px-4 py-3 flex flex-wrap items-start gap-4 justify-between">
          <div className="min-w-0">
            <div className="text-xl font-bold text-primary font-mono tracking-wide">{company.name}</div>
            <div className="flex flex-wrap gap-3 mt-1">
              {company.legal_constitution && (
                <span className="text-[9px] tracking-widest text-muted-foreground border border-border px-1.5 py-0.5">
                  {company.legal_constitution}
                </span>
              )}
              {company.industry && (
                <span className="text-[9px] tracking-widest text-muted-foreground border border-border px-1.5 py-0.5">
                  {company.industry}
                </span>
              )}
              {company.year_established && (
                <span className="text-[9px] tracking-widest text-muted-foreground">EST. {company.year_established}</span>
              )}
              {company.gstin && (
                <span className="text-[9px] tracking-widest text-muted-foreground font-mono">GSTIN: {company.gstin}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={openEdit}
              className="px-3 py-1.5 text-[10px] font-bold tracking-widest border border-border bg-surface-2 text-primary hover:bg-surface transition-colors"
            >
              ✎ EDIT
            </button>
            <button
              onClick={() => navigate(`/new?company_id=${company.id}&company_name=${encodeURIComponent(company.name)}`)}
              className="px-3 py-1.5 text-[10px] font-bold tracking-widest border border-primary bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              + NEW CASE
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-1.5 text-[10px] font-bold tracking-widest border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors"
              >
                ✕ REMOVE
              </button>
            ) : (
              <div className="flex items-center gap-1 border border-destructive bg-destructive/10 px-2">
                <span className="text-[9px] text-destructive font-bold tracking-widest">CONFIRM DELETE?</span>
                <button
                  onClick={deleteCompany}
                  disabled={deleting}
                  className="px-2 py-1 text-[9px] font-bold tracking-widest bg-destructive text-white hover:opacity-90 disabled:opacity-40 transition-opacity ml-1"
                >
                  {deleting ? "…" : "YES"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 text-[9px] font-bold tracking-widest border border-border text-muted-foreground hover:text-primary transition-colors"
                >
                  NO
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Stats ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "TOTAL CASES",    value: cases.length.toString() },
            { label: "ACTIVE",         value: activeCases.toString() },
            { label: "TOTAL EXPOSURE", value: totalExposure > 0 ? `₹${totalExposure.toFixed(1)} Cr` : "—" },
          ].map(s => (
            <div key={s.label} className="border border-border bg-card px-4 py-3">
              <div className="text-[9px] tracking-widest text-muted-foreground mb-1">{s.label}</div>
              <div className="text-xl font-bold text-primary font-mono">{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <div className="flex border-b border-border">
          {(["overview","deals","financials"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-[10px] font-bold tracking-widest border-b-2 transition-colors ${
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-primary"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW tab ───────────────────────────────────────────────── */}
        {tab === "overview" && !editing && (
          <Panel title="COMPANY PROFILE" ticker="MASTER/PROFILE" status="live">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              {[
                { label: "LEGAL CONSTITUTION", value: company.legal_constitution },
                { label: "INDUSTRY",           value: company.industry },
                { label: "YEAR ESTABLISHED",   value: company.year_established ? String(company.year_established) : null },
                { label: "GSTIN",              value: company.gstin },
                { label: "WEBSITE",            value: company.website },
                { label: "REGISTERED ADDRESS", value: company.registered_address },
                { label: "DATE NOTED",         value: new Date(company.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
              ].map(f => (
                <div key={f.label}>
                  <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">{f.label}</div>
                  <div className={f.value ? "text-primary font-mono" : "text-muted-foreground/40"}>
                    {f.value ?? "—"}
                  </div>
                </div>
              ))}
              {company.promoter_details && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">PROMOTER DETAILS</div>
                  <div className="text-primary whitespace-pre-wrap">{company.promoter_details}</div>
                </div>
              )}
              {company.notes && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">NOTES</div>
                  <div className="text-primary whitespace-pre-wrap">{company.notes}</div>
                </div>
              )}
            </div>
          </Panel>
        )}

        {/* ── EDIT form ──────────────────────────────────────────────────── */}
        {tab === "overview" && editing && (
          <Panel title="EDIT COMPANY" ticker="MASTER/EDIT" status="live">
            <form onSubmit={saveEdit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2">
                  <label className={labelCls}>Company Name *</label>
                  <input className={inputCls} required value={form.name} onChange={set("name")} />
                </div>
                <div>
                  <label className={labelCls}>Legal Constitution</label>
                  <select className={inputCls} value={form.legal_constitution} onChange={set("legal_constitution")}>
                    <option value="">Select…</option>
                    {CONSTITUTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Industry</label>
                  <select className={inputCls} value={form.industry} onChange={set("industry")}>
                    <option value="">Select…</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Year Established</label>
                  <input className={inputCls} type="number" value={form.year_established} onChange={set("year_established")} />
                </div>
                <div>
                  <label className={labelCls}>GSTIN</label>
                  <input className={inputCls} value={form.gstin} onChange={set("gstin")} />
                </div>
                <div>
                  <label className={labelCls}>Website</label>
                  <input className={inputCls} value={form.website} onChange={set("website")} />
                </div>
                <div className="lg:col-span-3">
                  <label className={labelCls}>Registered Address</label>
                  <input className={inputCls} value={form.registered_address} onChange={set("registered_address")} />
                </div>
                <div className="lg:col-span-3">
                  <label className={labelCls}>Promoter Details</label>
                  <textarea className={inputCls} rows={2} value={form.promoter_details} onChange={set("promoter_details")} />
                </div>
                <div className="lg:col-span-3">
                  <label className={labelCls}>Notes</label>
                  <textarea className={inputCls} rows={2} value={form.notes} onChange={set("notes")} />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit" disabled={saving}
                  className="px-4 py-2 text-[10px] font-bold tracking-widest border border-primary bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {saving ? "SAVING…" : "SAVE CHANGES"}
                </button>
                <button
                  type="button" onClick={() => setEditing(false)}
                  className="px-4 py-2 text-[10px] font-bold tracking-widest border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  CANCEL
                </button>
              </div>
            </form>
          </Panel>
        )}

        {/* ── DEALS tab ──────────────────────────────────────────────────── */}
        {tab === "deals" && (
          <Panel title="DEAL HISTORY" ticker={`${cases.length} CASES`} status="live">
            {cases.length === 0 ? (
              <div className="text-muted-foreground text-xs py-8 text-center tracking-widest">
                NO DEALS LINKED — CREATE A NEW CASE ABOVE
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-border text-[9px] tracking-widest text-muted-foreground">
                      <th className="text-left py-2 pr-4">CASE CODE</th>
                      <th className="text-left py-2 pr-4 hidden sm:table-cell">PRODUCT</th>
                      <th className="text-right py-2 pr-4">AMOUNT</th>
                      <th className="text-right py-2 pr-4 hidden md:table-cell">IRR</th>
                      <th className="text-right py-2 pr-4 hidden lg:table-cell">DATE</th>
                      <th className="text-center py-2">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map(c => {
                      const sm = STATUS_META[c.status] ?? { label: c.status.toUpperCase(), color: "text-muted-foreground" };
                      return (
                        <tr
                          key={c.id}
                          onClick={() => navigate(`/case/${c.id}`)}
                          className="border-b border-border/40 hover:bg-surface-2 cursor-pointer transition-colors"
                        >
                          <td className="py-2.5 pr-4">
                            <div className="font-bold text-primary">{c.case_code}</div>
                            <div className="text-[9px] text-muted-foreground">{c.client_name}</div>
                          </td>
                          <td className="py-2.5 pr-4 hidden sm:table-cell text-muted-foreground">
                            {c.product_type.replace(/_/g," ").toUpperCase()}
                          </td>
                          <td className="py-2.5 pr-4 text-right">
                            {c.deal_amount != null
                              ? <span className="text-primary font-bold">₹{c.deal_amount.toFixed(1)} Cr</span>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-2.5 pr-4 text-right hidden md:table-cell text-muted-foreground">
                            {c.expected_irr != null ? `${c.expected_irr}%` : "—"}
                          </td>
                          <td className="py-2.5 pr-4 text-right hidden lg:table-cell text-muted-foreground">
                            {new Date(c.created_at).toLocaleDateString("en-IN",{month:"short",day:"numeric",year:"numeric"})}
                          </td>
                          <td className="py-2.5 text-center">
                            <span className={`text-[9px] font-bold tracking-widest ${sm.color}`}>{sm.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}

        {/* ── FINANCIALS tab ─────────────────────────────────────────────── */}
        {tab === "financials" && (
          <div className="space-y-3">
            {trendData.length === 0 ? (
              <Panel title="FINANCIAL TRENDS" ticker="NO DATA" status="live">
                <div className="text-muted-foreground text-xs py-8 text-center tracking-widest">
                  UPLOAD AND EXTRACT FINANCIALS WITHIN A CASE TO SEE TRENDS HERE
                </div>
              </Panel>
            ) : (
              <>
                <Panel title="P&L TREND" ticker={`${trendData.length} YEARS`} status="live">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="fy" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <RTooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                          labelStyle={{ color: "hsl(var(--primary))" }}
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Line type="monotone" dataKey="turnover" name="Turnover" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} connectNulls />
                        <Line type="monotone" dataKey="ebitda"   name="EBITDA"   stroke="hsl(var(--success))" dot={false} strokeWidth={2} connectNulls />
                        <Line type="monotone" dataKey="pat"      name="PAT"      stroke="hsl(var(--accent))"  dot={false} strokeWidth={2} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>

                <Panel title="BALANCE SHEET TREND" ticker="NET WORTH vs DEBT" status="live">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="fy" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <RTooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                          labelStyle={{ color: "hsl(var(--primary))" }}
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Line type="monotone" dataKey="netWorth"  name="Net Worth"  stroke="hsl(var(--success))"     dot={false} strokeWidth={2} connectNulls />
                        <Line type="monotone" dataKey="totalDebt" name="Total Debt" stroke="hsl(var(--destructive))" dot={false} strokeWidth={2} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>

                {/* Tabular summary */}
                <Panel title="YEAR-WISE SUMMARY" ticker="P&L + BS" status="live">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-border text-[9px] tracking-widest text-muted-foreground">
                          <th className="text-left py-2 pr-4">METRIC</th>
                          {trendData.map(d => <th key={d.fy} className="text-right py-2 pr-4">{d.fy}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {(["turnover","ebitda","pat","netWorth","totalDebt"] as const).map(key => {
                          const labels: Record<typeof key, string> = {
                            turnover: "Turnover", ebitda: "EBITDA", pat: "PAT",
                            netWorth: "Net Worth", totalDebt: "Total Debt",
                          };
                          return (
                            <tr key={key} className="border-b border-border/40">
                              <td className="py-2 pr-4 text-muted-foreground">{labels[key]}</td>
                              {trendData.map(d => (
                                <td key={d.fy} className="py-2 pr-4 text-right text-primary font-bold">
                                  {d[key] != null ? `₹${(d[key] as number).toFixed(1)}` : "—"}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </>
            )}
          </div>
        )}

      </div>
    </TerminalLayout>
  );
}
