import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type LogRow = {
  id: string;
  event_category: string;
  event_type: string;
  actor_role: string;
  status: string;
  title: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  case_id: string | null;
};

type CategoryFilter = "all" | "extraction" | "document" | "case" | "decision" | "system";
type StatusFilter   = "all" | "success" | "failure" | "warning";

const STATUS_DOT: Record<string, string> = {
  success: "bg-success",
  failure: "bg-destructive",
  warning: "bg-warning",
};

const CATEGORY_ICON: Record<string, string> = {
  extraction: "⚙",
  document:   "📄",
  case:       "📁",
  decision:   "⚖",
  system:     "🖥",
  auth:       "🔑",
};

function reltime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)  return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-IN");
}

export function BackendLogs() {
  const [logs, setLogs]               = useState<LogRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [category, setCategory]       = useState<CategoryFilter>("all");
  const [statusF, setStatusF]         = useState<StatusFilter>("all");
  const [search, setSearch]           = useState("");
  const [expanded, setExpanded]       = useState<Set<string>>(new Set());
  const [paused, setPaused]           = useState(false);
  const pausedRef                     = useRef(false);
  pausedRef.current                   = paused;

  const load = async () => {
    let q = supabase
      .from("activity_log")
      .select("id,event_category,event_type,actor_role,status,title,metadata,created_at,case_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (category !== "all") q = q.eq("event_category", category);
    if (statusF  !== "all") q = q.eq("status", statusF);
    const { data } = await q;
    if (data) setLogs(data as LogRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [category, statusF]);

  // Realtime subscription
  useEffect(() => {
    const ch = supabase
      .channel("backend-logs-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" },
        (payload) => {
          if (pausedRef.current) return;
          const row = payload.new as LogRow;
          if (category !== "all" && row.event_category !== category) return;
          if (statusF  !== "all" && row.status !== statusF)            return;
          setLogs(prev => [row, ...prev].slice(0, 200));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [category, statusF]);

  const filtered = logs.filter(l =>
    !search || l.title.toLowerCase().includes(search.toLowerCase()) ||
    l.event_type.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search logs..."
          className="bg-input border border-border px-3 py-1.5 text-xs text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary w-48"
        />

        {/* category chips */}
        <div className="flex gap-1 flex-wrap">
          {(["all","extraction","document","case","decision","system"] as CategoryFilter[]).map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`text-[9px] tracking-widest px-2 py-1 border transition-colors ${category === c ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:border-primary/50"}`}>
              {c.toUpperCase()}
            </button>
          ))}
        </div>

        {/* status chips */}
        <div className="flex gap-1">
          {(["all","success","failure","warning"] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => setStatusF(s)}
              className={`text-[9px] tracking-widest px-2 py-1 border transition-colors ${statusF === s ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:border-primary/50"}`}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setPaused(p => !p)}
            className={`text-[9px] tracking-widest px-2 py-1 border transition-colors ${paused ? "border-warning text-warning" : "border-border text-muted-foreground hover:border-primary/50"}`}>
            {paused ? "▶ RESUME" : "⏸ PAUSE"}
          </button>
          <button onClick={load} className="text-[9px] tracking-widest px-2 py-1 border border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors">
            ↻ REFRESH
          </button>
          <span className="text-[9px] text-muted-foreground">{filtered.length} entries</span>
        </div>
      </div>

      {/* log list */}
      {loading ? (
        <div className="text-xs text-muted-foreground py-8 text-center tracking-widest">LOADING LOGS...</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-muted-foreground py-8 text-center tracking-widest">NO LOG ENTRIES FOUND</div>
      ) : (
        <div className="border border-border divide-y divide-border/40 font-mono text-[11px]">
          {filtered.map(l => {
            const isOpen = expanded.has(l.id);
            const meta   = l.metadata ?? {};
            return (
              <div key={l.id} className={`${l.status === "failure" ? "bg-destructive/5" : l.status === "warning" ? "bg-warning/5" : ""}`}>
                <div
                  className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-primary/5 transition-colors"
                  onClick={() => toggle(l.id)}
                >
                  {/* status dot */}
                  <span className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${STATUS_DOT[l.status] ?? "bg-muted-foreground"}`} />

                  {/* timestamp */}
                  <span className="text-muted-foreground/60 flex-shrink-0 w-16 text-right">
                    {reltime(l.created_at)}
                  </span>

                  {/* category icon + role */}
                  <span className="flex-shrink-0 text-muted-foreground/60">
                    {CATEGORY_ICON[l.event_category] ?? "·"} <span className="text-[9px] tracking-widest">{l.actor_role}</span>
                  </span>

                  {/* event type badge */}
                  <span className="flex-shrink-0 text-[9px] tracking-widest text-muted-foreground border border-border/60 px-1">
                    {l.event_type.replace(/_/g, " ")}
                  </span>

                  {/* title */}
                  <span className={`flex-1 min-w-0 truncate ${l.status === "failure" ? "text-destructive" : l.status === "warning" ? "text-warning" : "text-foreground"}`}>
                    {l.title}
                  </span>

                  {/* expand toggle */}
                  <span className="flex-shrink-0 text-muted-foreground/40 text-[9px]">
                    {isOpen ? "▲" : "▼"}
                  </span>
                </div>

                {/* expanded metadata */}
                {isOpen && (
                  <div className="px-8 pb-3 space-y-1">
                    <div className="text-[9px] text-muted-foreground tracking-widest border-t border-border/30 pt-2 mb-1">
                      {new Date(l.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
                      {l.case_id && <> · CASE <span className="text-primary">{l.case_id.slice(0, 8)}</span></>}
                    </div>
                    {Object.entries(meta).length > 0 && (
                      <pre className="text-[10px] text-muted-foreground bg-background/50 border border-border/30 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(meta, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
