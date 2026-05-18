import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { CASE_STATUS_META, PRODUCTS, type CaseStatus, type ProductType } from "@/features/credit/domain";
import { toast } from "sonner";

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
  admin: "ADM", analyst: "ANL", business_development: "BD",
  ic_member: "IC", credit_committee: "CC", operations: "OPS",
};
const ROLE_COLOR: Record<string, string> = {
  admin:                "text-destructive border-destructive/40",
  analyst:              "text-primary border-primary/30",
  business_development: "text-accent border-accent/30",
  ic_member:            "text-success border-success/30",
  credit_committee:     "text-warning border-warning/30",
  operations:           "text-muted-foreground border-border",
};

// Visual accent per column — inline style so Tailwind purging isn't an issue
const COL_ACCENT: Partial<Record<CaseStatus, string>> = {
  draft:                  "#6b7280",
  docs_received:          "#60a5fa",
  on_hold:                "#f59e0b",
  analysis:               "#a78bfa",
  recommended_ic:         "#a78bfa",
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

// ── Project Mapping ──────────────────────────────────────────────────────────
const BUSINESS_STAGES = [
  { n: 1,  short: "CREATED",   label: "Case Created" },
  { n: 2,  short: "DOCS REC.", label: "All Docs Received" },
  { n: 3,  short: "ON HOLD",   label: "On Hold" },
  { n: 4,  short: "ANALYSIS",  label: "Analysis In Process" },
  { n: 5,  short: "REC. IC",   label: "Recommended for IC" },
  { n: 6,  short: "SUB. IC",   label: "Submitted to IC" },
  { n: 7,  short: "APPR.",     label: "Approved by IC" },
  { n: 8,  short: "COND.",     label: "Cond. Approved by IC" },
  { n: 9,  short: "REJECTED",  label: "Rejected by IC" },
  { n: 10, short: "RE-QUERY",  label: "Queries Resubmission" },
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

export default function Pipeline() {
  const { user } = useAuth();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<CaseStatus | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);

  // Inline note editing
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Per-column sort order (localStorage)
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

  // Filters
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

  // ── Note handlers ────────────────────────────────────────────────────────
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

  // ── Drag handlers ────────────────────────────────────────────────────────
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
    if (error) { toast.error("Failed to update status"); load(); }
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
      if (error) { toast.error("Failed to update status"); load(); }
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

  // ── Render ───────────────────────────────────────────────────────────────
  const icCount       = cases.filter(c => c.status === "ic_review").length;
  const approvedCount = cases.filter(c => c.status === "approved" || c.status === "conditionally_approved").length;
  const onHoldCount   = cases.filter(c => c.status === "on_hold").length;

  return (
    <TerminalLayout>

      {/* ── Stats bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-stretch gap-3 mb-3">
        <div className="flex-1 min-w-[120px] border border-border bg-surface px-4 py-2.5">
          <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">ACTIVE CASES</div>
          <div className="text-2xl text-primary glow font-bold">{cases.length}</div>
        </div>
        <div className="flex-1 min-w-[120px] border border-border bg-surface px-4 py-2.5">
          <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">SUBMITTED TO IC</div>
          <div className="text-2xl text-warning glow font-bold">{icCount}</div>
        </div>
        <div className="flex-1 min-w-[120px] border border-border bg-surface px-4 py-2.5">
          <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">APPROVED</div>
          <div className="text-2xl text-success glow font-bold">{approvedCount}</div>
        </div>
        <div className="flex-1 min-w-[120px] border border-border bg-surface px-4 py-2.5">
          <div className="text-[9px] tracking-widest text-muted-foreground mb-0.5">ON HOLD</div>
          <div className="text-2xl text-warning/80 glow font-bold">{onHoldCount}</div>
        </div>
        <div className="border border-primary/40 bg-primary/5 px-4 py-2.5 flex items-center">
          <Link
            to="/new"
            className="text-primary text-[10px] tracking-widest font-bold hover:opacity-80 whitespace-nowrap"
          >
            [F2] NEW CASE →
          </Link>
        </div>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3 border border-border bg-surface px-3 py-2">
        <div className="relative flex-1 min-w-[200px]">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-[11px]">▶</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search client name or case code…"
            className="w-full bg-input border border-border pl-6 pr-7 py-1.5 text-xs text-primary focus:outline-none focus:border-primary placeholder:text-muted-foreground/30"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-primary text-[11px]">✕</button>
          )}
        </div>
        <button
          onClick={() => setMyOnly(v => !v)}
          className={`px-3 py-1.5 text-[10px] tracking-widest font-bold border transition-colors whitespace-nowrap ${myOnly ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary"}`}
        >
          {myOnly ? "● MY CASES" : "○ MY CASES"}
        </button>
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
        <div className="text-[10px] tracking-widest ml-auto whitespace-nowrap flex items-center gap-3">
          {filtersActive ? (
            <span className={visibleCases.length === 0 ? "text-destructive" : "text-primary"}>
              {visibleCases.length} / {cases.length} CASES
            </span>
          ) : (
            <span className="text-muted-foreground/40">{cases.length} TOTAL</span>
          )}
          {filtersActive && (
            <button onClick={clearFilters} className="text-muted-foreground/50 hover:text-destructive">CLEAR ✕</button>
          )}
        </div>
      </div>

      {/* ── Pipeline board ──────────────────────────────────────────────── */}
      <div className="border border-border bg-surface">
        {/* Board header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface-2">
          <span className="text-[10px] tracking-widest text-primary font-bold">PIPELINE BOARD</span>
          <span className="text-[9px] text-muted-foreground/50 tracking-wider">
            drag between columns to move stage &nbsp;·&nbsp; drag up/down to reorder &nbsp;·&nbsp; click note to edit
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-xs tracking-wider">LOADING PIPELINE…</div>
        ) : cases.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-xs tracking-wider">
            NO CASES YET —{" "}
            <Link to="/new" className="text-primary hover:opacity-80">[F2] CREATE YOUR FIRST CASE</Link>
          </div>
        ) : visibleCases.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-xs tracking-wider">
            NO CASES MATCH FILTERS —{" "}
            <button onClick={clearFilters} className="text-primary hover:opacity-80">CLEAR FILTERS</button>
          </div>
        ) : (
          <div>
            <div className="flex">
              {COLUMNS.map((col, colIdx) => {
                const meta     = CASE_STATUS_META[col];
                const colCases = getSortedColCases(col, visibleCases.filter(c => c.status === col));
                const isOver   = dragOverCol === col;
                const accent   = COL_ACCENT[col] ?? "#6b7280";

                return (
                  <div
                    key={col}
                    className={`flex flex-col flex-1 min-w-0 border-r border-border transition-colors ${isOver ? "bg-primary/3" : "bg-surface"}`}
                    onDragOver={e => { e.preventDefault(); setDragOverCol(col); }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null); }}
                    onDrop={e => onDrop(e, col)}
                  >
                    {/* Column header */}
                    <div
                      className="px-3 py-2 border-b border-border"
                      style={{ borderTop: `3px solid ${accent}` }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] tracking-wide font-bold leading-tight" style={{ color: accent }}>
                          {meta.label}
                        </span>
                        <span
                          className="text-[9px] font-bold px-1.5 py-px rounded-full"
                          style={{ background: `${accent}22`, color: accent }}
                        >
                          {colCases.length}
                        </span>
                      </div>
                    </div>

                    {/* Cards */}
                    <div className="flex-1 p-1.5 space-y-1.5 min-h-[280px]">
                      {colCases.map(c => {
                        const isDragging   = draggingId === c.id;
                        const isDropTarget = dragOverCardId === c.id && !isDragging;
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
                            className={`relative group bg-card border transition-all select-none ${
                              isDragging    ? "opacity-40 scale-95 cursor-grabbing border-primary/40" :
                              isDropTarget  ? "border-primary shadow-sm" :
                                             "border-border hover:border-border/80 cursor-grab"
                            }`}
                            style={{ borderLeft: `3px solid ${accent}` }}
                          >
                            {/* ── Card top: drag handle area ── */}
                            <Link
                              to={`/case/${c.id}`}
                              draggable={false}
                              className="block px-2 pt-2 pb-1.5"
                              onClick={e => { if (isDragging) e.preventDefault(); }}
                            >
                              {/* Client name */}
                              <div className="text-primary font-bold text-[11px] leading-snug pr-4 truncate">
                                {c.client_name}
                              </div>
                              {/* Code + badges */}
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <span className="text-muted-foreground text-[9px] font-mono">{c.case_code}</span>
                                <span className="text-[8px] font-bold tracking-widest px-1 py-px border border-accent/30 text-accent">
                                  {PRODUCTS[c.product_type].short}
                                </span>
                                {c.deal_amount && (
                                  <span className="text-success text-[10px] font-bold">
                                    ₹{Number(c.deal_amount).toLocaleString("en-IN")} Cr
                                  </span>
                                )}
                              </div>
                              {/* Assigned to */}
                              <div className="mt-1.5 flex items-center gap-1 min-w-0">
                                <span className="text-[8px] tracking-widest text-primary/40 shrink-0">→</span>
                                {(c.assigned_to_name || c.assigned_to_email) ? (
                                  <>
                                    <span className="text-[9px] text-primary/70 truncate font-medium">
                                      {c.assigned_to_name ?? c.assigned_to_email?.split("@")[0]}
                                    </span>
                                    {c.assignee_role && (
                                      <span className={`shrink-0 text-[7px] font-bold tracking-widest border px-1 py-px ${ROLE_COLOR[c.assignee_role] ?? "text-muted-foreground border-border"}`}>
                                        {ROLE_SHORT[c.assignee_role] ?? c.assignee_role.toUpperCase()}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-[9px] text-muted-foreground/30 italic">unassigned</span>
                                )}
                              </div>
                            </Link>

                            {/* ── Note area (not draggable) ── */}
                            <div
                              className="border-t border-border/40 px-2 py-1.5"
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
                                    if (e.key === "Escape") { setEditingNoteId(null); }
                                  }}
                                  placeholder="Type a note… (Ctrl+Enter to save)"
                                  rows={3}
                                  className="w-full bg-input border border-primary/40 px-2 py-1 text-[10px] text-primary font-mono resize-none focus:outline-none placeholder:text-muted-foreground/30"
                                  draggable={false}
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={e => startEditNote(e, c)}
                                  className="w-full text-left group/note"
                                >
                                  {c.analyst_notes ? (
                                    <p className="text-[10px] text-foreground/70 font-mono leading-relaxed line-clamp-3 group-hover/note:text-primary transition-colors whitespace-pre-wrap">
                                      {c.analyst_notes}
                                    </p>
                                  ) : (
                                    <p className="text-[9px] text-muted-foreground/30 tracking-wider italic group-hover/note:text-muted-foreground/60 transition-colors">
                                      ✎ add note…
                                    </p>
                                  )}
                                </button>
                              )}
                            </div>

                            {/* Delete button */}
                            <button
                              onClick={e => deleteCase(e, c.id)}
                              title="Delete case"
                              className="absolute top-2 right-2 w-4 h-4 flex items-center justify-center text-[10px] text-foreground/20 opacity-0 group-hover:opacity-100 hover:text-destructive transition-all z-10"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}

                      {/* Drop zone hint at bottom of column */}
                      {isOver && (
                        <div className="border border-dashed border-primary/30 h-10 flex items-center justify-center text-[9px] text-primary/40 tracking-widest">
                          DROP HERE
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

      {/* ── Project Mapping ──────────────────────────────────────────────── */}
      {visibleCases.length > 0 && (
        <div className="border border-border bg-surface mt-3">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface-2">
            <span className="text-[10px] tracking-widest text-primary font-bold">PROJECT MAPPING</span>
            <span className="text-[9px] text-muted-foreground/50 tracking-wider">◉ current &nbsp;·&nbsp; ✓ completed &nbsp;·&nbsp; — pending</span>
          </div>
          <div className="overflow-x-auto px-4 py-3">
            <table className="text-[10px] font-mono border-collapse w-full" style={{ minWidth: "860px" }}>
              <thead>
                <tr className="border-b border-border text-[8px] tracking-widest text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-normal sticky left-0 bg-surface z-10" style={{ minWidth: "200px" }}>CASE</th>
                  <th className="text-left py-2 px-3 font-normal whitespace-nowrap" style={{ minWidth: "80px" }}>AMOUNT</th>
                  {BUSINESS_STAGES.map(s => (
                    <th key={s.n} title={s.label} className="py-2 px-1 font-normal text-center" style={{ minWidth: "58px" }}>
                      <div className="text-muted-foreground/30 text-[7px] mb-0.5">{s.n}</div>
                      <div className="whitespace-nowrap">{s.short}</div>
                    </th>
                  ))}
                  <th className="text-left py-2 px-3 font-normal" style={{ minWidth: "160px" }}>NOTE</th>
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
                      <td className="py-2 pr-4 sticky left-0 bg-card z-10 border-r border-border/20">
                        <div className="text-primary font-bold text-[11px] truncate" style={{ maxWidth: "185px" }}>{c.client_name}</div>
                        <div className="text-muted-foreground text-[9px] mt-0.5 flex items-center gap-1.5">
                          <span>{c.case_code}</span>
                          <span className="text-accent">{PRODUCTS[c.product_type].short}</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {c.deal_amount
                          ? <span className="text-success">₹{Number(c.deal_amount).toLocaleString("en-IN")} Cr</span>
                          : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      {BUSINESS_STAGES.map(s => {
                        const isCurrent  = map.current === s.n;
                        const isComplete = map.completed.includes(s.n);
                        return (
                          <td key={s.n} className={`py-2 px-1 text-center ${isCurrent ? "bg-primary/10" : ""}`}>
                            {isCurrent  ? <span className="text-primary font-bold text-[13px] leading-none">◉</span>
                            : isComplete ? <span className="text-success text-[11px]">✓</span>
                            : <span className="text-muted-foreground/20 text-[10px]">—</span>}
                          </td>
                        );
                      })}
                      <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                        {c.analyst_notes
                          ? <span className="text-foreground/60 text-[9px] line-clamp-2 whitespace-pre-wrap">{c.analyst_notes}</span>
                          : <span className="text-muted-foreground/20 text-[9px] italic">—</span>}
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
