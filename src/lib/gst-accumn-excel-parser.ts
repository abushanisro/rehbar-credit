// Parser for Accumn GST Analytical Report Excel files (.xlsx)
// Extracts GSTR-1/GSTR-3B monthly data + full AccumnReport from all sheets.

import type {
  AccumnReport, AccumnConcentration, AccumnProduct, AccumnGeography,
  AccumnCategoryRow, AccumnCircular, AccumnTaxDetail, AccumnGstrRow,
  AccumnSalesSummary, AccumnFlag,
} from "@/features/case/types";

export interface ParsedGstPeriod {
  period: string;           // YYYY-MM
  return_type: string;      // "GSTR-1" | "GSTR-3B"
  gstin: string | null;
  taxable_turnover: number | null;
  exempt_turnover: number | null;
  total_turnover: number | null;
  output_tax: number | null;
  itc_claimed: number | null;
  net_tax_paid: number | null;
  filing_date: string | null;
  filing_status: string;
}

export interface AccumnExcelParseResult {
  periods: ParsedGstPeriod[];
  gstin: string | null;
  company_name: string | null;
  pan: string | null;
  period_covered: string | null;
  report: AccumnReport;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseMonthHeader(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const mon = MONTH_MAP[m[1]];
  if (!mon) return null;
  return `20${m[2]}-${mon}`;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return isFinite(n) ? n : null;
}

function parseDDMMYYYY(raw: unknown): string | null {
  if (!raw || raw === "-") return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function filingStatus(delayedDays: unknown): "filed" | "late" {
  if (delayedDays === null || delayedDays === "-" || delayedDays === "" || delayedDays === undefined) return "filed";
  const n = toNum(delayedDays);
  return n !== null && n > 0 ? "late" : "filed";
}

function extractPeriodLabel(sectionHeader: string): string {
  const fy = sectionHeader.match(/FY\s+(\d{4}-\d{2,4})/i);
  if (fy) return `FY ${fy[1]}`;
  if (sectionHeader.includes("TTM")) return "TTM";
  return sectionHeader.trim();
}

// ── Sheet-specific parsers ─────────────────────────────────────────────────────

type Rows = unknown[][];

function parseFilingMap(
  profileRows: Rows,
  sectionTitle: string,
): Map<string, { filing_date: string | null; filing_status: "filed" | "late" }> {
  const map = new Map<string, { filing_date: string | null; filing_status: "filed" | "late" }>();
  let dataStart = -1;
  for (let i = 0; i < profileRows.length; i++) {
    const cell0 = String((profileRows[i] as unknown[])?.[0] ?? "").trim();
    if (cell0.includes(sectionTitle)) { dataStart = i + 2; break; }
  }
  if (dataStart < 0) return map;
  for (let i = dataStart; i < profileRows.length; i++) {
    const row = profileRows[i] as unknown[];
    if (!row) break;
    const fy = row[0];
    const taxPeriod = row[1];
    if (!taxPeriod || taxPeriod === "TAX PERIOD") continue;
    if (!fy || typeof fy !== "string" || !/\d{4}/.test(String(fy))) break;
    const period = parseMonthHeader(taxPeriod);
    if (!period) continue;
    map.set(period, {
      filing_date: parseDDMMYYYY(row[3]),
      filing_status: filingStatus(row[4]),
    });
  }
  return map;
}

function parseConcentrationSection(
  rows: Rows,
  sectionHeaderRow: number,
  period: string,
  maxRows = 20,
): AccumnConcentration[] {
  const result: AccumnConcentration[] = [];
  const dataStart = sectionHeaderRow + 2;
  for (let i = dataStart; i < dataStart + maxRows && i < rows.length; i++) {
    const r = rows[i] as unknown[];
    if (!r) break;
    const rank = toNum(r[0]);
    if (rank === null) break;
    const name = String(r[2] ?? "").trim();
    if (!name) continue;
    const amount = toNum(r[5]);
    if (amount === null) continue;
    const pct = toNum(r[6]);
    result.push({
      period,
      rank,
      name,
      gstin: r[1] ? String(r[1]).trim() : undefined,
      amount,
      pct: pct ?? 0,
    });
  }
  return result;
}

function parseHsnSection(
  rows: Rows,
  sectionHeaderRow: number,
  period: string,
  isChapter: boolean,
  maxRows = 10,
): AccumnProduct[] {
  const result: AccumnProduct[] = [];
  const dataStart = sectionHeaderRow + 2;
  for (let i = dataStart; i < dataStart + maxRows && i < rows.length; i++) {
    const r = rows[i] as unknown[];
    if (!r) break;
    const rank = toNum(r[0]);
    if (rank === null) break;
    const hsnOrChapter = r[1] ? String(r[1]).trim() : undefined;
    const description = String(r[2] ?? "").trim();
    if (!description) continue;
    const amount = toNum(r[3]);
    if (amount === null) continue;
    const pct = toNum(r[4]);
    result.push({
      period,
      ...(isChapter ? { chapter: hsnOrChapter } : { hsn: hsnOrChapter }),
      description,
      amount,
      pct: pct ?? 0,
    });
  }
  return result;
}

// ── Main parser ────────────────────────────────────────────────────────────────

export async function parseAccumnGstExcel(file: File): Promise<AccumnExcelParseResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });

  // ── Profile & Filing Table ─────────────────────────────────────────────────
  const profileSheet = wb.Sheets["Profile & Filing Table"];
  if (!profileSheet) throw new Error("Sheet 'Profile & Filing Table' not found — is this an Accumn GST report?");
  const profileRows = XLSX.utils.sheet_to_json<unknown[]>(profileSheet, { header: 1, defval: null });

  // Read structured key-value profile block (rows 3–23)
  const profileKV: Record<string, string> = {};
  for (let i = 3; i <= 23; i++) {
    const r = profileRows[i] as unknown[];
    if (!r?.[0]) continue;
    const key = String(r[0]).trim().toUpperCase();
    const val = String(r[1] ?? "").trim();
    if (key && val && val !== "-") profileKV[key] = val;
  }

  const company_name =
    profileKV["LEGAL NAME OF BUSINESS"] ||
    profileKV["TRADE NAME"] ||
    String(profileRows[0]?.[0] ?? "").trim() ||
    null;
  const gstin        = profileKV["GSTN"] || null;
  const pan          = profileKV["PAN"] || null;
  const constitution = profileKV["CONSTITUTION OF BUSINESS"] || null;
  const state        = profileKV["STATE"] || null;
  const registration_date = profileKV["DATE OF REGISTRATION"] || null;
  const business_type     = profileKV["NATURE OF CORE BUSINESS ACTIVITY"] || null;

  // Period covered from Summary Analysis sheet header cell
  const summarySheet = wb.Sheets["Summary Analysis"];
  let period_covered: string | null = null;
  if (summarySheet) {
    const summaryRows = XLSX.utils.sheet_to_json<unknown[]>(summarySheet, { header: 1, defval: null });
    const hdrCell = String(summaryRows[1]?.[0] ?? "");
    const pcm = hdrCell.match(/Period Covered[:\s]+(.+)/i);
    period_covered = pcm ? pcm[1].trim() : null;
    if (!period_covered) {
      // Try row 4 header labels
      const hdr4 = summaryRows[4] as unknown[];
      const fyLabels = [hdr4?.[3], hdr4?.[4], hdr4?.[5], hdr4?.[6]]
        .filter(v => v && String(v).trim())
        .map(v => String(v).trim());
      if (fyLabels.length >= 2) period_covered = `${fyLabels[0]} – ${fyLabels[fyLabels.length - 1]}`;
    }
  }

  if (!gstin && !company_name) throw new Error("File does not appear to be an Accumn GST Analytical Report");

  // Filing maps (GSTR-3B and GSTR-1)
  const gstr3bFiling = parseFilingMap(profileRows, "Filing Details - GSTR3B");
  const gstr1Filing  = parseFilingMap(profileRows, "Filing Details - GSTR1");

  // ── GSTR 3B sheet ─────────────────────────────────────────────────────────
  const gstr3bSheet = wb.Sheets["GSTR 3B"];
  if (!gstr3bSheet) throw new Error("Sheet 'GSTR 3B' not found");
  const gstr3bRows = XLSX.utils.sheet_to_json<unknown[]>(gstr3bSheet, { header: 1, defval: null });

  const g3bHeaderRow = gstr3bRows[4] as unknown[];
  const monthPeriods: (string | null)[] = [];
  for (let c = 1; c < g3bHeaderRow.length; c++) {
    monthPeriods.push(parseMonthHeader(g3bHeaderRow[c]));
  }

  const gstr1Revenue  = gstr3bRows[5] as unknown[];   // Adjusted Revenue as per GSTR1
  const gstr3bRevenue = gstr3bRows[6] as unknown[];   // Revenue as per GSTR 3B
  const exemptRow     = gstr3bRows[15] as unknown[];  // Other Outward Taxable Supplies (Nil/Exempt)

  // ── Tax sheet ─────────────────────────────────────────────────────────────
  const taxSheet = wb.Sheets["Tax"];
  if (!taxSheet) throw new Error("Sheet 'Tax' not found");
  const taxRows = XLSX.utils.sheet_to_json<unknown[]>(taxSheet, { header: 1, defval: null });

  const itcRow      = taxRows[6] as unknown[];   // Total Tax paid through Input Tax Credit
  const cashTaxRow  = taxRows[12] as unknown[];  // Total Tax paid through cash
  const totalTaxRow = taxRows[18] as unknown[];  // Total Tax Paid

  // ── Build ParsedGstPeriod[] + gstr_comparison[] + tax_details[] ───────────
  const periods: ParsedGstPeriod[] = [];
  const gstrComparison: AccumnGstrRow[] = [];
  const taxDetails: AccumnTaxDetail[] = [];

  for (let c = 0; c < monthPeriods.length; c++) {
    const period = monthPeriods[c];
    if (!period) continue;
    const colIdx = c + 1;

    const gstr3bTaxable = toNum(gstr3bRevenue?.[colIdx]);
    const gstr3bExempt  = toNum(exemptRow?.[colIdx]);
    const gstr1Taxable  = toNum(gstr1Revenue?.[colIdx]);
    const outputTax     = toNum(totalTaxRow?.[colIdx]);
    const itc           = toNum(itcRow?.[colIdx]);
    const cashTax       = toNum(cashTaxRow?.[colIdx]);

    const gstr3bTotal =
      gstr3bTaxable !== null || gstr3bExempt !== null
        ? (gstr3bTaxable ?? 0) + (gstr3bExempt ?? 0)
        : null;

    const netTax =
      cashTax !== null ? cashTax
      : outputTax !== null && itc !== null ? outputTax - itc
      : null;

    const f3b = gstr3bFiling.get(period);
    periods.push({
      period,
      return_type: "GSTR-3B",
      gstin,
      taxable_turnover: gstr3bTaxable,
      exempt_turnover: gstr3bExempt,
      total_turnover: gstr3bTotal,
      output_tax: outputTax,
      itc_claimed: itc,
      net_tax_paid: netTax,
      filing_date: f3b?.filing_date ?? null,
      filing_status: f3b?.filing_status ?? "filed",
    });

    const f1 = gstr1Filing.get(period);
    if (gstr1Taxable !== null || f1) {
      periods.push({
        period,
        return_type: "GSTR-1",
        gstin,
        taxable_turnover: gstr1Taxable,
        exempt_turnover: null,
        total_turnover: gstr1Taxable,
        output_tax: null,
        itc_claimed: null,
        net_tax_paid: null,
        filing_date: f1?.filing_date ?? null,
        filing_status: f1?.filing_status ?? "filed",
      });
    }

    // gstr_comparison
    const diff =
      gstr1Taxable !== null && gstr3bTaxable !== null
        ? gstr1Taxable - gstr3bTaxable
        : null;
    gstrComparison.push({
      period,
      gstr1_turnover: gstr1Taxable,
      gstr3b_turnover: gstr3bTaxable,
      difference: diff,
    });

    // tax_details
    taxDetails.push({
      period,
      output_tax: outputTax,
      itc_availed: itc,
      net_tax: cashTax,
    });
  }

  // ── Summary Analysis ──────────────────────────────────────────────────────
  const salesSummary: AccumnSalesSummary[] = [];
  if (summarySheet) {
    const sumRows = XLSX.utils.sheet_to_json<unknown[]>(summarySheet, { header: 1, defval: null });
    const fyHeaders = (sumRows[4] as unknown[]) ?? [];
    const revRow    = (sumRows[5] as unknown[]) ?? [];
    const marginPctRow    = (sumRows[17] as unknown[]) ?? [];
    const revGrowthRow    = (sumRows[22] as unknown[]) ?? [];

    const FY_COLS = [3, 4, 5, 6];
    for (const col of FY_COLS) {
      const label = String(fyHeaders[col] ?? "").trim();
      if (!label) continue;
      const adj_revenue   = toNum(revRow[col]);
      const margin_pct_raw = toNum(marginPctRow[col]);
      const rev_growth_raw = toNum(revGrowthRow[col]);
      salesSummary.push({
        period: label,
        adjusted_revenue: adj_revenue,
        gross_margin_pct: margin_pct_raw !== null ? +(margin_pct_raw * 100).toFixed(2) : null,
        sales_return_pct: null,
        pat_pct: null,
        advance_pct: null,
        net_revenue: rev_growth_raw !== null ? +(rev_growth_raw * 100).toFixed(2) : null,
      });
    }
  }

  // ── Customers Analysis ────────────────────────────────────────────────────
  const customerConcentration: AccumnConcentration[] = [];
  const custSheet = wb.Sheets["Customers Analysis"];
  if (custSheet) {
    const custRows = XLSX.utils.sheet_to_json<unknown[]>(custSheet, { header: 1, defval: null });
    for (let i = 0; i < custRows.length; i++) {
      const cell0 = String((custRows[i] as unknown[])?.[0] ?? "");
      if (cell0.includes("TOP 20 B2B CUSTOMERS")) {
        const period = extractPeriodLabel(cell0);
        customerConcentration.push(...parseConcentrationSection(custRows, i, period));
      }
    }
  }

  // ── Suppliers Analysis ────────────────────────────────────────────────────
  const supplierConcentration: AccumnConcentration[] = [];
  const suppSheet = wb.Sheets["Suppliers Analysis"];
  if (suppSheet) {
    const suppRows = XLSX.utils.sheet_to_json<unknown[]>(suppSheet, { header: 1, defval: null });
    for (let i = 0; i < suppRows.length; i++) {
      const cell0 = String((suppRows[i] as unknown[])?.[0] ?? "");
      if (cell0.includes("TOP 20 B2B SUPPLIERS")) {
        const period = extractPeriodLabel(cell0);
        supplierConcentration.push(...parseConcentrationSection(suppRows, i, period));
      }
    }
  }

  // ── HSN & Chapter Analysis ────────────────────────────────────────────────
  const productConcentration: AccumnProduct[] = [];
  const hsnSheet = wb.Sheets["HSN & Chapter Analysis"];
  if (hsnSheet) {
    const hsnRows = XLSX.utils.sheet_to_json<unknown[]>(hsnSheet, { header: 1, defval: null });
    for (let i = 0; i < hsnRows.length; i++) {
      const cell0 = String((hsnRows[i] as unknown[])?.[0] ?? "");
      if (cell0.includes("TOP 10 HSN")) {
        productConcentration.push(...parseHsnSection(hsnRows, i, extractPeriodLabel(cell0), false));
      } else if (cell0.includes("TOP 10 CHAPTER")) {
        productConcentration.push(...parseHsnSection(hsnRows, i, extractPeriodLabel(cell0), true));
      }
    }
  }

  // ── Circular Transactions ─────────────────────────────────────────────────
  // Header row 5: col 0=name, 1=gstin, 2=state, 3=type, 4..=monthly, 16=FY2024-25, 29=FY2025-26, 31=FY2026-27
  const circularMap = new Map<string, AccumnCircular & { sale_sum: number; purch_sum: number }>();
  const circSheet = wb.Sheets["Circular Transactions"];
  if (circSheet) {
    const circRows = XLSX.utils.sheet_to_json<unknown[]>(circSheet, { header: 1, defval: null });
    // Locate the FY aggregate columns from the header
    const circHeader = (circRows[5] as unknown[]) ?? [];
    const fyColIndices: number[] = [];
    for (let c = 0; c < circHeader.length; c++) {
      const v = String(circHeader[c] ?? "").trim();
      if (/^FY\s+\d{4}-\d{2,4}$/.test(v)) fyColIndices.push(c);
    }

    for (let i = 6; i < circRows.length; i++) {
      const r = circRows[i] as unknown[];
      if (!r?.[0]) continue;
      const name  = String(r[0]).trim();
      const gstinV = r[1] ? String(r[1]).trim() : undefined;
      const type   = String(r[3] ?? "").trim();
      if (!name || (type !== "Sales" && type !== "Purchase")) continue;

      if (!circularMap.has(name)) {
        circularMap.set(name, { entity: name, gstin: gstinV, sale_sum: 0, purch_sum: 0, sale_amount: null, purchase_amount: null });
      }
      const entry = circularMap.get(name)!;
      for (const col of fyColIndices) {
        const v = toNum(r[col]);
        if (v === null) continue;
        if (type === "Sales") entry.sale_sum += v;
        else entry.purch_sum += v;
      }
    }
  }
  const circularTransactions: AccumnCircular[] = [];
  for (const entry of circularMap.values()) {
    const { sale_sum, purch_sum, ...rest } = entry;
    circularTransactions.push({
      ...rest,
      sale_amount: sale_sum !== 0 ? sale_sum : null,
      purchase_amount: purch_sum !== 0 ? purch_sum : null,
    });
  }

  // ── State Wise ────────────────────────────────────────────────────────────
  // Header at row 4: PARTICULARS(0), STATE CODE(1), monthly pairs..., FY2024-25(26), FY2025-26(52), FY2026-27(56), TTM(58)
  const SKIP_STATE_NAMES = new Set(["inter state", "total", "grand total", "adjusted revenue total", "adjusted revenue (total)"]);
  const geography: AccumnGeography[] = [];
  const stateSheet = wb.Sheets["State Wise"];
  if (stateSheet) {
    const stateRows = XLSX.utils.sheet_to_json<unknown[]>(stateSheet, { header: 1, defval: null });
    // Locate FY aggregate columns from header row 4
    const stateHeader = (stateRows[4] as unknown[]) ?? [];
    const fyStateCols: { col: number; period: string }[] = [];
    for (let c = 0; c < stateHeader.length; c++) {
      const v = String(stateHeader[c] ?? "").trim();
      if (/^FY\s+\d{4}-\d{2,4}$/.test(v) || v.startsWith("TTM")) {
        fyStateCols.push({ col: c, period: v });
      }
    }

    for (let i = 6; i < stateRows.length; i++) {
      const r = stateRows[i] as unknown[];
      if (!r?.[0]) break;
      const stateName = String(r[0]).trim();
      if (!stateName) break;
      if (SKIP_STATE_NAMES.has(stateName.toLowerCase())) continue;

      for (const { col, period } of fyStateCols) {
        const amount = toNum(r[col]);
        const pct    = toNum(r[col + 1]);
        if (amount === null || amount === 0) continue;
        geography.push({ period, state: stateName, amount, pct: pct ?? 0 });
      }
    }
  }

  // ── Bifurcation ───────────────────────────────────────────────────────────
  // Header row 4: PARTICULARS(0), monthly pairs, FY2024-25(25), FY2025-26(51), FY2026-27(55), TTM(57)
  // Rows: B2B=7, B2CL=8, B2CS=9, Exempted=10, NilRated=11, Total=16
  const customerCategories: AccumnCategoryRow[] = [];
  const bifSheet = wb.Sheets["Bifurcation"];
  if (bifSheet) {
    const bifRows = XLSX.utils.sheet_to_json<unknown[]>(bifSheet, { header: 1, defval: null });
    const bifHeader = (bifRows[4] as unknown[]) ?? [];
    const fyBifCols: { col: number; period: string }[] = [];
    for (let c = 0; c < bifHeader.length; c++) {
      const v = String(bifHeader[c] ?? "").trim();
      if (/^FY\s+\d{4}-\d{2,4}$/.test(v) || v.startsWith("TTM")) {
        fyBifCols.push({ col: c, period: v });
      }
    }

    // B2B=row7, B2CL=row8, B2CS=row9, Exempted=row10, NilRated=row11, Total=row16
    const ROW_B2B   = 7;
    const ROW_B2CL  = 8;
    const ROW_B2CS  = 9;
    const ROW_NIL   = 11;
    const ROW_TOTAL = 16;

    for (const { col, period } of fyBifCols) {
      customerCategories.push({
        period,
        b2b:        toNum((bifRows[ROW_B2B]   as unknown[])?.[col]),
        b2c_large:  toNum((bifRows[ROW_B2CL]  as unknown[])?.[col]),
        b2c_small:  toNum((bifRows[ROW_B2CS]  as unknown[])?.[col]),
        nil_rated:  toNum((bifRows[ROW_NIL]   as unknown[])?.[col]),
        total:      toNum((bifRows[ROW_TOTAL] as unknown[])?.[col]),
      });
    }
  }

  // ── Derive flags ──────────────────────────────────────────────────────────
  const flags: AccumnFlag[] = [];

  // Late filings
  const latePeriods = periods.filter(p => p.filing_status === "late").map(p => p.period);
  if (latePeriods.length > 0) {
    flags.push({
      flag_name: "Late Filing",
      severity: latePeriods.length >= 3 ? "HIGH" : "MEDIUM",
      description: `${latePeriods.length} returns filed late: ${latePeriods.slice(0, 5).join(", ")}${latePeriods.length > 5 ? "…" : ""}`,
    });
  }

  // Customer concentration
  const topCustFy = customerConcentration.filter(c => c.period === (salesSummary[0]?.period ?? "FY 2024-25") && c.rank === 1);
  if (topCustFy.length > 0 && topCustFy[0].pct > 0.3) {
    flags.push({
      flag_name: "Customer Concentration",
      severity: topCustFy[0].pct > 0.5 ? "HIGH" : "MEDIUM",
      description: `Top customer '${topCustFy[0].name}' accounts for ${(topCustFy[0].pct * 100).toFixed(1)}% of revenue`,
    });
  }

  // Circular transactions
  const activeCircular = circularTransactions.filter(
    c => c.sale_amount && c.purchase_amount && Math.abs(c.sale_amount) > 0 && Math.abs(c.purchase_amount) > 0,
  );
  if (activeCircular.length > 0) {
    flags.push({
      flag_name: "Circular Transactions",
      severity: "HIGH",
      description: `${activeCircular.length} entities have both sales and purchases — circular transaction risk`,
    });
  }

  // ── Assemble AccumnReport ─────────────────────────────────────────────────
  const report: AccumnReport = {
    is_accumn: true,
    flags,
    company_profile: {
      name: company_name ?? undefined,
      gstin: gstin ?? undefined,
      pan: pan ?? undefined,
      constitution: constitution ?? undefined,
      state: state ?? undefined,
      business_type: business_type ?? undefined,
      registration_date: registration_date ?? undefined,
    },
    sales_summary:          salesSummary.length > 0 ? salesSummary : undefined,
    customer_categories:    customerCategories.length > 0 ? customerCategories : undefined,
    geography:              geography.length > 0 ? geography : undefined,
    customer_concentration: customerConcentration.length > 0 ? customerConcentration : undefined,
    supplier_concentration: supplierConcentration.length > 0 ? supplierConcentration : undefined,
    product_concentration:  productConcentration.length > 0 ? productConcentration : undefined,
    tax_details:            taxDetails.length > 0 ? taxDetails : undefined,
    gstr_comparison:        gstrComparison.length > 0 ? gstrComparison : undefined,
    circular_transactions:  circularTransactions.length > 0 ? circularTransactions : undefined,
  };

  return { periods, gstin, company_name, pan, period_covered, report };
}
