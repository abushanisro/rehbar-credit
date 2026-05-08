import { Panel } from "@/components/terminal/Panel";
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import type { ExtractedRow, CaseRow, LineItem } from "@/features/case/types";
import { unitAbbr, fmtUnit } from "@/features/case/utils";

const TOOLTIP_STYLE = {
  backgroundColor: "#0d1117",
  border: "1px solid #1f2937",
  color: "#e2e8f0",
  fontSize: "11px",
  borderRadius: "2px",
};

export function ProjectionsTab({
  extracted,
  cc,
  busy,
  progress,
  progressLabel,
  onGenerateNote,
}: {
  extracted: ExtractedRow[];
  cc: CaseRow;
  busy: boolean;
  progress: number;
  progressLabel: string;
  onGenerateNote: () => void;
}) {
  const projRows = extracted.filter((r) => r.statement_type === "projections");
  const histPL   = extracted.filter((r) => r.statement_type === "profit_loss");
  const histBS   = extracted.filter((r) => r.statement_type === "balance_sheet");

  // Detect unit from any available extraction row
  const unit = projRows[0]?.unit ?? histPL[0]?.unit ?? null;
  const abbr = unitAbbr(unit);
  const unitTicker = fmtUnit(unit);

  const liVal = (items: LineItem[], label: string): number | null => {
    const it = items.find((i) => i.label === label);
    if (!it) return null;
    return it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
  };

  const fmt  = (n: number | null | undefined, dec = 2): string =>
    n === null || n === undefined || !Number.isFinite(n as number)
      ? "—"
      : (n as number).toLocaleString("en-IN", { maximumFractionDigits: dec, minimumFractionDigits: dec });

  const pct = (n: number | null | undefined): string =>
    n === null || n === undefined || !Number.isFinite(n as number) ? "—" : (n as number).toFixed(1) + "%";

  if (projRows.length === 0) {
    return (
      <Panel title="NO PROJECTION DATA" ticker="UPLOAD REQUIRED">
        <div className="text-muted-foreground text-xs leading-relaxed">
          No projection rows found. Upload a document containing financial projections and extract
          it with the <strong>projections</strong> or <strong>all-in-one</strong> statement type.
        </div>
      </Panel>
    );
  }

  // ── Core projection data ──────────────────────────────────────────────────
  const projYears = [...new Set(projRows.map((r) => r.fiscal_year))].sort();

  const projData = projYears.map((fy) => {
    const items = ((projRows.find((r) => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]);
    const turnover  = liVal(items, "Projected Turnover");
    const ebitda    = liVal(items, "Projected EBITDA");
    const pat       = liVal(items, "Projected PAT");
    const networth  = liVal(items, "Projected Net Worth");
    const totalDebt = liVal(items, "Projected Total Debt");
    return { fy, turnover, ebitda, pat, networth, totalDebt };
  });

  const projMetrics = projData.map((d, i) => {
    const prev         = i > 0 ? projData[i - 1] : null;
    const ebitdaMargin = d.turnover && d.ebitda    ? (d.ebitda / d.turnover) * 100 : null;
    const patMargin    = d.turnover && d.pat       ? (d.pat   / d.turnover) * 100 : null;
    const debtEbitda   = d.ebitda && d.ebitda !== 0 && d.totalDebt ? d.totalDebt / d.ebitda : null;
    const roe          = d.networth && d.networth !== 0 && d.pat   ? (d.pat / d.networth) * 100 : null;
    const revGrowth    = prev?.turnover && d.turnover && prev.turnover !== 0
      ? ((d.turnover - prev.turnover) / Math.abs(prev.turnover)) * 100 : null;
    return { ...d, ebitdaMargin, patMargin, debtEbitda, roe, revGrowth };
  });

  // ── CAGR helpers ─────────────────────────────────────────────────────────
  const cagr = (first: number | null, last: number | null, n: number): number | null =>
    first && last && n > 0 && first > 0 ? (Math.pow(last / first, 1 / n) - 1) * 100 : null;

  const nYears = projData.length - 1;
  const revCAGR = cagr(projData[0]?.turnover ?? null, projData[nYears]?.turnover ?? null, nYears);
  const final   = projMetrics[projMetrics.length - 1];

  // ── Historical data (for bridge chart) ──────────────────────────────────
  const histYears = [...new Set(histPL.map((r) => r.fiscal_year))].sort();
  const histData  = histYears.map((fy) => {
    const plItems = ((histPL.find((r) => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]);
    const bsItems = ((histBS.find((r) => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]);
    return {
      fy,
      turnover:  liVal(plItems, "Turnover"),
      ebitda:    liVal(plItems, "EBITDA"),
      totalDebt: liVal(bsItems, "Total Debt"),
    };
  });

  // ── Chart datasets ────────────────────────────────────────────────────────
  const revenueData  = projMetrics.map((d) => ({
    fy: `FY${d.fy}`, turnover: d.turnover,
    growth: d.revGrowth !== null ? +d.revGrowth.toFixed(1) : null,
  }));

  const marginsData  = projMetrics.map((d) => ({
    fy: `FY${d.fy}`,
    ebitdaMargin: d.ebitdaMargin !== null ? +d.ebitdaMargin.toFixed(1) : null,
    patMargin:    d.patMargin    !== null ? +d.patMargin.toFixed(1)    : null,
  }));

  const bridgeData = [
    ...histData.map((d)  => ({ label: `FY${d.fy}`,    actual: d.turnover, projected: null })),
    ...projData.map((d)  => ({ label: `FY${d.fy}*`,   actual: null, projected: d.turnover })),
  ];
  const lastHistLabel = histData.length ? `FY${histData[histData.length - 1].fy}` : null;

  const debtData = projMetrics.map((d) => ({
    fy: `FY${d.fy}`,
    totalDebt: d.totalDebt,
    debtEbitda: d.debtEbitda !== null ? +d.debtEbitda.toFixed(2) : null,
  }));

  // ── Derived analytics rows ────────────────────────────────────────────────
  const analyticsRows: Array<{ label: string; get: (m: typeof projMetrics[0]) => string; color?: string }> = [
    { label: "EBITDA Margin",        get: (m) => pct(m.ebitdaMargin) },
    { label: "PAT / Net Profit Margin", get: (m) => pct(m.patMargin) },
    { label: "Return on Net Worth",  get: (m) => pct(m.roe) },
    { label: "Debt / EBITDA",        get: (m) => m.debtEbitda !== null ? m.debtEbitda.toFixed(2) + "x" : "—" },
    { label: "Revenue Growth YoY",   get: (m) => m.revGrowth !== null ? (m.revGrowth > 0 ? "+" : "") + m.revGrowth.toFixed(1) + "%" : "—" },
  ];

  const projLineItems = [
    "Projected Turnover",
    "Projected EBITDA",
    "Projected PAT",
    "Projected Net Worth",
    "Projected Total Debt",
  ];

  const debtColor = (v: number | null | undefined) =>
    v === null || v === undefined ? "text-foreground/50" : v < 3 ? "text-success" : v < 5 ? "text-warning" : "text-destructive";

  return (
    <div className="space-y-3">

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Panel title="REVENUE CAGR" ticker={nYears > 0 ? `${nYears}Y PROJ` : "1Y"}>
          <div className={`text-2xl font-bold glow ${revCAGR !== null && revCAGR > 0 ? "text-success" : "text-destructive"}`}>
            {revCAGR !== null ? (revCAGR > 0 ? "+" : "") + revCAGR.toFixed(1) + "%" : "—"}
          </div>
          <div className="terminal-label mt-1">Projected period</div>
        </Panel>
        <Panel title="FINAL EBITDA %" ticker={`FY${final?.fy ?? "—"}`}>
          <div className="text-2xl font-bold text-warning glow">{pct(final?.ebitdaMargin)}</div>
          <div className="terminal-label mt-1">Last projected FY</div>
        </Panel>
        <Panel title="FINAL PAT %" ticker={`FY${final?.fy ?? "—"}`}>
          <div className={`text-2xl font-bold glow ${(final?.patMargin ?? 0) > 0 ? "text-success" : "text-destructive"}`}>
            {pct(final?.patMargin)}
          </div>
          <div className="terminal-label mt-1">Last projected FY</div>
        </Panel>
        <Panel title="DEBT / EBITDA" ticker={`FY${final?.fy ?? "—"}`}>
          <div className={`text-2xl font-bold glow ${debtColor(final?.debtEbitda)}`}>
            {final?.debtEbitda != null ? final.debtEbitda.toFixed(2) + "x" : "—"}
          </div>
          <div className="terminal-label mt-1">Last projected FY</div>
        </Panel>
      </div>

      {/* ── Charts Row 1 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Panel title="PROJECTED REVENUE GROWTH" ticker="TURNOVER">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={revenueData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fill: "#6b7280", fontSize: 10 }} width={55} />
                <YAxis yAxisId="r" orientation="right" tick={{ fill: "#f59e0b", fontSize: 10 }} unit="%" width={38} />
                <RTooltip contentStyle={TOOLTIP_STYLE} />
                <Bar yAxisId="l" dataKey="turnover" fill="#22c55e" opacity={0.85} name="Turnover" radius={[2,2,0,0]} />
                <Line yAxisId="r" type="monotone" dataKey="growth" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 3 }} name="Growth %" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1 tracking-wider">▸ Bars = revenue · Amber line = YoY growth %</div>
        </Panel>

        <Panel title="PROJECTED MARGIN TREND" ticker="EBITDA + PAT">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={marginsData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} unit="%" width={40} />
                <RTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => v.toFixed(1) + "%"} />
                <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                <Line type="monotone" dataKey="ebitdaMargin" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 3 }} name="EBITDA %" connectNulls />
                <Line type="monotone" dataKey="patMargin"    stroke="#60a5fa" strokeWidth={2} dot={{ fill: "#60a5fa", r: 3 }} name="PAT %"   connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1 tracking-wider">▸ Amber = EBITDA margin · Blue = PAT margin</div>
        </Panel>
      </div>

      {/* ── Charts Row 2 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Panel title="HISTORICAL vs PROJECTED REVENUE" ticker="BRIDGE">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bridgeData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} width={55} />
                <RTooltip contentStyle={TOOLTIP_STYLE} />
                {lastHistLabel && <ReferenceLine x={lastHistLabel} stroke="#374151" strokeDasharray="4 2" label={{ value: "PROJ →", fill: "#6b7280", fontSize: 9 }} />}
                <Bar dataKey="actual"    fill="#4b5563" name="Actual"    radius={[2,2,0,0]} />
                <Bar dataKey="projected" fill="#22c55e" opacity={0.7} name="Projected" radius={[2,2,0,0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1 tracking-wider">▸ Grey = historical actuals · Green = projections</div>
        </Panel>

        <Panel title="DEBT TRAJECTORY" ticker="TOTAL DEBT + COVERAGE">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={debtData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fill: "#6b7280", fontSize: 10 }} width={55} />
                <YAxis yAxisId="r" orientation="right" tick={{ fill: "#f59e0b", fontSize: 10 }} unit="x" width={38} />
                <RTooltip contentStyle={TOOLTIP_STYLE} />
                <Bar  yAxisId="l" dataKey="totalDebt"  fill="#ef4444" opacity={0.6} name="Total Debt" radius={[2,2,0,0]} />
                <Line yAxisId="r" type="monotone" dataKey="debtEbitda" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 3 }} name="Debt/EBITDA" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1 tracking-wider">▸ Red bars = total debt · Amber line = Debt/EBITDA</div>
        </Panel>
      </div>

      {/* ── Projected Financials Table ────────────────────────────────────── */}
      <Panel title="PROJECTED FINANCIAL STATEMENTS" ticker={unitTicker || "DOC UNITS"}>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-1">LINE ITEM</th>
              {projYears.map((y) => <th key={y} className="text-right">FY{y}</th>)}
              {nYears > 0 && <th className="text-right text-accent">CAGR</th>}
            </tr>
          </thead>
          <tbody>
            {projLineItems.map((label) => {
              const values = projYears.map((fy) =>
                liVal(((projRows.find((r) => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]), label)
              );
              const itemCagr = cagr(values[0] ?? null, values[values.length - 1] ?? null, nYears);
              return (
                <tr key={label} className="border-b border-border/30">
                  <td className="py-1.5 text-foreground/90 font-medium">{label}</td>
                  {values.map((v, i) => (
                    <td key={projYears[i]} className="text-right tabular-nums text-primary">
                      {fmt(v)}{abbr && v !== null && <span className="text-[9px] text-muted-foreground ml-0.5">{abbr}</span>}
                    </td>
                  ))}
                  {nYears > 0 && (
                    <td className={`text-right tabular-nums font-bold text-[10px] ${itemCagr !== null && itemCagr > 0 ? "text-success" : itemCagr !== null && itemCagr < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {itemCagr !== null ? (itemCagr > 0 ? "+" : "") + itemCagr.toFixed(1) + "%" : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* ── Projection Analytics Matrix ───────────────────────────────────── */}
      <Panel title="PROJECTION ANALYTICS MATRIX" ticker={unitTicker ? `DERIVED RATIOS · ${unitTicker}` : "DERIVED RATIOS"}>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-1">METRIC</th>
              {projYears.map((y) => <th key={y} className="text-right pr-2">FY{y}</th>)}
            </tr>
          </thead>
          <tbody>
            {analyticsRows.map(({ label, get }) => (
              <tr key={label} className="border-b border-border/30">
                <td className="py-1.5 text-foreground/90">{label}</td>
                {projMetrics.map((m) => (
                  <td key={m.fy} className="text-right tabular-nums text-primary pr-2">{get(m)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[9px] text-muted-foreground mt-2 tracking-wider border-t border-border/30 pt-2">
          ▸ Values in {unitTicker || "document units"} · YoY growth from first projected FY
        </div>
      </Panel>

      {/* ── Generate IC Note ─────────────────────────────────────────────── */}
      {busy && (
        <div className="border border-primary/40 bg-primary/5 p-3 space-y-2">
          <div className="flex justify-between text-[11px] tracking-widest">
            <span className="text-primary">▸ {progressLabel || "DRAFTING IC NOTE"}</span>
            <span className="text-primary font-bold tabular-nums">{progress}%</span>
          </div>
          <div className="h-2 bg-input border border-border overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progress}%`, boxShadow: "0 0 8px hsl(var(--primary))" }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground tracking-widest">
            <span>PREP</span><span>ANALYSE</span><span>DRAFT</span><span>BUILD</span><span>DONE</span>
          </div>
        </div>
      )}
      <button
        onClick={onGenerateNote}
        disabled={busy}
        className="bg-primary text-primary-foreground px-4 py-2 text-xs tracking-widest font-bold disabled:opacity-50"
      >
        {busy ? "DRAFTING..." : "[GENERATE 12-SECTION IC NOTE →]"}
      </button>

    </div>
  );
}
