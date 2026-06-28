import { useState, useEffect, useRef } from "react";
import { Panel } from "@/components/terminal/Panel";
import { supabase } from "@/integrations/supabase/client";
import type { CaseRow } from "@/features/case/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PriorFacility {
  id: string;
  product: string;
  sanctioned_amount: number | null;
  disbursed_amount: number | null;
  outstanding: number | null;
  sanction_date: string;
  closure_date: string;
  status: "Active" | "Closed" | "NPA" | "Restructured" | "Written Off";
  max_dpd: number | null;
  notes: string;
}

export interface CreditReference {
  id: string;
  ref_type: "Bank" | "Trade" | "Other";
  entity_name: string;
  contact: string;
  relationship: string;
  notes: string;
}

export interface RehbarHistory {
  has_prior_exposure: boolean;
  facilities: PriorFacility[];
  analyst_notes: string;
  credit_references: CreditReference[];
  linked_company_id?: string;
}

const EMPTY_HISTORY: RehbarHistory = {
  has_prior_exposure: false,
  facilities: [],
  analyst_notes: "",
  credit_references: [],
};

const BLANK_FACILITY = (): PriorFacility => ({
  id: crypto.randomUUID(),
  product: "Operating Lease",
  sanctioned_amount: null,
  disbursed_amount: null,
  outstanding: null,
  sanction_date: "",
  closure_date: "",
  status: "Closed",
  max_dpd: null,
  notes: "",
});

const BLANK_REF = (): CreditReference => ({
  id: crypto.randomUUID(),
  ref_type: "Bank",
  entity_name: "",
  contact: "",
  relationship: "",
  notes: "",
});

const PRODUCTS = [
  "Operating Lease", "Finance Lease", "PLS", "Project Finance",
  "Trade Finance", "Home Loan", "Term Loan", "Working Capital",
];

const STATUSES: PriorFacility["status"][] = ["Active", "Closed", "NPA", "Restructured", "Written Off"];

const STATUS_CLS: Record<PriorFacility["status"], string> = {
  Active:       "bg-success text-success-foreground",
  Closed:       "bg-muted text-muted-foreground",
  NPA:          "bg-destructive text-destructive-foreground",
  Restructured: "bg-warning text-warning-foreground",
  "Written Off":"bg-destructive/70 text-destructive-foreground",
};

const DPD_CLS = (dpd: number | null) =>
  dpd == null ? "text-muted-foreground" : dpd === 0 ? "text-success" : dpd <= 30 ? "text-warning" : "text-destructive";

type CompanyData = Record<string, string | null>;

// ─── Rehbar Funder Profile (static) ──────────────────────────────────────────

