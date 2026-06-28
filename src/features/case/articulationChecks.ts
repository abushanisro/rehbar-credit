import type { ExtractedRow } from "./types";

export type CheckSeverity = "hard" | "soft";
export type CheckStatus   = "pass" | "fail" | "warn" | "skip";

export interface ArticulationCheck {
  id: string;
  name: string;
  category: "within_bs" | "within_pl" | "within_cf" | "cross_stmt" | "temporal" | "wc_schedule";
  severity: CheckSeverity;
  status: CheckStatus;
  fiscal_year: number | null;
  expected: number | null;
  actual: number | null;
  gap: number | null;
  tolerance: number;
  description: string;
  hint: string;
}

// Convert line_items JSON to flat dict (override_value takes precedence).
function toDict(lineItems: unknown): Record<string, number | null> {
  const items = lineItems as { label: string; value: number | null; override_value?: number | null }[] | null;
  if (!Array.isArray(items)) return {};
  const dict: Record<string, number | null> = {};
  for (const item of items) {
    dict[item.label] = item.override_value !== undefined && item.override_value !== null
      ? item.override_value
      : item.value;
  }
  return dict;
}

function get(d: Record<string, number | null>, k: string): number | null {
  return d[k] ?? null;
}

function evaluate(
  id: string,
  name: string,
  category: ArticulationCheck["category"],
  severity: CheckSeverity,
  fy: number | null,
  expected: number | null,
  actual: number | null,
  tolerance: number,
  description: string,
  hint: string,
): ArticulationCheck {
  if (expected === null || actual === null) {
    return { id, name, category, severity, status: "skip", fiscal_year: fy, expected, actual, gap: null, tolerance, description, hint };
  }
  const gap = actual - expected;
  const absTol = Math.max(tolerance, Math.abs(expected) * 0.0001); // at least 0.01% tolerance for floating point
  let status: CheckStatus;
  if (Math.abs(gap) <= absTol) {
    status = "pass";
  } else if (severity === "hard") {
    status = "fail";
  } else {
    status = "warn";
  }
  return { id, name, category, severity, status, fiscal_year: fy, expected, actual, gap, tolerance, description, hint };
}

// Maps check-id prefix → the result row that should be highlighted in the financial table.
export const CHECK_RESULT_ROW: Record<string, { stmtType: string; label: string }> = {
  bs_balance:          { stmtType: "balance_sheet", label: "Total Assets" },
  bs_assets_sum:       { stmtType: "balance_sheet", label: "Total Assets" },
  bs_ncl_subtotal:     { stmtType: "balance_sheet", label: "Total Non Current Liabilities" },
  bs_deferred_tax:     { stmtType: "balance_sheet", label: "Deferred Tax Liabilities" },
  bs_networth_subtotal:{ stmtType: "balance_sheet", label: "Net Worth" },
  bs_cap_employed:     { stmtType: "balance_sheet", label: "Capital Employed" },
  pl_gross:            { stmtType: "profit_loss",   label: "Gross Profit" },
  pl_ebitda:           { stmtType: "profit_loss",   label: "EBITDA" },
  pl_ebit:             { stmtType: "profit_loss",   label: "EBIT" },
  pl_pbt:              { stmtType: "profit_loss",   label: "Profit Before Tax" },
  pl_pat:              { stmtType: "profit_loss",   label: "PAT" },
  cf_net:              { stmtType: "cash_flow",     label: "Net Change in Cash" },
  cf_close:            { stmtType: "cash_flow",     label: "Closing Cash" },
  cross_cash:          { stmtType: "balance_sheet", label: "Cash & Bank" },
};

