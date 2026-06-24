import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type LogRow = {
  id: string;
  event_category: string;
  event_type: string;
  case_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  status: string;
  title: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const CATEGORY_ICON: Record<string, string> = {
  case:       "📋",
  document:   "📄",
  extraction: "⚙",
  decision:   "⚖",
  auth:       "🔐",
  system:     "🖥",
};

const STATUS_DOT: Record<string, string> = {
  success: "bg-success",
  failure: "bg-destructive",
  warning: "bg-warning",
};

const CATEGORY_FILTERS = ["all", "case", "document", "extraction", "decision", "system"];

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function ActivityTimeline() {
  const [rows, setRows]       = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage]       = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE = 50;

  async function fetchRows(pageNum: number, cat: string, append = false) {
    setLoading(true);
    let q = (supabase as any).from("activity_log")
      .select("id,event_category,event_type,case_id,actor_name,actor_role,status,title,metadata,created_at")
      .order("created_at", { ascending: false })
      .range(pageNum * PAGE, (pageNum + 1) * PAGE - 1);
    if (cat !== "all") q = q.eq("event_category", cat);
    const { data } = await q;
    const rows = (data ?? []) as LogRow[];
    setHasMore(rows.length === PAGE);
    setRows(prev => append ? [...prev, ...rows] : rows);
    setLoading(false);
  }

  useEffect(() => { setPage(0); fetchRows(0, filter); }, [filter]);

  // Realtime: prepend new rows
  useEffect(() => {
    const ch = (supabase as any)
      .channel("activity-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, (payload: { new: LogRow }) => {
        setRows(prev => [payload.new, ...prev]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchRows(next, filter, true);
  };

  return (
    <div className="space-y-3">
      {/* filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORY_FILTERS.map(c => (
          <button key={c} onClick={() => setFilter(c)}
            className={cn("px-2.5 py-0.5 text-[10px] font-bold tracking-widest border transition-colors",
              filter === c ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary")}>
            {CATEGORY_ICON[c] ?? ""} {c.toUpperCase()}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
          LIVE
        </span>
      </div>

      {/* feed */}
      <div className="border border-border divide-y divide-border/30">
        {loading && rows.length === 0 && (
          <div className="px-4 py-8 text-[10px] text-muted-foreground text-center tracking-widest animate-pulse">LOADING…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="px-4 py-8 text-[10px] text-muted-foreground text-center tracking-widest">
            No activity yet — events will appear here automatically.
          </div>
        )}
        {rows.map(row => (
          <div key={row.id} className="bg-card hover:bg-surface-2 transition-colors">
            <button
              onClick={() => setExpanded(expanded === row.id ? null : row.id)}
              className="w-full text-left px-3 py-2.5 flex items-start gap-2.5"
            >
              <span className={cn("mt-1 w-1.5 h-1.5 rounded-full shrink-0", STATUS_DOT[row.status] ?? "bg-muted")} />
              <span className="text-[13px] shrink-0">{CATEGORY_ICON[row.event_category] ?? "●"}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-foreground leading-snug">{row.title}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[9px] text-muted-foreground tracking-wider">{row.event_category.toUpperCase()} · {row.event_type.replace(/_/g, " ").toUpperCase()}</span>
                  {row.actor_name && <span className="text-[9px] text-muted-foreground/60">{row.actor_name}</span>}
                </div>
              </div>
              <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">{relativeTime(row.created_at)}</span>
            </button>
            {expanded === row.id && row.metadata && (
              <div className="px-7 pb-2.5 pt-0">
                <div className="border border-border/50 bg-surface p-2 space-y-1">
                  {Object.entries(row.metadata).filter(([,v]) => v != null).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-[10px]">
                      <span className="text-muted-foreground w-28 shrink-0 tracking-wider">{k.replace(/_/g, " ").toUpperCase()}</span>
                      <span className="text-foreground/80 font-mono break-all">{String(v)}</span>
                    </div>
                  ))}
                  <div className="flex gap-2 text-[10px] border-t border-border/30 pt-1 mt-1">
                    <span className="text-muted-foreground w-28 shrink-0 tracking-wider">TIMESTAMP</span>
                    <span className="text-foreground/80 font-mono">{new Date(row.created_at).toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {hasMore && !loading && (
        <button onClick={loadMore} className="w-full py-2 text-[10px] tracking-widest text-muted-foreground border border-border hover:border-primary/50 hover:text-primary transition-colors">
          LOAD MORE
        </button>
      )}
    </div>
  );
}
