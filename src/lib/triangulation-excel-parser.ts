// Parser for Perfios "Triangulation" Excel files.

type Rows = unknown[][];

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface TriangulationSourceDate {
  source: string;
  startDate: string;
  endDate: string;
}

export interface TriangulationProfileDetail {
  srNo: number;
  particular: string;
  result: string; // "Match" | "Mismatch" | "-"
  values: Record<string, string>; // keys: itr, bsa1, bsa2, gst1...gst7
}

export interface TriangulationBankInfo {
  srNo: number;
  bankName: string;
  accountNumber: string;
  accountType: string;
  banking: string;
  itrAis: string;
}

export interface TriangulationSummaryRow {
  particular: string;
  values: (string | null)[];
}

export interface TriangulationParty {
  srNo: number;
  name: string;
  gstAmount: number | null;
  pctRevenue: number | null;
  activeMonths: number | null;
  trend: string;
  bankingAnnualized: number | null;
  realisation: number | null;
}

export interface TriangulationCircularParty {
  partyName: string;
  data: {
    period: string;
    gstRevenue: number | null;
    gstPurchase: number | null;
    bankingCredit: number | null;
    bankingDebit: number | null;
  }[];
}

export interface TriangulationData {
  sourceDates: TriangulationSourceDate[];
  profileDetails: TriangulationProfileDetail[];
  bankingInfo: TriangulationBankInfo[];
  summary: { periods: string[]; rows: TriangulationSummaryRow[] };
  customers: {
    period: string;
    parties: TriangulationParty[];
    subtotalGst: number | null;
    subtotalBanking: number | null;
    totalGst: number | null;
    totalBanking: number | null;
  };
  suppliers: {
    period: string;
    parties: TriangulationParty[];
    subtotalGst: number | null;
    subtotalBanking: number | null;
  };
  circularParties: TriangulationCircularParty[];
  hasRelatedPartyData: boolean;
  hasLoanMappingData: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-" || v === "NA" || v === "N/A") return null;
  const s = String(v).replace(/,/g, "").replace(/%$/, "").trim();
  if (!s || s === "-" || s === "NA") return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function rowIsEmpty(row: unknown[]): boolean {
  return row.every(c => c === null || c === undefined || String(c).trim() === "");
}

function cellContains(v: unknown, needle: string): boolean {
  return str(v).toLowerCase().includes(needle.toLowerCase());
}

function findSheet(wb: { Sheets: Record<string, unknown>; SheetNames: string[] }, name: string): unknown | null {
  if (wb.Sheets[name]) return wb.Sheets[name];
  const lower = name.toLowerCase();
  const found = wb.SheetNames.find(n => n.toLowerCase().startsWith(lower));
  return found ? wb.Sheets[found] : null;
}

// ── Profile sheet parser ──────────────────────────────────────────────────────

function parseProfileSheet(rows: Rows): {
  sourceDates: TriangulationSourceDate[];
  profileDetails: TriangulationProfileDetail[];
  bankingInfo: TriangulationBankInfo[];
} {
  const sourceDates: TriangulationSourceDate[] = [];
  const profileDetails: TriangulationProfileDetail[] = [];
  const bankingInfo: TriangulationBankInfo[] = [];

  const SECTION_SOURCE   = "source date range";
  const SECTION_PROFILE  = "profile details";
  const SECTION_BANKING  = "banking information";

  let mode: "none" | "source" | "profile" | "banking" = "none";
  let headerParsed = false;
  let profileValueKeys: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const cell0 = str(row[0]).toLowerCase();

    // Detect section headers
    if (cell0.includes(SECTION_BANKING)) {
      mode = "banking";
      headerParsed = false;
      continue;
    }
    if (cell0.includes(SECTION_PROFILE)) {
      mode = "profile";
      headerParsed = false;
      continue;
    }
    if (cell0.includes(SECTION_SOURCE)) {
      mode = "source";
      headerParsed = false;
      continue;
    }

    if (mode === "none") continue;

    // Skip header rows (first non-empty row after section header)
    if (!headerParsed) {
      // For profile mode, capture the column keys from header
      if (mode === "profile" && str(row[1]).toLowerCase().includes("particular")) {
        profileValueKeys = [];
        for (let c = 3; c < row.length; c++) {
          const key = str(row[c]).toLowerCase().replace(/\s+/g, "");
          if (key) profileValueKeys.push(key);
          else profileValueKeys.push(`col${c}`);
        }
        headerParsed = true;
        continue;
      }
      if (str(row[0]).toLowerCase().includes("sr") || str(row[1]).toLowerCase().includes("source") ||
          str(row[1]).toLowerCase().includes("particular") || str(row[1]).toLowerCase().includes("bank")) {
        headerParsed = true;
        continue;
      }
      continue;
    }

    if (rowIsEmpty(row)) {
      mode = "none";
      headerParsed = false;
      continue;
    }

    const srNo = toNum(row[0]);

    if (mode === "source") {
      if (srNo === null) continue;
      sourceDates.push({
        source: str(row[1]),
        startDate: str(row[2]),
        endDate: str(row[3]),
      });
    } else if (mode === "profile") {
      if (srNo === null) continue;
      const values: Record<string, string> = {};
      const defaultKeys = ["itr", "bsa1", "bsa2", "gst1", "gst2", "gst3", "gst4", "gst5", "gst6", "gst7"];
      const keys = profileValueKeys.length > 0 ? profileValueKeys : defaultKeys;
      for (let c = 3; c < row.length; c++) {
        const key = keys[c - 3] ?? `col${c}`;
        values[key] = str(row[c]);
      }
      profileDetails.push({
        srNo,
        particular: str(row[1]),
        result: str(row[2]) || "-",
        values,
      });
    } else if (mode === "banking") {
      if (srNo === null) continue;
      bankingInfo.push({
        srNo,
        bankName: str(row[1]),
        accountNumber: str(row[2]),
        accountType: str(row[3]),
        banking: str(row[4]),
        itrAis: str(row[5]),
      });
    }
  }

