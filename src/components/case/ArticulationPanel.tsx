import React, { useState } from "react";
import { Panel } from "@/components/terminal/Panel";
import type { ArticulationCheck } from "@/features/case/articulationChecks";

interface Props {
  checks: ArticulationCheck[];
  unit: string | null;
}

const CATEGORY_LABELS: Record<ArticulationCheck["category"], string> = {
  within_bs:   "Balance Sheet Integrity",
  within_pl:   "P&L Integrity",
  within_cf:   "Cash Flow Integrity",
  cross_stmt:  "Cross-Statement Articulation",
  temporal:    "Year-over-Year Continuity",
  wc_schedule: "Working Capital Reconciliation",
};

function unitAbbr(u: string | null | undefined) {
  if (!u) return "";
  const l = u.toLowerCase();
  if (l.includes("crore"))   return " Cr";
  if (l.includes("lakh"))    return " L";
  if (l.includes("million")) return " M";
  return "";
}

function fmtVal(v: number | null, unit: string | null) {
  if (v === null) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) + unitAbbr(unit);
}

function StatusBadge({ check }: { check: ArticulationCheck }) {
  if (check.status === "skip") return <span className="text-muted-foreground text-[10px]">—</span>;
  if (check.status === "pass") return <span className="text-success text-[10px]">✓</span>;
  if (check.status === "fail") return (
    <span className="inline-flex items-center gap-1 text-destructive text-[10px] font-semibold">
      ✗ HARD
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-warning text-[10px] font-semibold">
      △ SOFT
    </span>
  );
}

export function ArticulationPanel({ checks, unit }: Props) {
  const actionable = checks.filter(c => c.status !== "skip" && c.status !== "pass");
  const hardFails  = actionable.filter(c => c.status === "fail").length;
  const warnings   = actionable.filter(c => c.status === "warn").length;
  const allPass    = actionable.length === 0;

  const [expanded, setExpanded] = useState(!allPass);
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set());

  const toggleCheck = (id: string) => {
    setExpandedChecks(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const summaryChip = allPass
    ? <span className="text-success text-xs font-medium">✓ All checks passed</span>
    : <span className="text-xs font-medium">
        {hardFails > 0 && <span className="text-destructive">{hardFails} hard failure{hardFails > 1 ? "s" : ""}</span>}
        {hardFails > 0 && warnings > 0 && <span className="text-muted-foreground"> · </span>}
        {warnings > 0 && <span className="text-warning">{warnings} warning{warnings > 1 ? "s" : ""}</span>}
      </span>;

  // Group actionable checks by category
  const categories = Array.from(
    new Set(checks.filter(c => c.status !== "skip").map(c => c.category))
  ) as ArticulationCheck["category"][];

  return (
    <Panel
      title="Articulation Checks"
      ticker={allPass ? "All Clear" : `${hardFails + warnings} issue${hardFails + warnings > 1 ? "s" : ""}`}
      status={allPass ? "live" : hardFails > 0 ? "idle" : "warn"}
      actions={
        <div className="flex items-center gap-3">
          {summaryChip}
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? "Collapse ↑" : "Expand ↓"}
          </button>
        </div>
      }
    >
      {expanded && (
        <div className="space-y-3">
          {categories.map(cat => {
            const catChecks = checks.filter(c => c.category === cat && c.status !== "skip");
            if (catChecks.length === 0) return null;
            return (
              <div key={cat}>
                <div className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase mb-1">
                  {CATEGORY_LABELS[cat]}
                </div>
                <div className="border border-border/40 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/20">
                      <tr>
                        <th className="text-left py-1.5 pl-3 pr-2 text-muted-foreground font-medium w-5"></th>
                        <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Check</th>
                        <th className="text-right py-1.5 px-2 text-muted-foreground font-medium hidden sm:table-cell">Expected</th>
                        <th className="text-right py-1.5 px-2 text-muted-foreground font-medium hidden sm:table-cell">Actual</th>
                        <th className="text-right py-1.5 pl-2 pr-3 text-muted-foreground font-medium">Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {catChecks.map(check => {
                        const isExpanded = expandedChecks.has(check.id);
                        const showHint = check.status !== "pass" && isExpanded;
                        return (
                          <React.Fragment key={check.id}>
                            <tr
                              className={`border-t border-border/20 cursor-pointer hover:bg-muted/10 transition-colors ${check.status === "fail" ? "bg-destructive/5" : check.status === "warn" ? "bg-warning/5" : ""}`}
                              onClick={() => check.status !== "pass" && toggleCheck(check.id)}
                            >
                              <td className="py-1.5 pl-3 pr-2">
                                <StatusBadge check={check} />
                              </td>
                              <td className="py-1.5 px-2 text-foreground">
                                {check.name}
                                {check.fiscal_year && (
                                  <span className="ml-1.5 text-muted-foreground text-[10px]">FY {check.fiscal_year}</span>
                                )}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                                {fmtVal(check.expected, unit)}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                                {fmtVal(check.actual, unit)}
                              </td>
                              <td className={`py-1.5 pl-2 pr-3 text-right tabular-nums font-medium ${check.gap === null || Math.abs(check.gap) <= check.tolerance ? "text-muted-foreground" : check.status === "fail" ? "text-destructive" : "text-warning"}`}>
                                {check.gap === null ? "—" : check.status === "pass" ? "✓" : `Δ ${fmtVal(check.gap, unit)}`}
                              </td>
                            </tr>
                            {showHint && (
                              <tr key={`${check.id}-hint`} className="border-t border-border/10 bg-muted/5">
                                <td></td>
                                <td colSpan={4} className="py-1.5 px-2 text-[11px] text-muted-foreground italic">
                                  {check.hint}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {allPass && (
            <div className="text-xs text-muted-foreground text-center py-3">
              All {checks.filter(c => c.status !== "skip").length} checks passed — statements are internally consistent.
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
