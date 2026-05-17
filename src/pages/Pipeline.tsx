import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
  "draft", "extracting", "extracted", "analysis", "narrative", "ic_review", "approved",
];

export default function Pipeline() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<CaseStatus | null>(null);

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
  };

  const onDragOver = (e: React.DragEvent, col: CaseStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(col);
  };

  const onDrop = async (e: React.DragEvent, col: CaseStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setDragOverCol(null);
    if (!id) return;
    const c = cases.find(x => x.id === id);
    if (!c || c.status === col) return;
    // Optimistic
    setCases(prev => prev.map(x => x.id === id ? { ...x, status: col } : x));
    const { error } = await supabase.from("credit_cases").update({ status: col }).eq("id", id);
    if (error) {
      toast.error("Failed to update status");
      load();
    } else {
      toast.success(`Moved to ${CASE_STATUS_META[col].label}`);
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

      <Panel title="PIPELINE BOARD" ticker="REHBAR/CAS" scan>
        <div className="text-[9px] text-muted-foreground mb-2 tracking-wider">
          ▸ DRAG cards between columns to update status &nbsp;·&nbsp; hover a card and click ✕ to delete
        </div>
        {loading ? (
          <div className="text-muted-foreground text-xs">LOADING...</div>
        ) : cases.length === 0 ? (
          <div className="text-muted-foreground text-xs py-8 text-center">
            NO CASES YET — PRESS [F2] TO CREATE YOUR FIRST APPRAISAL
          </div>
        ) : (
          <div className="overflow-x-auto -mx-3 px-3">
          <div className="grid grid-cols-7 gap-2 min-w-[700px]">
            {COLUMNS.map(col => {
              const meta = CASE_STATUS_META[col];
              const colCases = cases.filter(c =>
                c.status === col || (col === "approved" && c.status === "declined"),
              );
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
                    {colCases.map(c => (
                      <div
                        key={c.id}
                        draggable
                        onDragStart={e => onDragStart(e, c.id)}
                        onDragEnd={onDragEnd}
                        className={`relative group transition-all ${
                          draggingId === c.id
                            ? "opacity-40 scale-95 cursor-grabbing"
                            : "cursor-grab"
                        }`}
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
    </TerminalLayout>
  );
}
