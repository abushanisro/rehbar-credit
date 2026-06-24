import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type CaseRow = {
  id: string;
  case_code: string;
  client_name: string;
  product_type: string;
  status: string;
  deal_amount: number | null;
  assigned_to_name: string | null;
  assigned_to_email: string | null;
  created_at: string;
  updated_at: string;
};

const ACTIVE_STATUSES = [
  "draft","docs_received","on_hold","uploading","extracting","extracted",
  "analysis","narrative","recommended_ic","ic_review","queries_resubmission",
];

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", docs_received: "Docs Received", on_hold: "On Hold",
  uploading: "Uploading", extracting: "Extracting", extracted: "Extracted",
  analysis: "Analysis", narrative: "Narrative", recommended_ic: "Rec. IC",
  ic_review: "IC Review", queries_resubmission: "Re-Query",
};

function getRisk(updatedAt: string, status: string): "green" | "yellow" | "red" {
  if (status === "on_hold") return "yellow";
  const age = Date.now() - new Date(updatedAt).getTime();
  if (age > 72 * 3600000) return "red";
  if (age > 48 * 3600000) return "yellow";
  return "green";
}

function getSlA(updatedAt: string): string {
  const diff = Date.now() - new Date(updatedAt).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "< 1h";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const RISK_ICON = { green: "🟢", yellow: "🟡", red: "🔴" };

export function CaseMonitor() {
  const [cases, setCases]     = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy]   = useState<"risk" | "updated" | "amount">("risk");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any).from("credit_cases")
        .select("id,case_code,client_name,product_type,status,deal_amount,assigned_to_name,assigned_to_email,created_at,updated_at")
        .in("status", ACTIVE_STATUSES)
        .order("updated_at", { ascending: true });
      setCases(data ?? []);
      setLoading(false);
    })();
  }, []);

  const sorted = [...cases].sort((a, b) => {
    if (sortBy === "risk") {
      const rOrder = { red: 0, yellow: 1, green: 2 };
      return rOrder[getRisk(a.updated_at, a.status)] - rOrder[getRisk(b.updated_at, b.status)];
    }
    if (sortBy === "amount") return (b.deal_amount ?? 0) - (a.deal_amount ?? 0);
    return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
  });

  const redCount    = cases.filter(c => getRisk(c.updated_at, c.status) === "red").length;
  const yellowCount = cases.filter(c => getRisk(c.updated_at, c.status) === "yellow").length;

  return (
    <div className="space-y-3">
      {/* summary bar */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] text-muted-foreground">{cases.length} ACTIVE CASES</span>
        {redCount > 0    && <span className="text-[10px] text-destructive font-bold">🔴 {redCount} STUCK &gt;72H</span>}
        {yellowCount > 0 && <span className="text-[10px] text-warning font-bold">🟡 {yellowCount} NEEDS ATTENTION</span>}
        <div className="ml-auto flex gap-1">
          {(["risk","updated","amount"] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)}
              className={cn("px-2 py-0.5 text-[9px] font-bold tracking-widest border transition-colors",
                sortBy === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50")}>
              {s === "risk" ? "BY RISK" : s === "updated" ? "BY ACTIVITY" : "BY AMOUNT"}
            </button>
          ))}
        </div>
      </div>

      {/* table */}
      <div className="border border-border overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className="text-left px-3 py-2 text-muted-foreground tracking-widest font-medium">RISK</th>
              <th className="text-left px-3 py-2 text-muted-foreground tracking-widest font-medium">CLIENT</th>
              <th className="text-left px-3 py-2 text-muted-foreground tracking-widest font-medium">STAGE</th>
              <th className="text-left px-3 py-2 text-muted-foreground tracking-widest font-medium">SLA</th>
              <th className="text-left px-3 py-2 text-muted-foreground tracking-widest font-medium">OWNER</th>
              <th className="text-right px-3 py-2 text-muted-foreground tracking-widest font-medium">AMOUNT</th>
              <th className="text-left px-3 py-2 text-muted-foreground tracking-widest font-medium">LAST ACTIVITY</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {loading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground animate-pulse">LOADING…</td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No active cases</td></tr>
            )}
            {sorted.map(c => {
              const risk = getRisk(c.updated_at, c.status);
              return (
                <tr key={c.id}
                  onClick={() => navigate(`/case/${c.id}`)}
                  className="hover:bg-surface-2 cursor-pointer transition-colors bg-card">
                  <td className="px-3 py-2">{RISK_ICON[risk]}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{c.client_name}</div>
                    <div className="text-muted-foreground text-[9px]">{c.case_code}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="border border-border px-1.5 py-0.5 text-[9px] tracking-wider">
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className={cn("px-3 py-2 font-mono font-bold",
                    risk === "red" ? "text-destructive" : risk === "yellow" ? "text-warning" : "text-muted-foreground")}>
                    {getSlA(c.updated_at)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.assigned_to_name ?? c.assigned_to_email ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">
                    {c.deal_amount ? `₹${c.deal_amount.toLocaleString("en-IN")} Cr` : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-[9px]">
                    {new Date(c.updated_at).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
