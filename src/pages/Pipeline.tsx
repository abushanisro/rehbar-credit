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
}

const COLUMNS: CaseStatus[] = [
  "draft", "extracting", "extracted", "analysis", "narrative", "ic_review", "approved",
];

export default function Pipeline() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<CaseStatus | null>(null);

  const load = () =>
    supabase
      .from("credit_cases")
      .select("id,case_code,client_name,product_type,status,deal_amount,created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setCases((data ?? []) as CaseRow[]));

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
                          <div className="text-muted-foreground truncate">{c.case_code}</div>
                          <div className="text-accent text-[10px] mt-1">{PRODUCTS[c.product_type].short}</div>
                          {c.deal_amount && (
                            <div className="text-success text-[10px]">
                              ₹{Number(c.deal_amount).toLocaleString("en-IN")} Cr
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
