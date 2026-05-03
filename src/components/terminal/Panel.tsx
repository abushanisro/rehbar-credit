import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface PanelProps {
  title: string;
  ticker?: string;
  status?: "live" | "idle" | "warn" | "error";
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  scan?: boolean;
}

const statusColor: Record<NonNullable<PanelProps["status"]>, string> = {
  live: "bg-success text-success-foreground",
  idle: "bg-muted text-muted-foreground",
  warn: "bg-warning text-warning-foreground",
  error: "bg-destructive text-destructive-foreground",
};

export const Panel = ({ title, ticker, status = "live", actions, children, className, bodyClassName, scan }: PanelProps) => {
  return (
    <section className={cn("terminal-panel relative overflow-hidden animate-fade-in", className)}>
      <header className="terminal-panel-header">
        <div className="flex items-center gap-2">
          <span className={cn("inline-block w-1.5 h-1.5", statusColor[status], status === "live" && "ticker-blink")} />
          <span className="font-bold">{title}</span>
          {ticker && <span className="text-muted-foreground">// {ticker}</span>}
        </div>
        <div className="flex items-center gap-2">{actions}</div>
      </header>
      {scan && <div className="scan-line" />}
      <div className={cn("p-3 relative z-[2]", bodyClassName)}>{children}</div>
    </section>
  );
};
