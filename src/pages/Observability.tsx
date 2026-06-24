import { useState } from "react";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { cn } from "@/lib/utils";
import { Dashboard }        from "@/components/observability/Dashboard";
import { CaseMonitor }      from "@/components/observability/CaseMonitor";
import { ActivityTimeline } from "@/components/observability/ActivityTimeline";
import { SystemHealth }     from "@/components/observability/SystemHealth";
import { AuditTrail }       from "@/components/observability/AuditTrail";
import { BackendLogs }      from "@/components/observability/BackendLogs";

type Tab = "dashboard" | "case_monitor" | "timeline" | "system_health" | "audit_trail" | "logs";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard",    label: "DASHBOARD" },
  { id: "case_monitor", label: "CASE MONITOR" },
  { id: "timeline",     label: "TIMELINE" },
  { id: "system_health",label: "SYSTEM HEALTH" },
  { id: "audit_trail",  label: "AUDIT TRAIL" },
  { id: "logs",         label: "LOGS" },
];

export default function Observability() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <TerminalLayout>
      <div className="space-y-4">
        {/* header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest">REHBAR CREDIT TERMINAL</div>
            <h1 className="text-sm font-bold tracking-widest text-primary mt-0.5">OBSERVABILITY</h1>
          </div>
          <div className="text-[9px] text-muted-foreground tracking-widest hidden md:block">
            PLATFORM HEALTH · ACTIVITY · AUDIT TRAIL
          </div>
        </div>

        {/* tabs */}
        <div className="border-b border-border flex flex-wrap gap-0">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-2 text-[10px] font-bold tracking-widest border-b-2 transition-colors",
                tab === t.id
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}>
              {t.label}
            </button>
          ))}
        </div>

        {/* content */}
        <div>
          {tab === "dashboard"    && <Dashboard />}
          {tab === "case_monitor" && <CaseMonitor />}
          {tab === "timeline"     && <ActivityTimeline />}
          {tab === "system_health"&& <SystemHealth />}
          {tab === "audit_trail"  && <AuditTrail />}
          {tab === "logs"         && <BackendLogs />}
        </div>
      </div>
    </TerminalLayout>
  );
}