export function runArticulationChecks(extracted: ExtractedRow[]): ArticulationCheck[] {
  const checks: ArticulationCheck[] = [];

  // Group by type and year
  const bsByYear  = new Map<number, Record<string, number | null>>();
  const plByYear  = new Map<number, Record<string, number | null>>();
  const cfByYear  = new Map<number, Record<string, number | null>>();

  for (const row of extracted) {
    const d = toDict(row.line_items);
    const fy = row.fiscal_year;
    if (row.statement_type === "balance_sheet") {
      bsByYear.set(fy, { ...(bsByYear.get(fy) ?? {}), ...d });
    } else if (row.statement_type === "profit_loss") {
      plByYear.set(fy, { ...(plByYear.get(fy) ?? {}), ...d });
    } else if (row.statement_type === "cash_flow") {
      cfByYear.set(fy, { ...(cfByYear.get(fy) ?? {}), ...d });
    }
  }

  const years = Array.from(new Set([
    ...bsByYear.keys(), ...plByYear.keys(), ...cfByYear.keys(),
  ])).sort((a, b) => a - b);

  for (const fy of years) {
    const bs = bsByYear.get(fy);
    const pl = plByYear.get(fy);
    const cf = cfByYear.get(fy);

    // ── Within BS ──────────────────────────────────────────────────────────
    if (bs) {
      const totalAssets     = get(bs, "Total Assets");
      const totalEquityLiab = get(bs, "Total Equity & Liabilities");
      const netWorth        = get(bs, "Net Worth");
      const totalDebt       = get(bs, "Total Debt");
      const currLiab        = get(bs, "Current Liabilities");

      if (totalAssets !== null && totalEquityLiab !== null) {
        // Corpository format: full liabilities total already computed by rules (includes DTL, Other NCL)
        checks.push(evaluate(
          `bs_balance_${fy}`,
          "BS: Assets = Equity + Liabilities",
          "within_bs", "hard", fy,
          totalEquityLiab, totalAssets, 1,
          `FY ${fy}: Total Assets should equal Total Equity & Liabilities`,
          "Extraction error: a line item may be mis-mapped, double-counted, or extracted in wrong units.",
        ));
      } else if (totalAssets !== null && (netWorth !== null || totalDebt !== null || currLiab !== null)) {
        // Simple AI-extracted format: Net Worth + Total Debt + Current Liabilities
        const liabSide = (netWorth ?? 0) + (totalDebt ?? 0) + (currLiab ?? 0);
        checks.push(evaluate(
          `bs_balance_${fy}`,
          "BS: Assets = Equity + Liabilities",
          "within_bs", "hard", fy,
          liabSide, totalAssets, 1,
          `FY ${fy}: Total Assets should equal Net Worth + Total Debt + Current Liabilities`,
          "Extraction error: a line item may be mis-mapped, double-counted, or extracted in wrong units.",
        ));
      }

      const currAssets         = get(bs, "Current Assets");
      const fixedAssets        = get(bs, "Fixed Assets (Net)");
      const totalNonCurrAssets = get(bs, "Total Non Current Assets");

      if (totalAssets !== null && currAssets !== null) {
        if (totalNonCurrAssets !== null) {
          // Corpository format: full non-current group (includes CWIP, investments, other NCA)
          checks.push(evaluate(
            `bs_assets_sum_${fy}`,
            "BS: Non-Current + Current Assets = Total Assets",
            "within_bs", "soft", fy,
            totalAssets, totalNonCurrAssets + currAssets, 1,
            `FY ${fy}: Total Non-Current Assets + Current Assets should equal Total Assets`,
            "Gap usually means 'Other Total Assets' or a residual category is not captured under non-current or current.",
          ));
        } else if (fixedAssets !== null) {
          // Simple format: fixed + current only
          checks.push(evaluate(
            `bs_assets_sum_${fy}`,
            "BS: Fixed + Current Assets = Total Assets",
            "within_bs", "soft", fy,
            totalAssets, currAssets + fixedAssets, 1,
            `FY ${fy}: Current Assets + Fixed Assets (Net) should equal Total Assets`,
            "Gap usually means intangibles, CWIP, long-term investments, or other non-current assets exist but are not captured in these two sub-categories. Add them as separate extraction labels to close the gap.",
          ));
        }
      }

      // ── Corpository sub-total consistency ──────────────────────────────────
      if (totalEquityLiab !== null) {
        const totalNCL = get(bs, "Total Non Current Liabilities");
        const ltbRaw   = get(bs, "Long-term Borrowings");
        const dtl      = get(bs, "Deferred Tax Liabilities");
        const otherNCL = get(bs, "Other Non Current Liabilities");
        const ltProv   = get(bs, "Long-term Provisions");

        if (totalNCL !== null) {
          const computedNCL = (ltbRaw ?? 0) + (dtl ?? 0) + (otherNCL ?? 0) + (ltProv ?? 0);
          checks.push(evaluate(
            `bs_ncl_subtotal_${fy}`,
            "BS: Non-Current Liabilities = LTB + DTL + Other NCL + Provisions",
            "within_bs", "hard", fy,
            computedNCL, totalNCL, 1,
            `FY ${fy}: Total NCL (${totalNCL?.toLocaleString("en-IN")}) should equal LTB + Deferred Tax Liabilities + Other NCL + LT Provisions (${computedNCL.toLocaleString("en-IN")})`,
            "A Corpository sub-row (Secured / Unsecured borrowings breakdown) may be double-imported, overstating Long-term Borrowings.",
          ));
        }

        // Ind AS 12: DTA and DTL must be netted — both non-zero simultaneously is a mapping error
        const dta = get(bs, "Deferred Tax Assets (Net)");
        if (dta !== null && dtl !== null && dta > 0 && dtl > 0) {
          checks.push(evaluate(
            `bs_deferred_tax_${fy}`,
            "BS: DTA / DTL — only one should be non-zero (Ind AS 12)",
            "within_bs", "hard", fy,
            0, Math.min(dta, dtl), 1,
            `FY ${fy}: Deferred Tax Assets (${dta?.toLocaleString("en-IN")}) and Liabilities (${dtl?.toLocaleString("en-IN")}) are both non-zero`,
            "Per Ind AS 12, DTA and DTL must be offset. Show only the net: if net DTA map it to Non-Current Assets; if net DTL map it to Non-Current Liabilities.",
          ));
        }
      }

      // ── Net Worth decomposition (all formats) ──────────────────────────────
      const shareCapital    = get(bs, "Share Capital");
      const reservesSurplus = get(bs, "Reserves & Surplus");
      if (netWorth !== null && shareCapital !== null && reservesSurplus !== null) {
        checks.push(evaluate(
          `bs_networth_subtotal_${fy}`,
          "BS: Net Worth = Share Capital + Reserves & Surplus",
          "within_bs", "soft", fy,
          shareCapital + reservesSurplus, netWorth, 1,
          `FY ${fy}: Net Worth (${netWorth?.toLocaleString("en-IN")}) should equal Share Capital + Reserves & Surplus (${(shareCapital + reservesSurplus).toLocaleString("en-IN")})`,
          "A gap here means other equity components (Share Warrants, Application Money, Minority Interest) are present but not separately extracted.",
        ));
      }

      // ── Capital Employed consistency (all formats) ──────────────────────────
      const capitalEmployed = get(bs, "Capital Employed");
      if (capitalEmployed !== null && netWorth !== null && totalDebt !== null) {
        checks.push(evaluate(
          `bs_cap_employed_${fy}`,
          "BS: Capital Employed = Net Worth + Total Debt",
          "within_bs", "soft", fy,
          netWorth + totalDebt, capitalEmployed, 1,
          `FY ${fy}: Capital Employed (${capitalEmployed?.toLocaleString("en-IN")}) should equal Net Worth + Total Debt (${(netWorth + totalDebt).toLocaleString("en-IN")})`,
          "Confirm Total Debt captures both Long-Term and Short-Term Borrowings. A gap may indicate CPLTD (current portion of LT debt) is classified under CL instead of STB.",
        ));
      }
    }

    // ── Within P&L ─────────────────────────────────────────────────────────
    if (pl) {
      const turnover  = get(pl, "Turnover");
      const cogs      = get(pl, "Cost of Goods Sold");
      const grossProfit = get(pl, "Gross Profit");
      const opex      = get(pl, "Operating Expenses");
      const ebitda    = get(pl, "EBITDA");
      const depreciation = get(pl, "Depreciation");
      const ebit      = get(pl, "EBIT");
      const interest  = get(pl, "Interest Expense");
      const pbt       = get(pl, "Profit Before Tax");
      const tax       = get(pl, "Tax");
      const pat       = get(pl, "PAT");

      // P&L: Turnover – COGS = Gross Profit
      if (turnover !== null && cogs !== null && grossProfit !== null) {
        checks.push(evaluate(
          `pl_gross_${fy}`,
          "P&L: Turnover – COGS = Gross Profit",
          "within_pl", "hard", fy,
          turnover - cogs, grossProfit, 1,
          `FY ${fy}: Gross Profit should equal Turnover minus Cost of Goods Sold`,
          "COGS may be incorrectly extracted or Gross Profit is computed on a different basis (net vs gross revenue).",
        ));
      }

      // P&L: Gross Profit – Operating Expenses = EBITDA
      if (grossProfit !== null && opex !== null && ebitda !== null) {
        checks.push(evaluate(
          `pl_ebitda_${fy}`,
          "P&L: Gross Profit – Opex = EBITDA",
          "within_pl", "hard", fy,
          grossProfit - opex, ebitda, 1,
          `FY ${fy}: EBITDA should equal Gross Profit minus Operating Expenses`,
          "Operating Expenses may include D&A (giving EBIT, not EBITDA), or Opex is understated.",
        ));
      }

      // P&L: EBITDA + Other Income – Depreciation = EBIT
      // Indian standard: Other Income (non-operating) sits between EBITDA and EBIT.
      const otherIncome = get(pl, "Other Income");
      if (ebitda !== null && depreciation !== null && ebit !== null) {
        const oi = otherIncome ?? 0;
        const hasOI = oi !== 0;
        checks.push(evaluate(
          `pl_ebit_${fy}`,
          hasOI ? "P&L: EBITDA + Other Income – Depreciation = EBIT" : "P&L: EBITDA – Depreciation = EBIT",
          "within_pl", "soft", fy,
          ebitda + oi - depreciation, ebit, 1,
          `FY ${fy}: EBIT should equal EBITDA${hasOI ? ` + Other Income (${oi.toLocaleString("en-IN")})` : ""} minus Depreciation`,
          "A remaining gap after this fix usually indicates amortisation is mapped differently, or a component of Other Income is captured under a different label.",
        ));
      }

      // P&L: EBIT – Interest = PBT
      if (ebit !== null && interest !== null && pbt !== null) {
        checks.push(evaluate(
          `pl_pbt_${fy}`,
          "P&L: EBIT – Interest = PBT",
          "within_pl", "hard", fy,
          ebit - interest, pbt, 1,
          `FY ${fy}: PBT should equal EBIT minus Interest Expense`,
          "Other income / exceptional items may be between EBIT and PBT. Check extraction for 'Other Income' lines.",
        ));
      }

      // P&L: PBT – Tax = PAT
      if (pbt !== null && tax !== null && pat !== null) {
        checks.push(evaluate(
          `pl_pat_${fy}`,
          "P&L: PBT – Tax = PAT",
          "within_pl", "hard", fy,
          pbt - tax, pat, 1,
          `FY ${fy}: PAT should equal Profit Before Tax minus Tax`,
          "Deferred tax or Minimum Alternate Tax (MAT) credit may be missing, or Tax is signed incorrectly.",
        ));
      }
    }

    // ── Within CF (only if extracted CF exists) ────────────────────────────
    if (cf) {
      const cfo     = get(cf, "Cash from Operations");
      const cfi     = get(cf, "Cash from Investing");
      const cff     = get(cf, "Cash from Financing");
      const netChg  = get(cf, "Net Change in Cash");
      const opening = get(cf, "Opening Cash");
      const closing = get(cf, "Closing Cash");

      if (cfo !== null && cfi !== null && cff !== null && netChg !== null) {
        checks.push(evaluate(
          `cf_net_${fy}`,
          "CF: CFO + CFI + CFF = Net Change",
          "within_cf", "hard", fy,
          cfo + cfi + cff, netChg, 1,
          `FY ${fy}: Net Change in Cash should equal CFO + CFI + CFF`,
          "An exchange rate / FX effect line may be extracted separately and not included in any of the three buckets.",
        ));
      }

      if (opening !== null && netChg !== null && closing !== null) {
        checks.push(evaluate(
          `cf_close_${fy}`,
          "CF: Opening + Net Change = Closing",
          "within_cf", "hard", fy,
          opening + netChg, closing, 1,
          `FY ${fy}: Closing Cash should equal Opening Cash plus Net Change in Cash`,
          "Opening or closing cash may be extracted with restricted-cash items included.",
        ));
      }
    }

    // ── Cross-statement ────────────────────────────────────────────────────
    if (bs && cf) {
      const bsCash = get(bs, "Cash & Bank");
      const cfClose = get(cf, "Closing Cash");
      if (bsCash !== null && cfClose !== null) {
        checks.push(evaluate(
          `cross_cash_${fy}`,
          "Cross: CF Closing Cash = BS Cash & Bank",
          "cross_stmt", "hard", fy,
          bsCash, cfClose, 1,
          `FY ${fy}: Closing Cash in Cash Flow Statement should match Cash & Bank on Balance Sheet`,
          "Units mismatch (Lakhs vs Crores) or restricted cash is included in CF but excluded from BS current assets.",
        ));
      }
    }
  }

  // ── Temporal: year-over-year continuity ───────────────────────────────────
  // Only meaningful check with BS-only data: CF Closing (N) = CF Opening (N+1)
  // (BS has no opening balance column, so comparing two year-end BS values is NOT a continuity check)
  for (let i = 1; i < years.length; i++) {
    const prevFy = years[i - 1];
    const currFy = years[i];

    const prevCf = cfByYear.get(prevFy);
    const currCf = cfByYear.get(currFy);

    if (prevCf && currCf) {
      const prevCloseCash = get(prevCf, "Closing Cash");
      const currOpenCash  = get(currCf, "Opening Cash");
      if (prevCloseCash !== null && currOpenCash !== null) {
        checks.push(evaluate(
          `temporal_cash_${prevFy}_${currFy}`,
          `YoY: CF Closing ${prevFy} = CF Opening ${currFy}`,
          "temporal", "hard", null,
          prevCloseCash, currOpenCash, 1,
          `Closing Cash in FY ${prevFy} should equal Opening Cash in FY ${currFy}`,
          "A restatement or reclassification occurred between years, or the two documents use different cash definitions.",
        ));
      }
    }

    // Cross-year BS cash vs extracted CF closing — hard tie
    const prevBs = bsByYear.get(prevFy);
    const currBs = bsByYear.get(currFy);
    if (prevBs && prevCf) {
      const bsCashPrev  = get(prevBs, "Cash & Bank");
      const cfClosePrev = get(prevCf, "Closing Cash");
      if (bsCashPrev !== null && cfClosePrev !== null) {
        checks.push(evaluate(
          `cross_cash_prev_${prevFy}`,
          `Cross: CF Closing Cash = BS Cash & Bank FY ${prevFy}`,
          "cross_stmt", "hard", prevFy,
          bsCashPrev, cfClosePrev, 1,
          `FY ${prevFy}: Closing Cash in Cash Flow Statement should match Cash & Bank on Balance Sheet`,
          "Units mismatch (Lakhs vs Crores) or restricted cash included in CF but excluded from BS current assets.",
        ));
      }
    }
    void currBs; // currBs cross-cash check already handled in the per-year loop above
  }

  // ── WC schedule (soft checks — only if extracted CF exists) ───────────────
  for (const fy of years.slice(1)) {
    const prevFy = years[years.indexOf(fy) - 1];
    const prevBs = bsByYear.get(prevFy);
    const currBs = bsByYear.get(fy);
    const cf     = cfByYear.get(fy);
    if (!prevBs || !currBs || !cf) continue;

    const cfDict = cf;

    // ΔTrade Receivables
    const dAR_bs = (get(currBs, "Trade Receivables") ?? 0) - (get(prevBs, "Trade Receivables") ?? 0);
    const dAR_cf = get(cfDict, "Δ Trade Receivables") ?? get(cfDict, "Changes in Receivables") ?? get(cfDict, "Increase/Decrease in Trade Receivables");
    if (dAR_bs !== 0 && dAR_cf !== null) {
      const tol = Math.abs(dAR_bs) * 0.1;
      checks.push(evaluate(
        `wc_ar_${fy}`,
        `WC: ΔTrade Receivables (BS) ≈ CF adjustment FY ${fy}`,
        "wc_schedule", "soft", fy,
        -dAR_bs, dAR_cf, tol,
        `FY ${fy}: BS movement in receivables (${dAR_bs}) should reconcile to CF working capital adjustment`,
        "Provisions, write-offs, or reclassifications can cause small breaks. A large gap suggests incorrect CF line mapping.",
      ));
    }

    // ΔInventory
    const dInv_bs = (get(currBs, "Inventory") ?? 0) - (get(prevBs, "Inventory") ?? 0);
    const dInv_cf = get(cfDict, "Δ Inventory") ?? get(cfDict, "Changes in Inventories") ?? get(cfDict, "Increase/Decrease in Inventories");
    if (dInv_bs !== 0 && dInv_cf !== null) {
      const tol = Math.abs(dInv_bs) * 0.1;
      checks.push(evaluate(
        `wc_inv_${fy}`,
        `WC: ΔInventory (BS) ≈ CF adjustment FY ${fy}`,
        "wc_schedule", "soft", fy,
        -dInv_bs, dInv_cf, tol,
        `FY ${fy}: BS movement in inventory (${dInv_bs}) should reconcile to CF working capital adjustment`,
        "Provisions or write-downs affect the BS but may not appear in the CF working capital section.",
      ));
    }

    // ΔTrade Payables
    const dAP_bs = (get(currBs, "Trade Payables") ?? 0) - (get(prevBs, "Trade Payables") ?? 0);
    const dAP_cf = get(cfDict, "Δ Trade Payables") ?? get(cfDict, "Changes in Trade Payables") ?? get(cfDict, "Increase/Decrease in Trade Payables");
    if (dAP_bs !== 0 && dAP_cf !== null) {
      const tol = Math.abs(dAP_bs) * 0.1;
      checks.push(evaluate(
        `wc_ap_${fy}`,
        `WC: ΔTrade Payables (BS) ≈ CF adjustment FY ${fy}`,
        "wc_schedule", "soft", fy,
        dAP_bs, dAP_cf, tol,
        `FY ${fy}: BS movement in payables (${dAP_bs}) should reconcile to CF working capital adjustment`,
        "Accruals or reclassifications within current liabilities can break this tie by a small amount.",
      ));
    }
  }

  return checks;
}
