import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";

type DateRange = "today" | "7d" | "30d";

interface KPIs {
  cases_created:       number;
  cases_approved:      number;
  cases_declined:      number;
  approval_rate:       number;
  avg_tat_days:        number | null;
  cases_stuck:         number;
  pipeline_value_cr:   number;
  approved_value_cr:   number;
  docs_uploaded:       number;
  extractions_done:    number;
  extractions_failed:  number;
}

interface Alert { id: string; alert_type: string; severity: string; title: string; message: string | null; created_at: string; }

const STAGE_COLORS: Record<string, string> = {
  draft: "#6b7280", docs_received: "#60a5fa", on_hold: "#f59e0b",
  analysis: "#a78bfa", narrative: "#c084fc", recommended_ic: "#818cf8",
  ic_review: "#3b82f6", approved: "#22c55e", conditionally_approved: "#4ade80",
  declined: "#ef4444", queries_resubmission: "#fb923c", extracting: "#34d399",
};

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="border border-border bg-card p-3 space-y-1 min-w-0">
      <div className="text-[9px] text-muted-foreground tracking-widest uppercase">{label}</div>
      <div className={cn("text-2xl font-bold tabular-nums", color ?? "text-foreground")}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const RANGE_LABELS: Record<DateRange, string> = { today: "TODAY", "7d": "LAST 7 DAYS", "30d": "LAST 30 DAYS" };

