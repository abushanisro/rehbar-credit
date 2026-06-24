import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Metric = { metric_name: string; metric_value: number; recorded_at: string };
type ErrorGroup = { event_type: string; count: number; last_seen: string; case_ids: string[] };
type Alert = { id: string; alert_type: string; severity: string; title: string; message: string | null; created_at: string };

function MetricCard({ label, value, unit, ok }: { label: string; value: string; unit?: string; ok?: boolean }) {
  return (
    <div className="border border-border bg-card p-3">
      <div className="text-[9px] text-muted-foreground tracking-widest mb-1">{label}</div>
      <div className={cn("text-xl font-bold tabular-nums", ok === false ? "text-destructive" : ok === true ? "text-success" : "text-foreground")}>
        {value}<span className="text-[10px] text-muted-foreground ml-1">{unit}</span>
      </div>
    </div>
  );
}

export function SystemHealth() {
  const [metrics, setMetrics]       = useState<Metric[]>([]);
  const [errors, setErrors]         = useState<ErrorGroup[]>([]);
  const [alerts, setAlerts]         = useState<Alert[]>([]);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [workerAlive, setWorkerAlive] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  async function load() {
    const [metricsRes, errorsRes, alertsRes] = await Promise.all([
      // latest value per metric
      (supabase as any).from("system_metrics")
        .select("metric_name,metric_value,recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(50),
      // recent failures from activity_log
      (supabase as any).from("activity_log")
        .select("event_type,case_id,created_at")
        .eq("status", "failure")
        .gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString())
        .order("created_at", { ascending: false })
        .limit(200),
      // active alerts
      (supabase as any).from("observability_alerts")
        .select("*")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    // deduplicate: latest per metric name
    const metricMap: Record<string, Metric> = {};
    ((metricsRes.data ?? []) as Metric[]).forEach(m => {
      if (!metricMap[m.metric_name] || m.recorded_at > metricMap[m.metric_name].recorded_at)
        metricMap[m.metric_name] = m;
    });
    const latestMetrics = Object.values(metricMap);
    setMetrics(latestMetrics);

    // check worker alive: last metric write < 10 min ago
    const lastMetric = latestMetrics[0];
    if (lastMetric) {
      setWorkerAlive(Date.now() - new Date(lastMetric.recorded_at).getTime() < 10 * 60000);
    } else {
      setWorkerAlive(null);
    }

    // group errors by type
    const errorMap: Record<string, ErrorGroup> = {};
    ((errorsRes.data ?? []) as { event_type: string; case_id: string | null; created_at: string }[]).forEach(r => {
      if (!errorMap[r.event_type]) errorMap[r.event_type] = { event_type: r.event_type, count: 0, last_seen: r.created_at, case_ids: [] };
      errorMap[r.event_type].count++;
      if (r.case_id && !errorMap[r.event_type].case_ids.includes(r.case_id)) errorMap[r.event_type].case_ids.push(r.case_id);
      if (r.created_at > errorMap[r.event_type].last_seen) errorMap[r.event_type].last_seen = r.created_at;
    });
    setErrors(Object.values(errorMap).sort((a, b) => b.count - a.count));

    setAlerts(alertsRes.data ?? []);
    setLoading(false);
  }

  function metricVal(name: string) {
    return metrics.find(m => m.metric_name === name)?.metric_value ?? null;
  }

  const queueDepth    = metricVal("queue_depth");
  const cacheHit      = metricVal("cache_hit_rate");
  const avgMs         = metricVal("avg_processing_ms");
  const failedJobs    = metricVal("failed_jobs_24h");
  const ocrSuccess    = metricVal("ocr_success_rate");

  const workerStatus = workerAlive === null ? "NO DATA"
    : workerAlive ? "HEALTHY" : "OFFLINE";
  const workerColor  = workerAlive === null ? "text-muted-foreground"
    : workerAlive ? "text-success" : "text-destructive";

  return (
    <div className="space-y-4">
      {/* worker status */}
      <div className="border border-border bg-card p-3 flex items-center justify-between">
        <div>
          <div className="text-[9px] text-muted-foreground tracking-widest mb-1">PYTHON WORKER STATUS</div>
          <div className={cn("text-lg font-bold tracking-widest", workerColor)}>
            {workerAlive === true && <span className="mr-2 animate-pulse">●</span>}
            {workerStatus}
          </div>
        </div>
        <div className="text-right text-[9px] text-muted-foreground">
          {metrics[0] && <div>Last heartbeat: {new Date(metrics[0].recorded_at).toLocaleTimeString("en-IN")}</div>}
          <div className="mt-1 text-[8px]">Auto-refreshes every 30s</div>
        </div>
      </div>

      {/* alerts */}
      {alerts.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] text-muted-foreground tracking-widest">ACTIVE ALERTS</div>
          {alerts.map(a => (
            <div key={a.id} className={cn("border px-3 py-2 flex items-start justify-between gap-2",
              a.severity === "critical" ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10")}>
              <div>
                <div className={cn("text-[11px] font-bold", a.severity === "critical" ? "text-destructive" : "text-warning")}>{a.title}</div>
                {a.message && <div className="text-[9px] text-muted-foreground mt-0.5">{a.message}</div>}
              </div>
              <div className="text-[9px] text-muted-foreground shrink-0">
                {new Date(a.created_at).toLocaleTimeString("en-IN")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* metrics grid */}
      <div>
        <div className="text-[9px] text-muted-foreground tracking-widest mb-2">WORKER METRICS (LAST RECORDED)</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <MetricCard label="Queue Depth"     value={queueDepth !== null ? String(queueDepth) : "—"} ok={queueDepth !== null ? queueDepth < 20 : undefined} />
          <MetricCard label="Cache Hit Rate"  value={cacheHit !== null ? `${cacheHit}` : "—"} unit="%" ok={cacheHit !== null ? cacheHit >= 50 : undefined} />
          <MetricCard label="Avg Processing"  value={avgMs !== null ? String(Math.round(avgMs / 1000)) : "—"} unit="s" ok={avgMs !== null ? avgMs < 120000 : undefined} />
          <MetricCard label="Failed Jobs 24h" value={failedJobs !== null ? String(failedJobs) : "—"} ok={failedJobs !== null ? failedJobs === 0 : undefined} />
          <MetricCard label="OCR Success"     value={ocrSuccess !== null ? `${ocrSuccess}` : "—"} unit="%" ok={ocrSuccess !== null ? ocrSuccess >= 80 : undefined} />
        </div>
        {metrics.length === 0 && !loading && (
          <div className="mt-2 text-[9px] text-muted-foreground">No metrics yet — start the Python worker to populate this section.</div>
        )}
      </div>

      {/* error center */}
      <div>
        <div className="text-[9px] text-muted-foreground tracking-widest mb-2">RECENT ERRORS (LAST 24H)</div>
        {errors.length === 0
          ? <div className="border border-border bg-card px-3 py-4 text-[10px] text-success text-center">✓ No errors in last 24 hours</div>
          : (
            <div className="border border-border divide-y divide-border/30">
              {errors.map(e => (
                <div key={e.event_type} className="bg-card">
                  <button onClick={() => setExpanded(expanded === e.event_type ? null : e.event_type)}
                    className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-surface-2 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-destructive text-[11px]">✕</span>
                      <span className="text-[10px] text-foreground">{e.event_type.replace(/_/g, " ")}</span>
                      <span className="text-[9px] text-muted-foreground">{e.case_ids.length} case{e.case_ids.length !== 1 ? "s" : ""} affected</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-destructive">{e.count}</span>
                      <span className="text-[9px] text-muted-foreground">{new Date(e.last_seen).toLocaleTimeString("en-IN")}</span>
                    </div>
                  </button>
                  {expanded === e.event_type && e.case_ids.length > 0 && (
                    <div className="px-7 pb-2 pt-1 flex flex-wrap gap-1.5">
                      {e.case_ids.slice(0, 10).map(cid => (
                        <button key={cid} onClick={() => navigate(`/case/${cid}`)}
                          className="text-[9px] border border-primary/30 text-primary px-1.5 py-0.5 hover:bg-primary/10 transition-colors font-mono">
                          {cid.slice(0, 8)}…
                        </button>
                      ))}
                      {e.case_ids.length > 10 && <span className="text-[9px] text-muted-foreground">+{e.case_ids.length - 10} more</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        }
      </div>
    </div>
  );
}
