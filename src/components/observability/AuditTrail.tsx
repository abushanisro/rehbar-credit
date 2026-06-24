import { useEffect, useState } from "react";
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
  resource_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const STATUS_COLOR: Record<string, string> = {
  success: "text-success",
  failure: "text-destructive",
  warning: "text-warning",
};

const PAGE_SIZE = 100;

function toCSV(rows: LogRow[]): string {
  const header = "timestamp,actor,role,category,event,status,title,case_id";
  const lines = rows.map(r => [
    r.created_at, r.actor_name ?? "", r.actor_role ?? "", r.event_category,
    r.event_type, r.status, `"${r.title.replace(/"/g,'""')}"`, r.case_id ?? "",
  ].join(","));
  return [header, ...lines].join("\n");
}

export function AuditTrail() {
  const [rows, setRows]         = useState<LogRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage]         = useState(0);
  const [hasMore, setHasMore]   = useState(true);

  const categories = ["all","case","document","extraction","decision","system"];

  async function fetchRows(p: number, cat: string, st: string, append = false) {
    setLoading(true);
    let q = (supabase as any).from("activity_log")
      .select("id,event_category,event_type,case_id,actor_name,actor_role,status,title,resource_type,metadata,created_at")
      .order("created_at", { ascending: false })
      .range(p * PAGE_SIZE, (p + 1) * PAGE_SIZE - 1);
    if (cat !== "all") q = q.eq("event_category", cat);
    if (st  !== "all") q = q.eq("status", st);
    const { data } = await q;
    const r = (data ?? []) as LogRow[];
    setHasMore(r.length === PAGE_SIZE);
    setRows(prev => append ? [...prev, ...r] : r);
    setLoading(false);
  }

  useEffect(() => { setPage(0); fetchRows(0, catFilter, statusFilter); }, [catFilter, statusFilter]);

  const filtered = search.trim()
    ? rows.filter(r => r.title.toLowerCase().includes(search.toLowerCase()) || (r.actor_name ?? "").toLowerCase().includes(search.toLowerCase()))
    : rows;

  function exportCSV() {
    const blob = new Blob([toCSV(filtered)], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url;
    a.download = `rehbar-audit-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search actor or event…"
          className="border border-border bg-surface px-2 py-1 text-[10px] tracking-wide text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 w-48" />
        <div className="flex gap-1">
          {categories.map(c => (
            <button key={c} onClick={() => setCatFilter(c)}
              className={cn("px-2 py-0.5 text-[9px] font-bold tracking-widest border transition-colors",
                catFilter === c ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50")}>
              {c.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {["all","success","failure","warning"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn("px-2 py-0.5 text-[9px] font-bold tracking-widest border transition-colors",
                statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50")}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>
        <button onClick={exportCSV} className="ml-auto px-3 py-1 text-[9px] font-bold tracking-widest border border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
          ↓ EXPORT CSV
        </button>
      </div>

      {/* table */}
      <div className="border border-border overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-muted-foreground tracking-widest font-medium">
              <th className="text-left px-3 py-2">TIMESTAMP</th>
              <th className="text-left px-3 py-2">ACTOR</th>
              <th className="text-left px-3 py-2">ROLE</th>
              <th className="text-left px-3 py-2">CATEGORY</th>
              <th className="text-left px-3 py-2">EVENT</th>
              <th className="text-left px-3 py-2">STATUS</th>
              <th className="text-left px-3 py-2">DESCRIPTION</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground animate-pulse">LOADING…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No records found</td></tr>
            )}
            {filtered.map(row => (
              <tr key={row.id} className="bg-card hover:bg-surface-2 transition-colors">
                <td className="px-3 py-1.5 font-mono text-[9px] text-muted-foreground whitespace-nowrap">
                  {new Date(row.created_at).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit", second:"2-digit" })}
                </td>
                <td className="px-3 py-1.5 text-foreground/80 max-w-[120px] truncate">{row.actor_name ?? "system"}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{row.actor_role ?? "—"}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{row.event_category}</td>
                <td className="px-3 py-1.5 text-muted-foreground font-mono text-[9px]">{row.event_type.replace(/_/g," ")}</td>
                <td className={cn("px-3 py-1.5 font-bold text-[9px]", STATUS_COLOR[row.status])}>{row.status.toUpperCase()}</td>
                <td className="px-3 py-1.5 text-foreground/70 max-w-[260px] truncate">{row.title}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && !loading && (
        <button onClick={() => { const next = page+1; setPage(next); fetchRows(next, catFilter, statusFilter, true); }}
          className="w-full py-2 text-[10px] tracking-widest text-muted-foreground border border-border hover:border-primary/50 hover:text-primary transition-colors">
          LOAD MORE
        </button>
      )}
    </div>
  );
}