export function Dashboard() {
  const [range, setRange] = useState<DateRange>("today");
  const [kpis, setKpis]   = useState<KPIs | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pipelineByStage, setPipelineByStage] = useState<{ stage: string; count: number; value: number }[]>([]);
  const [uploadsByHour, setUploadsByHour]     = useState<{ hour: string; count: number }[]>([]);
  const [extractionTrend, setExtractionTrend] = useState<{ day: string; success: number; failed: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load(range);
  }, [range]);

  async function load(r: DateRange) {
    setLoading(true);
    const now   = new Date();
    const from  = r === "today" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
                : r === "7d"    ? new Date(now.getTime() - 7  * 86400000).toISOString()
                :                 new Date(now.getTime() - 30 * 86400000).toISOString();

    // KPIs from credit_cases
    const [casesRes, docsRes, alertsRes] = await Promise.all([
      (supabase as any).from("credit_cases").select("id,status,ic_decision,deal_amount,created_at,updated_at"),
      (supabase as any).from("financial_documents").select("id,extraction_status,created_at").gte("created_at", from),
      (supabase as any).from("observability_alerts").select("*").eq("resolved", false).order("created_at", { ascending: false }).limit(5),
    ]);

    const cases: { id: string; status: string; ic_decision: string | null; deal_amount: number | null; created_at: string; updated_at: string }[] = casesRes.data ?? [];
    const docs: { id: string; extraction_status: string; created_at: string }[] = docsRes.data ?? [];

    const inRange = cases.filter(c => c.created_at >= from);
    const activeStatuses = ["draft","docs_received","on_hold","uploading","extracting","extracted","analysis","narrative","recommended_ic","ic_review","queries_resubmission"];
    const activeCases    = cases.filter(c => activeStatuses.includes(c.status));
    const approvedCases  = cases.filter(c => c.ic_decision === "approved");
    const declinedCases  = cases.filter(c => c.ic_decision === "declined");
    const decided        = approvedCases.length + declinedCases.length + cases.filter(c => c.ic_decision === "conditionally_approved").length;

    const stuckThreshold = Date.now() - 48 * 3600000;
    const stuck = activeCases.filter(c => new Date(c.updated_at).getTime() < stuckThreshold);

    const tatCases = cases.filter(c => c.ic_decision && c.updated_at);
    const avgTat   = tatCases.length > 0
      ? tatCases.reduce((s, c) => s + (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()), 0) / tatCases.length / 86400000
      : null;

    const pipelineVal = activeCases.reduce((s, c) => s + (c.deal_amount ?? 0), 0);
    const approvedVal = approvedCases.reduce((s, c) => s + (c.deal_amount ?? 0), 0);

    setKpis({
      cases_created:      inRange.length,
      cases_approved:     approvedCases.length,
      cases_declined:     declinedCases.length,
      approval_rate:      decided > 0 ? Math.round((approvedCases.length / decided) * 100) : 0,
      avg_tat_days:       avgTat !== null ? Math.round(avgTat * 10) / 10 : null,
      cases_stuck:        stuck.length,
      pipeline_value_cr:  Math.round(pipelineVal * 10) / 10,
      approved_value_cr:  Math.round(approvedVal * 10) / 10,
      docs_uploaded:      docs.length,
      extractions_done:   docs.filter(d => d.extraction_status === "extracted").length,
      extractions_failed: docs.filter(d => d.extraction_status === "failed").length,
    });

    setAlerts(alertsRes.data ?? []);

    // Pipeline by stage
    const stageCounts: Record<string, { count: number; value: number }> = {};
    activeCases.forEach(c => {
      if (!stageCounts[c.status]) stageCounts[c.status] = { count: 0, value: 0 };
      stageCounts[c.status].count++;
      stageCounts[c.status].value += c.deal_amount ?? 0;
    });
    setPipelineByStage(Object.entries(stageCounts).map(([stage, d]) => ({ stage: stage.replace(/_/g, " "), count: d.count, value: Math.round(d.value * 10) / 10 })));

    // Uploads by hour (last 24h)
    const hourBuckets: Record<string, number> = {};
    const dayAgo = Date.now() - 24 * 3600000;
    docs.filter(d => new Date(d.created_at).getTime() > dayAgo).forEach(d => {
      const h = new Date(d.created_at).getHours().toString().padStart(2, "0") + ":00";
      hourBuckets[h] = (hourBuckets[h] ?? 0) + 1;
    });
    setUploadsByHour(Array.from({ length: 24 }, (_, i) => {
      const h = i.toString().padStart(2, "0") + ":00";
      return { hour: h, count: hourBuckets[h] ?? 0 };
    }));

    // Extraction trend (try from activity_log, fallback to docs)
    try {
      const { data: trendData } = await (supabase as any).from("activity_log")
        .select("status,created_at")
        .eq("event_category", "extraction")
        .eq("event_type", "job_completed")
        .gte("created_at", from);
      const dayBuckets: Record<string, { success: number; failed: number }> = {};
      (trendData ?? []).forEach((r: { status: string; created_at: string }) => {
        const d = r.created_at.slice(0, 10);
        if (!dayBuckets[d]) dayBuckets[d] = { success: 0, failed: 0 };
        if (r.status === "success") dayBuckets[d].success++;
        else dayBuckets[d].failed++;
      });
      setExtractionTrend(Object.entries(dayBuckets).map(([day, v]) => ({ day: day.slice(5), ...v })));
    } catch { setExtractionTrend([]); }

    setLoading(false);
  }

  const fmtCr = (v: number) => v > 0 ? `₹${v.toLocaleString("en-IN")} Cr` : "—";

  return (
    <div className="space-y-4">
      {/* active alerts banner */}
      {alerts.length > 0 && (
        <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 flex items-center gap-2">
          <span className="text-destructive font-bold text-[11px] tracking-widest">🔴 ACTIVE ALERTS ({alerts.length})</span>
          <span className="text-[10px] text-destructive/80">{alerts[0]?.title}</span>
          {alerts.length > 1 && <span className="text-[9px] text-destructive/60">+{alerts.length - 1} more</span>}
        </div>
      )}

      {/* range selector */}
      <div className="flex items-center gap-1">
        {(["today","7d","30d"] as DateRange[]).map(r => (
          <button key={r} onClick={() => setRange(r)}
            className={cn("px-3 py-1 text-[10px] font-bold tracking-widest border transition-colors",
              range === r ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50")}>
            {RANGE_LABELS[r]}
          </button>
        ))}
        {loading && <span className="text-[9px] text-muted-foreground animate-pulse ml-2">LOADING…</span>}
      </div>

      {kpis && (
        <>
          {/* business KPIs */}
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-2">BUSINESS METRICS</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              <KPICard label="Cases Created"    value={kpis.cases_created} />
              <KPICard label="Cases Approved"   value={kpis.cases_approved} color="text-success" />
              <KPICard label="Cases Declined"   value={kpis.cases_declined} color={kpis.cases_declined > 0 ? "text-destructive" : undefined} />
              <KPICard label="Approval Rate"    value={`${kpis.approval_rate}%`} color={kpis.approval_rate >= 60 ? "text-success" : "text-warning"} />
              <KPICard label="Avg TAT"          value={kpis.avg_tat_days !== null ? `${kpis.avg_tat_days}d` : "—"} sub="time to decision" />
              <KPICard label="Stuck >48h"       value={kpis.cases_stuck} color={kpis.cases_stuck > 0 ? "text-destructive" : "text-success"} sub="active cases" />
              <KPICard label="Pipeline Value"   value={fmtCr(kpis.pipeline_value_cr)} color="text-primary" sub="under review" />
              <KPICard label="Approved Value"   value={fmtCr(kpis.approved_value_cr)} color="text-success" sub="this period" />
            </div>
          </div>

          {/* ops KPIs */}
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-2">OPERATIONS</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <KPICard label="Docs Uploaded"       value={kpis.docs_uploaded} />
              <KPICard label="Extractions Done"    value={kpis.extractions_done} color="text-success" />
              <KPICard label="Extractions Failed"  value={kpis.extractions_failed} color={kpis.extractions_failed > 0 ? "text-destructive" : "text-success"} />
            </div>
          </div>

          {/* charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* uploads by hour */}
            <div className="border border-border bg-card p-3">
              <div className="text-[9px] text-muted-foreground tracking-widest mb-3">UPLOADS BY HOUR (LAST 24H)</div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={uploadsByHour} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="hour" tick={{ fontSize: 8, fill: "#6b7280" }} interval={3} />
                  <YAxis tick={{ fontSize: 8, fill: "#6b7280" }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid #334155", fontSize: 10 }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* pipeline by stage */}
            <div className="border border-border bg-card p-3">
              <div className="text-[9px] text-muted-foreground tracking-widest mb-3">ACTIVE PIPELINE BY STAGE</div>
              {pipelineByStage.length === 0
                ? <div className="h-[140px] flex items-center justify-center text-[10px] text-muted-foreground">No active cases</div>
                : <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={pipelineByStage} dataKey="count" nameKey="stage" cx="50%" cy="50%" outerRadius={55} label={({ stage, count }) => `${stage} (${count})`} labelLine={false} fontSize={8}>
                        {pipelineByStage.map((entry, i) => (
                          <Cell key={i} fill={STAGE_COLORS[entry.stage.replace(/ /g,"_")] ?? `hsl(${i * 40}, 60%, 50%)`} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid #334155", fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
              }
            </div>

            {/* extraction success trend */}
            {extractionTrend.length > 0 && (
              <div className="border border-border bg-card p-3 md:col-span-2">
                <div className="text-[9px] text-muted-foreground tracking-widest mb-3">EXTRACTION TREND</div>
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={extractionTrend} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 8, fill: "#6b7280" }} />
                    <YAxis tick={{ fontSize: 8, fill: "#6b7280" }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid #334155", fontSize: 10 }} />
                    <Line type="monotone" dataKey="success" stroke="#22c55e" dot={false} strokeWidth={1.5} />
                    <Line type="monotone" dataKey="failed"  stroke="#ef4444" dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
