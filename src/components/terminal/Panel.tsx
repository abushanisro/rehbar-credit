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

const statusDot: Record<NonNullable<PanelProps["status"]>, string> = {
  live:  "bg-green-500",
  idle:  "bg-slate-400",
  warn:  "bg-amber-500",
  error: "bg-red-500",
};

export const Panel = ({ title, ticker, status = "live", actions, children, className, bodyClassName }: PanelProps) => {
  return (
    <section className={cn("terminal-panel animate-fade-in", className)}>
      <header className="terminal-panel-header">
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full shrink-0", statusDot[status], status === "live" && "animate-pulse")} />
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {ticker && <span className="text-xs text-muted-foreground">{ticker}</span>}
        </div>
        <div className="flex items-center gap-2">{actions}</div>
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
};
