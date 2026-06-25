import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { CASE_STATUS_META, PRODUCTS, type CaseStatus, type ProductType } from "@/features/credit/domain";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CaseRow {
  id: string;
  case_code: string;
  client_name: string;
  product_type: ProductType;
  status: CaseStatus;
  deal_amount: number | null;
  analyst_notes: string | null;
  created_at: string;
  user_id: string;
  assigned_to_email: string | null;
  assigned_to_name: string | null;
  creator_name: string | null;
  creator_email: string | null;
  creator_role: string | null;
  assignee_role: string | null;
}

type ProfileRow = { id: string; email: string | null; full_name: string | null };
type RoleRow    = { user_id: string; role: string };

const ROLE_SHORT: Record<string, string> = {
  admin: "Admin", analyst: "Analyst", business_development: "BD",
  ic_member: "IC", credit_committee: "CC", operations: "Ops",
};

const COL_ACCENT: Partial<Record<CaseStatus, string>> = {
  draft:                  "#94a3b8",
  docs_received:          "#60a5fa",
  on_hold:                "#f59e0b",
  analysis:               "#a78bfa",
  recommended_ic:         "#8b5cf6",
  ic_review:              "#3b82f6",
  approved:               "#22c55e",
  conditionally_approved: "#4ade80",
  declined:               "#ef4444",
  queries_resubmission:   "#f59e0b",
};

const COLUMNS: CaseStatus[] = [
  "draft", "docs_received", "on_hold", "analysis", "recommended_ic",
  "ic_review", "approved", "conditionally_approved", "declined", "queries_resubmission",
];

const BUSINESS_STAGES = [
  { n: 1,  short: "Created",   label: "Case Created" },
  { n: 2,  short: "Docs Rec.", label: "All Docs Received" },
  { n: 3,  short: "On Hold",   label: "On Hold" },
  { n: 4,  short: "Analysis",  label: "Analysis In Process" },
  { n: 5,  short: "Rec. IC",   label: "Recommended for IC" },
  { n: 6,  short: "Sub. IC",   label: "Submitted to IC" },
  { n: 7,  short: "Approved",  label: "Approved by IC" },
  { n: 8,  short: "Cond.",     label: "Conditionally Approved" },
  { n: 9,  short: "Rejected",  label: "Rejected by IC" },
  { n: 10, short: "Re-Query",  label: "Queries Resubmission" },
] as const;

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

const PIPELINE_COL_OVERRIDE: Partial<Record<CaseStatus, CaseStatus>> = {
  uploading:  "docs_received",
  extracting: "docs_received",
  extracted:  "docs_received",
  narrative:  "analysis",
};
function getPipelineCol(status: CaseStatus): CaseStatus {
  return PIPELINE_COL_OVERRIDE[status] ?? status;
}

