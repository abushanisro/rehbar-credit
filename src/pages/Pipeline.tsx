import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { Panel } from "@/components/terminal/Panel";
import { CASE_STATUS_META, PRODUCTS, type CaseStatus, type ProductType } from "@/features/credit/domain";
import { toast } from "sonner";

interface CaseRow {
  id: string;
  case_code: string;
  client_name: string;
  product_type: ProductType;
  status: CaseStatus;
  deal_amount: number | null;
  created_at: string;
  user_id: string;
  assigned_to_email: string | null;
  assigned_to_name: string | null;
  creator_name: string | null;
  creator_email: string | null;
  creator_role: string | null;
  assignee_role: string | null;
}

type ProfileRow  = { id: string; email: string | null; full_name: string | null };
type RoleRow     = { user_id: string; role: string };

const ROLE_SHORT: Record<string, string> = {
  admin:                "ADM",
  analyst:              "ANL",
  business_development: "BD",
  ic_member:            "IC",
  credit_committee:     "CC",
  operations:           "OPS",
};
const ROLE_COLOR: Record<string, string> = {
  admin:                "text-destructive border-destructive/40",
  analyst:              "text-primary border-primary/30",
  business_development: "text-accent border-accent/30",
  ic_member:            "text-success border-success/30",
  credit_committee:     "text-warning border-warning/30",
  operations:           "text-muted-foreground border-border",
};

const COLUMNS: CaseStatus[] = [
  "draft", "docs_received", "on_hold", "analysis", "recommended_ic",
  "ic_review", "approved", "conditionally_approved", "declined", "queries_resubmission",
];

// ── Project Mapping ──────────────────────────────────────────────────────────
const BUSINESS_STAGES = [
  { n: 1,  short: "CREATED",    label: "Case Created" },
  { n: 2,  short: "DOCS REC.",  label: "All Docs Received" },
  { n: 3,  short: "ON HOLD",    label: "On Hold" },
  { n: 4,  short: "ANALYSIS",   label: "Analysis In Process" },
  { n: 5,  short: "REC. IC",    label: "Recommended for IC" },
  { n: 6,  short: "SUB. IC",    label: "Submitted to IC" },
  { n: 7,  short: "APPR.",      label: "Approved by IC" },
  { n: 8,  short: "COND.",      label: "Cond. Approved by IC" },
  { n: 9,  short: "REJECTED",   label: "Rejected by IC" },
  { n: 10, short: "RE-QUERY",   label: "Queries Resubmission" },
] as const;

// Maps each DB status to its current business stage (1-10) and which prior stages are complete
const STAGE_MAP: Partial<Record<CaseStatus, { current: number; completed: number[] }>> = {
  draft:                  { current: 1,  completed: [] },
  uploading:              { current: 2,  completed: [1] },
  extracting:             { current: 2,  completed: [1] },
  extracted:              { current: 2,  completed: [1] },
  docs_received:          { current: 2,  completed: [1] },
  on_hold:                { current: 3,  completed: [1, 2] },
  analysis:               { current: 4,  completed: [1, 2] },
  narrative:              { current: 5,  completed: [1, 2, 4] },
  recommended_ic:         { current: 5,  completed: [1, 2, 4] },
  ic_review:              { current: 6,  completed: [1, 2, 4, 5] },
  approved:               { current: 7,  completed: [1, 2, 4, 5, 6] },
  conditionally_approved: { current: 8,  completed: [1, 2, 4, 5, 6] },
  declined:               { current: 9,  completed: [1, 2, 4, 5, 6] },
  queries_resubmission:   { current: 10, completed: [1, 2, 4, 5, 6] },
};

