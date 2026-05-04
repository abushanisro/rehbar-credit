import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { Panel } from "@/components/terminal/Panel";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyRow {
  id: string; name: string; legal_constitution: string | null;
  industry: string | null; year_established: number | null;
  gstin: string | null; website: string | null;
  promoter_details: string | null; registered_address: string | null;
  notes: string | null; is_active: boolean; created_at: string;
}

interface CaseAgg {
  count: number; exposure: number;
  lastDeal: string; hasActive: boolean;
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

const inputCls  = "w-full bg-input border border-border px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary placeholder:text-muted-foreground/40";
const labelCls  = "block text-[9px] tracking-widest text-muted-foreground mb-1 uppercase";

// ── Component ─────────────────────────────────────────────────────────────────

export default function Companies() {
  const navigate  = useNavigate();
  const { user }  = useAuth();
  const [companies, setCompanies]       = useState<CompanyRow[]>([]);
  const [caseMap, setCaseMap]           = useState<Map<string, CaseAgg>>(new Map());
  const [search, setSearch]             = useState("");
  const [industryFilter, setIndustry]   = useState("");
  const [loading, setLoading]           = useState(true);
  const [showForm, setShowForm]         = useState(false);
  const [saving, setSaving]             = useState(false);
  const [form, setForm]                 = useState({
    name: "", legal_constitution: "", industry: "", year_established: "",
    gstin: "", website: "", promoter_details: "", registered_address: "", notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const db = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
    const [{ data: comp }, { data: cases }] = await Promise.all([
      db.from("companies").select("*").order("name"),
      supabase.from("credit_cases")
        .select("company_id, id, deal_amount, status, created_at")
        .not("company_id", "is", null),
    ]);

    const map = new Map<string, CaseAgg>();
    for (const c of (cases ?? []) as { company_id: string; deal_amount: number | null; status: string; created_at: string }[]) {
      if (!c.company_id) continue;
      const e = map.get(c.company_id) ?? { count: 0, exposure: 0, lastDeal: "", hasActive: false };
      e.count++;
      e.exposure += c.deal_amount ?? 0;
      if (!e.lastDeal || c.created_at > e.lastDeal) e.lastDeal = c.created_at;
      if (["draft","extracting","extracted","analysis","narrative","ic_review"].includes(c.status)) e.hasActive = true;
      map.set(c.company_id, e);
    }

    setCompanies((comp ?? []) as CompanyRow[]);
    setCaseMap(map);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = companies.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.name.toLowerCase().includes(q) || (c.gstin ?? "").toLowerCase().includes(q);
    const matchInd    = !industryFilter || c.industry === industryFilter;
    return matchSearch && matchInd;
  });

  const totalExposure = Array.from(caseMap.values()).reduce((s, a) => s + a.exposure, 0);
  const activeDeals   = Array.from(caseMap.values()).reduce((s, a) => s + (a.hasActive ? a.count : 0), 0);

  const saveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !user) return;
    setSaving(true);
    const db = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
    const { error } = await db.from("companies").insert({
      name: form.name.trim(),
      legal_constitution: form.legal_constitution || null,
      industry: form.industry || null,
      year_established: form.year_established ? Number(form.year_established) : null,
      gstin: form.gstin || null,
      website: form.website || null,
      promoter_details: form.promoter_details || null,
      registered_address: form.registered_address || null,
      notes: form.notes || null,
      created_by: user.id,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${form.name} added to master data`);
    setForm({ name:"", legal_constitution:"", industry:"", year_established:"", gstin:"", website:"", promoter_details:"", registered_address:"", notes:"" });
    setShowForm(false);
    load();
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <TerminalLayout>
      <div className="space-y-3">

        {/* ── Stats ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "COMPANIES", value: companies.length.toString() },
            { label: "ACTIVE DEALS", value: activeDeals.toString() },
            { label: "TOTAL EXPOSURE", value: totalExposure > 0 ? `₹${totalExposure.toFixed(1)} Cr` : "—" },
          ].map(s => (
            <div key={s.label} className="border border-border bg-card px-4 py-3">
              <div className="text-[9px] tracking-widest text-muted-foreground mb-1">{s.label}</div>
              <div className="text-xl font-bold text-primary font-mono">{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── Controls ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="bg-input border border-border px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary placeholder:text-muted-foreground/40 w-52"
            placeholder="Search by name or GSTIN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="bg-input border border-border px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary"
            value={industryFilter}
            onChange={e => setIndustry(e.target.value)}
          >
            <option value="">All industries</option>
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <div className="flex-1" />
          <button
            onClick={() => setShowForm(s => !s)}
            className="px-3 py-1.5 text-[10px] font-bold tracking-widest border border-primary bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            {showForm ? "✕ CANCEL" : "+ NEW COMPANY"}
          </button>
        </div>

        {/* ── New company form ────────────────────────────────────────────── */}
        {showForm && (
          <Panel title="ADD COMPANY TO MASTER DATA" ticker="MASTER/NEW" status="live">
            <form onSubmit={saveCompany} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2">
                  <label className={labelCls}>Company Name *</label>
                  <input className={inputCls} required value={form.name} onChange={set("name")} placeholder="ACME Manufacturing Pvt Ltd" />
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
                  <input className={inputCls} type="number" placeholder="2010" value={form.year_established} onChange={set("year_established")} />
                </div>
                <div>
                  <label className={labelCls}>GSTIN</label>
                  <input className={inputCls} placeholder="29AAACM9517G1ZK" value={form.gstin} onChange={set("gstin")} />
                </div>
                <div>
                  <label className={labelCls}>Website</label>
                  <input className={inputCls} placeholder="https://acme.com" value={form.website} onChange={set("website")} />
                </div>
                <div className="lg:col-span-3">
                  <label className={labelCls}>Promoter Details</label>
                  <textarea className={inputCls} rows={2} placeholder="Names, designations, shareholding %" value={form.promoter_details} onChange={set("promoter_details")} />
                </div>
                <div className="lg:col-span-3">
                  <label className={labelCls}>Notes</label>
                  <textarea className={inputCls} rows={2} value={form.notes} onChange={set("notes")} />
                </div>
              </div>
              <button
                type="submit" disabled={saving || !form.name.trim()}
                className="px-4 py-2 text-[10px] font-bold tracking-widest border border-primary bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {saving ? "SAVING…" : "SAVE COMPANY"}
              </button>
            </form>
          </Panel>
        )}

        {/* ── Company table ───────────────────────────────────────────────── */}
        <Panel title="COMPANY MASTER DATA" ticker={`${filtered.length} COMPANIES`} status="live">
          {loading ? (
            <div className="text-muted-foreground text-xs py-8 text-center tracking-widest">LOADING…</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground text-xs py-8 text-center tracking-widest">
              {search || industryFilter ? "NO MATCHING COMPANIES" : "NO COMPANIES YET — ADD YOUR FIRST CLIENT ABOVE"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-[9px] tracking-widest text-muted-foreground">
                    <th className="text-left py-2 pr-4">COMPANY</th>
                    <th className="text-left py-2 pr-4 hidden sm:table-cell">INDUSTRY</th>
                    <th className="text-left py-2 pr-4 hidden md:table-cell">CONST.</th>
                    <th className="text-right py-2 pr-4">DEALS</th>
                    <th className="text-right py-2 pr-4 hidden lg:table-cell">EXPOSURE</th>
                    <th className="text-right py-2 pr-4 hidden xl:table-cell">LAST DEAL</th>
                    <th className="text-right py-2 pr-4 hidden 2xl:table-cell">DATE NOTED</th>
                    <th className="text-center py-2">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(co => {
                    const agg = caseMap.get(co.id);
                    return (
                      <tr
                        key={co.id}
                        onClick={() => navigate(`/companies/${co.id}`)}
                        className="border-b border-border/40 hover:bg-surface-2 cursor-pointer transition-colors"
                      >
                        <td className="py-2.5 pr-4">
                          <div className="font-bold text-primary">{co.name}</div>
                          {co.gstin && <div className="text-[9px] text-muted-foreground">{co.gstin}</div>}
                        </td>
                        <td className="py-2.5 pr-4 hidden sm:table-cell text-muted-foreground">
                          {co.industry ?? "—"}
                        </td>
                        <td className="py-2.5 pr-4 hidden md:table-cell text-muted-foreground">
                          {co.legal_constitution ?? "—"}
                        </td>
                        <td className="py-2.5 pr-4 text-right">
                          {agg ? <span className="text-primary font-bold">{agg.count}</span> : <span className="text-muted-foreground">0</span>}
                        </td>
                        <td className="py-2.5 pr-4 text-right hidden lg:table-cell">
                          {agg?.exposure ? `₹${agg.exposure.toFixed(1)} Cr` : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2.5 pr-4 text-right hidden xl:table-cell text-muted-foreground">
                          {agg?.lastDeal ? new Date(agg.lastDeal).toLocaleDateString("en-IN",{month:"short",year:"numeric"}) : "—"}
                        </td>
                        <td className="py-2.5 pr-4 text-right hidden 2xl:table-cell text-muted-foreground">
                          {new Date(co.created_at).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
                        </td>
                        <td className="py-2.5 text-center">
                          {agg?.hasActive
                            ? <span className="text-[9px] text-warning font-bold tracking-widest">● ACTIVE</span>
                            : agg?.count
                            ? <span className="text-[9px] text-success font-bold tracking-widest">✓ DONE</span>
                            : <span className="text-[9px] text-muted-foreground tracking-widest">— NEW</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

      </div>
    </TerminalLayout>
  );
}