export default function Pipeline() {
  const { user } = useAuth();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<CaseStatus | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const [colOrder, setColOrder] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("rehbar_pipeline_order") ?? "{}"); }
    catch { return {}; }
  });
  const saveOrder = (next: Record<string, string[]>) => {
    localStorage.setItem("rehbar_pipeline_order", JSON.stringify(next));
    setColOrder(next);
  };
  const getSortedColCases = (col: CaseStatus, colCases: CaseRow[]): CaseRow[] => {
    const order = colOrder[col];
    if (!order?.length) return colCases;
    const idx = new Map(order.map((id, i) => [id, i]));
    return [...colCases].sort((a, b) => (idx.get(a.id) ?? -1) - (idx.get(b.id) ?? -1));
  };

  const [search, setSearch] = useState("");
  const [myOnly, setMyOnly] = useState(false);
  const [productFilter, setProductFilter] = useState<ProductType | "">("");
  const filtersActive = search.trim() !== "" || myOnly || productFilter !== "";

  const visibleCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases.filter(c => {
      if (q && !c.client_name.toLowerCase().includes(q) && !c.case_code.toLowerCase().includes(q)) return false;
      if (myOnly && c.creator_email !== user?.email && c.assigned_to_email !== user?.email) return false;
      if (productFilter && c.product_type !== productFilter) return false;
      return true;
    });
  }, [cases, search, myOnly, productFilter, user?.email]);

  const load = async () => {
    const [{ data: rawCases }, { data: profiles }, { data: roles }] = await Promise.all([
      supabase
        .from("credit_cases")
        .select("id,case_code,client_name,product_type,status,deal_amount,analyst_notes,created_at,user_id,assigned_to_email,assigned_to_name")
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,email,full_name"),
      supabase.from("user_roles").select("user_id,role"),
    ]);
    const profileMap   = Object.fromEntries(((profiles ?? []) as ProfileRow[]).map(p => [p.id, p]));
    const emailToId    = Object.fromEntries(((profiles ?? []) as ProfileRow[]).filter(p => p.email).map(p => [p.email!, p.id]));
    const roleByUserId = Object.fromEntries(((roles ?? []) as RoleRow[]).map(r => [r.user_id, r.role]));
    setCases(((rawCases ?? []) as (Omit<CaseRow, "creator_name"|"creator_email"|"creator_role"|"assignee_role"> & { assigned_to_email?: string|null; assigned_to_name?: string|null })[]).map(c => {
      const assigneeId = c.assigned_to_email ? (emailToId[c.assigned_to_email] ?? null) : null;
      return {
        ...c,
        analyst_notes:     (c as unknown as { analyst_notes?: string | null }).analyst_notes ?? null,
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

  const removeCase = async (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete case "${name}"?\nThis cannot be undone.`)) return;
    setCases(prev => prev.filter(c => c.id !== id));
    const { error } = await supabase.from("credit_cases").delete().eq("id", id);
    if (error) { toast.error("Failed to delete case"); load(); }
    else toast.success(`Deleted ${name}`);
  };

  const startEditNote = (e: React.MouseEvent, c: CaseRow) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingNoteId(c.id);
    setNoteText(c.analyst_notes ?? "");
    setTimeout(() => noteRef.current?.focus(), 0);
  };

  const saveNote = async (id: string) => {
    const original = cases.find(c => c.id === id)?.analyst_notes ?? "";
    const trimmed  = noteText.trim();
    if (trimmed === (original ?? "").trim()) { setEditingNoteId(null); return; }
    setCases(prev => prev.map(c => c.id === id ? { ...c, analyst_notes: trimmed || null } : c));
    setEditingNoteId(null);
    const { error } = await supabase.from("credit_cases").update({ analyst_notes: trimmed || null } as never).eq("id", id);
    if (error) { toast.error("Failed to save note"); load(); }
  };

  const onDragStart = (e: React.DragEvent, id: string) => {
    if (editingNoteId) return;
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragEnd = () => { setDraggingId(null); setDragOverCol(null); setDragOverCardId(null); };

  const onDrop = async (e: React.DragEvent, col: CaseStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null); setDragOverCol(null); setDragOverCardId(null);
    if (!id) return;
    const c = cases.find(x => x.id === id);
    if (!c) return;
    if (c.status === col) {
      const sorted = getSortedColCases(col, cases.filter(x => x.status === col));
      const ids = sorted.map(x => x.id);
      const from = ids.indexOf(id);
      if (from !== -1) { ids.splice(from, 1); ids.push(id); }
      saveOrder({ ...colOrder, [col]: ids });
      return;
    }
    setCases(prev => prev.map(x => x.id === id ? { ...x, status: col } : x));
    const { error } = await supabase.from("credit_cases").update({ status: col }).eq("id", id);
    if (error) { toast.error(`Status update failed: ${error.message}`); load(); }
    else { toast.success(`Moved to ${CASE_STATUS_META[col].label}`); }
  };

  const onCardDrop = async (e: React.DragEvent, targetId: string, targetCol: CaseStatus) => {
    e.preventDefault(); e.stopPropagation();
    const sourceId = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null); setDragOverCol(null); setDragOverCardId(null);
    if (!sourceId || sourceId === targetId) return;
    const source = cases.find(x => x.id === sourceId);
    if (!source) return;
    if (source.status !== targetCol) {
      setCases(prev => prev.map(x => x.id === sourceId ? { ...x, status: targetCol } : x));
      const colCases = getSortedColCases(targetCol, cases.filter(x => x.status === targetCol));
      const ids = colCases.map(x => x.id);
      const ti = ids.indexOf(targetId);
      if (ti !== -1) ids.splice(ti, 0, sourceId); else ids.push(sourceId);
      saveOrder({ ...colOrder, [targetCol]: ids });
      const { error } = await supabase.from("credit_cases").update({ status: targetCol }).eq("id", sourceId);
      if (error) { toast.error(`Status update failed: ${error.message}`); load(); }
      else { toast.success(`Moved to ${CASE_STATUS_META[targetCol].label}`); }
    } else {
      const colCases = getSortedColCases(targetCol, cases.filter(x => x.status === targetCol));
      const ids = colCases.map(x => x.id);
      const fi = ids.indexOf(sourceId), ti = ids.indexOf(targetId);
      if (fi === -1 || ti === -1) return;
      ids.splice(fi, 1); ids.splice(ti, 0, sourceId);
      saveOrder({ ...colOrder, [targetCol]: ids });
    }
  };

  const deleteCase = async (e: React.MouseEvent, id: string) => {
    e.preventDefault(); e.stopPropagation();
    const c = cases.find(x => x.id === id);
    if (!window.confirm(`Delete "${c?.client_name}"? This cannot be undone.`)) return;
    setCases(prev => prev.filter(x => x.id !== id));
    const { data: deleted, error } = await supabase.from("credit_cases").delete().eq("id", id).select("id");
    if (error) { toast.error("Delete failed: " + error.message); load(); return; }
    if (!deleted || deleted.length === 0) { toast.error("Delete blocked — run the RLS fix migration"); load(); return; }
    toast.success("Case deleted");
  };

  const clearFilters = () => { setSearch(""); setMyOnly(false); setProductFilter(""); };

  const icCount       = cases.filter(c => c.status === "ic_review").length;
  const approvedCount = cases.filter(c => c.status === "approved" || c.status === "conditionally_approved").length;
  const onHoldCount   = cases.filter(c => c.status === "on_hold").length;

  return (
    <TerminalLayout>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track and manage all credit cases</p>
        </div>
        <Link
          to="/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Case
        </Link>
      </div>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-card rounded-lg border border-border p-5" style={{ boxShadow: "var(--shadow-panel)" }}>
          <p className="text-xs font-medium text-muted-foreground mb-2">Active Cases</p>
          <p className="text-3xl font-bold text-foreground">{cases.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total in pipeline</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-5" style={{ boxShadow: "var(--shadow-panel)" }}>
          <p className="text-xs font-medium text-muted-foreground mb-2">Submitted to IC</p>
          <p className="text-3xl font-bold text-amber-600">{icCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Awaiting review</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-5" style={{ boxShadow: "var(--shadow-panel)" }}>
          <p className="text-xs font-medium text-muted-foreground mb-2">Approved</p>
          <p className="text-3xl font-bold text-green-600">{approvedCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Approved by IC</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-5" style={{ boxShadow: "var(--shadow-panel)" }}>
          <p className="text-xs font-medium text-muted-foreground mb-2">On Hold</p>
          <p className="text-3xl font-bold text-amber-500">{onHoldCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Pending action</p>
        </div>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-5 bg-card rounded-lg border border-border px-4 py-3" style={{ boxShadow: "var(--shadow-panel)" }}>
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client name or case code…"
            className="w-full bg-background border border-border rounded-lg pl-9 pr-8 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <button
          onClick={() => setMyOnly(v => !v)}
          className={cn(
            "px-3 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap",
            myOnly
              ? "bg-primary text-white border-primary"
              : "bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
          )}
        >
          {myOnly ? "✓ My Cases" : "My Cases"}
        </button>

        <select
          value={productFilter}
          onChange={e => setProductFilter(e.target.value as ProductType | "")}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        >
          <option value="">All Products</option>
          {Object.values(PRODUCTS).map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className={cn("font-medium", filtersActive && visibleCases.length === 0 ? "text-destructive" : "text-muted-foreground")}>
            {filtersActive ? `${visibleCases.length} of ${cases.length} cases` : `${cases.length} cases`}
          </span>
          {filtersActive && (
            <button onClick={clearFilters} className="text-muted-foreground/60 hover:text-destructive text-xs">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── Pipeline board ──────────────────────────────────────────────── */}
      <div className="bg-card rounded-lg border border-border overflow-hidden mb-6" style={{ boxShadow: "var(--shadow-panel)" }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-surface-2/50">
          <h2 className="text-sm font-semibold text-foreground">Pipeline Board</h2>
          <p className="text-xs text-muted-foreground hidden sm:block">
            Drag cards between columns to update status · Click the note area to add notes
          </p>
        </div>

        {loading ? (
          <div className="p-12 text-center text-muted-foreground text-sm">Loading pipeline…</div>
        ) : cases.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground mb-1">No cases yet</p>
            <p className="text-xs text-muted-foreground mb-4">Create your first credit case to get started</p>
            <Link to="/new" className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
              Create First Case
            </Link>
          </div>
        ) : visibleCases.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground mb-3">No cases match your filters</p>
            <button onClick={clearFilters} className="text-sm text-primary hover:underline font-medium">Clear filters</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex" style={{ minWidth: `${COLUMNS.length * 180}px` }}>
              {COLUMNS.map(col => {
                const meta     = CASE_STATUS_META[col];
                const colCases = getSortedColCases(col, visibleCases.filter(c => getPipelineCol(c.status) === col));
                const isOver   = dragOverCol === col;
                const accent   = COL_ACCENT[col] ?? "#94a3b8";

                return (
                  <div
                    key={col}
                    className={cn(
                      "flex flex-col flex-1 border-r border-border last:border-r-0 transition-colors",
                      isOver ? "bg-primary/5" : "bg-surface"
                    )}
                    onDragOver={e => { e.preventDefault(); setDragOverCol(col); }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null); }}
                    onDrop={e => onDrop(e, col)}
                  >
                    {/* Column header */}
                    <div className="px-3 py-2.5 border-b border-border bg-card" style={{ borderTop: `3px solid ${accent}` }}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground/80 leading-tight">{meta.label}</span>
                        <span
                          className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: `${accent}22`, color: accent }}
                        >
                          {colCases.length}
                        </span>
                      </div>
                    </div>

                    {/* Cards */}
                    <div className="flex-1 p-2 space-y-2 min-h-[300px]">
                      {colCases.map(c => {
                        const isDragging    = draggingId === c.id;
                        const isDropTarget  = dragOverCardId === c.id && !isDragging;
                        const isEditingNote = editingNoteId === c.id;

                        return (
                          <div
                            key={c.id}
                            draggable={!isEditingNote}
                            onDragStart={e => onDragStart(e, c.id)}
                            onDragEnd={onDragEnd}
                            onDragOver={e => { e.preventDefault(); setDragOverCardId(c.id); setDragOverCol(col); }}
                            onDragLeave={() => setDragOverCardId(null)}
                            onDrop={e => onCardDrop(e, c.id, col)}
                            className={cn(
                              "relative group bg-card rounded-lg border transition-all select-none",
                              isDragging   ? "opacity-40 scale-95 cursor-grabbing border-primary/40 shadow-lg" :
                              isDropTarget ? "border-primary shadow-md" :
                                            "border-border hover:border-border/60 hover:shadow-sm cursor-grab"
                            )}
                            style={{ borderLeft: `3px solid ${accent}` }}
                          >
                            <Link
                              to={`/case/${c.id}`}
                              draggable={false}
                              className="block px-3 pt-3 pb-2"
                              onClick={e => { if (isDragging) e.preventDefault(); }}
                            >
                              <p className="text-sm font-semibold text-foreground leading-snug pr-5 break-words">
                                {c.client_name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                <span className="text-xs text-muted-foreground font-mono">{c.case_code}</span>
                                <span
                                  className="text-xs font-medium px-1.5 py-0.5 rounded"
                                  style={{ background: `${accent}18`, color: accent }}
                                >
                                  {PRODUCTS[c.product_type].short}
                                </span>
                                {c.deal_amount && (
                                  <span className="text-xs font-semibold text-green-600">
                                    ₹{Number(c.deal_amount).toLocaleString("en-IN")} Cr
                                  </span>
                                )}
                              </div>
                              {(c.assigned_to_name || c.assigned_to_email) ? (
                                <div className="mt-2 flex items-center gap-1.5 min-w-0">
                                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                    <span className="text-[9px] font-bold text-primary">
                                      {(c.assigned_to_name ?? c.assigned_to_email ?? "?")[0].toUpperCase()}
                                    </span>
                                  </div>
                                  <span className="text-xs text-muted-foreground truncate">
                                    {c.assigned_to_name ?? c.assigned_to_email?.split("@")[0]}
                                  </span>
                                  {c.assignee_role && (
                                    <span className="text-xs text-muted-foreground/60 shrink-0">
                                      · {ROLE_SHORT[c.assignee_role] ?? c.assignee_role}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <p className="mt-2 text-xs text-muted-foreground/40 italic">Unassigned</p>
                              )}
                            </Link>

                            {/* Note area */}
                            <div
                              className="border-t border-border/50 px-3 py-2"
                              onMouseDown={e => e.stopPropagation()}
                              onDragStart={e => e.stopPropagation()}
                            >
                              {isEditingNote ? (
                                <textarea
                                  ref={noteRef}
                                  value={noteText}
                                  onChange={e => setNoteText(e.target.value)}
                                  onBlur={() => saveNote(c.id)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(c.id);
                                    if (e.key === "Escape") setEditingNoteId(null);
                                  }}
                                  placeholder="Add a note… (Ctrl+Enter to save)"
                                  rows={3}
                                  className="w-full bg-surface-2 border border-primary/30 rounded-md px-2 py-1.5 text-xs text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/40"
                                  draggable={false}
                                />
                              ) : (
                                <button type="button" onClick={e => startEditNote(e, c)} className="w-full text-left">
                                  {c.analyst_notes ? (
                                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 whitespace-pre-wrap hover:text-foreground transition-colors">
                                      {c.analyst_notes}
                                    </p>
                                  ) : (
                                    <p className="text-xs text-muted-foreground/40 italic hover:text-muted-foreground/70 transition-colors">
                                      + Add note
                                    </p>
                                  )}
                                </button>
                              )}
                            </div>

                            {/* Delete */}
                            <button
                              onClick={e => deleteCase(e, c.id)}
                              title="Delete case"
                              className="absolute top-2.5 right-2.5 w-5 h-5 flex items-center justify-center rounded text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-red-50 transition-all"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        );
                      })}

                      {isOver && (
                        <div className="border-2 border-dashed border-primary/30 rounded-lg h-12 flex items-center justify-center text-xs text-primary/50">
                          Drop here
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Progress tracker ─────────────────────────────────────────────── */}
      {visibleCases.length > 0 && (
        <div className="bg-card rounded-lg border border-border overflow-hidden" style={{ boxShadow: "var(--shadow-panel)" }}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-surface-2/50">
            <h2 className="text-sm font-semibold text-foreground">Progress Tracker</h2>
            <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-primary" />Current stage
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />Completed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-border" />Pending
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse w-full" style={{ minWidth: "900px" }}>
              <thead>
                <tr className="border-b border-border bg-surface-2/30">
                  <th className="text-left py-3 px-5 font-medium text-muted-foreground text-xs sticky left-0 bg-surface-2/30 z-10" style={{ minWidth: "200px" }}>
                    Case
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground text-xs" style={{ minWidth: "90px" }}>
                    Amount
                  </th>
                  {BUSINESS_STAGES.map(s => (
                    <th key={s.n} title={s.label} className="py-3 px-2 font-medium text-muted-foreground text-xs text-center" style={{ minWidth: "62px" }}>
                      {s.short}
                    </th>
                  ))}
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground text-xs" style={{ minWidth: "160px" }}>
                    Note
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleCases.map(c => {
                  const map = STAGE_MAP[c.status] ?? { current: 1, completed: [] as number[] };
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-border/50 hover:bg-surface-2/50 transition-colors cursor-pointer"
                      onClick={() => window.location.href = `/case/${c.id}`}
                    >
                      <td className="py-3 px-5 sticky left-0 bg-card z-10 border-r border-border/30">
                        <p className="text-sm font-semibold text-foreground break-words leading-tight">{c.client_name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {c.case_code} · {PRODUCTS[c.product_type].short}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        {c.deal_amount
                          ? <span className="text-sm font-semibold text-green-600">₹{Number(c.deal_amount).toLocaleString("en-IN")} Cr</span>
                          : <span className="text-sm text-muted-foreground/40">—</span>}
                      </td>
                      {BUSINESS_STAGES.map(s => {
                        const isCurrent  = map.current === s.n;
                        const isComplete = map.completed.includes(s.n);
                        return (
                          <td key={s.n} className={cn("py-3 px-2 text-center", isCurrent && "bg-primary/10")}>
                            {isCurrent  ? (
                              <span className="inline-block w-3 h-3 rounded-full bg-primary" />
                            ) : isComplete ? (
                              <svg className="inline-block text-green-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <span className="inline-block w-2 h-2 rounded-full bg-border/60" />
                            )}
                          </td>
                        );
                      })}
                      <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between gap-2 group/row">
                          <div className="flex-1 min-w-0">
                            {c.analyst_notes
                              ? <span className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{c.analyst_notes}</span>
                              : <span className="text-xs text-muted-foreground/30 italic">—</span>}
                          </div>
                          <button
                            onClick={e => removeCase(e, c.id, c.client_name)}
                            title="Delete case"
                            className="opacity-0 group-hover/row:opacity-100 text-muted-foreground/30 hover:text-destructive transition-all shrink-0"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </TerminalLayout>
  );
}
