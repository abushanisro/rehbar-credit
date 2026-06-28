import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { parseTriangulationExcel, isTriangulationExcel } from "@/lib/triangulation-excel-parser";
import type { TriangulationData } from "@/lib/triangulation-excel-parser";
import type { Tables } from "@/integrations/supabase/types";
import { buildTriangulationTemplate, downloadBuffer } from "@/lib/excel-templates";

type CaseRow = Tables<"credit_cases">;

interface TriangulationRow {
  id: string;
  case_id: string;
  report_data: TriangulationData;
  period_covered: string | null;
  created_at: string;
}

function fmtN(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n > 1) return n.toFixed(1) + "%";
  return (n * 100).toFixed(1) + "%";
}

function ResultBadge({ result }: { result: string }) {
  if (result === "Match")
    return <span className="text-[9px] font-bold text-success tracking-widest">MATCH</span>;
  if (result === "Mismatch")
    return <span className="text-[9px] font-bold text-destructive tracking-widest">MISMATCH</span>;
  return <span className="text-[9px] text-muted-foreground">—</span>;
}

function TrendBadge({ trend }: { trend: string }) {
  const cls =
    trend === "growth"    ? "text-success border-success/30 bg-success/5" :
    trend === "de-growth" ? "text-destructive border-destructive/30 bg-destructive/5" :
    trend === "stagnation"? "text-warning border-warning/30 bg-warning/5" :
    trend === "new client"? "text-accent border-accent/30 bg-accent/5" :
                            "text-muted-foreground border-border";
  return (
    <span className={`text-[8px] tracking-widest border px-1 py-0.5 ${cls}`}>
      {trend.toUpperCase()}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] tracking-widest font-bold text-muted-foreground uppercase mb-2 mt-1 border-b border-border/30 pb-1">
      {children}
    </div>
  );
}

