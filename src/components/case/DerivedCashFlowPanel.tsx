import { Panel } from "@/components/terminal/Panel";
import type { DerivedCashFlow, DerivedCFRow } from "@/features/case/derivedCashFlow";

interface Props {
  series: DerivedCashFlow[];
  unit: string | null;
}

function unitAbbr(u: string | null | undefined) {
  if (!u) return "";
  const l = u.toLowerCase();
  if (l.includes("crore")) return " Cr";
  if (l.includes("lakh"))  return " L";
  if (l.includes("million")) return " M";
  if (l.includes("thousand")) return " K";
  return "";
}

function fmt(v: number | null, unit: string | null): string {
  if (v === null) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) + unitAbbr(unit);
}

interface SectionBlock {
  label: string;
  indent?: boolean;
  getValue: (cf: DerivedCashFlow) => number | null;
  note?: string;
  bold?: boolean;
  separator?: boolean;
}

export function DerivedCashFlowPanel({ series, unit }: Props) {
  if (series.length === 0) return null;

  const sections: SectionBlock[] = [
    { label: "Operating Cash Flow (CFO)", bold: true, getValue: cf => cf.cfo.total },
    ...(() => {
      // Use rows from first series item as template for CFO rows
      const template = series[0].cfo.rows;
      return template.map((r): SectionBlock => ({
        label: r.label,
        indent: true,
        note: r.note,
        getValue: cf => cf.cfo.rows.find(x => x.label === r.label)?.value ?? null,
      }));
    })(),
    { label: "Investing Cash Flow (CFI)", bold: true, getValue: cf => cf.cfi.total },
    { label: "Capex (approx.)", indent: true, note: "–(Δ Net Fixed Assets + Depreciation); disposals excluded", getValue: cf => cf.cfi.rows[0]?.value ?? null },
    { label: "Financing Cash Flow (CFF)", bold: true, getValue: cf => cf.cff.total },
    { label: "Δ Long Term Borrowings",      indent: true, getValue: cf => cf.cff.rows.find(r => r.label === "Δ Long Term Borrowings")?.value ?? null },
    { label: "Δ Short Term Borrowings",     indent: true, getValue: cf => cf.cff.rows.find(r => r.label === "Δ Short Term Borrowings")?.value ?? null },
    { label: "Equity Raised / (Returned)",  indent: true, note: "Δ Net Worth – PAT; captures fresh share capital issuance", getValue: cf => cf.cff.rows.find(r => r.label === "Equity Raised / (Returned)")?.value ?? null },
    { label: "Net Change in Cash", bold: true, getValue: cf => cf.netChange },
    { label: "Opening Cash (BS)", indent: true, getValue: cf => cf.openingCash },
    { label: "Derived Closing Cash", bold: true, getValue: cf => cf.derivedClosingCash },
  ];

  return (
    <Panel
      title="Derived Cash Flow"
      ticker="Indirect Method · from BS + P&L"
      status="idle"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[480px]">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left py-2 pl-3 text-muted-foreground font-medium w-64">Line Item</th>
              {series.map(cf => (
                <th key={cf.years[1]} className="text-right py-2 px-4 text-muted-foreground font-medium whitespace-nowrap">
                  FY {cf.years[1]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((section, idx) => (
              <tr
                key={idx}
                className={`border-t border-border/20 ${section.bold ? "bg-muted/10" : ""}`}
              >
                <td className={`py-1.5 pr-4 text-xs ${section.indent ? "pl-6 text-muted-foreground" : "pl-3 text-foreground"} ${section.bold ? "font-semibold" : ""}`}>
                  {section.label}
                  {section.note && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground/50" title={section.note}>ⓘ</span>
                  )}
                </td>
                {series.map(cf => {
                  const v = section.getValue(cf);
                  return (
                    <td
                      key={cf.years[1]}
                      className={`py-1.5 px-4 text-right tabular-nums text-xs ${section.bold ? "font-semibold" : "text-muted-foreground"} ${v !== null && v < 0 ? "text-destructive/80" : v !== null && v > 0 && section.bold ? "text-success" : ""}`}
                      title={section.note}
                    >
                      {fmt(v, unit)}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Reconciliation row */}
            <tr className="border-t-2 border-border/60 bg-muted/20">
              <td className="pl-3 py-2 text-xs font-semibold text-foreground">
                BS Cash & Bank (check)
              </td>
              {series.map(cf => (
                <td key={cf.years[1]} className="px-4 py-2 text-right tabular-nums text-xs font-semibold">
                  {fmt(cf.bsCash, unit)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-border/20">
              <td className="pl-3 py-1.5 text-xs text-muted-foreground">
                Reconciliation gap
              </td>
              {series.map(cf => {
                const gap = cf.reconciliationGap;
                const isClean = gap !== null && Math.abs(gap) < 1;
                return (
                  <td
                    key={cf.years[1]}
                    className={`px-4 py-1.5 text-right tabular-nums text-xs font-medium ${gap === null ? "text-muted-foreground" : isClean ? "text-success" : "text-destructive"}`}
                  >
                    {gap === null
                      ? "—"
                      : isClean
                        ? "✓ Reconciles"
                        : `Δ ${fmt(gap, unit)}`}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-muted-foreground space-y-0.5 border-t border-border/30 pt-2">
        <div>· Indirect method — CFO derived from PAT + D&A + working capital movements</div>
        <div>· CFI is approximated as –(Δ Net Fixed Assets + Depreciation); disposals are excluded and will cause a gap</div>
        <div>· CFF includes equity raised (Δ Net Worth − PAT); dividends paid will reduce this figure</div>
        <div>· Reconciliation gap should be near zero; a large gap indicates missing BS categories or a disposal/dividend not captured</div>
      </div>
    </Panel>
  );
}