export default function Pipeline() {
  const { user } = useAuth();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<CaseStatus | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);

  // Per-column sort order — persisted in localStorage so it survives page refresh
  const [colOrder, setColOrder] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("rehbar_pipeline_order") ?? "{}"); }
    catch { return {}; }
  });

  const saveOrder = (next: Record<string, string[]>) => {
    localStorage.setItem("rehbar_pipeline_order", JSON.stringify(next));
    setColOrder(next);
  };

  // Returns colCases sorted by the user's custom order (new cards go to top)
  const getSortedColCases = (col: CaseStatus, colCases: CaseRow[]): CaseRow[] => {
    const order = colOrder[col];
    if (!order?.length) return colCases;
    const idx = new Map(order.map((id, i) => [id, i]));
    return [...colCases].sort((a, b) => (idx.get(a.id) ?? -1) - (idx.get(b.id) ?? -1));
  };

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [myOnly, setMyOnly] = useState(false);
  const [productFilter, setProductFilter] = useState<ProductType | "">("");

  const visibleCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases.filter(c => {
      if (q && !c.client_name.toLowerCase().includes(q) && !c.case_code.toLowerCase().includes(q)) return false;
      if (myOnly && c.creator_email !== user?.email && c.assigned_to_email !== user?.email) return false;
      if (productFilter && c.product_type !== productFilter) return false;
      return true;
    });
  }, [cases, search, myOnly, productFilter, user?.email]);

  const filtersActive = search.trim() !== "" || myOnly || productFilter !== "";

  const load = async () => {
    const [{ data: rawCases }, { data: profiles }, { data: roles }] = await Promise.all([
      supabase
        .from("credit_cases")
        .select("id,case_code,client_name,product_type,status,deal_amount,created_at,user_id,assigned_to_email,assigned_to_name")
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,email,full_name"),
      supabase.from("user_roles").select("user_id,role"),
    ]);

    const profileMap  = Object.fromEntries(((profiles ?? []) as ProfileRow[]).map(p => [p.id, p]));
    const emailToId   = Object.fromEntries(((profiles ?? []) as ProfileRow[]).filter(p => p.email).map(p => [p.email!, p.id]));
    const roleByUserId = Object.fromEntries(((roles ?? []) as RoleRow[]).map(r => [r.user_id, r.role]));

    setCases(((rawCases ?? []) as (Omit<CaseRow, "creator_name"|"creator_email"|"creator_role"|"assignee_role"> & { assigned_to_email?: string|null; assigned_to_name?: string|null })[]).map(c => {
      const assigneeId   = c.assigned_to_email ? (emailToId[c.assigned_to_email] ?? null) : null;
      return {
        ...c,
        assigned_to_email: c.assigned_to_email ?? null,
        assigned_to_name:  c.assigned_to_name  ?? null,
        creator_name:  profileMap[c.user_id]?.full_name ?? null,
        creator_email: profileMap[c.user_id]?.email     ?? null,
        creator_role:  roleByUserId[c.user_id]          ?? null,
        assignee_role: assigneeId ? (roleByUserId[assigneeId] ?? null) : null,
      };
    }));
  };

  useEffect(() => {
    load().then(() => setLoading(false));
    const ch = supabase
      .channel("pipeline_cases")
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_cases" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── Drag handlers ────────────────────────────────────────────────────────

  const onDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setDragOverCol(null);
    setDragOverCardId(null);
  };

  const onDragOver = (e: React.DragEvent, col: CaseStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(col);
  };

  // Column drop — fires when dropped on empty space inside a column
  const onDrop = async (e: React.DragEvent, col: CaseStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setDragOverCol(null);
    setDragOverCardId(null);
    if (!id) return;
    const c = cases.find(x => x.id === id);
    if (!c) return;
    if (c.status === col) {
      // Same column, drop on empty space → move to bottom
      const colCases = getSortedColCases(col, cases.filter(x => x.status === col));
      const ids = colCases.map(x => x.id);
      const from = ids.indexOf(id);
      if (from !== -1) { ids.splice(from, 1); ids.push(id); }
      saveOrder({ ...colOrder, [col]: ids });
      return;
    }
    setCases(prev => prev.map(x => x.id === id ? { ...x, status: col } : x));
    const { error } = await supabase.from("credit_cases").update({ status: col }).eq("id", id);
    if (error) { toast.error("Failed to update status"); load(); }
    else { toast.success(`Moved to ${CASE_STATUS_META[col].label}`); }
  };

  // Card drop — handles both within-column reorder and cross-column status change
  const onCardDrop = async (e: React.DragEvent, targetId: string, targetCol: CaseStatus) => {
    e.preventDefault();
    e.stopPropagation(); // prevent column onDrop from also firing
    const sourceId = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setDragOverCol(null);
    setDragOverCardId(null);
    if (!sourceId || sourceId === targetId) return;
    const source = cases.find(x => x.id === sourceId);
    if (!source) return;

    if (source.status !== targetCol) {
      // Cross-column: change status, insert before targetId
      setCases(prev => prev.map(x => x.id === sourceId ? { ...x, status: targetCol } : x));
      const colCases = getSortedColCases(targetCol, cases.filter(x => x.status === targetCol));
      const ids = colCases.map(x => x.id);
      const ti = ids.indexOf(targetId);
      if (ti !== -1) ids.splice(ti, 0, sourceId); else ids.push(sourceId);
      saveOrder({ ...colOrder, [targetCol]: ids });
      const { error } = await supabase.from("credit_cases").update({ status: targetCol }).eq("id", sourceId);
      if (error) { toast.error("Failed to update status"); load(); }
      else { toast.success(`Moved to ${CASE_STATUS_META[targetCol].label}`); }
    } else {
      // Same-column reorder: move sourceId to position of targetId
      const colCases = getSortedColCases(targetCol, cases.filter(x => x.status === targetCol));
      const ids = colCases.map(x => x.id);
      const fi = ids.indexOf(sourceId);
      const ti = ids.indexOf(targetId);
      if (fi === -1 || ti === -1) return;
      ids.splice(fi, 1);
      ids.splice(ti, 0, sourceId);
      saveOrder({ ...colOrder, [targetCol]: ids });
    }
  };

  // ── Delete handler ───────────────────────────────────────────────────────

  const deleteCase = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const c = cases.find(x => x.id === id);
    if (!window.confirm(`Delete "${c?.client_name}"? This cannot be undone.`)) return;
    setCases(prev => prev.filter(x => x.id !== id));
    const { data: deleted, error } = await supabase.from("credit_cases").delete().eq("id", id).select("id");
    if (error) { toast.error("Delete failed: " + error.message); load(); return; }
    if (!deleted || deleted.length === 0) { toast.error("Delete blocked by database — run the RLS fix migration"); load(); return; }
    toast.success("Case deleted");
  };

  return (
    <TerminalLayout>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Panel title="ACTIVE CASES">
          <div className="text-3xl text-primary glow font-bold">{cases.length}</div>
          <div className="terminal-label mt-1">Total in pipeline</div>
        </Panel>
        <Panel title="IN IC REVIEW" status="warn">
          <div className="text-3xl text-warning glow font-bold">
            {cases.filter(c => c.status === "ic_review").length}
          </div>
          <div className="terminal-label mt-1">Awaiting committee decision</div>
        </Panel>
        <Panel title="APPROVED">
          <div className="text-3xl text-success glow font-bold">
            {cases.filter(c => c.status === "approved").length}
          </div>
          <div className="terminal-label mt-1">Closed deals</div>
        </Panel>
        <Panel title="QUICK ACTION" className="col-span-2 lg:col-span-1">
          <Link
            to="/new"
            className="block w-full text-center bg-primary text-primary-foreground px-3 py-2 text-xs tracking-widest font-bold hover:opacity-90"
          >
            [F2] NEW CREDIT CASE
          </Link>
          <div className="terminal-label mt-2">Initiate appraisal workflow</div>
        </Panel>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3 border border-border bg-surface px-3 py-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-[11px]">▶</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search client / case code…"
            className="w-full bg-input border border-border pl-6 pr-6 py-1.5 text-xs text-primary focus:outline-none focus:border-primary placeholder:text-muted-foreground/40"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-primary text-[11px]"
            >
              ✕
            </button>
          )}
        </div>

        {/* My Cases toggle */}
        <button
          onClick={() => setMyOnly(v => !v)}
          className={`px-3 py-1.5 text-[10px] tracking-widest font-bold border transition-colors whitespace-nowrap ${
            myOnly
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
          }`}
        >
          {myOnly ? "● MY CASES" : "○ MY CASES"}
        </button>

        {/* Product filter */}
        <select
          value={productFilter}
          onChange={e => setProductFilter(e.target.value as ProductType | "")}
          className="bg-input border border-border px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary"
        >
          <option value="">All Products</option>
          {Object.values(PRODUCTS).map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        {/* Match count */}
        <div className="text-[10px] tracking-widest ml-auto whitespace-nowrap">
          {filtersActive ? (
            <span className={visibleCases.length === 0 ? "text-destructive" : "text-primary"}>
              {visibleCases.length} / {cases.length} CASES
            </span>
          ) : (
            <span className="text-muted-foreground/40">{cases.length} CASES</span>
          )}
          {filtersActive && (
            <button
              onClick={() => { setSearch(""); setMyOnly(false); setProductFilter(""); }}
              className="ml-3 text-muted-foreground/50 hover:text-destructive tracking-widest"
            >
              CLEAR ✕
            </button>
          )}
        </div>
      </div>

      <Panel title="PIPELINE BOARD" ticker="REHBAR/CAS" scan>
        <div className="text-[9px] text-muted-foreground mb-2 tracking-wider">
          ▸ DRAG between columns to change status &nbsp;·&nbsp; DRAG up/down within a column to reorder &nbsp;·&nbsp; hover and click ✕ to delete
        </div>
        {loading ? (
          <div className="text-muted-foreground text-xs">LOADING...</div>
        ) : cases.length === 0 ? (
          <div className="text-muted-foreground text-xs py-8 text-center">
            NO CASES YET — PRESS [F2] TO CREATE YOUR FIRST APPRAISAL
          </div>
        ) : visibleCases.length === 0 ? (
          <div className="text-muted-foreground text-xs py-8 text-center">
            NO CASES MATCH YOUR FILTERS — <button onClick={() => { setSearch(""); setMyOnly(false); setProductFilter(""); }} className="text-primary underline">CLEAR FILTERS</button>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-3 px-3">
          <div className="grid grid-cols-10 gap-2 min-w-[1000px]">
            {COLUMNS.map(col => {
              const meta = CASE_STATUS_META[col];
              const colCases = visibleCases.filter(c => c.status === col);
              const isOver = dragOverCol === col;
              return (
                <div
                  key={col}
                  className={`border min-h-[300px] transition-colors ${
                    isOver
                      ? "border-primary bg-primary/5"
                      : "border-border bg-surface"
                  }`}
                  onDragOver={e => onDragOver(e, col)}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={e => onDrop(e, col)}
                >
                  <div className={`px-2 py-1 text-[10px] tracking-widest border-b border-border bg-surface-2 text-${meta.color}`}>
                    {meta.label} ({colCases.length})
                  </div>
                  <div className="p-1 space-y-1">
                    {getSortedColCases(col, colCases).map(c => (
                      <div
                        key={c.id}
                        draggable
                        onDragStart={e => onDragStart(e, c.id)}
                        onDragEnd={onDragEnd}
                        onDragOver={e => { e.preventDefault(); setDragOverCardId(c.id); setDragOverCol(col); }}
                        onDragLeave={() => setDragOverCardId(null)}
                        onDrop={e => onCardDrop(e, c.id, col)}
                        className={`relative group transition-all ${
                          draggingId === c.id
                            ? "opacity-40 scale-95 cursor-grabbing"
                            : "cursor-grab"
                        } ${dragOverCardId === c.id && draggingId !== c.id ? "border-t-2 border-primary" : ""}`}
                      >
                        <Link
                          to={`/case/${c.id}`}
                          className={`block p-2 bg-card border text-[11px] transition-colors ${
                            draggingId === c.id
                              ? "border-primary/50"
                              : "border-border hover:border-primary"
                          }`}
                          draggable={false}
                        >
                          <div className="text-primary font-bold truncate pr-5">{c.client_name}</div>
                          <div className="text-muted-foreground truncate text-[10px]">{c.case_code}</div>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-accent text-[10px]">{PRODUCTS[c.product_type].short}</span>
                            {c.deal_amount && (
                              <span className="text-success text-[10px]">
                                ₹{Number(c.deal_amount).toLocaleString("en-IN")} Cr
                              </span>
                            )}
                          </div>
                          {/* Creator */}
                          <div className="mt-1.5 flex items-center gap-1 min-w-0">
                            <span className="text-[8px] tracking-widest text-muted-foreground/40 shrink-0">BY</span>
                            <span className="text-[9px] text-muted-foreground truncate">
                              {c.creator_name ?? (c.creator_email ? c.creator_email.split("@")[0] : "—")}
                            </span>
                            {c.creator_role && (
                              <span className={`shrink-0 text-[7px] font-bold tracking-widest border px-1 py-px ${ROLE_COLOR[c.creator_role] ?? "text-muted-foreground border-border"}`}>
                                {ROLE_SHORT[c.creator_role] ?? c.creator_role.toUpperCase()}
                              </span>
                            )}
                          </div>
                          {/* Assignee */}
                          {(c.assigned_to_name || c.assigned_to_email) && (
                            <div className="flex items-center gap-1 min-w-0">
                              <span className="text-[8px] tracking-widest text-primary/40 shrink-0">→</span>
                              <span className="text-[9px] text-primary/70 truncate font-medium">
                                {c.assigned_to_name ?? c.assigned_to_email?.split("@")[0]}
                              </span>
                              {c.assignee_role && (
                                <span className={`shrink-0 text-[7px] font-bold tracking-widest border px-1 py-px ${ROLE_COLOR[c.assignee_role] ?? "text-muted-foreground border-border"}`}>
                                  {ROLE_SHORT[c.assignee_role] ?? c.assignee_role.toUpperCase()}
                                </span>
                              )}
                            </div>
                          )}
                        </Link>
                        {/* Delete button — visible on hover */}
                        <button
                          onClick={e => deleteCase(e, c.id)}
                          title="Delete case"
                          className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center text-[10px] text-foreground/30 opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all rounded-sm z-10"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        )}
      </Panel>

      {/* ── Project Mapping ─────────────────────────────────────────────── */}
      {visibleCases.length > 0 && (
        <Panel title="PROJECT MAPPING" ticker="REHBAR/ALL" className="mt-3">
          <div className="text-[9px] text-muted-foreground mb-3 tracking-wider">
            ▸ ◉ current stage &nbsp;·&nbsp; ✓ completed &nbsp;·&nbsp; — not reached &nbsp;·&nbsp; click a row to open the case
          </div>
          <div className="overflow-x-auto -mx-3 px-3">
            <table className="text-[10px] font-mono border-collapse w-full" style={{ minWidth: "860px" }}>
              <thead>
                <tr className="border-b border-border bg-surface/60 text-[8px] tracking-widest text-muted-foreground">
                  <th className="text-left py-2 pl-3 pr-4 font-normal sticky left-0 bg-surface/60 z-10" style={{ minWidth: "200px" }}>
                    CASE
                  </th>
                  <th className="text-left py-2 px-3 font-normal whitespace-nowrap" style={{ minWidth: "72px" }}>
                    AMOUNT
                  </th>
                  {BUSINESS_STAGES.map(s => (
                    <th
                      key={s.n}
                      title={s.label}
                      className="py-2 px-1 font-normal text-center"
                      style={{ minWidth: "58px" }}
                    >
                      <div className="text-muted-foreground/40 text-[7px] mb-0.5">{s.n}</div>
                      <div className="leading-tight whitespace-nowrap">{s.short}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleCases.map(c => {
                  const map = STAGE_MAP[c.status] ?? { current: 1, completed: [] as number[] };
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-border/40 hover:bg-surface-2 transition-colors cursor-pointer"
                      onClick={() => window.location.href = `/case/${c.id}`}
                    >
                      <td className="py-2 pl-3 pr-4 sticky left-0 bg-card z-10 border-r border-border/20">
                        <div className="text-primary font-bold text-[11px] truncate" style={{ maxWidth: "180px" }}>
                          {c.client_name}
                        </div>
                        <div className="text-muted-foreground text-[9px] mt-0.5 flex items-center gap-1.5">
                          <span>{c.case_code}</span>
                          <span className="text-accent">{PRODUCTS[c.product_type].short}</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {c.deal_amount
                          ? <span className="text-success">₹{Number(c.deal_amount).toLocaleString("en-IN")} Cr</span>
                          : <span className="text-muted-foreground/40">—</span>
                        }
                      </td>
                      {BUSINESS_STAGES.map(s => {
                        const isCurrent  = map.current === s.n;
                        const isComplete = map.completed.includes(s.n);
                        return (
                          <td
                            key={s.n}
                            className={`py-2 px-1 text-center ${isCurrent ? "bg-primary/10" : ""}`}
                          >
                            {isCurrent ? (
                              <span className="text-primary font-bold text-[13px] leading-none">◉</span>
                            ) : isComplete ? (
                              <span className="text-success text-[11px]">✓</span>
                            ) : (
                              <span className="text-muted-foreground/20 text-[10px]">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </TerminalLayout>
  );
}
