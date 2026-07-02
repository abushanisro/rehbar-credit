import type { ExtractedRow } from "./types";

export interface DataQualityIssue {
  id: string;
  severity: "hard" | "warn";
  title: string;
  detail: string;
  section: "deal" | "projections" | "financials" | "gst";
}

type LineItem = { label: string; value: number | null; override_value?: number | null };

function getLineItem(rows: ExtractedRow[], stmtType: string, label: string, fy: number): number | null {
  const row = rows.find(r => r.statement_type === stmtType && r.fiscal_year === fy);
  if (!row) return null;
  const raw = row.line_items;
  if (!Array.isArray(raw)) return null;
  const items = raw as LineItem[];
  const item = items.find(i => i.label === label);
  if (!item) return null;
  return item.override_value != null ? item.override_value : item.value;
}

function lakhs(v: number): string {
  if (Math.abs(v) >= 100) return `₹${(v / 100).toFixed(2)} Cr`;
  return `₹${v.toFixed(2)} L`;
}

export function runDataQualityChecks(
  cc: { deal_amount?: number | null; client_name?: string | null },
  extracted: ExtractedRow[],
  gstData: { period: string; total_turnover: number | null }[],
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];

  // Guard: if data isn't ready yet, return empty — never throw
  if (!Array.isArray(extracted) || !Array.isArray(gstData)) return issues;

  // ── Derive year sets ──────────────────────────────────────────────────────
  const histRows = extracted.filter(r => r.statement_type !== "projections");
  const projRows = extracted.filter(r => r.statement_type === "projections");
  const histPlYears = [...new Set(histRows.filter(r => r.statement_type === "profit_loss").map(r => r.fiscal_year))].sort();
  const projYears   = [...new Set(projRows.map(r => r.fiscal_year))].sort();

  const latestHistFy = histPlYears.at(-1);
  const firstProjFy  = projYears[0];

  // ── 1. Projection units mismatch ─────────────────────────────────────────
  if (latestHistFy != null && firstProjFy != null) {
    const histTurnover = getLineItem(extracted, "profit_loss", "Turnover", latestHistFy)
      ?? getLineItem(extracted, "profit_loss", "Total Revenue from Operations", latestHistFy);
    const projTurnover = getLineItem(extracted, "projections", "Turnover", firstProjFy)
      ?? getLineItem(extracted, "projections", "Revenue", firstProjFy)
      ?? getLineItem(extracted, "projections", "Total Revenue", firstProjFy);

    if (histTurnover != null && projTurnover != null && histTurnover > 0 && projTurnover > 0) {
      const ratio = projTurnover / histTurnover;
      if (ratio < 0.05) {
        // Projected is 20x+ below actuals — projection likely in raw rupees vs lakhs
        issues.push({
          id: "projection_units_mismatch",
          severity: "hard",
          title: "Projection data appears to be in wrong units",
          detail: `Projected Year 1 turnover (${lakhs(projTurnover)}) is ${(1 / ratio).toFixed(0)}× below actual FY${latestHistFy} (${lakhs(histTurnover)}). Projection rows may have been entered in rupees while the rest of the deck is in lakhs.`,
          section: "projections",
        });
      } else if (ratio > 20) {
        // Projected is 20x+ above actuals — implausible growth
        issues.push({
          id: "projection_implausible_growth",
          severity: "hard",
          title: "Projection growth is not credible",
          detail: `Projected Year 1 turnover (${lakhs(projTurnover)}) is ${ratio.toFixed(0)}× above actual FY${latestHistFy} (${lakhs(histTurnover)}). This level of growth is not credible — confirm whether projections have been reviewed.`,
          section: "projections",
        });
      }
    }
  }

  // ── 2. Deal amount sanity ─────────────────────────────────────────────────
  const dealAmt = cc.deal_amount != null ? Number(cc.deal_amount) : null;
  if (dealAmt != null && dealAmt > 0 && latestHistFy != null) {
    const histTurnover = getLineItem(extracted, "profit_loss", "Turnover", latestHistFy)
      ?? getLineItem(extracted, "profit_loss", "Total Revenue from Operations", latestHistFy);

    if (histTurnover != null && histTurnover > 0) {
      const ratio = dealAmt / histTurnover;
      if (ratio > 50) {
        // Deal amount is 50x annual revenue — almost certainly entered in wrong units (rupees not lakhs)
        issues.push({
          id: "deal_amount_unit_error",
          severity: "hard",
          title: "Deal amount appears to be in wrong units",
          detail: `Deal amount (${lakhs(dealAmt)}) is ${ratio.toFixed(0)}× annual revenue (${lakhs(histTurnover)}). The deal amount field stores values in lakhs — confirm it was not entered in rupees.`,
          section: "deal",
        });
      } else if (ratio > 2.5) {
        // Deal > 2.5x annual revenue is an aggressive leverage ask
        issues.push({
          id: "deal_amount_high_leverage",
          severity: "warn",
          title: "Deal amount is high relative to revenue",
          detail: `Deal amount ${lakhs(dealAmt)} is ${ratio.toFixed(1)}× annual revenue ${lakhs(histTurnover)}. Confirm collateral adequacy and repayment source.`,
          section: "deal",
        });
      }
    }
  }

  // ── 3. P&L vs GST gap ────────────────────────────────────────────────────
  if (latestHistFy != null && gstData.length > 0) {
    const histTurnover = getLineItem(extracted, "profit_loss", "Turnover", latestHistFy)
      ?? getLineItem(extracted, "profit_loss", "Total Revenue from Operations", latestHistFy);

    if (histTurnover != null && histTurnover > 0) {
      // TTM GST: last 12 months sorted desc, sum total_turnover
      const sorted = [...gstData]
        .filter(r => r.total_turnover != null && r.total_turnover > 0)
        .sort((a, b) => b.period.localeCompare(a.period));
      const ttmRows = sorted.slice(0, 12);
      const gstTtm = ttmRows.reduce((s, r) => s + (r.total_turnover ?? 0), 0);

      if (gstTtm > 0) {
        const ratio = histTurnover / gstTtm;

        if (ratio > 5) {
          issues.push({
            id: "pl_gst_gap_high",
            severity: "hard",
            title: "P&L turnover is significantly above GST revenue",
            detail: `P&L turnover FY${latestHistFy} (${lakhs(histTurnover)}) is ${ratio.toFixed(1)}× TTM GST revenue (${lakhs(gstTtm)}). This structural gap indicates either exempt/non-GST revenue, one-time items, or a routing/misstatement risk. Verify Schedule of Other Income and reconcile with ITR.`,
            section: "gst",
          });
        } else if (ratio > 2.5) {
          issues.push({
            id: "pl_gst_gap_moderate",
            severity: "warn",
            title: "P&L turnover exceeds GST revenue by 2.5×",
            detail: `P&L turnover FY${latestHistFy} (${lakhs(histTurnover)}) is ${ratio.toFixed(1)}× TTM GST revenue (${lakhs(gstTtm)}). Some revenue may be GST-exempt, but the gap should be explained in due diligence.`,
            section: "gst",
          });
        } else if (ratio < 0.3) {
          // GST shows much more revenue than P&L — could mean P&L is understated
          issues.push({
            id: "pl_gst_gap_pl_low",
            severity: "warn",
            title: "GST revenue significantly exceeds P&L turnover",
            detail: `TTM GST revenue (${lakhs(gstTtm)}) is ${(1 / ratio).toFixed(1)}× above P&L turnover FY${latestHistFy} (${lakhs(histTurnover)}). P&L may be understated or fiscal years are misaligned. Verify the correct FY mapping.`,
            section: "gst",
          });
        }
      }
    }
  }

  // ── 4. PAT spike detection ────────────────────────────────────────────────
  if (histPlYears.length >= 2) {
    for (let i = 1; i < histPlYears.length; i++) {
      const prevFy = histPlYears[i - 1];
      const currFy = histPlYears[i];
      const prevPat = getLineItem(extracted, "profit_loss", "PAT", prevFy);
      const currPat = getLineItem(extracted, "profit_loss", "PAT", currFy);

      if (prevPat != null && currPat != null && prevPat > 0) {
        const ratio = currPat / prevPat;
        if (ratio > 10) {
          issues.push({
            id: `pat_spike_${prevFy}_${currFy}`,
            severity: "warn",
            title: `PAT spike: ${prevFy}→${currFy} grew ${ratio.toFixed(0)}×`,
            detail: `PAT increased from ${lakhs(prevPat)} to ${lakhs(currPat)} in one year (${ratio.toFixed(0)}×). This is almost certainly a one-time item — land monetization, revaluation, related-party credit, or exceptional gain. Request Schedule of Other Income and clarify before IC.`,
            section: "financials",
          });
        }
      }
    }
  }

  return issues;
}
