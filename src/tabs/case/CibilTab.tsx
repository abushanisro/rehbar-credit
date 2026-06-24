import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast }    from "sonner";
import { Panel }    from "@/components/terminal/Panel";
import { UploadGrid } from "@/components/case/UploadGrid";
import { cn }       from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";

// ── Types ──────────────────────────────────────────────────────────────────────

type CaseRow    = Tables<"credit_cases">;
type DocRow     = Omit<Tables<"financial_documents">, "doc_class"> & { doc_class: string };
type CibilDocRow = Omit<DocRow, "doc_class"> & { doc_class: "cibil_report" };

type ConsumerCibilReport = {
  report_type?: "consumer";
  borrower_name?:   string;
  chm_ref?:         string;
  report_date?:     string;
  pan?:             string;
  phone?:           string;
  dob?:             string;
  father_name?:     string;
  address?:         string;
  perform_score?:   number | null;
  score_factors?:   string[];
  total_accounts?:  number;
  active_accounts?: number;
  overdue_accounts?: number;
  current_balance?:  number | null;
  total_disbursed?:  number | null;
  inquiries_24m?:    number;
  new_accounts_6m?:  number;
  accounts?:         ConsumerAccount[];
};

type ConsumerAccount = {
  seq?:               number;
  account_type?:      string;
  status?:            string;
  ownership?:         string;
  disbursed_date?:    string;
  disbursed_amount?:  number | null;
  current_balance?:   number | null;
  overdue_amount?:    number | null;
  tenure_months?:     number | null;
  installment_amount?: number | null;
  last_payment_date?: string;
  has_delinquency?:   boolean;
  suit_filed?:        boolean;
  writeoff_amount?:   number | null;
  asset_class?:       string;
};

type CommercialCibilReport = {
  report_type: "commercial";
  entity_name?:          string;
  pan?:                  string;
  cin?:                  string;
  legal_constitution?:   string;
  industry_type?:        string;
  incorporation_date?:   string;
  bureau_ref_no?:        string;
  report_order_no?:      string;
  report_date?:          string;
  cibil_rank?:           string;
  rank_exclusion_reasons?: string[];
  total_lenders?:           number;
  total_credit_facilities?: number;
  open_credit_facilities?:  number;
  total_outstanding?:       number | null;
  delinquent_borrower_cf?:  number;
  delinquent_outstanding?:  number | null;
  enquiries?: {
    last_30d?:      number;
    last_31_90d?:   number;
    last_91_180d?:  number;
    last_181_365d?: number;
    gt_365d?:       number;
  };
  outstanding_by_type?: Array<{
    lender_type:   string;
    outstanding:   number;
    open_cf:       number;
    delinquent_cf: number;
  }>;
  credit_facilities?: Array<{
    lender?:            string;
    facility_type?:     string;
    sanctioned_amount?: number | null;
    outstanding?:       number | null;
    overdue?:           number | null;
    asset_class?:       string;
    opened_date?:       string;
    status?:            string;
    dpd_worst?:         number | null;
  }>;
};

type AnyReportData = ConsumerCibilReport | CommercialCibilReport;