function FunderProfile() {
  const rows = [
    ["Legal Entity",      "Rehbar Financial Services"],
    ["Business Model",    "Sharia-compliant NBFC — asset financing & structured credit"],
    ["Core Products",     "Operating Lease · Finance Lease · PLS · Project Finance · Trade Finance · Home Loan"],
    ["Return Framework",  "Fixed rental / IRR / profit-share depending on product"],
    ["Website",           "rehbar.co.in"],
  ];
  return (
    <Panel title="Rehbar Financial Services — Funder Profile" ticker="MASTER DATA">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-border/30">
              <td className="py-1.5 pr-4 text-muted-foreground/70 w-36 shrink-0">{k}</td>
              <td className="py-1.5 text-foreground/90 font-medium">
                {k === "Website"
                  ? <a href={`https://${v}`} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{v}</a>
                  : v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ─── Company search + profile panel ──────────────────────────────────────────

type CoResult = { id: string; name: string; mca_cin: string | null; mca_pan: string | null };

function CompanySelector({
  selectedId,
  onSelect,
  onClear,
}: {
  selectedId: string | undefined;
  onSelect: (id: string, company: CompanyData) => void;
  onClear: () => void;
}) {
  const [query, setQuery]           = useState("");
  const [results, setResults]       = useState<CoResult[]>([]);
  const [loading, setLoading]       = useState(false);
  const [open, setOpen]             = useState(false);
  const [selectedCo, setSelectedCo] = useState<CompanyData | null>(null);
  const [dropRect, setDropRect]     = useState<{ top: number; left: number; width: number } | null>(null);
  const debounceRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef                    = useRef<HTMLInputElement>(null);

  // Load selected company on mount / id change
  useEffect(() => {
    if (!selectedId) { setSelectedCo(null); return; }
    supabase.from("companies").select("*").eq("id", selectedId).single()
      .then(({ data }) => { if (data) setSelectedCo(data as unknown as CompanyData); });
  }, [selectedId]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase
        .from("companies")
        .select("id,name,mca_cin,mca_pan")
        .or(`name.ilike.%${query}%,mca_cin.ilike.%${query}%,mca_pan.ilike.%${query}%`)
        .order("name")
        .limit(12);
      setResults((data as CoResult[] | null) ?? []);
      setOpen(true);
      setLoading(false);
    }, 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Measure input position whenever dropdown opens
  useEffect(() => {
    if (!open || !inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, [open]);

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (!inputRef.current) return;
      const r = inputRef.current.getBoundingClientRect();
      setDropRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.closest("div")?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const pick = async (co: CoResult) => {
    setOpen(false); setQuery("");
    const { data } = await supabase.from("companies").select("*").eq("id", co.id).single();
    if (data) {
      setSelectedCo(data as unknown as CompanyData);
      onSelect(co.id, data as unknown as CompanyData);
    }
  };

  const inp = "bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 w-full";

  const val = (d: CompanyData, k: string) => d[k]?.trim() || null;

  const profile = selectedCo ? (() => {
    const rows: [string, string][] = ([
      ["CIN",               val(selectedCo, "mca_cin")],
      ["PAN",               val(selectedCo, "mca_pan")],
      ["Company Type",      [val(selectedCo, "mca_type"), val(selectedCo, "mca_category"), val(selectedCo, "mca_sub_category")].filter(Boolean).join(" · ") || null],
      ["MCA Status",        val(selectedCo, "mca_status")],
      ["Auth. Capital",     val(selectedCo, "mca_authorized_capital")],
      ["Paid-up Capital",   val(selectedCo, "mca_paid_up_capital")],
      ["Date of Incorp.",   val(selectedCo, "mca_date_of_incorp")],
      ["Last Balance Sheet",val(selectedCo, "mca_date_last_bs")],
      ["Sector",            [val(selectedCo, "mca_nse_sector"), val(selectedCo, "mca_sector")].filter(Boolean).join(" / ") || null],
      ["Email",             val(selectedCo, "mca_email")],
      ["Telephone",         val(selectedCo, "mca_telephone")],
      ["Address",           val(selectedCo, "registered_address")],
      ["Website",           val(selectedCo, "website")],
    ] as [string, string | null][]).filter(([, v]) => v != null) as [string, string][];
    return rows;
  })() : [];

  const status = selectedCo ? val(selectedCo, "mca_status")?.toLowerCase() : null;
  const statusBadge = status === "active"
    ? "bg-success/10 text-success border border-success/30"
    : status ? "bg-destructive/10 text-destructive border border-destructive/30" : "";

  return (
    <Panel
      title="Client Company — Master Data"
      ticker={selectedCo ? (val(selectedCo, "name") ?? "SELECTED").toUpperCase() : "NOT LINKED"}
      status={selectedCo ? "live" : "idle"}
    >
      {/* Search row */}
      <div className="flex gap-2 mb-3">
        <input
          ref={inputRef}
          className={inp}
          placeholder="Search by company name, CIN, or PAN…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {selectedCo && (
          <button
            onClick={() => { setSelectedCo(null); onClear(); }}
            className="shrink-0 text-[10px] text-destructive border border-destructive/30 rounded px-2 py-1 hover:bg-destructive/10 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Dropdown — fixed so it escapes panel's overflow-hidden */}
      {open && dropRect && (
        <div
          style={{ position: "fixed", top: dropRect.top, left: dropRect.left, width: dropRect.width, zIndex: 9999 }}
          className="bg-card border border-border rounded shadow-xl overflow-hidden max-h-56 overflow-y-auto"
        >
          {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
          {!loading && results.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground italic">No companies found.</div>}
          {results.map(co => (
            <button
              key={co.id}
              onMouseDown={e => { e.preventDefault(); pick(co); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
            >
              <div className="font-medium text-foreground">{co.name}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {[co.mca_cin, co.mca_pan].filter(Boolean).join(" · ") || "No CIN/PAN on record"}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Profile rows */}
      {selectedCo && profile.length > 0 && (
        <table className="w-full text-xs">
          <tbody>
            {profile.map(([k, v]) => (
              <tr key={k} className="border-b border-border/30">
                <td className="py-1.5 pr-4 text-muted-foreground/70 w-40 shrink-0">{k}</td>
                <td className="py-1.5 text-foreground/90 font-medium">
                  {k === "MCA Status" && statusBadge ? (
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wide ${statusBadge}`}>{v}</span>
                  ) : k === "Website" ? (
                    <a href={v.startsWith("http") ? v : `https://${v}`} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{v}</a>
                  ) : v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!selectedCo && (
        <p className="text-xs text-muted-foreground italic">Search and select a company to pull its master data here.</p>
      )}
    </Panel>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RehbarHistoryTab({
  cc,
  history,
  onSave,
}: {
  cc: CaseRow;
  history: RehbarHistory | null | undefined;
  onSave: (h: RehbarHistory) => Promise<void>;
}) {
  const [data, setData] = useState<RehbarHistory>(history ?? EMPTY_HISTORY);
  const [saving, setSaving] = useState(false);
  const [editingFacilityId, setEditingFacilityId] = useState<string | null>(null);
  const [editingRefId, setEditingRefId] = useState<string | null>(null);

  const save = async (next: RehbarHistory) => {
    setSaving(true);
    try { await onSave(next); } finally { setSaving(false); }
  };

  const setField = <K extends keyof RehbarHistory>(k: K, v: RehbarHistory[K]) => {
    const next = { ...data, [k]: v };
    setData(next);
    save(next);
  };

  const upsertFacility = (f: PriorFacility) => {
    const existing = data.facilities.findIndex(x => x.id === f.id);
    const next = existing >= 0
      ? data.facilities.map(x => x.id === f.id ? f : x)
      : [...data.facilities, f];
    const updated = { ...data, facilities: next };
    setData(updated);
    save(updated);
    setEditingFacilityId(null);
  };

  const deleteFacility = (id: string) => {
    const updated = { ...data, facilities: data.facilities.filter(f => f.id !== id) };
    setData(updated);
    save(updated);
  };

  const upsertRef = (r: CreditReference) => {
    const existing = data.credit_references.findIndex(x => x.id === r.id);
    const next = existing >= 0
      ? data.credit_references.map(x => x.id === r.id ? r : x)
      : [...data.credit_references, r];
    const updated = { ...data, credit_references: next };
    setData(updated);
    save(updated);
    setEditingRefId(null);
  };

  const deleteRef = (id: string) => {
    const updated = { ...data, credit_references: data.credit_references.filter(r => r.id !== id) };
    setData(updated);
    save(updated);
  };

  const editingFacility = editingFacilityId
    ? (data.facilities.find(f => f.id === editingFacilityId) ?? BLANK_FACILITY())
    : null;
  const editingRef = editingRefId
    ? (data.credit_references.find(r => r.id === editingRefId) ?? BLANK_REF())
    : null;

  return (
    <div className="space-y-3">
      <FunderProfile />

      {/* ── Client Company — Master Data selector ────────────────────────── */}
      <CompanySelector
        selectedId={data.linked_company_id}
        onSelect={(id) => setField("linked_company_id", id)}
        onClear={() => setField("linked_company_id", undefined)}
      />

      {/* ── Prior Rehbar Exposure ─────────────────────────────────────────── */}
      <Panel
        title={`Prior Exposure to ${cc.client_name.toUpperCase()}`}
        ticker={data.has_prior_exposure ? `${data.facilities.length} FACILIT${data.facilities.length === 1 ? "Y" : "IES"}` : "NEW RELATIONSHIP"}
        status={data.has_prior_exposure ? "live" : "idle"}
      >
        {/* Toggle */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs text-muted-foreground">Relationship type:</span>
          <div className="flex gap-1 bg-muted/40 rounded p-0.5">
            {([false, true] as const).map(v => (
              <button
                key={String(v)}
                onClick={() => setField("has_prior_exposure", v)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${data.has_prior_exposure === v ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"}`}
              >
                {v ? "Has prior exposure" : "New relationship"}
              </button>
            ))}
          </div>
          {saving && <span className="text-[10px] text-muted-foreground/50 italic">Saving…</span>}
        </div>

        {!data.has_prior_exposure ? (
          <div className="space-y-1.5 text-[11px] text-muted-foreground/70">
            <div className="border-l-2 border-muted pl-3 py-1">
              <span className="text-foreground/60 font-medium">New Relationship:</span>{" "}
              {cc.client_name} has no prior Rehbar/RERL facility history. This is a first-time exposure.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {data.facilities.length === 0 ? (
              <div className="text-[10px] text-muted-foreground/50 italic py-1">No facilities added yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[700px]">
                  <thead className="border-b border-border text-muted-foreground text-[10px]">
                    <tr>
                      <th className="text-left py-1.5 pr-3">PRODUCT</th>
                      <th className="text-right pr-3">SANCTIONED</th>
                      <th className="text-right pr-3">DISBURSED</th>
                      <th className="text-right pr-3">O/S</th>
                      <th className="text-center pr-3">SANCTION DATE</th>
                      <th className="text-center pr-3">CLOSURE DATE</th>
                      <th className="text-center pr-3">STATUS</th>
                      <th className="text-center pr-3">MAX DPD</th>
                      <th className="text-left pr-2">NOTES</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.facilities.map(f => (
                      <tr key={f.id} className="border-b border-border/20 hover:bg-muted/10">
                        <td className="py-1.5 pr-3 font-medium text-foreground/90">{f.product}</td>
                        <td className="text-right pr-3 tabular-nums">{f.sanctioned_amount != null ? `₹${f.sanctioned_amount.toLocaleString("en-IN")}L` : "—"}</td>
                        <td className="text-right pr-3 tabular-nums">{f.disbursed_amount != null ? `₹${f.disbursed_amount.toLocaleString("en-IN")}L` : "—"}</td>
                        <td className="text-right pr-3 tabular-nums">{f.outstanding != null ? `₹${f.outstanding.toLocaleString("en-IN")}L` : "—"}</td>
                        <td className="text-center pr-3 text-muted-foreground/70">{f.sanction_date || "—"}</td>
                        <td className="text-center pr-3 text-muted-foreground/70">{f.closure_date || "—"}</td>
                        <td className="text-center pr-3">
                          <span className={`px-1.5 py-0 text-[9px] font-bold tracking-widest ${STATUS_CLS[f.status]}`}>{f.status}</span>
                        </td>
                        <td className={`text-center pr-3 tabular-nums font-medium ${DPD_CLS(f.max_dpd)}`}>
                          {f.max_dpd != null ? `${f.max_dpd}d` : "—"}
                        </td>
                        <td className="pr-2 text-muted-foreground/60 text-[10px] max-w-[160px] truncate">{f.notes || "—"}</td>
                        <td className="whitespace-nowrap">
                          <button onClick={() => setEditingFacilityId(f.id)} className="text-[10px] text-primary hover:underline mr-2">Edit</button>
                          <button onClick={() => deleteFacility(f.id)} className="text-[10px] text-destructive hover:underline">Del</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button
              onClick={() => { const f = BLANK_FACILITY(); setData(d => ({ ...d, facilities: [...d.facilities, f] })); setEditingFacilityId(f.id); }}
              className="text-xs border border-dashed border-border/60 rounded px-3 py-1.5 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >+ Add Facility</button>
          </div>
        )}
      </Panel>

      {/* ── Facility Editor ───────────────────────────────────────────────── */}
      {editingFacility && (
        <FacilityEditor
          initial={editingFacility}
          onSave={upsertFacility}
          onCancel={() => setEditingFacilityId(null)}
        />
      )}

      {/* ── Credit References ─────────────────────────────────────────────── */}
      <Panel title="Credit References" ticker={`${data.credit_references.length} REF${data.credit_references.length !== 1 ? "S" : ""}`}>
        {!data.has_prior_exposure && (
          <div className="border-l-2 border-warning/60 pl-3 py-1 mb-3 text-[10px] text-warning/80">
            New relationship — analyst must obtain at least 2 trade / banking references and verify external credit conduct before first disbursement.
          </div>
        )}
        {data.credit_references.length > 0 && (
          <div className="overflow-x-auto mb-2">
            <table className="w-full text-xs min-w-[560px]">
              <thead className="border-b border-border text-muted-foreground text-[10px]">
                <tr>
                  <th className="text-left py-1.5 pr-3">TYPE</th>
                  <th className="text-left pr-3">ENTITY</th>
                  <th className="text-left pr-3">CONTACT</th>
                  <th className="text-left pr-3">RELATIONSHIP</th>
                  <th className="text-left pr-2">NOTES</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.credit_references.map(r => (
                  <tr key={r.id} className="border-b border-border/20 hover:bg-muted/10">
                    <td className="py-1.5 pr-3">
                      <span className="px-1.5 py-0 text-[9px] font-bold tracking-widest bg-muted text-muted-foreground">{r.ref_type}</span>
                    </td>
                    <td className="pr-3 font-medium text-foreground/90">{r.entity_name || "—"}</td>
                    <td className="pr-3 text-muted-foreground/70">{r.contact || "—"}</td>
                    <td className="pr-3 text-muted-foreground/70">{r.relationship || "—"}</td>
                    <td className="pr-2 text-muted-foreground/60 text-[10px] max-w-[160px] truncate">{r.notes || "—"}</td>
                    <td className="whitespace-nowrap">
                      <button onClick={() => setEditingRefId(r.id)} className="text-[10px] text-primary hover:underline mr-2">Edit</button>
                      <button onClick={() => deleteRef(r.id)} className="text-[10px] text-destructive hover:underline">Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button
          onClick={() => { const r = BLANK_REF(); setData(d => ({ ...d, credit_references: [...d.credit_references, r] })); setEditingRefId(r.id); }}
          className="text-xs border border-dashed border-border/60 rounded px-3 py-1.5 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >+ Add Reference</button>
      </Panel>

      {/* ── Reference Editor ──────────────────────────────────────────────── */}
      {editingRef && (
        <ReferenceEditor
          initial={editingRef}
          onSave={upsertRef}
          onCancel={() => setEditingRefId(null)}
        />
      )}

      {/* ── Analyst Notes ─────────────────────────────────────────────────── */}
      <Panel title="Analyst Notes" ticker="FEEDS INTO IC NOTE">
        <div className="text-[9px] text-muted-foreground/50 mb-2 tracking-wider">
          These notes appear in Section IV of the IC Note under "Funding History & Credit Conduct".
        </div>
        <textarea
          className="w-full bg-background border border-border rounded px-3 py-2 text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
          rows={5}
          placeholder="Add any notes on funding history, repayment conduct, banking references, credit bureau observations, or relationship context…"
          value={data.analyst_notes}
          onChange={e => setData(d => ({ ...d, analyst_notes: e.target.value }))}
          onBlur={() => save(data)}
        />
        {saving && <div className="text-[10px] text-muted-foreground/50 mt-1 italic">Saving…</div>}
      </Panel>
    </div>
  );
}

// ─── Facility Editor ──────────────────────────────────────────────────────────

function FacilityEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: PriorFacility;
  onSave: (f: PriorFacility) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<PriorFacility>(initial);
  const set = <K extends keyof PriorFacility>(k: K, v: PriorFacility[K]) => setF(p => ({ ...p, [k]: v }));
  const inp = "bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 w-full";

  return (
    <Panel title="Facility Detail" ticker="EDITING">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Product</label>
          <select className={inp} value={f.product} onChange={e => set("product", e.target.value)}>
            {PRODUCTS.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Sanctioned (₹L)</label>
          <input type="number" className={inp} value={f.sanctioned_amount ?? ""} onChange={e => set("sanctioned_amount", e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 250" />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Disbursed (₹L)</label>
          <input type="number" className={inp} value={f.disbursed_amount ?? ""} onChange={e => set("disbursed_amount", e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 250" />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Outstanding (₹L)</label>
          <input type="number" className={inp} value={f.outstanding ?? ""} onChange={e => set("outstanding", e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 0" />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Sanction Date</label>
          <input type="date" className={inp} value={f.sanction_date} onChange={e => set("sanction_date", e.target.value)} />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Closure Date</label>
          <input type="date" className={inp} value={f.closure_date} onChange={e => set("closure_date", e.target.value)} />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Status</label>
          <select className={inp} value={f.status} onChange={e => set("status", e.target.value as PriorFacility["status"])}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Max DPD (days)</label>
          <input type="number" className={inp} value={f.max_dpd ?? ""} onChange={e => set("max_dpd", e.target.value ? Number(e.target.value) : null)} placeholder="0" />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Notes</label>
          <input type="text" className={inp} value={f.notes} onChange={e => set("notes", e.target.value)} placeholder="Optional notes…" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave(f)} className="bg-primary text-primary-foreground text-xs px-4 py-1.5 rounded hover:bg-primary/90 transition-colors">Save Facility</button>
        <button onClick={onCancel} className="border border-border text-xs px-3 py-1.5 rounded text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
      </div>
    </Panel>
  );
}

// ─── Reference Editor ─────────────────────────────────────────────────────────

function ReferenceEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: CreditReference;
  onSave: (r: CreditReference) => void;
  onCancel: () => void;
}) {
  const [r, setR] = useState<CreditReference>(initial);
  const set = <K extends keyof CreditReference>(k: K, v: CreditReference[K]) => setR(p => ({ ...p, [k]: v }));
  const inp = "bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 w-full";

  return (
    <Panel title="Credit Reference" ticker="EDITING">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Type</label>
          <select className={inp} value={r.ref_type} onChange={e => set("ref_type", e.target.value as CreditReference["ref_type"])}>
            {["Bank", "Trade", "Other"].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Entity Name</label>
          <input type="text" className={inp} value={r.entity_name} onChange={e => set("entity_name", e.target.value)} placeholder="e.g. State Bank of India" />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Contact</label>
          <input type="text" className={inp} value={r.contact} onChange={e => set("contact", e.target.value)} placeholder="Name / phone / email" />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">Relationship / Account</label>
          <input type="text" className={inp} value={r.relationship} onChange={e => set("relationship", e.target.value)} placeholder="e.g. CC limit ₹200L since 2019" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] text-muted-foreground mb-1">Notes</label>
          <input type="text" className={inp} value={r.notes} onChange={e => set("notes", e.target.value)} placeholder="Conduct, overdue history, comments…" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave(r)} className="bg-primary text-primary-foreground text-xs px-4 py-1.5 rounded hover:bg-primary/90 transition-colors">Save Reference</button>
        <button onClick={onCancel} className="border border-border text-xs px-3 py-1.5 rounded text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
      </div>
    </Panel>
  );
}