  return { sourceDates, profileDetails, bankingInfo };
}

// ── Summary sheet parser ──────────────────────────────────────────────────────

function parseSummarySheet(rows: Rows): { periods: string[]; rows: TriangulationSummaryRow[] } {
  const summaryRows: TriangulationSummaryRow[] = [];
  let periods: string[] = [];
  let headerIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (str(row[0]).toLowerCase().includes("particular")) {
      headerIdx = i;
      periods = [];
      for (let c = 1; c < row.length; c++) {
        const v = str(row[c]);
        if (v) periods.push(v);
      }
      break;
    }
  }

  if (headerIdx < 0) return { periods: [], rows: [] };

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || rowIsEmpty(row)) continue;
    const particular = str(row[0]);
    if (!particular) continue;
    const values: (string | null)[] = [];
    for (let c = 1; c <= periods.length; c++) {
      const v = row[c];
      values.push(v === null || v === undefined || str(v) === "" ? null : str(v));
    }
    summaryRows.push({ particular, values });
  }

  return { periods, rows: summaryRows };
}

// ── Customers / Suppliers parser ──────────────────────────────────────────────

function parsePartiesSheet(
  rows: Rows,
  gstColLabel: string,
): {
  period: string;
  parties: TriangulationParty[];
  subtotalGst: number | null;
  subtotalBanking: number | null;
  totalGst: number | null;
  totalBanking: number | null;
} {
  const parties: TriangulationParty[] = [];
  let subtotalGst: number | null = null;
  let subtotalBanking: number | null = null;
  let totalGst: number | null = null;
  let totalBanking: number | null = null;
  let period = "";

  // Find header row containing the GST column label
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const rowStr = row.map(c => str(c).toLowerCase()).join("|");
    if (rowStr.includes(gstColLabel.toLowerCase())) {
      headerIdx = i;
      // Extract period from a nearby row (usually the line just above the header)
      for (let back = Math.max(0, i - 3); back < i; back++) {
        const candidate = rows[back];
        if (!candidate) continue;
        const text = candidate.map(c => str(c)).join(" ").trim();
        if (text && !str(candidate[0]).toLowerCase().includes("sr")) {
          period = text;
        }
      }
      break;
    }
  }

  if (headerIdx < 0) return { period, parties, subtotalGst, subtotalBanking, totalGst, totalBanking };

  // Identify column positions from header row
  const hdr = rows[headerIdx].map(c => str(c).toLowerCase());
  const colSrNo       = 0;
  const colName       = hdr.findIndex(h => h.includes("particular"));
  const colGst        = hdr.findIndex(h => h.includes(gstColLabel.toLowerCase().split(" ")[0]) && (h.includes("revenue") || h.includes("expense")));
  const colPct        = hdr.findIndex(h => h.includes("% of"));
  const colMonths     = hdr.findIndex(h => h.includes("active month"));
  const colTrend      = hdr.findIndex(h => h.includes("trend"));
  const colBanking    = hdr.findIndex(h => h.includes("banking") && h.includes("annuali"));
  const colRealise    = hdr.findIndex(h => h.includes("realisa") || h.includes("realizat"));

  const safeGet = (row: unknown[], col: number): unknown => col >= 0 ? row[col] : undefined;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || rowIsEmpty(row)) continue;

    const nameVal = str(safeGet(row, colName >= 0 ? colName : 1));
    const srVal   = safeGet(row, colSrNo);

    // Sub Total row
    if (nameVal.toLowerCase().includes("sub total")) {
      subtotalGst     = toNum(safeGet(row, colGst >= 0 ? colGst : 2));
      subtotalBanking = toNum(safeGet(row, colBanking >= 0 ? colBanking : 6));
      continue;
    }

    // Adjusted Revenue / Other Revenue → treat as "total" bucket
    if (nameVal.toLowerCase().includes("adjusted revenue")) {
      totalGst     = toNum(safeGet(row, colGst >= 0 ? colGst : 2));
      totalBanking = toNum(safeGet(row, colBanking >= 0 ? colBanking : 6));
      continue;
    }

    // Skip other special aggregate rows
    if (nameVal.toLowerCase().includes("other revenue") ||
        nameVal.toLowerCase().includes("other purchase")) {
      continue;
    }

    const srNo = toNum(srVal);
    if (srNo === null) continue;

    parties.push({
      srNo,
      name: nameVal,
      gstAmount:         toNum(safeGet(row, colGst >= 0 ? colGst : 2)),
      pctRevenue:        toNum(safeGet(row, colPct >= 0 ? colPct : 3)),
      activeMonths:      toNum(safeGet(row, colMonths >= 0 ? colMonths : 4)),
      trend:             str(safeGet(row, colTrend >= 0 ? colTrend : 5)),
      bankingAnnualized: toNum(safeGet(row, colBanking >= 0 ? colBanking : 6)),
      realisation:       toNum(safeGet(row, colRealise >= 0 ? colRealise : 7)),
    });
  }

  return { period, parties, subtotalGst, subtotalBanking, totalGst, totalBanking };
}