export function TriangulationDisplay({ data }: { data: TriangulationData }) {
  return (
    <div className="space-y-6">
      {/* ── Source Date Range ───────────────────────────────────────────── */}
      {data.sourceDates.length > 0 && (
        <div>
          <SectionLabel>Source Date Range</SectionLabel>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-1 font-medium w-8">#</th>
                <th className="text-left font-medium">Source</th>
                <th className="text-left font-medium">Start Date</th>
                <th className="text-left font-medium">End Date</th>
              </tr>
            </thead>
            <tbody>
              {data.sourceDates.map((s, i) => (
                <tr key={i} className="border-b border-border/20">
                  <td className="py-1 text-muted-foreground">{i + 1}</td>
                  <td className="font-medium">{s.source}</td>
                  <td>{s.startDate}</td>
                  <td>{s.endDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Profile Details ─────────────────────────────────────────────── */}
      {data.profileDetails.length > 0 && (
        <div>
          <SectionLabel>Profile Details</SectionLabel>
          <div className="overflow-x-auto">
            <table className="text-xs min-w-[600px] w-full">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 font-medium w-8">#</th>
                  <th className="text-left font-medium w-40">Particular</th>
                  <th className="text-left font-medium w-20">Result</th>
                  <th className="text-left font-medium">ITR</th>
                  <th className="text-left font-medium">BSA</th>
                  <th className="text-left font-medium">GST (Primary)</th>
                </tr>
              </thead>
              <tbody>
                {data.profileDetails.map((d, i) => (
                  <tr key={i} className="border-b border-border/20 align-top">
                    <td className="py-1.5 text-muted-foreground">{d.srNo}</td>
                    <td className="py-1.5 text-muted-foreground">{d.particular}</td>
                    <td className="py-1.5"><ResultBadge result={d.result} /></td>
                    <td className="py-1.5 text-foreground/80 max-w-[180px] text-[10px]">{d.values.itr || "—"}</td>
                    <td className="py-1.5 text-foreground/80 text-[10px]">{d.values.bsa1 || d.values.bsa2 || "—"}</td>
                    <td className="py-1.5 text-foreground/80 text-[10px]">{d.values.gst1 || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Banking Information ──────────────────────────────────────────── */}
      {data.bankingInfo.length > 0 && (
        <div>
          <SectionLabel>Banking Information</SectionLabel>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-1 font-medium">Bank</th>
                <th className="text-left font-medium">Account No.</th>
                <th className="text-left font-medium">Type</th>
                <th className="text-left font-medium">Banking</th>
                <th className="text-left font-medium">ITR/AIS</th>
              </tr>
            </thead>
            <tbody>
              {data.bankingInfo.map((b, i) => (
                <tr key={i} className="border-b border-border/20">
                  <td className="py-1.5 font-medium">{b.bankName}</td>
                  <td className="tabular-nums text-muted-foreground">{b.accountNumber}</td>
                  <td>{b.accountType}</td>
                  <td className={b.banking.toLowerCase() === "available" ? "text-success" : "text-muted-foreground"}>
                    {b.banking}
                  </td>
                  <td className={b.itrAis.toLowerCase() === "available" ? "text-success" : "text-muted-foreground"}>
                    {b.itrAis}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Financial Summary ────────────────────────────────────────────── */}
      {data.summary.rows.length > 0 && (
        <div>
          <SectionLabel>Financial Summary</SectionLabel>
          <div className="overflow-x-auto">
            <table className="text-xs min-w-[500px] w-full">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 font-medium w-64">Particular</th>
                  {data.summary.periods.map(p => (
                    <th key={p} className="text-right font-medium px-2">{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.summary.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/20">
                    <td className="py-1.5 text-muted-foreground">{r.particular}</td>
                    {r.values.map((v, j) => (
                      <td key={j} className="py-1.5 text-right tabular-nums text-foreground/80 px-2">
                        {v ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1 italic">
            TTM = Trailing Twelve Months · YTD = Year to Date · Values as reported
          </div>
        </div>
      )}

      {/* ── Customers ───────────────────────────────────────────────────── */}
      {data.customers.parties.length > 0 && (
        <div>
          <SectionLabel>
            Customer Concentration — GST vs Banking {data.customers.period && `(${data.customers.period})`}
          </SectionLabel>
          <div className="overflow-x-auto">
            <table className="text-xs min-w-[600px] w-full">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 font-medium">#</th>
                  <th className="text-left font-medium">Customer</th>
                  <th className="text-right font-medium">GST Revenue</th>
                  <th className="text-right font-medium">% Rev</th>
                  <th className="text-right font-medium">Active Mo.</th>
                  <th className="text-left font-medium">Trend</th>
                  <th className="text-right font-medium">Banking Credit (Ann.)</th>
                  <th className="text-right font-medium">Realisation</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.parties.map((c, i) => (
                  <tr key={i} className="border-b border-border/20">
                    <td className="py-1.5 text-muted-foreground">{c.srNo}</td>
                    <td className="py-1.5 font-medium max-w-[180px] truncate">{c.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtN(c.gstAmount)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtPct(c.pctRevenue)}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.activeMonths ?? "—"}</td>
                    <td className="py-1.5"><TrendBadge trend={c.trend} /></td>
                    <td className="py-1.5 text-right tabular-nums">{fmtN(c.bankingAnnualized)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {c.realisation != null ? fmtPct(c.realisation) : "—"}
                    </td>
                  </tr>
                ))}
                {data.customers.subtotalGst != null && (
                  <tr className="border-t border-border bg-muted/20 font-medium">
                    <td colSpan={2} className="py-1.5 text-muted-foreground">Sub Total (Top 10)</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtN(data.customers.subtotalGst)}</td>
                    <td colSpan={3} />
                    <td className="py-1.5 text-right tabular-nums">{fmtN(data.customers.subtotalBanking)}</td>
                    <td />
                  </tr>
                )}
                {data.customers.totalGst != null && (
                  <tr className="border-t border-border/40 text-muted-foreground">
                    <td colSpan={2} className="py-1">Total (Adjusted)</td>
                    <td className="py-1 text-right tabular-nums">{fmtN(data.customers.totalGst)}</td>
                    <td colSpan={3} />
                    <td className="py-1 text-right tabular-nums">{fmtN(data.customers.totalBanking)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Suppliers ───────────────────────────────────────────────────── */}
      {data.suppliers.parties.length > 0 && (
        <div>
          <SectionLabel>
            Supplier Concentration — GST vs Banking {data.suppliers.period && `(${data.suppliers.period})`}
          </SectionLabel>
          <div className="overflow-x-auto">
            <table className="text-xs min-w-[600px] w-full">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 font-medium">#</th>
                  <th className="text-left font-medium">Supplier</th>
                  <th className="text-right font-medium">GST Expenses</th>
                  <th className="text-right font-medium">% Rev</th>
                  <th className="text-right font-medium">Active Mo.</th>
                  <th className="text-left font-medium">Trend</th>
                  <th className="text-right font-medium">Banking Debit (Ann.)</th>
                  <th className="text-right font-medium">Realisation</th>
                </tr>
              </thead>
              <tbody>
                {data.suppliers.parties.map((s, i) => (
                  <tr key={i} className="border-b border-border/20">
                    <td className="py-1.5 text-muted-foreground">{s.srNo}</td>
                    <td className="py-1.5 font-medium max-w-[180px] truncate">{s.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtN(s.gstAmount)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtPct(s.pctRevenue)}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.activeMonths ?? "—"}</td>
                    <td className="py-1.5"><TrendBadge trend={s.trend} /></td>
                    <td className="py-1.5 text-right tabular-nums">{fmtN(s.bankingAnnualized)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {s.realisation != null ? fmtPct(s.realisation) : "—"}
                    </td>
                  </tr>
                ))}
                {data.suppliers.subtotalGst != null && (
                  <tr className="border-t border-border bg-muted/20 font-medium">
                    <td colSpan={2} className="py-1.5 text-muted-foreground">Sub Total (Top 10)</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtN(data.suppliers.subtotalGst)}</td>
                    <td colSpan={3} />
                    <td className="py-1.5 text-right tabular-nums">{fmtN(data.suppliers.subtotalBanking)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Circular Transactions ────────────────────────────────────────── */}
      {data.circularParties.length > 0 && (
        <div>
          <SectionLabel>Related Party & Circular Transactions</SectionLabel>
          <div className="border border-warning/30 bg-warning/5 px-3 py-2 mb-3 text-[10px] text-warning tracking-wide">
            ⚠ {data.circularParties.length} circular/related party identified — cross-check with promoter declarations
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs min-w-[700px] w-full">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-1 font-medium w-48">Party</th>
                  <th className="text-left font-medium w-24">Period</th>
                  <th className="text-right font-medium">GST Revenue</th>
                  <th className="text-right font-medium">GST Purchase</th>
                  <th className="text-right font-medium">Banking Credit</th>
                  <th className="text-right font-medium">Banking Debit</th>
                </tr>
              </thead>
              <tbody>
                {data.circularParties.map((p, i) =>
                  p.data.map((d, j) => {
                    const hasData = d.gstRevenue || d.gstPurchase || d.bankingCredit || d.bankingDebit;
                    if (!hasData) return null;
                    return (
                      <tr key={`${i}-${j}`} className="border-b border-border/20">
                        {j === 0 && (
                          <td className="py-1.5 font-medium text-warning/90 max-w-[180px]" rowSpan={p.data.filter(x => x.gstRevenue || x.gstPurchase || x.bankingCredit || x.bankingDebit).length}>
                            {p.partyName}
                          </td>
                        )}
                        <td className="py-1.5 text-muted-foreground text-[9px]">{d.period}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtN(d.gstRevenue)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtN(d.gstPurchase)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtN(d.bankingCredit)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtN(d.bankingDebit)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.circularParties.length === 0 && !data.hasRelatedPartyData && (
        <div className="border border-success/30 bg-success/5 px-3 py-2 text-[10px] text-success tracking-wide">
          ✓ No circular transactions or related party data flagged
        </div>
      )}

      {/* ── Loan Mapping ─────────────────────────────────────────────────── */}
      <div className="text-[10px] text-muted-foreground italic">
        {data.hasLoanMappingData
          ? "EMI triangulation data available — check source Excel for full details"
          : "EMI triangulation: No data available"
        }
      </div>
    </div>
  );
}

export function TriangulationTab({
  cc,
  data,
  user,
  onReload,
}: {
  cc: CaseRow;
  data: TriangulationRow | null;
  user: { id: string; email?: string };
  onReload: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy]     = useState(false);
  const [progress, setProgress] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);

  const handleFile = async (file: File) => {
    if (!isTriangulationExcel(file) && !file.name.toLowerCase().endsWith(".xlsx") && !file.name.toLowerCase().endsWith(".xls")) {
      toast.error("Please upload an Accumn triangulation Excel file (.xlsx)");
      return;
    }
    setBusy(true);
    setProgress("Parsing Excel…");
    try {
      const parsed = await parseTriangulationExcel(file);
      setProgress("Saving…");
      const { error } = await supabase.from("triangulation_data").upsert(
        {
          case_id:        cc.id,
          user_id:        user.id,
          report_data:    parsed as never,
          period_covered: parsed.sourceDates.map(s => `${s.source}: ${s.startDate}–${s.endDate}`).join("; ") || null,
        },
        { onConflict: "case_id" },
      );
      if (error) throw error;
      await onReload();
      toast.success("Triangulation report imported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload panel */}
      <div className="bg-white -mx-4 px-4 py-2 border-b border-border shadow-sm mb-4">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-sm hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            {busy ? progress : "Import Triangulation Excel"}
          </button>
          <div className="h-8 w-px bg-border hidden sm:block" />
          <button
            onClick={async () => {
              const buf = await buildTriangulationTemplate();
              downloadBuffer("Rehbar_Triangulation_Template.xlsx", buf);
            }}
            disabled={busy}
            className="flex items-center gap-1.5 text-sm text-muted-foreground border border-border rounded-lg px-4 py-2 hover:text-foreground hover:border-primary/50 hover:bg-surface transition-colors disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download Template
          </button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(
                "I have attached two files: financial source documents and an Excel template.\n\nExtract every figure from the source documents and fill in the Excel template — enter each number in the correct column and row. Compare GST turnover, banking credits, and ITR revenue across the periods shown. Flag any material differences between the sources. Return only the completed Excel file."
              );
              setPromptCopied(true);
              setTimeout(() => setPromptCopied(false), 2000);
            }}
            className="flex items-center gap-1.5 text-sm text-primary/70 border border-primary/30 rounded-lg px-4 py-2 hover:text-primary hover:border-primary/60 hover:bg-primary/5 transition-colors"
            title="Copy a ready-to-use Claude prompt — attach the template + documents in Claude chat and paste this"
          >
            {promptCopied ? "✓ Copied" : "⧉ Copy AI Prompt"}
          </button>
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-medium text-foreground/70">Triangulation Import</span>
            <span className="text-[11px] text-muted-foreground">
              GST × BSA × ITR cross-reference
              {data && ` · Last: ${new Date(data.created_at).toLocaleDateString("en-IN")}${data.period_covered ? ` (${data.period_covered})` : ""}`}
            </span>
          </div>
        </div>
      </div>

      {/* Data display */}
      {data ? (
        <TriangulationDisplay data={data.report_data} />
      ) : (
        <div className="text-[10px] text-muted-foreground/50 italic text-center py-8">
          No triangulation report imported yet
        </div>
      )}
    </div>
  );
}