export type CibilReportRow = {
  id:                string;
  case_id:           string;
  document_id:       string | null;
  user_id:           string;
  report_data:       AnyReportData;
  report_order_no:   string | null;
  report_date:       string | null;
  borrower_name:     string | null;
  cibil_rank:        string | null;
  total_outstanding: number | null;
  created_at:        string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtCr(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString("en-IN")}`;
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground border-muted-foreground/40 bg-muted/20";
  if (score >= 750)  return "text-success border-success/60 bg-success/10";
  if (score >= 650)  return "text-amber-600 border-amber-400/60 bg-amber-50/30";
  if (score >= 550)  return "text-orange-600 border-orange-400/60 bg-orange-50/30";
  return "text-destructive border-destructive/60 bg-destructive/10";
}

function cmrColor(rank: string | undefined): string {
  if (!rank) return "text-muted-foreground border-muted-foreground/40 bg-muted/20";
  const n = parseInt(rank.replace(/[^0-9]/g, ""), 10);
  if (n <= 3) return "text-success border-success/60 bg-success/10";
  if (n <= 5) return "text-amber-600 border-amber-400/60 bg-amber-50/30";
  if (n <= 7) return "text-orange-600 border-orange-400/60 bg-orange-50/30";
  return "text-destructive border-destructive/60 bg-destructive/10";
}

function assetBadge(cls: string | undefined): string {
  if (cls === "STD") return "bg-success/10 text-success border-success/30";
  if (cls === "SUB") return "bg-orange-100 text-orange-700 border-orange-300";
  if (cls === "DBT") return "bg-destructive/10 text-destructive border-destructive/30";
  if (cls === "LOS") return "bg-destructive/20 text-destructive border-destructive/40 font-bold";
  return "bg-muted text-muted-foreground border-border";
}

// ── Commercial card ────────────────────────────────────────────────────────────

function CommercialCard({
  row,
  isExpanded,
  onToggle,
}: {
  row:        CibilReportRow;
  isExpanded: boolean;
  onToggle:   () => void;
}) {
  const rd = row.report_data as CommercialCibilReport;
  const hasDelinquency = (rd.delinquent_borrower_cf ?? 0) > 0;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={onToggle}
      >
        <span className={cn(
          "text-sm font-bold px-3 py-1 rounded border font-mono shrink-0 whitespace-nowrap",
          cmrColor(rd.cibil_rank),
        )}>
          {rd.cibil_rank ?? "—"}
        </span>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground truncate">
            {rd.entity_name || row.borrower_name || "Unknown Entity"}
          </div>
          <div className="text-xs text-muted-foreground flex gap-3 flex-wrap mt-0.5">
            {rd.pan           && <span>PAN: {rd.pan}</span>}
            {rd.report_date   && <span>{rd.report_date}</span>}
            {rd.bureau_ref_no && <span>Ref: {rd.bureau_ref_no}</span>}
            <span className="uppercase text-[10px] tracking-wide bg-muted/40 border border-border/40 px-1.5 rounded">
              Commercial
            </span>
          </div>
        </div>

        <div className="flex gap-2 items-center text-xs flex-wrap justify-end">
          <span className="text-muted-foreground">
            {rd.total_credit_facilities ?? 0} CFs · {rd.total_lenders ?? 0} lenders
          </span>
          {hasDelinquency && (
            <span className="px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/30 font-medium">
              ⚠ {rd.delinquent_borrower_cf} delinquent
            </span>
          )}
          <span className="text-muted-foreground font-mono">{fmtCr(rd.total_outstanding)}</span>
          <span className="text-muted-foreground/40 ml-1">{isExpanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-border/40 p-4 space-y-4 bg-muted/5">

          {/* Exclusion reasons */}
          {(rd.rank_exclusion_reasons?.length ?? 0) > 0 && (
            <div className="flex gap-2 flex-wrap">
              {rd.rank_exclusion_reasons!.map((r, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 bg-muted/40 rounded border border-border/40 text-muted-foreground"
                >
                  {r}
                </span>
              ))}
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              ["Total Lenders",  rd.total_lenders  ?? 0],
              ["Total CFs",      rd.total_credit_facilities ?? 0],
              ["Open CFs",       rd.open_credit_facilities  ?? 0],
              ["Delinquent CFs", rd.delinquent_borrower_cf  ?? 0],
            ] as [string, number][]).map(([k, v]) => (
              <div key={k} className="border border-border/40 rounded p-2">
                <div className="text-xs text-muted-foreground">{k}</div>
                <div className={cn(
                  "text-lg font-bold font-mono",
                  k === "Delinquent CFs" && v > 0 ? "text-destructive" : "",
                )}>{v}</div>
              </div>
            ))}
          </div>

          {/* Balances */}
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-border/40 rounded p-2">
              <div className="text-xs text-muted-foreground">Total Outstanding</div>
              <div className="text-lg font-bold font-mono text-primary">{fmtCr(rd.total_outstanding)}</div>
            </div>
            <div className="border border-border/40 rounded p-2">
              <div className="text-xs text-muted-foreground">Delinquent Outstanding</div>
              <div className={cn(
                "text-lg font-bold font-mono",
                (rd.delinquent_outstanding ?? 0) > 0 ? "text-destructive" : "text-muted-foreground",
              )}>
                {(rd.delinquent_outstanding ?? 0) > 0 ? fmtCr(rd.delinquent_outstanding) : "—"}
              </div>
            </div>
          </div>

          {/* Outstanding by lender type */}
          {(rd.outstanding_by_type?.length ?? 0) > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Outstanding by Lender Type
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[400px]">
                  <thead className="bg-muted/20">
                    <tr>
                      {["Lender Type", "Outstanding", "Open CFs", "Delinquent CFs"].map(h => (
                        <th key={h} className="text-left py-1.5 px-2 text-muted-foreground font-medium first:pl-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rd.outstanding_by_type!.map((t, i) => (
                      <tr key={i} className="border-t border-border/20">
                        <td className="py-1.5 pl-3 pr-2 font-medium">{t.lender_type}</td>
                        <td className="py-1.5 px-2 tabular-nums font-mono text-primary">{fmtCr(t.outstanding)}</td>
                        <td className="py-1.5 px-2 tabular-nums">{t.open_cf}</td>
                        <td className={cn(
                          "py-1.5 px-2 tabular-nums",
                          t.delinquent_cf > 0 ? "text-destructive font-bold" : "text-muted-foreground",
                        )}>{t.delinquent_cf}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Enquiry summary */}
          {rd.enquiries && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Enquiry Summary
              </div>
              <div className="flex gap-3 flex-wrap">
                {([
                  ["≤30d",   rd.enquiries.last_30d],
                  ["31-90d", rd.enquiries.last_31_90d],
                  ["91-180d",rd.enquiries.last_91_180d],
                  ["181-365d",rd.enquiries.last_181_365d],
                  [">365d",  rd.enquiries.gt_365d],
                ] as [string, number | undefined][]).map(([label, val]) => (
                  <div key={label} className="border border-border/40 rounded p-2 text-center min-w-[60px]">
                    <div className="text-[10px] text-muted-foreground">{label}</div>
                    <div className="text-base font-bold font-mono">{val ?? 0}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Credit facilities table */}
          {(rd.credit_facilities?.length ?? 0) > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Credit Facilities ({rd.credit_facilities!.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[700px]">
                  <thead className="bg-muted/20">
                    <tr>
                      {["Lender", "Type", "Sanctioned", "Outstanding", "Overdue", "Class", "Status"].map(h => (
                        <th key={h} className="text-left py-1.5 px-2 text-muted-foreground font-medium first:pl-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rd.credit_facilities!.map((f, i) => (
                      <tr key={i} className={cn(
                        "border-t border-border/20",
                        (f.overdue ?? 0) > 0 ? "bg-destructive/5" : "",
                      )}>
                        <td className="py-1.5 pl-3 pr-2 font-medium truncate max-w-[140px]">{f.lender || "—"}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{f.facility_type || "—"}</td>
                        <td className="py-1.5 px-2 tabular-nums font-mono">{fmtCr(f.sanctioned_amount)}</td>
                        <td className="py-1.5 px-2 tabular-nums font-mono text-primary">{fmtCr(f.outstanding)}</td>
                        <td className={cn(
                          "py-1.5 px-2 tabular-nums font-mono",
                          (f.overdue ?? 0) > 0 ? "text-destructive font-bold" : "text-muted-foreground",
                        )}>
                          {(f.overdue ?? 0) > 0 ? fmtCr(f.overdue) : "—"}
                        </td>
                        <td className="py-1.5 px-2">
                          <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold border", assetBadge(f.asset_class))}>
                            {f.asset_class || "—"}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-muted-foreground">{f.status || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Entity details footer */}
          <div className="flex gap-4 text-xs text-muted-foreground flex-wrap border-t border-border/20 pt-3">
            {rd.legal_constitution  && <span>{rd.legal_constitution}</span>}
            {rd.incorporation_date  && <span>Incorporated: {rd.incorporation_date}</span>}
            {rd.cin                 && <span>CIN: {rd.cin}</span>}
            {rd.industry_type       && <span>Industry: {rd.industry_type}</span>}
            {rd.report_order_no     && <span>Order No: {rd.report_order_no}</span>}
          </div>

        </div>
      )}
    </div>
  );
}

// ── Consumer card ──────────────────────────────────────────────────────────────

function ConsumerCard({
  row,
  isExpanded,
  onToggle,
}: {
  row:        CibilReportRow;
  isExpanded: boolean;
  onToggle:   () => void;
}) {
  const rd = row.report_data as ConsumerCibilReport;
  const score         = rd.perform_score ?? null;
  const allAccounts   = rd.accounts ?? [];
  const activeAccounts = allAccounts.filter(a => a.status === "ACTIVE");
  const delinquent    = allAccounts.filter(a => a.has_delinquency);
  const suitFiled     = allAccounts.filter(a => a.suit_filed);
  const writeoff      = allAccounts.filter(a => (a.writeoff_amount ?? 0) > 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={onToggle}
      >
        <span className={cn(
          "text-lg font-bold px-3 py-1 rounded border font-mono shrink-0",
          scoreColor(score),
        )}>
          {score ?? "—"}
        </span>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground">
            {rd.borrower_name || row.borrower_name || "Unknown"}
          </div>
          <div className="text-xs text-muted-foreground flex gap-3 flex-wrap mt-0.5">
            {rd.pan        && <span>PAN: {rd.pan}</span>}
            {rd.report_date && <span>{rd.report_date}</span>}
            {rd.chm_ref    && <span>Ref: {rd.chm_ref}</span>}
          </div>
        </div>

        <div className="flex gap-2 items-center text-xs flex-wrap justify-end">
          <span className="text-muted-foreground">
            {rd.total_accounts ?? 0} accounts · {rd.active_accounts ?? 0} active
          </span>
          {delinquent.length > 0 && (
            <span className="px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/30 font-medium">
              ⚠ {delinquent.length} delinquent
            </span>
          )}
          {suitFiled.length > 0 && (
            <span className="px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/30 font-medium">
              SUIT
            </span>
          )}
          <span className="text-muted-foreground font-mono">{fmtCr(rd.current_balance)}</span>
          <span className="text-muted-foreground/40 ml-1">{isExpanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-border/40 p-4 space-y-4 bg-muted/5">

          {rd.score_factors && rd.score_factors.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {rd.score_factors.map((f, i) => (
                <span key={i} className="text-xs px-2 py-0.5 bg-muted/40 rounded border border-border/40 text-muted-foreground">
                  {f}
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              ["Total Accounts", rd.total_accounts ?? 0],
              ["Active",         rd.active_accounts ?? 0],
              ["Overdue",        rd.overdue_accounts ?? 0],
              ["Inquiries 24M",  rd.inquiries_24m ?? 0],
            ] as [string, number][]).map(([k, v]) => (
              <div key={k} className="border border-border/40 rounded p-2">
                <div className="text-xs text-muted-foreground">{k}</div>
                <div className="text-lg font-bold font-mono">{v}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="border border-border/40 rounded p-2">
              <div className="text-xs text-muted-foreground">Current Outstanding</div>
              <div className="text-lg font-bold font-mono text-primary">{fmtCr(rd.current_balance)}</div>
            </div>
            <div className="border border-border/40 rounded p-2">
              <div className="text-xs text-muted-foreground">Total Disbursed</div>
              <div className="text-lg font-bold font-mono">{fmtCr(rd.total_disbursed)}</div>
            </div>
          </div>

          {(delinquent.length > 0 || suitFiled.length > 0 || writeoff.length > 0) && (
            <div className="border border-destructive/40 bg-destructive/5 rounded p-3 space-y-1">
              <div className="text-xs font-semibold text-destructive uppercase tracking-wide">Risk Flags</div>
              {delinquent.length > 0 && (
                <div className="text-xs text-destructive">· {delinquent.length} account(s) with delinquency</div>
              )}
              {suitFiled.length > 0 && (
                <div className="text-xs text-destructive">· Suit filed on {suitFiled.length} account(s)</div>
              )}
              {writeoff.length > 0 && (
                <div className="text-xs text-destructive">· Writeoff on {writeoff.length} account(s)</div>
              )}
            </div>
          )}

          {activeAccounts.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Active Accounts ({activeAccounts.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[600px]">
                  <thead className="bg-muted/20">
                    <tr>
                      {["#", "Type", "Ownership", "Outstanding", "Overdue", "Tenure", "EMI", "Class"].map(h => (
                        <th key={h} className="text-left py-1.5 px-2 text-muted-foreground font-medium first:pl-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeAccounts.map((a, i) => {
                      const bad = a.has_delinquency || a.suit_filed;
                      return (
                        <tr key={i} className={cn("border-t border-border/20", bad ? "bg-destructive/5" : "")}>
                          <td className="py-1.5 pl-3 pr-2 text-muted-foreground">{a.seq}</td>
                          <td className="py-1.5 px-2 font-medium">{a.account_type}</td>
                          <td className="py-1.5 px-2 text-muted-foreground">{a.ownership}</td>
                          <td className="py-1.5 px-2 tabular-nums font-mono text-primary">{fmtCr(a.current_balance)}</td>
                          <td className={cn(
                            "py-1.5 px-2 tabular-nums font-mono",
                            (a.overdue_amount ?? 0) > 0 ? "text-destructive font-bold" : "text-muted-foreground",
                          )}>
                            {(a.overdue_amount ?? 0) > 0 ? fmtCr(a.overdue_amount) : "—"}
                          </td>
                          <td className="py-1.5 px-2 text-muted-foreground">
                            {a.tenure_months ? `${a.tenure_months}m` : "—"}
                          </td>
                          <td className="py-1.5 px-2 tabular-nums text-muted-foreground">
                            {a.installment_amount ? fmtCr(a.installment_amount) : "—"}
                          </td>
                          <td className="py-1.5 px-2">
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold border", assetBadge(a.asset_class))}>
                              {a.asset_class || "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-4 text-xs text-muted-foreground flex-wrap border-t border-border/20 pt-3">
            {rd.dob         && <span>DOB: {rd.dob}</span>}
            {rd.father_name && <span>Father: {rd.father_name}</span>}
            {rd.phone       && <span>Phone: {rd.phone}</span>}
            {rd.address     && (
              <span className="max-w-xs truncate" title={rd.address}>{rd.address}</span>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CibilTab({
  cc,
  data: allDocs,
  cibilData,
  user,
  onReload,
}: {
  cc:        CaseRow;
  data:      DocRow[];
  cibilData: CibilReportRow[];
  user:      { id: string };
  onReload:  () => Promise<void>;
}) {
  const docs = allDocs.filter((d): d is CibilDocRow => d.doc_class === "cibil_report");

  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState(0);
  const [label, setLabel]       = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCollapsed(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  // ── Upload ───────────────────────────────────────────────────────────────────

  const handleUpload = async (file: File) => {
    if (busy) return;
    setBusy(true);
    setProgress(5);
    setLabel("Uploading…");

    let uploadedDocId: string | null = null;
    try {
      const path = `${user.id}/${cc.id}/cibil/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("case-files").upload(path, file);
      if (upErr) throw upErr;

      setProgress(20);

      const { data: doc, error: dErr } = await supabase
        .from("financial_documents")
        .insert({
          case_id:           cc.id,
          user_id:           user.id,
          file_path:         path,
          file_name:         file.name,
          file_type:         "pdf" as never,
          doc_class:         "cibil_report" as never,
          extraction_status: "pending",
        })
        .select()
        .single();
      if (dErr || !doc) throw new Error(dErr?.message ?? "Document registration failed");
      uploadedDocId = doc.id;

      setProgress(50);
      setLabel("Extracting with Gemini…");

      const { data: triggerRes, error: trigErr } = await supabase.functions.invoke(
        "extract-cibil",
        { body: { case_id: cc.id, user_id: user.id, document_id: doc.id } },
      );
      if (trigErr) throw trigErr;
      if (triggerRes?.error) throw new Error(triggerRes.error);

      setProgress(100);
      setLabel("Done");
      toast.success("CIBIL report extracted");
      await onReload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
      if (uploadedDocId) {
        await supabase
          .from("financial_documents")
          .update({ extraction_status: "failed", extraction_error: msg.slice(0, 500) })
          .eq("id", uploadedDocId);
      }
    } finally {
      setBusy(false);
      setProgress(0);
      setLabel("");
    }
  };

  // ── Retry ────────────────────────────────────────────────────────────────────

  const handleRetry = async (doc: DocRow) => {
    if (busy) return;
    setBusy(true);
    setLabel("Re-extracting…");
    try {
      await supabase
        .from("financial_documents")
        .update({ extraction_status: "pending", extraction_error: null })
        .eq("id", doc.id);

      const { data: triggerRes, error: trigErr } = await supabase.functions.invoke(
        "extract-cibil",
        { body: { case_id: cc.id, user_id: user.id, document_id: doc.id } },
      );
      if (trigErr) throw trigErr;
      if (triggerRes?.error) throw new Error(triggerRes.error);

      toast.success("CIBIL report re-extracted");
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusy(false);
      setLabel("");
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────

  const handleDelete = async (doc: DocRow) => {
    try {
      await supabase.from("financial_documents").delete().eq("id", doc.id);
      const dbRaw = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
      await dbRaw.from("cibil_report_data").delete().eq("document_id", doc.id);
      await supabase.storage.from("case-files").remove([doc.file_path]);
      toast.success("Removed");
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      <Panel title="CIBIL Report Upload" ticker="Consumer CRIF · Commercial CIBIL">
        <UploadGrid
          onUpload={(f) => handleUpload(f)}
          onDelete={handleDelete}
          onRetry={handleRetry}
          busy={busy}
          docs={docs}
          progress={progress}
          progressLabel={label}
          defaultClass="cibil_report"
          allowedClasses={["cibil_report"]}
          showClass={false}
          showFy={false}
          hint={[
            "CRIF High Mark Consumer PERFORM Report (individual/promoter)",
            "TransUnion CIBIL Commercial Credit Report (company entity)",
          ]}
        />
      </Panel>

      {cibilData.map(row => {
        const isCommercial = (row.report_data as AnyReportData).report_type === "commercial";
        const isExpanded   = !collapsed.has(row.id);
        return isCommercial
          ? <CommercialCard key={row.id} row={row} isExpanded={isExpanded} onToggle={() => toggle(row.id)} />
          : <ConsumerCard   key={row.id} row={row} isExpanded={isExpanded} onToggle={() => toggle(row.id)} />;
      })}

      {cibilData.length === 0 && docs.length === 0 && (
        <Panel title="No CIBIL Reports">
          <div className="text-sm text-muted-foreground">
            Upload a CRIF Consumer PERFORM report (individual promoter) or a TransUnion CIBIL Commercial report (company entity).
          </div>
        </Panel>
      )}

    </div>
  );
}