// ── Related Party & Circular Txn parser ──────────────────────────────────────

function parseRelatedPartySheet(rows: Rows): {
  circularParties: TriangulationCircularParty[];
  hasRelatedPartyData: boolean;
  hasLoanMappingData: boolean; // always false from this sheet
} {
  const circularParties: TriangulationCircularParty[] = [];
  let hasRelatedPartyData = false;

  // Check if sheet has "No Data Available" for related party section
  const fullText = rows.map(r => (r ?? []).map(c => str(c)).join(" ")).join("\n").toLowerCase();
  if (fullText.includes("no data available") && fullText.includes("related party")) {
    hasRelatedPartyData = false;
  } else if (fullText.includes("related party")) {
    hasRelatedPartyData = true;
  }

  // Find "Circular Transaction" section
  let circHeaderIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (cellContains(row[0], "circular transaction") || cellContains(row[1], "circular transaction")) {
      circHeaderIdx = i;
      break;
    }
  }

  if (circHeaderIdx < 0) return { circularParties, hasRelatedPartyData, hasLoanMappingData: false };

  // Check for No Data Available in the circular section
  const circSection = rows.slice(circHeaderIdx, Math.min(circHeaderIdx + 5, rows.length));
  const circText = circSection.map(r => (r ?? []).map(c => str(c)).join(" ")).join(" ").toLowerCase();
  if (circText.includes("no data available")) {
    return { circularParties, hasRelatedPartyData, hasLoanMappingData: false };
  }

  // The structure: row after section header has period labels (2024-25, 2025-26, TTM, …)
  // Next row has sub-headers: Sr. No. | Party Name | [GST Rev, GST Purchase, Banking Credit, Banking Debit] × periods
  let periodLabelRow = -1;
  let subHeaderRow   = -1;
  let dataStart      = -1;
  const periods: string[] = [];

  for (let i = circHeaderIdx + 1; i < Math.min(circHeaderIdx + 8, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const rowStr = row.map(c => str(c)).join("|");

    // Period label row: contains year-range patterns like "2024-25" or "TTM"
    if (/\d{4}-\d{2}/.test(rowStr) || rowStr.toLowerCase().includes("ttm")) {
      periodLabelRow = i;
      // Extract distinct period labels (skip blank cells and repeated labels)
      const seen = new Set<string>();
      for (const c of row) {
        const v = str(c);
        if (v && !seen.has(v) && (str(v).includes("-") || v.toLowerCase().includes("ttm"))) {
          seen.add(v);
          periods.push(v);
        }
      }
      continue;
    }

    // Sub-header row: contains "GST Revenue" or "GST Purchase"
    if (rowStr.toLowerCase().includes("gst revenue") || rowStr.toLowerCase().includes("gst purchase")) {
      subHeaderRow = i;
      dataStart = i + 1;
      break;
    }
  }

  if (dataStart < 0) return { circularParties, hasRelatedPartyData, hasLoanMappingData: false };

  // Build column map from sub-header row
  // Columns: [Sr.No., Party Name, (GSTRev, GSTPurch, BankCredit, BankDebit) × periods]
  const subHdr = rows[subHeaderRow].map(c => str(c).toLowerCase());
  // Data columns start at index 2
  // Each period occupies 4 columns: gst_rev, gst_purch, bank_credit, bank_debit
  const metricsPerPeriod = 4;
  const dataColStart = 2;

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row || rowIsEmpty(row)) break;

    // Stop if we hit another section header
    if (cellContains(row[0], "related party") || cellContains(row[1], "related party")) break;

    const srNo = toNum(row[0]);
    if (srNo === null) continue;

    const partyName = str(row[1]);
    if (!partyName) continue;

    const data: TriangulationCircularParty["data"] = [];
    for (let p = 0; p < periods.length; p++) {
      const base = dataColStart + p * metricsPerPeriod;
      data.push({
        period:         periods[p],
        gstRevenue:     toNum(row[base]),
        gstPurchase:    toNum(row[base + 1]),
        bankingCredit:  toNum(row[base + 2]),
        bankingDebit:   toNum(row[base + 3]),
      });
    }

    circularParties.push({ partyName, data });
  }

  return { circularParties, hasRelatedPartyData, hasLoanMappingData: false };
}

