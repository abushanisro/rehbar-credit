import { Panel } from "@/components/terminal/Panel";
import { BulletOnlyMd } from "@/components/case/MdRenderer";
import { RATIO_DISPLAY_NAMES } from "@/features/credit/domain";
import type { CaseRow, ExtractedRow, RatioRow, LineItem } from "@/features/case/types";
import { unitAbbr } from "@/features/case/utils";

// ─── ICFinalRecommendation ───────────────────────────────────────────────────
export function ICFinalRecommendation({ cc, ratios, extracted, ic }: {
  cc: CaseRow;
  ratios: RatioRow[];
  extracted: ExtractedRow[];
  ic: { sections: Record<string, { markdown: string }>; risks: Array<{ category: string; risk: string; mitigant: string; severity: string }>; conditions_precedent: string[]; swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] } };
}) {
  const histYears = Array.from(new Set(extracted.filter(r => r.statement_type !== "projections").map(r => r.fiscal_year))).sort();
  const lastFy = histYears[histYears.length - 1];
  const unit = extracted.find(r => r.unit)?.unit ?? "";
  const abbr = unitAbbr(unit);

  const getVal = (fy: number, label: string): number | null => {
    for (const row of extracted.filter(r => r.fiscal_year === fy && r.statement_type !== "projections")) {
      const it = (row.line_items as unknown as LineItem[]).find(i => i.label === label);
      if (it) { const v = it.override_value ?? it.value; return v !== null && Number.isFinite(Number(v)) ? Number(v) : null; }
    }
    return null;
  };

  const fmt = (v: number | null) => v === null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const pct = (v: number | null) => v === null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";

  // Ratio scorecard
  const latestRatioMap = new Map<string, RatioRow>();
  for (const r of ratios) {
    const existing = latestRatioMap.get(r.ratio_name);
    if (!existing || r.fiscal_year > existing.fiscal_year) latestRatioMap.set(r.ratio_name, r);
  }
  const latestRatios = Array.from(latestRatioMap.values());
  const greenCount = latestRatios.filter(r => r.threshold_status === "green").length;
  const amberCount = latestRatios.filter(r => r.threshold_status === "amber").length;
  const redCount   = latestRatios.filter(r => r.threshold_status === "red").length;
  const total = greenCount + amberCount + redCount;

  const verdict = total === 0
    ? "AWAITING RATIO ANALYSIS"
    : redCount >= 3 ? "NOT RECOMMENDED"
    : redCount >= 1 || amberCount >= 3 ? "CONDITIONAL APPROVAL"
    : "RECOMMEND APPROVAL";

  const verdictColor = verdict === "NOT RECOMMENDED" ? "text-destructive border-destructive/40 bg-destructive/5"
    : verdict === "CONDITIONAL APPROVAL" ? "text-warning border-warning/40 bg-warning/5"
    : verdict === "RECOMMEND APPROVAL" ? "text-success border-success/40 bg-success/5"
    : "text-muted-foreground border-border bg-muted/10";

  // Key financial snapshot (latest year)
  const turnover = lastFy ? getVal(lastFy, "Turnover") : null;
  const ebitda   = lastFy ? getVal(lastFy, "EBITDA") : null;
  const pat      = lastFy ? getVal(lastFy, "PAT") : null;
  const nw       = lastFy ? getVal(lastFy, "Net Worth") : null;
  const td       = lastFy ? getVal(lastFy, "Total Debt") : null;
  const ebitdaMgn = turnover && ebitda ? (ebitda / turnover) * 100 : null;
  const patMgn    = turnover && pat    ? (pat    / turnover) * 100 : null;
  const de        = nw && nw !== 0 && td ? td / nw : null;
  const intExp    = lastFy ? getVal(lastFy, "Interest Expense") : null;
  const icr       = ebitda && intExp && intExp > 0 ? ebitda / intExp : null;

  // Revenue CAGR
  const firstFy = histYears[0];
  const rev0 = firstFy ? getVal(firstFy, "Turnover") : null;
  const revN = lastFy  ? getVal(lastFy,  "Turnover") : null;
  const nYrs = histYears.length - 1;
  const revCAGR = rev0 && revN && nYrs > 0 && rev0 > 0 ? (Math.pow(revN / rev0, 1 / nYrs) - 1) * 100 : null;

  // Strengths & concerns from ratios
  const strengths = latestRatios.filter(r => r.threshold_status === "green").map(r => RATIO_DISPLAY_NAMES[r.ratio_name] ?? r.ratio_name);
  const concerns  = latestRatios.filter(r => r.threshold_status === "red").map(r => RATIO_DISPLAY_NAMES[r.ratio_name] ?? r.ratio_name);
  const cautions  = latestRatios.filter(r => r.threshold_status === "amber").map(r => RATIO_DISPLAY_NAMES[r.ratio_name] ?? r.ratio_name);

  // AI exec recommendation from visit_reference section
  const execAi = ic.sections["visit_reference"]?.markdown ?? "";

  const metricRow = (label: string, value: string | null, note?: string) =>
    value ? (
      <div key={label} className="flex items-baseline justify-between gap-2 py-0.5 border-b border-border/20">
        <span className="text-foreground/60 text-[10px]">{label}</span>
        <div className="text-right">
          <span className="text-primary tabular-nums text-xs font-medium">{value}</span>
          {note && <span className="text-muted-foreground text-[9px] ml-1.5">{note}</span>}
        </div>
      </div>
    ) : null;

  return (
    <Panel title="FINAL CREDIT RECOMMENDATION" ticker="IC DECISION" status={redCount >= 3 ? "idle" : amberCount >= 3 || redCount >= 1 ? "warn" : "live"}>
      <div className="space-y-4">
        {/* Disclaimer */}
        <div className="text-[9px] text-warning/80 tracking-wider border border-warning/30 bg-warning/5 px-2 py-1.5">
          ⚠ AI-ASSISTED ANALYSIS · FINAL DECISION RESTS WITH INVESTMENT COMMITTEE · NOT A SUBSTITUTE FOR ANALYST JUDGEMENT
        </div>

        {/* Verdict */}
        <div className={`border px-4 py-3 text-center ${verdictColor}`}>
          <div className="text-xl font-bold tracking-widest">{verdict}</div>
          <div className="text-[10px] mt-1 opacity-70">{cc.client_name} · {cc.product_type.replace(/_/g, " ").toUpperCase()} · ₹{cc.deal_amount ?? "—"} Cr · {cc.tenure_months ?? "—"}M · {cc.expected_irr ?? "—"}% IRR</div>
        </div>

        {/* Ratio scorecard */}
        {total > 0 && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="border border-success/30 bg-success/5 py-2">
              <div className="text-xl font-bold text-success">{greenCount}</div>
              <div className="text-[8px] text-success/70 tracking-widest">RATIOS PASS</div>
            </div>
            <div className="border border-warning/30 bg-warning/5 py-2">
              <div className="text-xl font-bold text-warning">{amberCount}</div>
              <div className="text-[8px] text-warning/70 tracking-widest">RATIOS CAUTION</div>
            </div>
            <div className="border border-destructive/30 bg-destructive/5 py-2">
              <div className="text-xl font-bold text-destructive">{redCount}</div>
              <div className="text-[8px] text-destructive/70 tracking-widest">RATIOS FAIL</div>
            </div>
          </div>
        )}

        {/* Financial snapshot */}
        {lastFy && (
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-1.5">KEY FINANCIAL SNAPSHOT · FY{lastFy}{unit ? ` · ₹ ${unit}` : ""}</div>
            <div className="space-y-0">
              {metricRow("Revenue (Turnover)", turnover ? fmt(turnover) + (abbr ? ` ${abbr}` : "") : null)}
              {metricRow("EBITDA Margin", ebitdaMgn ? pct(ebitdaMgn) : null, ebitda ? `(${fmt(ebitda)}${abbr ? ` ${abbr}` : ""})` : undefined)}
              {metricRow("PAT Margin", patMgn ? pct(patMgn) : null, pat ? `(${fmt(pat)}${abbr ? ` ${abbr}` : ""})` : undefined)}
              {metricRow("Debt / Equity", de ? de.toFixed(2) + "x" : null, de !== null ? (de <= 1.5 ? "Conservative" : de <= 3 ? "Moderate" : "High leverage") : undefined)}
              {metricRow("Interest Coverage", icr ? icr.toFixed(2) + "x" : null, icr !== null ? (icr >= 3 ? "Comfortable" : icr >= 1.5 ? "Adequate" : "Tight") : undefined)}
              {metricRow("Revenue CAGR", revCAGR !== null ? pct(revCAGR) : null, histYears.length >= 2 ? `FY${firstFy}–FY${lastFy}` : undefined)}
            </div>
          </div>
        )}

        {/* Strengths & Concerns */}
        <div className="grid grid-cols-2 gap-3">
          {strengths.length > 0 && (
            <div>
              <div className="text-[9px] text-success tracking-widest mb-1.5">+ FINANCIAL STRENGTHS</div>
              <div className="space-y-1">
                {strengths.map((s, i) => (
                  <div key={i} className="flex gap-1.5 text-[10px]">
                    <span className="text-success shrink-0">✓</span>
                    <span className="text-foreground/80">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(concerns.length > 0 || cautions.length > 0) && (
            <div>
              {concerns.length > 0 && (
                <>
                  <div className="text-[9px] text-destructive tracking-widest mb-1.5">✕ RED FLAGS</div>
                  <div className="space-y-1 mb-2">
                    {concerns.map((c, i) => (
                      <div key={i} className="flex gap-1.5 text-[10px]">
                        <span className="text-destructive shrink-0">✕</span>
                        <span className="text-foreground/80">{c}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {cautions.length > 0 && (
                <>
                  <div className="text-[9px] text-warning tracking-widest mb-1.5">▲ WATCH ITEMS</div>
                  <div className="space-y-1">
                    {cautions.map((c, i) => (
                      <div key={i} className="flex gap-1.5 text-[10px]">
                        <span className="text-warning shrink-0">▲</span>
                        <span className="text-foreground/80">{c}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Conditions Precedent */}
        {ic.conditions_precedent?.length > 0 && (
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-1.5">CONDITIONS PRECEDENT</div>
            <div className="space-y-0.5">
              {ic.conditions_precedent.map((c, i) => (
                <div key={i} className="flex gap-1.5 text-[10px]">
                  <span className="text-accent shrink-0">▸</span>
                  <span className="text-foreground/80">{c}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI exec text from visit_reference */}
        {execAi && (
          <div>
            <div className="text-[9px] text-muted-foreground tracking-widest mb-1.5">ANALYST OBSERVATIONS</div>
            <BulletOnlyMd text={execAi} />
          </div>
        )}
      </div>
    </Panel>
  );
}
