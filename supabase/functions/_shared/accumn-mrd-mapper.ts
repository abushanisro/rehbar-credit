/**
 * Accumn MRD (Machine Readable Data) JSON → normalised Supabase tables.
 * Called from both accumn-poll-order and accumn-webhook after downloading MRD.
 *
 * All mappers are defensive: uses optional chaining + safeNum throughout.
 * Unknown/missing fields are silently skipped rather than throwing.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ── Helpers ──────────────────────────────────────────────────────────────────

export function safeNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

export function safeInt(v: unknown): number | null {
  const n = safeNum(v);
  return n == null ? null : Math.round(n);
}

export function normaliseMonth(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // "YYYY-MM" already
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  // "Apr-24" or "Apr-2024"
  const MONTHS: Record<string, string> = {
    jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
    jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
  };
  const m1 = s.match(/^([A-Za-z]{3})[-/ ]?(\d{2,4})$/);
  if (m1) {
    const mon = MONTHS[m1[1].toLowerCase()];
    const yr  = m1[2].length === 2 ? `20${m1[2]}` : m1[2];
    if (mon) return `${yr}-${mon}`;
  }
  // "April 2024" or "April-2024"
  const FULLMONTHS: Record<string, string> = {
    january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",
    july:"07",august:"08",september:"09",october:"10",november:"11",december:"12",
  };
  const m2 = s.match(/^([A-Za-z]+)[-/ ](\d{4})$/i);
  if (m2) {
    const mon = FULLMONTHS[m2[1].toLowerCase()];
    if (mon) return `${m2[2]}-${mon}`;
  }
  // "MM/YYYY" or "MM-YYYY"
  const m3 = s.match(/^(\d{2})[-/](\d{4})$/);
  if (m3) return `${m3[2]}-${m3[1]}`;
  console.warn("normaliseMonth: unrecognised format", s);
  return null;
}

export function normaliseFy(raw: unknown): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // "FY2023-24" → 2024
  const m1 = s.match(/FY\d{4}[-/](\d{2,4})/i);
  if (m1) return m1[1].length === 2 ? 2000 + parseInt(m1[1]) : parseInt(m1[1]);
  // "2023-24" → 2024
  const m2 = s.match(/^(\d{4})[-/](\d{2,4})$/);
  if (m2) { const yr = m2[2].length === 2 ? 2000 + parseInt(m2[2]) : parseInt(m2[2]); return yr; }
  // plain "2024"
  if (/^\d{4}$/.test(s)) return parseInt(s);
  return null;
}

export function normaliseGstPeriod(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  // "March 2024" → "2024-03"
  const m = normaliseMonth(s);
  if (m) return m;
  // "Q1 FY2025" → keep as-is, already informative
  if (/Q\d/i.test(s)) return s;
  return s;
}

// ── BSA MRD → bank_statement_data ────────────────────────────────────────────

export async function mapBsaMrd(
  mrdJson: unknown,
  case_id: string,
  user_id: string,
  supabase: SupabaseClient,
): Promise<number> {
  const mrd = mrdJson as Record<string, unknown>;
  const rows: Array<Record<string, unknown>> = [];

  // Accumn BSA MRD may have accounts at mrd.accounts[] or mrd.account_details[]
  const accounts = (
    (mrd.accounts ?? mrd.account_details ?? mrd.data) as Array<Record<string, unknown>> | undefined
  ) ?? [];

  if (!Array.isArray(accounts) || accounts.length === 0) {
    // Flat monthly structure (single account)
    const months = (mrd.monthly_analysis ?? mrd.months ?? mrd.monthly_data) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(months)) {
      const bankName = String(mrd.bank_name ?? mrd.bankName ?? "");
      for (const m of months) {
        const month = normaliseMonth(m.month ?? m.period ?? m.transaction_month);
        if (!month) continue;
        rows.push({
          case_id, user_id,
          month,
          bank_name:       bankName || null,
          account_number:  String(mrd.account_number ?? m.account_number ?? "") || null,
          opening_balance: safeNum(m.opening_balance),
          closing_balance: safeNum(m.closing_balance),
          total_credits:   safeNum(m.total_credits   ?? m.total_credit),
          total_debits:    safeNum(m.total_debits    ?? m.total_debit),
          credit_count:    safeInt(m.credit_count    ?? m.no_of_credits),
          debit_count:     safeInt(m.debit_count     ?? m.no_of_debits),
          avg_balance:     safeNum(m.avg_balance     ?? m.average_balance),
          min_balance:     safeNum(m.min_balance     ?? m.minimum_balance),
          max_balance:     safeNum(m.max_balance     ?? m.maximum_balance),
          bounce_inward:   safeInt(m.bounce_inward   ?? m.inward_bounce_count ?? m.inward_bounces) ?? 0,
          bounce_outward:  safeInt(m.bounce_outward  ?? m.outward_bounce_count ?? m.outward_bounces) ?? 0,
          emi_outflows:    safeNum(m.emi_outflows    ?? m.emi_outflow),
        });
      }
    }
  } else {
    for (const acct of accounts) {
      const bankName = String(acct.bank_name ?? acct.bankName ?? "");
      const accountNumber = String(acct.account_number ?? acct.accountNumber ?? "");
      const months = (acct.monthly_analysis ?? acct.months ?? acct.monthly_data) as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(months)) continue;
      for (const m of months) {
        const month = normaliseMonth(m.month ?? m.period ?? m.transaction_month);
        if (!month) continue;
        rows.push({
          case_id, user_id,
          month,
          bank_name:       bankName || null,
          account_number:  accountNumber || null,
          opening_balance: safeNum(m.opening_balance),
          closing_balance: safeNum(m.closing_balance),
          total_credits:   safeNum(m.total_credits   ?? m.total_credit),
          total_debits:    safeNum(m.total_debits    ?? m.total_debit),
          credit_count:    safeInt(m.credit_count    ?? m.no_of_credits),
          debit_count:     safeInt(m.debit_count     ?? m.no_of_debits),
          avg_balance:     safeNum(m.avg_balance     ?? m.average_balance),
          min_balance:     safeNum(m.min_balance     ?? m.minimum_balance),
          max_balance:     safeNum(m.max_balance     ?? m.maximum_balance),
          bounce_inward:   safeInt(m.bounce_inward   ?? m.inward_bounce_count ?? m.inward_bounces) ?? 0,
          bounce_outward:  safeInt(m.bounce_outward  ?? m.outward_bounce_count ?? m.outward_bounces) ?? 0,
          emi_outflows:    safeNum(m.emi_outflows    ?? m.emi_outflow),
        });
      }
    }
  }

  if (rows.length === 0) {
    console.warn("mapBsaMrd: no rows parsed from MRD");
    return 0;
  }

  const { error } = await supabase.from("bank_statement_data").upsert(rows, { onConflict: "case_id,month,bank_name" });
  if (error) throw new Error(`bank_statement_data upsert: ${error.message}`);
  return rows.length;
}

// ── ITR+GST MRD → gst_return_data + extracted_financials ─────────────────────

export async function mapItrGstMrd(
  mrdJson: unknown,
  case_id: string,
  user_id: string,
  supabase: SupabaseClient,
): Promise<void> {
  const mrd = mrdJson as Record<string, unknown>;

  // GST returns
  const gstReturns = (mrd.gst_returns ?? mrd.gst ?? mrd.returns) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(gstReturns)) {
    for (const ret of gstReturns) {
      const period = normaliseGstPeriod(ret.tax_period ?? ret.period ?? ret.return_period);
      if (!period) continue;
      const returnType = String(ret.return_type ?? ret.form_type ?? "GSTR-1");
      await supabase.from("gst_return_data").upsert({
        case_id, user_id,
        period,
        return_type:      returnType,
        gstin:            String(ret.gstin ?? ret.registration_number ?? "") || null,
        taxable_turnover: safeNum(ret.taxable_value   ?? ret.taxable_turnover),
        total_turnover:   safeNum(ret.total_value     ?? ret.total_turnover),
        output_tax:       safeNum(ret.tax_liability   ?? ret.output_tax),
        itc_claimed:      safeNum(ret.itc_availed     ?? ret.itc_claimed),
        net_tax_paid:     safeNum(ret.net_tax_paid    ?? ret.net_tax),
        filing_date:      String(ret.filing_date ?? "") || null,
        filing_status:    (ret.filing_status === "Y" || ret.filing_status === "filed") ? "filed" : "not_filed",
      }, { onConflict: "case_id,period,return_type" });
    }
  }

  // ITR financials (E-Financials from Self-Employed ITR)
  await mapItrFinancials(mrd, case_id, user_id, supabase);
}

async function mapItrFinancials(
  mrd: Record<string, unknown>,
  case_id: string,
  user_id: string,
  supabase: SupabaseClient,
): Promise<void> {
  // Try to find P&L and BS data under various keys
  const pnlData  = (mrd.profit_and_loss ?? mrd.pnl ?? mrd.income_statement ?? mrd.e_financials?.profit_and_loss) as Record<string, unknown> | undefined;
  const bsData   = (mrd.balance_sheet   ?? mrd.bs  ?? mrd.e_financials?.balance_sheet) as Record<string, unknown> | undefined;

  // P&L — keyed by fiscal year
  if (pnlData && typeof pnlData === "object") {
    for (const [fyRaw, fyData] of Object.entries(pnlData)) {
      if (!fyData || typeof fyData !== "object") continue;
      const fy = normaliseFy(fyRaw);
      if (!fy) continue;
      const d = fyData as Record<string, unknown>;
      const lineItems = [
        { label: "Turnover",            value: safeNum(d.turnover          ?? d.gross_receipts  ?? d.revenue) },
        { label: "Cost of Goods Sold",  value: safeNum(d.cogs              ?? d.cost_of_goods_sold ?? d.cost_of_sales) },
        { label: "Gross Profit",        value: safeNum(d.gross_profit      ?? d.gross_income) },
        { label: "Operating Expenses",  value: safeNum(d.operating_expenses ?? d.expenses) },
        { label: "Depreciation",        value: safeNum(d.depreciation      ?? d.dep_amortisation) },
        { label: "EBITDA",              value: safeNum(d.ebitda) },
        { label: "Interest Expense",    value: safeNum(d.interest_expense  ?? d.finance_cost    ?? d.interest) },
        { label: "Profit Before Tax",   value: safeNum(d.profit_before_tax ?? d.pbt) },
        { label: "Tax",                 value: safeNum(d.tax               ?? d.income_tax) },
        { label: "PAT",                 value: safeNum(d.net_profit        ?? d.pat             ?? d.profit_after_tax) },
      ].filter(li => li.value != null).map((li, i) => ({
        ...li, confidence: 85, reviewed: false, sort_order: i,
      }));
      if (lineItems.length === 0) continue;
      await supabase.from("extracted_financials").upsert({
        case_id, user_id,
        fiscal_year:    fy,
        statement_type: "profit_loss",
        line_items:     lineItems,
        unit:           String(d.unit ?? mrd.unit ?? "Lakhs"),
      }, { onConflict: "case_id,statement_type,fiscal_year" });
    }
  }

  // Balance Sheet — keyed by fiscal year
  if (bsData && typeof bsData === "object") {
    for (const [fyRaw, fyData] of Object.entries(bsData)) {
      if (!fyData || typeof fyData !== "object") continue;
      const fy = normaliseFy(fyRaw);
      if (!fy) continue;
      const d = fyData as Record<string, unknown>;
      const lineItems = [
        { label: "Share Capital",         value: safeNum(d.share_capital        ?? d.paid_up_capital) },
        { label: "Reserves & Surplus",    value: safeNum(d.reserves             ?? d.reserves_and_surplus) },
        { label: "Net Worth",             value: safeNum(d.net_worth            ?? d.shareholders_equity) },
        { label: "Long Term Borrowings",  value: safeNum(d.long_term_borrowings ?? d.term_loans) },
        { label: "Short Term Borrowings", value: safeNum(d.short_term_borrowings ?? d.working_capital_loans) },
        { label: "Trade Payables",        value: safeNum(d.trade_payables       ?? d.creditors) },
        { label: "Fixed Assets (Net)",    value: safeNum(d.fixed_assets         ?? d.net_block ?? d.tangible_assets) },
        { label: "Inventory",             value: safeNum(d.inventory            ?? d.inventories ?? d.stock) },
        { label: "Trade Receivables",     value: safeNum(d.trade_receivables    ?? d.debtors     ?? d.sundry_debtors) },
        { label: "Cash & Bank",           value: safeNum(d.cash_and_bank        ?? d.cash_bank_balances) },
        { label: "Total Assets",          value: safeNum(d.total_assets         ?? d.balance_sheet_total) },
      ].filter(li => li.value != null).map((li, i) => ({
        ...li, confidence: 85, reviewed: false, sort_order: i,
      }));
      if (lineItems.length === 0) continue;
      await supabase.from("extracted_financials").upsert({
        case_id, user_id,
        fiscal_year:    fy,
        statement_type: "balance_sheet",
        line_items:     lineItems,
        unit:           String(d.unit ?? mrd.unit ?? "Lakhs"),
      }, { onConflict: "case_id,statement_type,fiscal_year" });
    }
  }
}

// ── INSIGHTS MRD → extracted_financials ──────────────────────────────────────

export async function mapInsightsMrd(
  mrdJson: unknown,
  case_id: string,
  user_id: string,
  supabase: SupabaseClient,
): Promise<void> {
  const mrd = mrdJson as Record<string, unknown>;
  // Insights MRD has audited financial data in same structure as ITR
  await mapItrFinancials(mrd, case_id, user_id, supabase);
}

// ── Router: pick mapper by product type ──────────────────────────────────────

export async function processMrd(
  productType: string,
  mrdJson: unknown,
  case_id: string,
  user_id: string,
  supabase: SupabaseClient,
): Promise<number> {
  if (productType === "BSA") {
    return mapBsaMrd(mrdJson, case_id, user_id, supabase);
  }
  if (productType === "ITR_GST") {
    await mapItrGstMrd(mrdJson, case_id, user_id, supabase);
    return 1;
  }
  if (productType === "INSIGHTS") {
    await mapInsightsMrd(mrdJson, case_id, user_id, supabase);
    return 1;
  }
  console.warn("processMrd: unknown product_type", productType);
  return 0;
}