// ── Loan Mapping sheet checker ────────────────────────────────────────────────

function checkLoanMappingSheet(rows: Rows): boolean {
  const fullText = rows.map(r => (r ?? []).map(c => str(c)).join(" ")).join("\n").toLowerCase();
  if (fullText.includes("no data available")) return false;
  // Has data if there's a numeric Sr.No in any row below the header
  for (const row of rows) {
    if (!row) continue;
    if (toNum(row[0]) !== null) return true;
  }
  return false;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function parseTriangulationExcel(file: File): Promise<TriangulationData> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const getRows = (sheetName: string): Rows => {
    const ws = findSheet(wb as { Sheets: Record<string, unknown>; SheetNames: string[] }, sheetName);
    if (!ws) return [];
    return XLSX.utils.sheet_to_json<unknown[]>(ws as Parameters<typeof XLSX.utils.sheet_to_json>[0], { header: 1, defval: "" }) as Rows;
  };

  // ── Profile ──────────────────────────────────────────────────────────────────
  let sourceDates: TriangulationSourceDate[]   = [];
  let profileDetails: TriangulationProfileDetail[] = [];
  let bankingInfo: TriangulationBankInfo[]     = [];
  try {
    const profileRows = getRows("Profile");
    if (profileRows.length > 0) {
      const parsed = parseProfileSheet(profileRows);
      sourceDates    = parsed.sourceDates;
      profileDetails = parsed.profileDetails;
      bankingInfo    = parsed.bankingInfo;
    }
  } catch {
    // resilient — leave defaults
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  let summary: TriangulationData["summary"] = { periods: [], rows: [] };
  try {
    const summaryRows = getRows("Summary");
    if (summaryRows.length > 0) {
      summary = parseSummarySheet(summaryRows);
    }
  } catch {
    // resilient
  }

  // ── Customers ────────────────────────────────────────────────────────────────
  let customers: TriangulationData["customers"] = {
    period: "", parties: [], subtotalGst: null, subtotalBanking: null, totalGst: null, totalBanking: null,
  };
  try {
    const custRows = getRows("Customers");
    if (custRows.length > 0) {
      customers = parsePartiesSheet(custRows, "GST Revenue");
    }
  } catch {
    // resilient
  }

  // ── Suppliers ────────────────────────────────────────────────────────────────
  let suppliers: TriangulationData["suppliers"] = {
    period: "", parties: [], subtotalGst: null, subtotalBanking: null,
  };
  try {
    const suppRows = getRows("Suppliers");
    if (suppRows.length > 0) {
      const parsed = parsePartiesSheet(suppRows, "GST Expenses");
      suppliers = {
        period:          parsed.period,
        parties:         parsed.parties,
        subtotalGst:     parsed.subtotalGst,
        subtotalBanking: parsed.subtotalBanking,
      };
    }
  } catch {
    // resilient
  }

  // ── Related Party & Circular Txn ─────────────────────────────────────────────
  let circularParties: TriangulationCircularParty[] = [];
  let hasRelatedPartyData = false;
  try {
    const relRows = getRows("Related Party");
    if (relRows.length > 0) {
      const parsed = parseRelatedPartySheet(relRows);
      circularParties    = parsed.circularParties;
      hasRelatedPartyData = parsed.hasRelatedPartyData;
    }
  } catch {
    // resilient
  }

  // ── Loan Mapping ──────────────────────────────────────────────────────────────
  let hasLoanMappingData = false;
  try {
    const loanRows = getRows("Loan mapping");
    if (loanRows.length > 0) {
      hasLoanMappingData = checkLoanMappingSheet(loanRows);
    }
  } catch {
    // resilient
  }

  return {
    sourceDates,
    profileDetails,
    bankingInfo,
    summary,
    customers,
    suppliers,
    circularParties,
    hasRelatedPartyData,
    hasLoanMappingData,
  };
}

// ── Filename-based detection ──────────────────────────────────────────────────

export function isTriangulationExcel(file: File): boolean {
  return file.name.toLowerCase().includes("triangulation");
}
