import type { ExtractedRow } from "@/features/case/types";
import type { LineItem } from "@/features/case/types";

export function StatementInsights({ type, typeRows, years, unit }: {
  type: string;
  typeRows: ExtractedRow[];
  years: number[];
  unit: string | null | undefined;
}) {
  if (years.length === 0) return null;

  const abbr = unit ? ` ${unit}` : "";

  const getVal = (fy: number, label: string): number | null => {
    const row = typeRows.find(r => r.fiscal_year === fy);
    if (!row) return null;
    const it = (row.line_items as unknown as LineItem[]).find(i => i.label === label);
    if (!it) return null;
    const v = it.override_value ?? it.value;
    return (v !== null && Number.isFinite(Number(v))) ? Number(v) : null;
  };

  const fmt = (v: number | null, dp = 1) =>
    v === null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: dp });

  const pct = (v: number | null) => v === null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";

  const cagr = (first: number | null, last: number | null, n: number) =>
    first && last && n > 0 && first > 0 ? (Math.pow(last / first, 1 / n) - 1) * 100 : null;

  const yoy = (prev: number | null, curr: number | null) =>
    prev && curr && prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : null;

  type Insight = { label: string; value: string; status: "green" | "amber" | "red" | "neutral"; note: string };
  const insights: Insight[] = [];

  const firstFy = years[0];
  const lastFy = years[years.length - 1];
  const nYears = years.length - 1;
  const prevFy = years.length >= 2 ? years[years.length - 2] : null;

  if (type === "profit_loss") {
    const rev0 = getVal(firstFy, "Turnover"), revN = getVal(lastFy, "Turnover");
    const revCAGR = cagr(rev0, revN, nYears);
    const revYOY = prevFy ? yoy(getVal(prevFy, "Turnover"), revN) : null;
    if (revCAGR !== null) insights.push({
      label: "Revenue CAGR", value: pct(revCAGR),
      status: revCAGR >= 10 ? "green" : revCAGR >= 0 ? "amber" : "red",
      note: `FY${firstFy}→FY${lastFy}: ${fmt(rev0)}→${fmt(revN)}${abbr}`,
    });
    if (revYOY !== null && prevFy) insights.push({
      label: `Revenue YoY (FY${prevFy}→${lastFy})`, value: pct(revYOY),
      status: revYOY >= 10 ? "green" : revYOY >= 0 ? "amber" : "red",
      note: revYOY > 0 ? "Positive growth momentum" : "Revenue contracted — monitor closely",
    });

    const ebitda = getVal(lastFy, "EBITDA"), turnover = getVal(lastFy, "Turnover");
    const ebitdaMgn = ebitda && turnover ? (ebitda / turnover) * 100 : null;
    if (ebitdaMgn !== null) insights.push({
      label: "EBITDA Margin (latest)", value: pct(ebitdaMgn),
      status: ebitdaMgn >= 15 ? "green" : ebitdaMgn >= 8 ? "amber" : "red",
      note: ebitdaMgn >= 15 ? "Healthy operating profitability" : ebitdaMgn >= 8 ? "Moderate margins — scope for improvement" : "Thin margins — cost structure review needed",
    });

    const pat = getVal(lastFy, "PAT"), pat0 = getVal(firstFy, "PAT");
    const patMgn = pat && turnover ? (pat / turnover) * 100 : null;
    if (patMgn !== null) insights.push({
      label: "PAT Margin (latest)", value: pct(patMgn),
      status: patMgn >= 8 ? "green" : patMgn >= 3 ? "amber" : "red",
      note: patMgn >= 8 ? "Strong net profitability" : patMgn >= 3 ? "Modest net margins" : "Low net margins — check interest burden & tax",
    });
    const patCAGR = cagr(pat0, pat, nYears);
    if (patCAGR !== null) insights.push({
      label: "PAT CAGR", value: pct(patCAGR),
      status: patCAGR >= 10 ? "green" : patCAGR >= 0 ? "amber" : "red",
      note: `Profit growth ${patCAGR >= 10 ? "outpacing" : patCAGR >= 0 ? "tracking" : "lagging"} revenue`,
    });

    const intExp = getVal(lastFy, "Interest Expense");
    const icr = ebitda && intExp && intExp > 0 ? ebitda / intExp : null;
    if (icr !== null) insights.push({
      label: "Interest Coverage (EBITDA/Int)", value: icr.toFixed(2) + "x",
      status: icr >= 3 ? "green" : icr >= 1.5 ? "amber" : "red",
      note: icr >= 3 ? "Comfortable debt service capacity" : icr >= 1.5 ? "Adequate but watch leverage" : "Tight coverage — high repayment risk",
    });
  }

  if (type === "balance_sheet") {
    const nw = getVal(lastFy, "Net Worth"), nw0 = getVal(firstFy, "Net Worth");
    const nwCAGR = cagr(nw0, nw, nYears);
    if (nwCAGR !== null) insights.push({
      label: "Net Worth CAGR", value: pct(nwCAGR),
      status: nwCAGR >= 10 ? "green" : nwCAGR >= 0 ? "amber" : "red",
      note: `FY${firstFy}→FY${lastFy}: ${fmt(nw0)}→${fmt(nw)}${abbr}`,
    });

    const ltd = getVal(lastFy, "Long Term Borrowings"), std = getVal(lastFy, "Short Term Borrowings");
    const td = getVal(lastFy, "Total Debt") ?? ((ltd ?? 0) + (std ?? 0));
    if (nw && nw !== 0) {
      const de = td / nw;
      insights.push({
        label: "Debt / Equity (latest)", value: de.toFixed(2) + "x",
        status: de <= 1.5 ? "green" : de <= 3 ? "amber" : "red",
        note: de <= 1.5 ? "Conservative leverage" : de <= 3 ? "Moderate leverage — monitor" : "High leverage — elevated financial risk",
      });
    }

    const ca = getVal(lastFy, "Current Assets"), cl = getVal(lastFy, "Current Liabilities");
    if (ca && cl && cl !== 0) {
      const cr = ca / cl;
      insights.push({
        label: "Current Ratio (latest)", value: cr.toFixed(2) + "x",
        status: cr >= 1.5 ? "green" : cr >= 1 ? "amber" : "red",
        note: cr >= 1.5 ? "Healthy short-term liquidity" : cr >= 1 ? "Tight liquidity — watch working capital" : "Current liabilities exceed current assets",
      });
    }

    const ta = getVal(lastFy, "Total Assets");
    if (ta && nw) {
      const roa = (getVal(lastFy, "PAT") ?? 0) / ta * 100;
      if (roa !== 0) insights.push({
        label: "Return on Assets (latest)", value: pct(roa),
        status: roa >= 5 ? "green" : roa >= 2 ? "amber" : "red",
        note: roa >= 5 ? "Efficient asset utilisation" : roa >= 2 ? "Moderate asset returns" : "Assets generating low returns",
      });
    }

    const tdYOY = prevFy ? yoy(getVal(prevFy, "Total Debt"), td) : null;
    if (tdYOY !== null) insights.push({
      label: `Debt Growth YoY (FY${prevFy}→${lastFy})`, value: pct(tdYOY),
      status: tdYOY <= 0 ? "green" : tdYOY <= 15 ? "amber" : "red",
      note: tdYOY <= 0 ? "Debt reducing — positive deleveraging" : tdYOY <= 15 ? "Moderate debt build-up" : "Rapid debt growth — assess repayment capacity",
    });
  }

  if (type === "cash_flow") {
    const cfo = getVal(lastFy, "Cash from Operations");
    const cfi = getVal(lastFy, "Cash from Investing");
    const cff = getVal(lastFy, "Cash from Financing");
    if (cfo !== null) insights.push({
      label: "Operating Cash Flow (latest)", value: fmt(cfo) + abbr,
      status: cfo > 0 ? "green" : "red",
      note: cfo > 0 ? "Business generating positive operating cash" : "Negative operating cash — working capital strain or losses",
    });
    if (cfi !== null) insights.push({
      label: "Investing Cash Flow (latest)", value: fmt(cfi) + abbr,
      status: cfi < 0 ? "green" : "amber",
      note: cfi < 0 ? "Investing in growth (capex/acquisitions)" : "Positive — asset disposals or low capex",
    });
    if (cff !== null) insights.push({
      label: "Financing Cash Flow (latest)", value: fmt(cff) + abbr,
      status: "neutral",
      note: cff > 0 ? "Net borrowing or capital raised" : "Debt repayment / dividend outflows",
    });
    if (cfo !== null && cfi !== null) {
      const fcf = cfo + cfi;
      insights.push({
        label: "Free Cash Flow (CFO + CFI)", value: fmt(fcf) + abbr,
        status: fcf > 0 ? "green" : "red",
        note: fcf > 0 ? "Positive FCF — able to service debt from operations" : "Negative FCF — reliant on external financing",
      });
    }
  }

  if (type === "projections") {
    const rev0p = getVal(years[0], "Projected Turnover"), revNp = getVal(lastFy, "Projected Turnover");
    const projCAGR = cagr(rev0p, revNp, nYears);
    if (projCAGR !== null) insights.push({
      label: "Projected Revenue CAGR", value: pct(projCAGR),
      status: projCAGR >= 10 ? "green" : projCAGR >= 5 ? "amber" : "red",
      note: projCAGR >= 20 ? "Aggressive growth — validate assumptions carefully" : projCAGR >= 10 ? "Realistic growth trajectory" : "Conservative projections",
    });

    const pebitda = getVal(lastFy, "Projected EBITDA"), prev = getVal(lastFy, "Projected Turnover");
    const pemgn = pebitda && prev ? (pebitda / prev) * 100 : null;
    if (pemgn !== null) insights.push({
      label: "Projected EBITDA Margin (terminal)", value: pct(pemgn),
      status: pemgn >= 15 ? "green" : pemgn >= 8 ? "amber" : "red",
      note: pemgn >= 15 ? "Strong projected profitability" : "Validate margin expansion assumptions",
    });

    const ppat = getVal(lastFy, "Projected PAT"), pnw = getVal(lastFy, "Projected Net Worth");
    if (ppat && pnw && pnw !== 0) {
      const roe = (ppat / pnw) * 100;
      insights.push({
        label: "Projected ROE (terminal)", value: pct(roe),
        status: roe >= 15 ? "green" : roe >= 8 ? "amber" : "red",
        note: roe >= 15 ? "Attractive return on equity projected" : "Moderate projected returns",
      });
    }
  }

  if (insights.length === 0) return null;

  const colorMap = {
    green: { bg: "bg-success/10", border: "border-success/30", text: "text-success", dot: "bg-success" },
    amber: { bg: "bg-warning/10", border: "border-warning/30", text: "text-warning", dot: "bg-warning" },
    red:   { bg: "bg-destructive/10", border: "border-destructive/30", text: "text-destructive", dot: "bg-destructive" },
    neutral:{ bg: "bg-muted/20", border: "border-border/40", text: "text-foreground/70", dot: "bg-muted-foreground" },
  };

  const counts = { green: insights.filter(i => i.status === "green").length, amber: insights.filter(i => i.status === "amber").length, red: insights.filter(i => i.status === "red").length };
  const verdict = counts.red >= 2 ? "CONCERNS FLAGGED" : counts.red === 1 || counts.amber >= 3 ? "REVIEW REQUIRED" : "FINANCIALS HEALTHY";
  const verdictColor = counts.red >= 2 ? "text-destructive" : counts.red === 1 || counts.amber >= 3 ? "text-warning" : "text-success";

  return (
    <div className="mt-4 border border-border/50 bg-card/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[9px] tracking-widest text-muted-foreground">ANALYST INSIGHTS</div>
        <div className={`text-[10px] font-bold tracking-widest ${verdictColor}`}>{verdict}</div>
      </div>
      <div className="flex gap-2 text-[9px] tracking-widest">
        <span className="text-success">{counts.green} PASS</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-warning">{counts.amber} REVIEW</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-destructive">{counts.red} CONCERN</span>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {insights.map((ins, i) => {
          const c = colorMap[ins.status];
          return (
            <div key={i} className={`flex items-start gap-2 border ${c.border} ${c.bg} px-2 py-1.5 rounded-sm`}>
              <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${c.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-foreground/80">{ins.label}</span>
                  <span className={`text-[11px] font-bold tabular-nums shrink-0 ${c.text}`}>{ins.value}</span>
                </div>
                <div className="text-[9px] text-muted-foreground mt-0.5">{ins.note}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
