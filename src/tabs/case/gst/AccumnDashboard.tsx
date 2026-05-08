import { useState } from "react";
import { Panel } from "@/components/terminal/Panel";
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend, LabelList,
} from "recharts";
import type {
  AccumnReport,
  AccumnSalesSummary,
} from "@/features/case/types";

export function AccumnDashboard({ data, onClear }: { data: AccumnReport; onClear?: () => void }) {
  const [concTab, setConcTab] = useState<"customer" | "supplier">("customer");
  const [concPeriod, setConcPeriod] = useState<string>("");

  const fmt = (v: number | null | undefined) =>
    v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const pct = (v: number | null | undefined) => v == null ? "—" : `${Number(v).toFixed(1)}%`;
  const avgMon = (revenue: number | null | undefined, period: string): string => {
    if (revenue == null) return "—";
    let months = 12;
    if (!/^TTM/i.test(period)) {
      const m = period.match(/Till\s+([A-Za-z]{3})-\d{2}/i);
      if (m) {
        const names: Record<string, number> = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
        const mn = names[m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()];
        if (mn) months = mn >= 4 ? mn - 3 : mn + 9;
      }
    }
    return (revenue / months).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  };
  const sevCls = (s: string) =>
    s === "HIGH" ? "text-destructive border-destructive/30 bg-destructive/5"
    : s === "MEDIUM" ? "text-warning border-warning/30 bg-warning/5"
    : "text-success border-success/30 bg-success/5";

  const concPeriods = Array.from(new Set([
    ...(data.customer_concentration?.map(r => r.period) ?? []),
    ...(data.supplier_concentration?.map(r => r.period) ?? []),
  ])).sort();
  const activePeriod = concPeriod || concPeriods[concPeriods.length - 1] || "";
  const topCustomers = (data.customer_concentration ?? []).filter(r => r.period === activePeriod).sort((a,b) => a.rank - b.rank);
  const topSuppliers = (data.supplier_concentration ?? []).filter(r => r.period === activePeriod).sort((a,b) => a.rank - b.rank);

  const hasFlags       = (data.flags?.length ?? 0) > 0;
  const hasConc        = (data.customer_concentration?.length ?? 0) > 0 || (data.supplier_concentration?.length ?? 0) > 0;
  const highFlags      = data.flags?.filter(f => f.severity === "HIGH").length ?? 0;
  const mediumFlags    = data.flags?.filter(f => f.severity === "MEDIUM").length ?? 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-bold tracking-[0.2em] text-accent border border-accent/40 px-1.5 py-0.5">ACCUMN</span>
          <span className="terminal-label text-xs">GST ANALYTICAL REPORT</span>
          {data.company_profile?.gstin && (
            <span className="text-[10px] text-muted-foreground font-mono">{data.company_profile.gstin}</span>
          )}
          {hasFlags && (
            <span className={`text-[9px] font-bold tracking-widest ${highFlags > 0 ? "text-destructive" : "text-warning"}`}>
              {highFlags > 0 ? `▲ ${highFlags} HIGH` : `△ ${mediumFlags} MEDIUM`}
            </span>
          )}
        </div>
        {onClear && (
          <button onClick={onClear} className="text-[10px] border border-border text-muted-foreground px-2 py-0.5 hover:text-foreground hover:border-foreground/40 transition-colors">
            [RE-EXTRACT]
          </button>
        )}
      </div>

      {/* Flags */}
      {hasFlags && (
        <Panel title={`FLAGS · ${data.flags!.length} ALERTS`} ticker="RISK INDICATORS"
          status={highFlags > 0 ? "idle" : mediumFlags > 0 ? "warn" : "live"}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.flags!.map((flag, i) => (
              <div key={i} className={`border p-2.5 space-y-1 ${sevCls(flag.severity)}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[8px] font-bold tracking-[0.15em] px-1.5 py-0.5 border ${sevCls(flag.severity)}`}>{flag.severity}</span>
                  <span className="text-xs font-bold leading-tight">{flag.flag_name}</span>
                </div>
                <div className="text-[10px] text-muted-foreground leading-relaxed">{flag.description}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Company Profile */}
      {data.company_profile && Object.values(data.company_profile).some(Boolean) && (
        <Panel title="COMPANY PROFILE" ticker="GSTIN DETAILS">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
            {data.company_profile.name && (<div><div className="terminal-label">COMPANY</div><div className="font-medium mt-0.5">{data.company_profile.name}</div></div>)}
            {data.company_profile.gstin && (<div><div className="terminal-label">GSTIN</div><div className="font-mono font-medium mt-0.5 text-accent">{data.company_profile.gstin}</div></div>)}
            {data.company_profile.pan && (<div><div className="terminal-label">PAN</div><div className="font-mono font-medium mt-0.5">{data.company_profile.pan}</div></div>)}
            {data.company_profile.state && (<div><div className="terminal-label">STATE</div><div className="font-medium mt-0.5">{data.company_profile.state}</div></div>)}
            {data.company_profile.constitution && (<div><div className="terminal-label">CONSTITUTION</div><div className="font-medium mt-0.5">{data.company_profile.constitution}</div></div>)}
            {data.company_profile.business_type && (<div><div className="terminal-label">BUSINESS TYPE</div><div className="font-medium mt-0.5">{data.company_profile.business_type}</div></div>)}
            {data.company_profile.registration_date && (<div><div className="terminal-label">REG. DATE</div><div className="font-medium mt-0.5">{data.company_profile.registration_date}</div></div>)}
            {data.company_profile.report_date && (<div><div className="terminal-label">REPORT DATE</div><div className="font-medium mt-0.5">{data.company_profile.report_date}</div></div>)}
          </div>
        </Panel>
      )}

      {/* Sales Summary */}
      {(data.sales_summary?.length ?? 0) > 0 && (
        <Panel title="SALES SUMMARY" ticker="ADJUSTED REVENUE + MARGINS">
          <div className="space-y-3">
            {/* Transposed table — periods as columns, metrics as rows */}
            <div className="overflow-x-auto">
              <div className="text-[9px] text-muted-foreground/50 tracking-wide text-right mb-1">in ₹ Lakhs</div>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 pr-4 font-normal">PARTICULARS</th>
                    {data.sales_summary!.map((row, i) => (
                      <th key={i} className="text-right pr-3 font-normal whitespace-nowrap">{row.period}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([
                    { label: "Adjusted Revenue (Total)", getValue: (r: AccumnSalesSummary) => fmt(r.adjusted_revenue), bold: true },
                    { label: "Adjusted Revenue Per Month", getValue: (r: AccumnSalesSummary) => avgMon(r.adjusted_revenue, r.period), bold: true },
                    { label: "Net Revenue", getValue: (r: AccumnSalesSummary) => fmt(r.net_revenue) },
                    { label: "Sales Return %", getValue: (r: AccumnSalesSummary) => pct(r.sales_return_pct), muted: true },
                    { label: "Gross Margin %", getValue: (r: AccumnSalesSummary) => pct(r.gross_margin_pct) },
                    { label: "EBITDA %", getValue: (r: AccumnSalesSummary) => pct(r.ebitda_pct), muted: true },
                    { label: "PAT %", getValue: (r: AccumnSalesSummary) => pct(r.pat_pct), muted: true },
                  ] as { label: string; getValue: (r: AccumnSalesSummary) => string; bold?: boolean; muted?: boolean }[]).map(({ label, getValue, bold, muted }) => (
                    <tr key={label} className="border-b border-border/30">
                      <td className={`py-1.5 pr-4 ${bold ? "font-bold text-foreground" : "text-muted-foreground"}`}>{label}</td>
                      {data.sales_summary!.map((row, i) => (
                        <td key={i} className={`text-right pr-3 tabular-nums ${bold ? "text-primary font-bold" : muted ? "text-muted-foreground" : ""}`}>
                          {getValue(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(data.sales_summary!.length >= 2) && (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.sales_summary} margin={{ top: 24, right: 44, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="period" tick={{ fill: "#6b7280", fontSize: 9 }} />
                    <YAxis yAxisId="rev" tick={{ fill: "#6b7280", fontSize: 9 }} width={58}
                      tickFormatter={v => Math.abs(v) >= 100 ? `${(v/100).toFixed(0)}Cr` : `${v}L`} />
                    <YAxis yAxisId="pct" orientation="right" tick={{ fill: "#6b7280", fontSize: 9 }} width={44}
                      tickFormatter={v => `${v}%`} />
                    <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                    <Bar yAxisId="rev" dataKey="adjusted_revenue" name="Adj. Revenue" fill="#14b8a6" opacity={0.85} radius={[2,2,0,0]}>
                      <LabelList dataKey="adjusted_revenue" position="top" style={{ fontSize: 9, fill: "#9ca3af" }}
                        formatter={(v: number) => v != null ? (Math.abs(v) >= 100 ? `${(v/100).toFixed(2)}Cr` : `${Number(v).toFixed(2)}L`) : ""} />
                    </Bar>
                    <Line yAxisId="pct" type="monotone" dataKey="gross_margin_pct" name="Gross Mgn%" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#0f172a", strokeWidth: 2 }}>
                      <LabelList dataKey="gross_margin_pct" position="top" style={{ fontSize: 9, fill: "#f59e0b" }}
                        formatter={(v: number) => v != null ? `${Number(v).toFixed(1)}%` : ""} />
                    </Line>
                    <Line yAxisId="pct" type="monotone" dataKey="ebitda_pct" name="EBITDA%" stroke="#60a5fa" strokeWidth={2} dot={{ r: 2.5 }} />
                    <Line yAxisId="pct" type="monotone" dataKey="pat_pct" name="PAT%" stroke="#a78bfa" strokeWidth={2} dot={{ r: 2.5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* Customer Category Breakup */}
      {(data.customer_categories?.length ?? 0) > 0 && (
        <Panel title="CUSTOMER CATEGORY BREAKUP" ticker="B2B / B2C / EXPORT">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 pr-3">PERIOD</th>
                  <th className="text-right pr-3">B2B</th>
                  <th className="text-right pr-3">B2C SMALL</th>
                  <th className="text-right pr-3">B2C LARGE</th>
                  <th className="text-right pr-3">EXPORT</th>
                  <th className="text-right pr-3">NIL RATED</th>
                  <th className="text-right font-bold text-primary">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {data.customer_categories!.map((row, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-1 pr-3 font-bold text-accent">{row.period}</td>
                    <td className="text-right pr-3 tabular-nums text-primary">{fmt(row.b2b)}</td>
                    <td className="text-right pr-3 tabular-nums">{fmt(row.b2c_small)}</td>
                    <td className="text-right pr-3 tabular-nums">{fmt(row.b2c_large)}</td>
                    <td className="text-right pr-3 tabular-nums text-accent">{fmt(row.export)}</td>
                    <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmt(row.nil_rated)}</td>
                    <td className="text-right tabular-nums font-bold">{fmt(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Customer / Supplier Concentration */}
      {hasConc && (
        <Panel title="CONCENTRATION ANALYSIS" ticker="TOP CUSTOMERS / SUPPLIERS">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-0">
                <button onClick={() => setConcTab("customer")}
                  className={`text-[10px] px-3 py-0.5 border tracking-widest font-bold transition-colors ${concTab === "customer" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  CUSTOMERS
                </button>
                <button onClick={() => setConcTab("supplier")}
                  className={`text-[10px] px-3 py-0.5 border tracking-widest font-bold transition-colors ${concTab === "supplier" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  SUPPLIERS
                </button>
              </div>
              {concPeriods.length > 1 && (
                <div className="flex gap-1">
                  {concPeriods.map(p => (
                    <button key={p} onClick={() => setConcPeriod(p)}
                      className={`text-[9px] px-2 py-0.5 border tracking-widest transition-colors ${p === activePeriod ? "border-accent text-accent" : "border-border text-muted-foreground hover:text-foreground"}`}>
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-center py-1 pr-2 w-8">#</th>
                    <th className="text-left pr-3">NAME</th>
                    <th className="text-left pr-3">GSTIN</th>
                    <th className="text-right pr-3">AMOUNT</th>
                    <th className="text-right">SHARE</th>
                  </tr>
                </thead>
                <tbody>
                  {(concTab === "customer" ? topCustomers : topSuppliers).map((row, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="text-center py-1 pr-2 text-muted-foreground/60 text-[10px]">{row.rank}</td>
                      <td className="pr-3 font-medium max-w-[160px] truncate">{row.name}</td>
                      <td className="pr-3 font-mono text-[10px] text-muted-foreground">{row.gstin ?? "—"}</td>
                      <td className="text-right pr-3 tabular-nums text-primary font-medium">{fmt(row.amount)}</td>
                      <td className="text-right tabular-nums">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-10 h-1.5 bg-border/40 rounded-sm overflow-hidden hidden sm:block">
                            <div className="h-full rounded-sm bg-primary/60" style={{ width: `${Math.min(100, row.pct)}%` }} />
                          </div>
                          <span className={`font-bold text-[11px] ${row.pct >= 30 ? "text-destructive" : row.pct >= 15 ? "text-warning" : "text-foreground/70"}`}>
                            {pct(row.pct)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(concTab === "customer" ? topCustomers : topSuppliers).length === 0 && (
                    <tr><td colSpan={5} className="py-3 text-center text-muted-foreground text-[10px]">No data for selected period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      )}

      {/* Geography */}
      {(data.geography?.length ?? 0) > 0 && (() => {
        const geoPeriods = Array.from(new Set(data.geography!.map(r => r.period))).sort();
        const latPeriod = geoPeriods[geoPeriods.length - 1];
        const geoRows = data.geography!.filter(r => r.period === latPeriod).sort((a,b) => b.amount - a.amount);
        return (
          <Panel title="GEOGRAPHY BREAKUP" ticker={`STATE-WISE SALES · ${latPeriod}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 pr-3">STATE</th>
                    <th className="text-right pr-3">AMOUNT</th>
                    <th className="text-right">SHARE%</th>
                  </tr>
                </thead>
                <tbody>
                  {geoRows.map((row, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 pr-3 font-medium">{row.state}</td>
                      <td className="text-right pr-3 tabular-nums text-primary">{fmt(row.amount)}</td>
                      <td className="text-right tabular-nums">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-14 h-1.5 bg-border/40 rounded-sm overflow-hidden hidden sm:block">
                            <div className="h-full rounded-sm bg-accent/60" style={{ width: `${Math.min(100, row.pct)}%` }} />
                          </div>
                          <span>{pct(row.pct)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })()}

      {/* Product Concentration */}
      {(data.product_concentration?.length ?? 0) > 0 && (() => {
        const prodPeriods = Array.from(new Set(data.product_concentration!.map(r => r.period))).sort();
        const latPeriod = prodPeriods[prodPeriods.length - 1];
        const prodRows = data.product_concentration!.filter(r => r.period === latPeriod).sort((a,b) => b.amount - a.amount);
        return (
          <Panel title="PRODUCT CONCENTRATION" ticker={`HSN / CHAPTER WISE · ${latPeriod}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 pr-3">PRODUCT / DESCRIPTION</th>
                    <th className="text-left pr-3">HSN</th>
                    <th className="text-left pr-3">CHAPTER</th>
                    <th className="text-right pr-3">AMOUNT</th>
                    <th className="text-right font-bold">SHARE%</th>
                  </tr>
                </thead>
                <tbody>
                  {prodRows.slice(0, 20).map((row, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 pr-3 font-medium">{row.description}</td>
                      <td className="pr-3 font-mono text-[10px] text-muted-foreground">{row.hsn ?? "—"}</td>
                      <td className="pr-3 text-muted-foreground">{row.chapter ?? "—"}</td>
                      <td className="text-right pr-3 tabular-nums text-primary">{fmt(row.amount)}</td>
                      <td className="text-right tabular-nums font-bold">{pct(row.pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })()}

      {/* Tax Details */}
      {(data.tax_details?.length ?? 0) > 0 && (
        <Panel title="TAX DETAILS" ticker="OUTPUT TAX · ITC ANALYSIS">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 pr-3">PERIOD</th>
                  <th className="text-right pr-3">WC INVEST.</th>
                  <th className="text-right pr-3">OUTPUT TAX</th>
                  <th className="text-right pr-3">IGST</th>
                  <th className="text-right pr-3">CGST</th>
                  <th className="text-right pr-3">SGST</th>
                  <th className="text-right pr-3">ITC AVAILED</th>
                  <th className="text-right font-bold">NET TAX</th>
                </tr>
              </thead>
              <tbody>
                {data.tax_details!.map((row, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-1 pr-3 font-bold text-accent">{row.period}</td>
                    <td className="text-right pr-3 tabular-nums">{fmt(row.wc_investment)}</td>
                    <td className="text-right pr-3 tabular-nums text-warning">{fmt(row.output_tax)}</td>
                    <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmt(row.igst)}</td>
                    <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmt(row.cgst)}</td>
                    <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmt(row.sgst)}</td>
                    <td className="text-right pr-3 tabular-nums text-accent">{fmt(row.itc_availed)}</td>
                    <td className="text-right tabular-nums font-bold text-primary">{fmt(row.net_tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* GSTR Comparison */}
      {(data.gstr_comparison?.length ?? 0) > 0 && (
        <Panel title="GSTR-1 vs GSTR-3B vs GSTR-9" ticker="RETURN RECONCILIATION">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 pr-3">PERIOD</th>
                  <th className="text-right pr-3">GSTR-1 T/O</th>
                  <th className="text-right pr-3">GSTR-3B T/O</th>
                  <th className="text-right pr-3">GSTR-9 T/O</th>
                  <th className="text-right pr-3">GSTR-1 TAX</th>
                  <th className="text-right pr-3">GSTR-3B TAX</th>
                  <th className="text-right">DIFF</th>
                </tr>
              </thead>
              <tbody>
                {data.gstr_comparison!.map((row, i) => {
                  const hasDiff = row.difference != null && row.difference !== 0;
                  return (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 pr-3 font-bold text-accent">{row.period}</td>
                      <td className="text-right pr-3 tabular-nums">{fmt(row.gstr1_turnover)}</td>
                      <td className="text-right pr-3 tabular-nums">{fmt(row.gstr3b_turnover)}</td>
                      <td className="text-right pr-3 tabular-nums text-muted-foreground">{fmt(row.gstr9_turnover)}</td>
                      <td className="text-right pr-3 tabular-nums">{fmt(row.gstr1_tax)}</td>
                      <td className="text-right pr-3 tabular-nums">{fmt(row.gstr3b_tax)}</td>
                      <td className={`text-right tabular-nums font-bold ${hasDiff ? "text-warning" : "text-success"}`}>
                        {row.difference == null ? "—" : `${row.difference >= 0 ? "+" : ""}${fmt(row.difference)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Circular Transactions */}
      {(data.circular_transactions?.length ?? 0) > 0 && (
        <Panel title={`CIRCULAR TRANSACTIONS · ${data.circular_transactions!.length} FLAGGED`} ticker="POTENTIAL RISK" status="idle">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 pr-3">ENTITY</th>
                  <th className="text-left pr-3">GSTIN</th>
                  <th className="text-right pr-3">SALES TO</th>
                  <th className="text-right pr-3">PURCHASES FROM</th>
                  <th className="text-left">NOTE</th>
                </tr>
              </thead>
              <tbody>
                {data.circular_transactions!.map((row, i) => (
                  <tr key={i} className="border-b border-border/30 text-warning/90">
                    <td className="py-1 pr-3 font-medium">{row.entity}</td>
                    <td className="pr-3 font-mono text-[10px] text-muted-foreground">{row.gstin ?? "—"}</td>
                    <td className="text-right pr-3 tabular-nums">{fmt(row.sale_amount)}</td>
                    <td className="text-right pr-3 tabular-nums">{fmt(row.purchase_amount)}</td>
                    <td className="text-[10px] text-muted-foreground">{row.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
