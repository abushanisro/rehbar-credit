// Parses Accumn/Corpository "Advanced Excel" financial statements
// Handles Balance Sheet, Profit & Loss, Cash Flow sheets

export interface FinLineItem {
  label: string;
  value: number | null;
  confidence: number;
  reviewed: boolean;
  override_value: number | null;
  note: string;
  is_section?: boolean;
  indent?: number;
  sort_order?: number;
}

export type FinancialFormat = "corpository" | "simple";

export interface ParsedFinancialStatement {
  stmt_type: "balance_sheet" | "profit_loss" | "cash_flow";
  unit: string;
  format: FinancialFormat;
  fiscal_years: number[];
  line_items_by_fy: Record<number, FinLineItem[]>;
}

function parseFiscalYear(raw: string): number | null {
  const s = String(raw ?? "").trim();
  // "2020-2021" → 2021
  const m1 = s.match(/(\d{4})-(\d{4})/);
  if (m1) return parseInt(m1[2]);
  // "2023-24" → 2024
  const m2 = s.match(/(\d{4})-(\d{2})$/);
  if (m2) return parseInt(m2[1].slice(0, 2) + m2[2]);
  // "FY2024" or standalone "2024"
  const m3 = s.match(/\d{4}/);
  if (m3) return parseInt(m3[0]);
  return null;
}

function detectStmtType(text: string): "balance_sheet" | "profit_loss" | "cash_flow" | null {
  const t = text.toLowerCase();
  if (t.includes("balance")) return "balance_sheet";
  if (t.includes("profit") || t.includes("p&l") || t.includes("income") || t.includes("loss account")) return "profit_loss";
  if (t.includes("cash flow") || t.includes("cash flows")) return "cash_flow";
  return null;
}

export async function parseFinancialExcel(file: File): Promise<ParsedFinancialStatement[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const results: ParsedFinancialStatement[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as string[][];

    // Detect statement type from first 15 rows
    let stmtType: "balance_sheet" | "profit_loss" | "cash_flow" | null = null;
    let unit = "INR";

    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const line = rows[i].map(c => String(c ?? "").trim()).join(" ");
      if (!stmtType) stmtType = detectStmtType(line);
      const lo = line.toLowerCase();
      if (lo.includes("crore")) unit = "Crores";
      else if (lo.includes("lakh")) unit = "Lakhs";
    }
    if (!stmtType) stmtType = detectStmtType(sheetName);
    if (!stmtType) continue;

    // Find header row: first cell = "PARTICULARS" (case-insensitive)
    let headerIdx = -1;
    let headerRow: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i].map(c => String(c ?? "").trim());
      if (row[0]?.toUpperCase() === "PARTICULARS") {
        headerIdx = i;
        headerRow = row;
        break;
      }
    }
    if (headerIdx === -1) continue;

    // Extract fiscal year columns
    const fyColumns: { col: number; fy: number }[] = [];
    for (let c = 1; c < headerRow.length; c++) {
      const fy = parseFiscalYear(headerRow[c]);
      if (fy && fy > 1990 && fy < 2100) fyColumns.push({ col: c, fy });
    }
    if (fyColumns.length === 0) continue;

    // Sort ascending by fiscal year
    fyColumns.sort((a, b) => a.fy - b.fy);
    const fiscal_years = fyColumns.map(f => f.fy);

    // Parse data rows
    interface RawRow { label: string; values: Record<number, number | null>; is_section: boolean; sort_order: number }
    const allRows: RawRow[] = [];

    for (let ri = headerIdx + 1; ri < rows.length; ri++) {
      const row = rows[ri].map(c => String(c ?? "").trim());
      const label = row[0];
      if (!label || label.length > 120) continue; // skip blank + footnotes

      const valueStrings = fyColumns.map(({ col }) => row[col] ?? "");
      const allEmpty = valueStrings.every(v => v === "" || v === "-" || v === "--" || v === "N/A");

      const values: Record<number, number | null> = {};
      for (const { col, fy } of fyColumns) {
        const raw = (row[col] ?? "").replace(/,/g, "").trim();
        if (!raw || raw === "-" || raw === "--" || raw === "N/A") {
          values[fy] = null;
        } else {
          const n = parseFloat(raw);
          values[fy] = isNaN(n) ? null : n;
        }
      }

      allRows.push({ label, values, is_section: allEmpty, sort_order: allRows.length });
    }

    if (allRows.length === 0) continue;

    // Detect Corpository format by presence of known section header rows
    const CORP_HEADERS = new Set([
      "SHAREHOLDERS FUND", "NON CURRENT LIABILITIES", "CURRENT LIABILITIES",
      "FIXED ASSET", "NON CURRENT ASSETS", "CURRENT ASSETS",
    ]);
    const corpHeaderCount = allRows.filter(r => CORP_HEADERS.has(r.label.toUpperCase())).length;
    const format: FinancialFormat = corpHeaderCount >= 2 ? "corpository" : "simple";

    // Build line_items_by_fy
    const line_items_by_fy: Record<number, FinLineItem[]> = {};
    for (const fy of fiscal_years) {
      line_items_by_fy[fy] = allRows.map(r => ({
        label: r.label,
        value: r.values[fy] ?? null,
        confidence: 100,
        reviewed: true,
        override_value: null,
        note: "excel-import",
        is_section: r.is_section || false,
        indent: 0,
        sort_order: r.sort_order,
      }));
    }

    // Avoid duplicate stmt_type — merge if already found
    const existing = results.find(r => r.stmt_type === stmtType);
    if (existing) {
      // Merge: add any new fiscal years
      for (const fy of fiscal_years) {
        if (!existing.fiscal_years.includes(fy)) {
          existing.fiscal_years.push(fy);
          existing.line_items_by_fy[fy] = line_items_by_fy[fy];
        }
      }
      existing.fiscal_years.sort((a, b) => a - b);
    } else {
      results.push({ stmt_type: stmtType, unit, format, fiscal_years, line_items_by_fy });
    }
  }

  return results;
}
