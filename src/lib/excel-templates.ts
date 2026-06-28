// Excel template generator for all upload tabs.
// Uses the xlsx library to produce correctly-structured workbooks.

const HEADER_FILL = { fgColor: { rgb: "0F1B2D" } };
const HEADER_FONT = { bold: true, color: { rgb: "C4A04A" }, sz: 10 };
const SUBHEADER_FILL = { fgColor: { rgb: "162236" } };
const SUBHEADER_FONT = { bold: true, color: { rgb: "FAFAF6" }, sz: 9 };
const SECTION_FILL = { fgColor: { rgb: "D4C9B0" } };
const SECTION_FONT = { bold: true, color: { rgb: "0F1B2D" }, sz: 9 };
const LABEL_FONT = { color: { rgb: "1C1C1E" }, sz: 9 };
const MUTED_FONT = { color: { rgb: "6B6152" }, sz: 8, italic: true };
const BORDER: Record<string, { style: string }> = {
  top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" },
};

function styleCell(
  ws: Record<string, unknown>,
  addr: string,
  value: unknown,
  style: Record<string, unknown>,
) {
  ws[addr] = { v: value, t: typeof value === "number" ? "n" : "s", s: style };
}

function hdr(ws: Record<string, unknown>, addr: string, v: string) {
  styleCell(ws, addr, v, { font: HEADER_FONT, fill: HEADER_FILL, border: BORDER, alignment: { horizontal: "center", vertical: "center", wrapText: true } });
}
function subHdr(ws: Record<string, unknown>, addr: string, v: string) {
  styleCell(ws, addr, v, { font: SUBHEADER_FONT, fill: SUBHEADER_FILL, border: BORDER, alignment: { horizontal: "left" } });
}
function sec(ws: Record<string, unknown>, addr: string, v: string) {
  styleCell(ws, addr, v, { font: SECTION_FONT, fill: SECTION_FILL, border: BORDER });
}
function lbl(ws: Record<string, unknown>, addr: string, v: string) {
  styleCell(ws, addr, v, { font: LABEL_FONT, border: BORDER });
}
function num(ws: Record<string, unknown>, addr: string, v: number | string = "") {
  styleCell(ws, addr, v, { font: LABEL_FONT, border: BORDER, alignment: { horizontal: "right" }, numFmt: "#,##0.00" });
}
function note(ws: Record<string, unknown>, addr: string, v: string) {
  styleCell(ws, addr, v, { font: MUTED_FONT, border: BORDER, alignment: { horizontal: "left", wrapText: true } });
}
function colWidth(ws: Record<string, unknown>, cols: number[]) {
  ws["!cols"] = cols.map(w => ({ wch: w }));
}
function mergeRange(ws: Record<string, unknown>, ranges: string[]) {
  const XLSX_utils = { decode_range: (s: string) => { const [s1, e1] = s.split(":"); const c = (a: string) => { const m = a.match(/([A-Z]+)(\d+)/); const col = m![1].split("").reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1; return { c: col, r: parseInt(m![2]) - 1 }; }; return { s: c(s1), e: c(e1) }; } };
  ws["!merges"] = (ws["!merges"] as unknown[] || []).concat(ranges.map(r => XLSX_utils.decode_range(r)));
}

// ─── Column letter helper ─────────────────────────────────────────────────────
function col(n: number): string {
  let s = "";
  for (let i = n; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(65 + (i % 26)) + s;
  return s;
}
function addr(c: number, r: number) { return `${col(c)}${r + 1}`; }

// ─── PROVISIONAL / MIS TEMPLATE ──────────────────────────────────────────────
// Designed for AI-assisted extraction: upload this template + a PDF to Claude,
// Claude fills in the value columns. Then upload the filled file to Rehbar.
export async function buildProvisionalTemplate(): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");

  const FY_COLS = ["FY2024 (Prov)", "FY2025 (Prov)", "FY2026 (Prov)"];
  const N = FY_COLS.length;

  const COMPUTED_FILL = { fgColor: { rgb: "E8F4F0" } };
  const COMPUTED_FONT = { color: { rgb: "1B6449" }, sz: 9, italic: true };
  const INPUT_INDENT_FONT = { color: { rgb: "1C1C1E" }, sz: 9 };
  const ALIAS_FONT = { color: { rgb: "8B7355" }, sz: 8, italic: true };

  function pComputed(ws: Record<string, unknown>, a: string, v: string) {
    styleCell(ws, a, v, { font: COMPUTED_FONT, fill: COMPUTED_FILL, border: BORDER, alignment: { horizontal: "left" } });
  }
  function pComputedNum(ws: Record<string, unknown>, a: string) {
    styleCell(ws, a, "", { font: COMPUTED_FONT, fill: COMPUTED_FILL, border: BORDER, alignment: { horizontal: "right" }, numFmt: "#,##0.00" });
  }
  function pIndent(ws: Record<string, unknown>, a: string, v: string) {
    styleCell(ws, a, v, { font: INPUT_INDENT_FONT, border: BORDER, alignment: { indentLevel: 1 } });
  }
  function aliasCell(ws: Record<string, unknown>, a: string, v: string) {
    styleCell(ws, a, v, { font: ALIAS_FONT, border: BORDER, alignment: { horizontal: "left", wrapText: true } });
  }

  // [label, type, aliases]
  // label: must exactly match PL_LABELS / BS_LABELS / CF_LABELS in ProvisionalTab.tsx
  // aliases: shown in the last column to guide Claude when reading PDFs
  type RowDef = [string, "section" | "input" | "input_indent" | "computed", string?];

  const ALIAS_COL = N + 1; // column index for the aliases column

  function makeSheet(sheetTitle: string, rowDefs: RowDef[]) {
    const ws: Record<string, unknown> = {};

    hdr(ws, "A1", sheetTitle);
    for (let i = 0; i < N; i++) hdr(ws, `${col(i + 1)}1`, FY_COLS[i]);
    hdr(ws, `${col(ALIAS_COL)}1`, "ALIASES (for reference only — do not edit)");

    note(ws, "A2", "CLAUDE INSTRUCTIONS: Fill each value column with numbers in ₹ Lakhs from the PDF. Use the ALIASES column to match line items. Leave COMPUTED rows blank — they are auto-derived. Do NOT rename column A labels.");
    mergeRange(ws, [`A2:${col(ALIAS_COL)}2`]);

    subHdr(ws, "A3", "PARTICULARS");
    for (let i = 0; i < N; i++) subHdr(ws, `${col(i + 1)}3`, FY_COLS[i]);
    subHdr(ws, `${col(ALIAS_COL)}3`, "Aliases / Also known as");

    let r = 3;
    for (const [label, type, aliases] of rowDefs) {
      const er = r + 1;
      if (type === "section") {
        sec(ws, `A${er}`, label);
        for (let i = 0; i < N; i++) sec(ws, `${col(i + 1)}${er}`, "");
        sec(ws, `${col(ALIAS_COL)}${er}`, "");
      } else if (type === "computed") {
        pComputed(ws, `A${er}`, label);
        for (let i = 0; i < N; i++) pComputedNum(ws, `${col(i + 1)}${er}`);
        aliasCell(ws, `${col(ALIAS_COL)}${er}`, aliases ?? "auto-computed — leave blank");
      } else if (type === "input_indent") {
        pIndent(ws, `A${er}`, label);
        for (let i = 0; i < N; i++) num(ws, `${col(i + 1)}${er}`);
        aliasCell(ws, `${col(ALIAS_COL)}${er}`, aliases ?? "");
      } else {
        lbl(ws, `A${er}`, label);
        for (let i = 0; i < N; i++) num(ws, `${col(i + 1)}${er}`);
        aliasCell(ws, `${col(ALIAS_COL)}${er}`, aliases ?? "");
      }
      r++;
    }

    ws["!ref"] = `A1:${col(ALIAS_COL)}${r + 1}`;
    colWidth(ws, [34, ...Array(N).fill(16), 52]);
    return ws;
  }

  const plRows: RowDef[] = [
    ["INCOME",                 "section"],
    ["Turnover",               "input",        "Revenue from Operations · Net Sales · Total Revenue · Gross Sales · Total Income from Operations"],
    ["COST OF GOODS SOLD",     "section"],
    ["Cost of Goods Sold",     "input_indent", "Cost of Materials Consumed · Purchases of Stock-in-Trade · Cost of Production · Direct Costs · COGS"],
    ["Gross Profit",           "computed",     "Turnover − Cost of Goods Sold"],
    ["OPERATING COSTS",        "section"],
    ["Operating Expenses",     "input_indent", "Total Expenses · Indirect Expenses · Other Operating Expenses · Total Expenditure (excl. Finance Costs & Dep)"],
    ["EBITDA",                 "computed",     "Gross Profit − Operating Expenses  (or EBITDA stated directly in the PDF)"],
    ["DEPRECIATION & FINANCE", "section"],
    ["Depreciation",           "input_indent", "Depreciation & Amortisation · D&A · Depreciation, Depletion and Amortization"],
    ["EBIT",                   "computed",     "EBITDA − Depreciation"],
    ["Interest Expense",       "input_indent", "Finance Costs · Finance Charges · Interest & Finance Charges · Borrowing Costs"],
    ["Profit Before Tax",      "computed",     "EBIT − Interest Expense  (or PBT / Profit before Tax stated in PDF)"],
    ["TAX",                    "section"],
    ["Tax",                    "input_indent", "Tax Expense · Current Tax + Deferred Tax · Provision for Tax"],
    ["PAT",                    "computed",     "Profit Before Tax − Tax  (or Net Profit / Profit for the Year in PDF)"],
  ];

  const bsRows: RowDef[] = [
    ["EQUITY & LIABILITIES",      "section"],
    ["Share Capital",             "input_indent", "Paid-up Capital · Equity Share Capital"],
    ["Reserves & Surplus",        "input_indent", "Reserves and Surplus · Other Equity · Retained Earnings · Free Reserves"],
    ["Net Worth",                 "computed",     "Share Capital + Reserves & Surplus  (or Shareholders Funds / Total Equity)"],
    ["BORROWINGS",                "section"],
    ["Long Term Borrowings",      "input_indent", "Non-Current Borrowings · Term Loans (Long Term) · Secured/Unsecured Long-Term Loans"],
    ["Short Term Borrowings",     "input_indent", "Current Borrowings · CC / OD / Working Capital Loans · Current Maturities of Long-Term Debt"],
    ["Total Debt",                "computed",     "Long Term Borrowings + Short Term Borrowings"],
    ["CURRENT LIABILITIES",       "section"],
    ["Trade Payables",            "input_indent", "Creditors · Sundry Creditors · Accounts Payable"],
    ["Other Current Liabilities", "input_indent", "Other Current Liabilities & Provisions · Short-term Provisions"],
    ["Current Liabilities",       "computed",     "Trade Payables + Other Current Liabilities"],
    ["Total Liabilities",         "computed",     "Net Worth + Total Debt + Current Liabilities"],
    ["ASSETS",                    "section"],
    ["Fixed Assets (Net)",        "input",        "Net Block · Net Fixed Assets · Property Plant & Equipment (Net) · Tangible Assets (Net)"],
    ["CURRENT ASSETS",            "section"],
    ["Inventory",                 "input_indent", "Inventories · Stock · Raw Material + WIP + Finished Goods"],
    ["Trade Receivables",         "input_indent", "Debtors · Sundry Debtors · Accounts Receivable"],
    ["Cash & Bank",               "input_indent", "Cash & Cash Equivalents · Cash and Bank Balances"],
    ["Other Current Assets",      "input_indent", "Short-term Loans & Advances · Other Current Assets · Prepaid Expenses"],
    ["Current Assets",            "computed",     "Inventory + Trade Receivables + Cash & Bank + Other Current Assets"],
    ["Total Assets",              "computed",     "Fixed Assets (Net) + Current Assets  (should equal Total Liabilities)"],
  ];

  const cfRows: RowDef[] = [
    ["OPERATING ACTIVITIES",  "section"],
    ["Cash from Operations",  "input",   "Net Cash from / (used in) Operating Activities · Operating Cash Flow"],
    ["INVESTING ACTIVITIES",  "section"],
    ["Cash from Investing",   "input",   "Net Cash from / (used in) Investing Activities"],
    ["FINANCING ACTIVITIES",  "section"],
    ["Cash from Financing",   "input",   "Net Cash from / (used in) Financing Activities"],
    ["SUMMARY",               "section"],
    ["Net Change in Cash",    "computed","Cash from Operations + Cash from Investing + Cash from Financing"],
    ["Opening Cash",          "input",   "Cash & Bank at beginning of period / year"],
    ["Closing Cash",          "computed","Opening Cash + Net Change in Cash  (should match Cash & Bank in Balance Sheet)"],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet("Profit & Loss (Provisional / MIS) · ₹ Lakhs", plRows) as never, "P&L");
  XLSX.utils.book_append_sheet(wb, makeSheet("Balance Sheet (Provisional) · ₹ Lakhs", bsRows) as never, "Balance Sheet");
  XLSX.utils.book_append_sheet(wb, makeSheet("Cash Flow (Provisional) · ₹ Lakhs", cfRows) as never, "Cash Flow");

  // ── Claude Prompt sheet ───────────────────────────────────────────────────────
  const prompt: Record<string, unknown> = {};
  const promptRows: [string, string][] = [
    ["INSTRUCTIONS FOR CLAUDE", ""],
    ["", ""],
    ["TASK",        "You have been given a financial PDF and this Excel template. Extract financial data from the PDF and fill in the value columns (B, C, D) on the P&L, Balance Sheet, and Cash Flow sheets."],
    ["UNIT",        "All values must be in ₹ Lakhs. If the PDF uses Crores, multiply by 100. If INR (absolute), divide by 1,00,000. If Thousands, divide by 100."],
    ["COLUMNS",     "Column B = earliest year, Column C = middle year, Column D = latest year. Rename the column headers to match the actual fiscal years in the PDF (e.g. FY2025 (Prov))."],
    ["LABELS",      "Do NOT change the text in Column A. Match each PDF line item to the nearest row using the ALIASES column as a guide."],
    ["COMPUTED",    "Leave teal (COMPUTED) rows blank — the system derives them automatically. You may fill them if you want to verify."],
    ["SECTIONS",    "Dark-gold section header rows (e.g. INCOME, ASSETS) must remain blank in the value columns."],
    ["MISSING",     "If a line item is not present in the PDF, leave the cell blank. Do not put 0 unless the PDF explicitly shows 0."],
    ["SIGN",        "Use positive numbers for all items except: Cash from Investing and Cash from Financing may be negative if net outflow."],
    ["PERIOD",      "If the PDF covers a partial period (e.g. Q1, H1, 9M), fill in that period's actuals as-is — do NOT annualize."],
    ["OUTPUT",      "Return the filled Excel file. Do not add extra rows, sheets, or change column A labels."],
  ];
  promptRows.forEach(([k, v], i) => {
    if (i === 0) { hdr(prompt, `A${i + 1}`, k); lbl(prompt, `B${i + 1}`, v); }
    else { subHdr(prompt, `A${i + 1}`, k); lbl(prompt, `B${i + 1}`, v); }
  });
  prompt["!ref"] = `A1:B${promptRows.length}`;
  prompt["!cols"] = [{ wch: 16 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, prompt as never, "Claude Instructions");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  return buf as ArrayBuffer;
}

// ─── PROJECTIONS TEMPLATE ─────────────────────────────────────────────────────
export async function buildProjectionsTemplate(): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");

  const FY_COLS = ["FY2025 (Base)", "FY2026 (Proj)", "FY2027 (Proj)", "FY2028 (Proj)", "FY2029 (Proj)"];
  const N = FY_COLS.length;
  const ALIAS_COL = N + 1; // column G

  const COMPUTED_FILL = { fgColor: { rgb: "E8F4F0" } };
  const COMPUTED_FONT = { color: { rgb: "1B6449" }, sz: 9, italic: true };
  const ALIAS_FONT = { color: { rgb: "8B7355" }, sz: 8, italic: true };

  function pComputed(ws: Record<string, unknown>, a: string, v: string) {
    styleCell(ws, a, v, { font: COMPUTED_FONT, fill: COMPUTED_FILL, border: BORDER, alignment: { horizontal: "left" } });
  }
  function pComputedNum(ws: Record<string, unknown>, a: string) {
    styleCell(ws, a, "", { font: COMPUTED_FONT, fill: COMPUTED_FILL, border: BORDER, alignment: { horizontal: "right" }, numFmt: "#,##0.00" });
  }
  function aliasCell(ws: Record<string, unknown>, a: string, v: string) {
    styleCell(ws, a, v, { font: ALIAS_FONT, border: BORDER, alignment: { horizontal: "left", wrapText: true } });
  }

  // [label, type, aliases?]
  type RowDef = [string, "section" | "input" | "input_indent" | "computed", string?];

  function makeProjSheet(title: string, rowDefs: RowDef[]) {
    const ws: Record<string, unknown> = {};
    hdr(ws, "A1", title);
    for (let i = 0; i < N; i++) hdr(ws, `${col(i + 1)}1`, FY_COLS[i]);
    hdr(ws, `${col(ALIAS_COL)}1`, "ALIASES (reference only — do not edit)");

    note(ws, "A2", "CLAUDE: FY2025 = audited base year actuals. FY2026–FY2029 = projections from the PDF/CMA. Fill all columns in ₹ Lakhs. Use ALIASES to match PDF labels. Leave COMPUTED rows blank.");
    mergeRange(ws, [`A2:${col(ALIAS_COL)}2`]);

    subHdr(ws, "A3", "PARTICULARS");
    for (let i = 0; i < N; i++) subHdr(ws, `${col(i + 1)}3`, FY_COLS[i]);
    subHdr(ws, `${col(ALIAS_COL)}3`, "Aliases / Also known as");

    let r = 3;
    for (const [label, type, aliases] of rowDefs) {
      const er = r + 1;
      if (type === "section") {
        sec(ws, `A${er}`, label);
        for (let i = 0; i < N; i++) sec(ws, `${col(i + 1)}${er}`, "");
        sec(ws, `${col(ALIAS_COL)}${er}`, "");
      } else if (type === "computed") {
        pComputed(ws, `A${er}`, label);
        for (let i = 0; i < N; i++) pComputedNum(ws, `${col(i + 1)}${er}`);
        aliasCell(ws, `${col(ALIAS_COL)}${er}`, aliases ?? "auto-computed — leave blank");
      } else if (type === "input_indent") {
        styleCell(ws, `A${er}`, label, { font: { color: { rgb: "1C1C1E" }, sz: 9 }, border: BORDER, alignment: { indentLevel: 1 } });
        for (let i = 0; i < N; i++) num(ws, `${col(i + 1)}${er}`);
        aliasCell(ws, `${col(ALIAS_COL)}${er}`, aliases ?? "");
      } else {
        lbl(ws, `A${er}`, label);
        for (let i = 0; i < N; i++) num(ws, `${col(i + 1)}${er}`);
        aliasCell(ws, `${col(ALIAS_COL)}${er}`, aliases ?? "");
      }
      r++;
    }
    ws["!ref"] = `A1:${col(ALIAS_COL)}${r + 1}`;
    colWidth(ws, [36, ...Array(N).fill(16), 52]);
    return ws;
  }

  const plRows: RowDef[] = [
    ["INCOME",                     "section"],
    ["Revenue from Operations",    "input",        "Projected Turnover · Projected Net Sales · Projected Revenue · Forecasted Revenue from Operations"],
    ["Other Income",               "input_indent", "Projected Other Income · Non-operating income (projected)"],
    ["Total Income",               "computed",     "auto-derived"],
    ["COST OF GOODS SOLD",         "section"],
    ["Cost of Materials / Purchases", "input_indent", "Projected COGS · Projected Material Cost · Projected Purchases · Projected Direct Costs"],
    ["Gross Profit",               "computed",     "auto-derived"],
    ["INDIRECT EXPENSES",          "section"],
    ["Employee Benefits Expense",  "input_indent", "Projected Staff Costs · Projected Salaries & Wages · Projected Personnel Expenses"],
    ["Finance Costs",              "input_indent", "Projected Interest · Projected Finance Charges · Projected Borrowing Costs"],
    ["Depreciation & Amortisation","input_indent", "Projected D&A · Projected Depreciation"],
    ["Other Expenses",             "input_indent", "Projected Operating Expenses · Projected Admin + Selling + Overhead"],
    ["Total Indirect Expenses",    "computed",     "auto-derived"],
    ["PROFITABILITY",              "section"],
    ["Net Profit Before Tax",      "input",        "Projected PBT · Projected Profit Before Tax — fill if stated directly, else leave blank"],
    ["Provision for Income Tax",   "input_indent", "Projected Tax · Projected Income Tax Provision"],
    ["Net Profit After Tax (PAT)", "input",        "Projected PAT · Projected Net Profit · Projected Profit After Tax — fill if stated directly"],
    ["EBITDA (calc)",              "computed",     "auto-derived from Gross Profit − Indirect Expenses + D&A + Finance Costs"],
  ];

  const bsRows: RowDef[] = [
    ["EQUITY & LIABILITIES",       "section"],
    ["Share Capital",              "input_indent", "Projected Paid-up Capital · Equity Share Capital (projected)"],
    ["Reserves & Surplus",         "input_indent", "Projected Retained Earnings · Projected Other Equity · Projected Net Worth excl. share capital"],
    ["Net Worth",                  "computed",     "auto-derived (Share Capital + Reserves & Surplus)"],
    ["Long Term Borrowings",       "input_indent", "Projected LT Debt · Projected Term Loans · Projected Non-current Borrowings"],
    ["Short Term Borrowings",      "input_indent", "Projected CC / OD · Projected Working Capital Loans · Projected Short-term Debt"],
    ["Trade Payables",             "input_indent", "Projected Creditors · Projected Accounts Payable"],
    ["Other Current Liabilities",  "input_indent", "Projected Other CL · Projected Statutory Dues + Advances"],
    ["Current Liabilities",        "computed",     "auto-derived"],
    ["Total Equity & Liabilities", "computed",     "auto-derived (must equal Total Assets)"],
    ["ASSETS",                     "section"],
    ["Fixed Assets (Net Block)",   "input",        "Projected Net Block · Projected PPE (Net) · Projected Net Fixed Assets"],
    ["CWIP",                       "input_indent", "Projected Capital Work in Progress · Projected Capex under construction"],
    ["Inventory",                  "input_indent", "Projected Inventories · Projected Stock"],
    ["Trade Receivables",          "input_indent", "Projected Debtors · Projected Accounts Receivable"],
    ["Cash & Bank",                "input_indent", "Projected Cash Position · Projected Cash & Bank Balances"],
    ["Other Current Assets",       "input_indent", "Projected Other CA · Projected Advance + Prepaid"],
    ["Current Assets",             "computed",     "auto-derived"],
    ["Total Assets",               "computed",     "auto-derived (must equal Total Equity & Liabilities)"],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeProjSheet("Projected P&L · ₹ Lakhs", plRows) as never, "Projected P&L");
  XLSX.utils.book_append_sheet(wb, makeProjSheet("Projected Balance Sheet · ₹ Lakhs", bsRows) as never, "Projected Balance Sheet");

  // Assumptions sheet
  const asmp: Record<string, unknown> = {};
  const asmpRows = [
    ["PROJECTION ASSUMPTIONS", "FY2026", "FY2027", "FY2028", "FY2029"],
    ["Revenue Growth (%)", "", "", "", ""],
    ["EBITDA Margin (%)", "", "", "", ""],
    ["PAT Margin (%)", "", "", "", ""],
    ["Capex (₹ Lakhs)", "", "", "", ""],
    ["Long-Term Debt Repayment (₹ Lakhs)", "", "", "", ""],
    ["New Borrowings (₹ Lakhs)", "", "", "", ""],
    ["Dividend Payout (%)", "", "", "", ""],
    ["Key Assumption Narrative", "", "", "", ""],
  ];
  asmpRows.forEach(([label, ...vals], i) => {
    if (i === 0) {
      hdr(asmp, "A1", label as string);
      vals.forEach((v, j) => hdr(asmp, `${col(j + 1)}1`, v as string));
    } else {
      lbl(asmp, `A${i + 1}`, label as string);
      vals.forEach((_, j) => num(asmp, `${col(j + 1)}${i + 1}`));
    }
  });
  asmp["!ref"] = `A1:E${asmpRows.length}`;
  asmp["!cols"] = [{ wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, asmp as never, "Assumptions");

  // ── Claude Prompt sheet ────────────────────────────────────────────────────
  const claudeSheet: Record<string, unknown> = {};
  const claudeRows: [string, string][] = [
    ["INSTRUCTIONS FOR CLAUDE", ""],
    ["", ""],
    ["TASK",        "You have been given a financial projections PDF (CMA data / projected financials) and this Excel template. Extract the projected financial data and fill in the value columns on the Projected P&L and Projected Balance Sheet sheets."],
    ["UNIT",        "All values must be in ₹ Lakhs. If the PDF uses Crores, multiply by 100. If absolute INR, divide by 1,00,000. If Thousands, divide by 100."],
    ["COLUMNS",     "Column B (FY2025 Base) = latest audited actuals. Columns C–F = projection years. Rename column headers to match the PDF years exactly."],
    ["LABELS",      "Do NOT change any text in Column A. Use the ALIASES column (last column) to match PDF line items to the correct template row."],
    ["COMPUTED",    "Teal rows are auto-derived by the system — leave them blank. Fill them only if the PDF states the total explicitly and you want to cross-check."],
    ["SECTIONS",    "Dark-gold section header rows (e.g. INCOME, ASSETS) must remain blank in the value columns."],
    ["MISSING",     "If a projected item is not in the PDF, leave blank. Do not write 0 unless the PDF explicitly shows zero."],
    ["ASSUMPTIONS", "Fill the Assumptions sheet with the key drivers (revenue growth %, EBITDA margin %, capex, debt movement) as stated in the PDF."],
    ["OUTPUT",      "Return only the filled Excel file. Do not add extra rows, columns, or sheets, and do not change any Column A labels."],
  ];
  claudeRows.forEach(([k, v], i) => {
    if (i === 0) { hdr(claudeSheet, `A${i + 1}`, k); lbl(claudeSheet, `B${i + 1}`, v); }
    else { subHdr(claudeSheet, `A${i + 1}`, k); lbl(claudeSheet, `B${i + 1}`, v); }
  });
  claudeSheet["!ref"] = `A1:B${claudeRows.length}`;
  claudeSheet["!cols"] = [{ wch: 16 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, claudeSheet as never, "Claude Instructions");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  return buf as ArrayBuffer;
}

// ─── BSA (BANK STATEMENT ANALYSIS) TEMPLATE ──────────────────────────────────
export async function buildBsaTemplate(): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  // ── Exec Summary ─────────────────────────────────────────────────────────────
  const exec: Record<string, unknown> = {};
  const execMeta = [
    ["", "Account Number: XXXXXXXXXX, BANK NAME"],
    ["", ""],
    ["", ""],
    ["Particulars", "Account 1"],
    ["Type of Account", "Current Account"],
    ["Period of Analysis", "Apr-2024 to Mar-2025"],
    ["Statement uploaded for no. of months", 12],
    ["Total value of net credits of period of analysis", ""],
    ["Total value of net debits of period of analysis", ""],
    ["ABB of period of analysis", ""],
    ["Total number of cheque/EMI bounces", ""],
    ["Penal interest/charges", ""],
    ["Irregularity indicators", ""],
  ];
  execMeta.forEach(([k, v], i) => {
    if (i === 3) {
      hdr(exec, `A${i + 1}`, k as string);
      hdr(exec, `B${i + 1}`, v as string);
    } else {
      lbl(exec, `A${i + 1}`, k as string);
      typeof v === "number" ? num(exec, `B${i + 1}`, v) : lbl(exec, `B${i + 1}`, v as string);
    }
  });
  exec["!ref"] = `A1:B${execMeta.length}`;
  exec["!cols"] = [{ wch: 50 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, exec as never, "Exec Summary");

  // ── MoM Summary ──────────────────────────────────────────────────────────────
  const mom: Record<string, unknown> = {};
  const months = ["Apr-24", "May-24", "Jun-24", "Jul-24", "Aug-24", "Sep-24", "Oct-24", "Nov-24", "Dec-24", "Jan-25", "Feb-25", "Mar-25"];
  const momHdr = ["", "", "", "", "", "Particulars", ...months];
  momHdr.forEach((v, i) => {
    if (i === 5) subHdr(mom, `A6`, v);
    else if (i > 5) subHdr(mom, `${col(i - 5)}6`, v);
  });
  ["Average EOD Balance", "Min EOD Balance", "Max EOD Balance"].forEach((label, ri) => {
    lbl(mom, `A${7 + ri}`, label);
    months.forEach((_, ci) => num(mom, `${col(ci + 1)}${7 + ri}`));
  });
  mom["!ref"] = `A1:M10`;
  mom["!cols"] = [{ wch: 28 }, ...months.map(() => ({ wch: 13 }))];
  XLSX.utils.book_append_sheet(wb, mom as never, "MoM Summary");

  // ── CAM Analysis ─────────────────────────────────────────────────────────────
  const cam: Record<string, unknown> = {};
  const camHdr = ["Month-Year", "Credit Count", "Credit Amount", "Debit Count", "Debit Amount", "Inward Bounce Count", "Inward Bounce Amount"];
  camHdr.forEach((h, i) => hdr(cam, `${col(i)}1`, h));
  months.forEach((m, ri) => {
    lbl(cam, `A${ri + 2}`, m);
    for (let ci = 1; ci < camHdr.length; ci++) num(cam, `${col(ci)}${ri + 2}`);
  });
  cam["!ref"] = `A1:G${months.length + 1}`;
  cam["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, cam as never, "CAM Analysis");

  // ── Trade Credits ─────────────────────────────────────────────────────────────
  const trCr: Record<string, unknown> = {};
  const trHdr = ["Ranking", "TRANSFER From", "AMOUNT", "% of Total", "MONTHLY AVG", "NO. OF MONTHS", "AVG PER COUNT", "COUNT"];
  ["", "", "", "", "", trHdr[0], ...trHdr.slice(1)].forEach((h, i) => {
    if (i >= 5) hdr(trCr, `${col(i - 5)}6`, h);
  });
  for (let r = 1; r <= 20; r++) {
    lbl(trCr, `A${6 + r}`, String(r));
    for (let c = 1; c < trHdr.length; c++) num(trCr, `${col(c)}${6 + r}`);
  }
  trCr["!ref"] = `A1:H26`;
  trCr["!cols"] = [{ wch: 10 }, { wch: 40 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, trCr as never, "Trade Credits");

  // ── Trade Debits (same structure) ────────────────────────────────────────────
  const trDb: Record<string, unknown> = {};
  const trDbHdr = ["Ranking", "TRANSFER To", "AMOUNT", "% of Total", "MONTHLY AVG", "NO. OF MONTHS", "AVG PER COUNT", "COUNT"];
  ["", "", "", "", "", trDbHdr[0], ...trDbHdr.slice(1)].forEach((h, i) => {
    if (i >= 5) hdr(trDb, `${col(i - 5)}6`, h);
  });
  for (let r = 1; r <= 20; r++) {
    lbl(trDb, `A${6 + r}`, String(r));
    for (let c = 1; c < trDbHdr.length; c++) num(trDb, `${col(c)}${6 + r}`);
  }
  trDb["!ref"] = `A1:H26`;
  trDb["!cols"] = trCr["!cols"] as never;
  XLSX.utils.book_append_sheet(wb, trDb as never, "Trade Debits");

  // ── Flags ─────────────────────────────────────────────────────────────────────
  const flags: Record<string, unknown> = {};
  ["", "", "", "", "", "S.N.", "Category", "Flag", "Description"].forEach((h, i) => {
    if (i >= 5) { i === 5 ? hdr(flags, "A6", h) : hdr(flags, `${col(i - 5)}6`, h); }
  });
  flags["!ref"] = "A1:D6";
  flags["!cols"] = [{ wch: 8 }, { wch: 20 }, { wch: 30 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, flags as never, "Flags");

  // ── Irregularity Indicators ───────────────────────────────────────────────────
  const irreg: Record<string, unknown> = {};
  ["", "", "", "", "", "S.N.", "Indicator", "Description", "Identified (Y/N)", "Triggers"].forEach((h, i) => {
    if (i >= 5) { i === 5 ? hdr(irreg, "A6", h) : hdr(irreg, `${col(i - 5)}6`, h); }
  });
  irreg["!ref"] = "A1:E6";
  irreg["!cols"] = [{ wch: 8 }, { wch: 30 }, { wch: 50 }, { wch: 16 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, irreg as never, "Irregularity Indicators");

  // ── Claude Instructions sheet ─────────────────────────────────────────────
  const claudeWs: Record<string, unknown> = {};
  const claudeRows: [string, string][] = [
    ["INSTRUCTIONS FOR CLAUDE", ""],
    ["", ""],
    ["TASK",           "You have been given bank statement documents (PDFs, images, or raw statements) and this Excel template. Extract the bank statement analysis data and fill in the template sheets."],
    ["EXEC SUMMARY",  "Row 1 = company name. Row 4 = account header 'Account Number: XXXX, BANK NAME' for each bank. Rows 5–17: fill values for Type of Account, Period of Analysis, months, Total Net Credits, Total Net Debits, ABB, Total Bounces, Penal Charges, Irregularity count. Consolidated total in col B, per-bank values in cols C, D… if multiple accounts."],
    ["MOM SUMMARY",   "Monthly columns (Apr-24, May-24 …). Rows 7–9: fill Average EOD Balance, Min EOD Balance, Max EOD Balance for each month."],
    ["CAM ANALYSIS",  "One row per month. Columns: Month-Year | Credit Count | Credit Amount | Debit Count | Debit Amount | Inward Bounce Count | Inward Bounce Amount. Month format: 'Apr-24'."],
    ["TRADE CREDITS", "Top counterparties sending money into the account. Columns: Ranking | TRANSFER From | AMOUNT | % of Total | MONTHLY AVG | NO. OF MONTHS | AVG PER COUNT | COUNT. Max 20 rows. Sort by amount descending."],
    ["TRADE DEBITS",  "Same structure as Trade Credits but for outgoing payments. Column header: 'TRANSFER To'."],
    ["FLAGS",         "Row 6 = header. Each flag: S.N. | Category (e.g. Irregularity, Concentration) | Flag name | Description. Only include flags that are actually present."],
    ["IRREGULARITY",  "Row 6 = header. Each indicator: S.N. | Indicator name | Description | Identified (Y/N) | Triggers (count). Fill all indicators from the statement."],
    ["AMOUNTS",       "All monetary values in absolute INR (e.g. 12,34,567). Do NOT convert to Lakhs. Use commas as thousands separator."],
    ["MONTHS",        "All month labels in 'Mon-YY' format — e.g. 'Apr-24', 'May-24', 'Mar-25'. Keep this format consistent across all sheets."],
    ["OUTPUT",        "Return only the completed Excel file. Do not add extra rows or sheets. Do not change any header labels."],
  ];
  claudeRows.forEach(([k, v], i) => {
    if (i === 0) { hdr(claudeWs, `A${i + 1}`, k); lbl(claudeWs, `B${i + 1}`, v); }
    else { subHdr(claudeWs, `A${i + 1}`, k); lbl(claudeWs, `B${i + 1}`, v); }
  });
  claudeWs["!ref"] = `A1:B${claudeRows.length}`;
  claudeWs["!cols"] = [{ wch: 16 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, claudeWs as never, "Claude Instructions");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  return buf as ArrayBuffer;
}

// ─── GST RETURNS TEMPLATE ─────────────────────────────────────────────────────
// Designed for AI-assisted extraction: give this template + GSTR-3B/GSTR-1 PDFs
// or portal screenshots to Claude. Claude fills Profile, GSTR-3B, and GSTR-1
// sheets. Upload the filled file to the GST tab in Rehbar.
export async function buildGstTemplate(): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const INPUT_FILL = { fgColor: { rgb: "FAFAF8" } };
  const HINT_FONT  = { color: { rgb: "9B8C6E" }, sz: 8, italic: true };

  function inp(ws: Record<string, unknown>, a: string) {
    styleCell(ws, a, "", { font: LABEL_FONT, fill: INPUT_FILL, border: BORDER, alignment: { horizontal: "left" } });
  }
  function hintCell(ws: Record<string, unknown>, a: string, v: string) {
    styleCell(ws, a, v, { font: HINT_FONT, border: BORDER, alignment: { horizontal: "left", wrapText: true } });
  }

  // ── Profile sheet ─────────────────────────────────────────────────────────
  const prof: Record<string, unknown> = {};

  sec(prof, "A1", "GST PROFILE");
  mergeRange(prof, ["A1:C1"]);
  note(prof, "A2", "CLAUDE INSTRUCTIONS: Fill Column B with values for each field in Column A. Leave blank if not available.");
  mergeRange(prof, ["A2:C2"]);
  subHdr(prof, "A3", "FIELD");
  subHdr(prof, "B3", "VALUE  ← fill here");
  subHdr(prof, "C3", "Hints");

  const profRows: [string, string][] = [
    ["GSTIN",                        "15-char GSTIN, e.g. 27AABCA1234H1Z5"],
    ["Legal Name of Business",       "Full legal name as on GST portal (ALL CAPS)"],
    ["Trade Name",                   "Trade/brand name if different from legal name"],
    ["PAN",                          "10-char PAN linked to GSTIN, e.g. AABCA1234H"],
    ["Constitution of Business",     "Pvt Ltd · Public Ltd · LLP · Proprietorship · Partnership · Individual"],
    ["State",                        "State of registration, e.g. Maharashtra · Tamil Nadu · Delhi"],
    ["Date of GST Registration",     "DD-MM-YYYY, e.g. 01-07-2017"],
    ["Nature of Core Business Activity", "e.g. Manufacturing · Trading · Services · Works Contract"],
  ];
  profRows.forEach(([field, hint], i) => {
    const r = i + 4;
    lbl(prof, `A${r}`, field);
    inp(prof, `B${r}`);
    hintCell(prof, `C${r}`, hint);
  });
  prof["!ref"] = `A1:C${profRows.length + 3}`;
  prof["!cols"] = [{ wch: 34 }, { wch: 44 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(wb, prof as never, "Profile");

  // ── GSTR-3B sheet ─────────────────────────────────────────────────────────
  const months24 = [
    "Apr-24","May-24","Jun-24","Jul-24","Aug-24","Sep-24",
    "Oct-24","Nov-24","Dec-24","Jan-25","Feb-25","Mar-25",
    "Apr-25","May-25","Jun-25","Jul-25","Aug-25","Sep-25",
    "Oct-25","Nov-25","Dec-25","Jan-26","Feb-26","Mar-26",
  ];
  const gstr3bHdr = [
    "Month-Year",
    "Taxable Turnover (₹)",
    "Exempt / Nil-rated Turnover (₹)",
    "Total Turnover (₹)",
    "Output Tax (₹)",
    "ITC Claimed (₹)",
    "Net Tax Paid (₹)",
    "Filing Date (DD-MM-YYYY)",
    "Filing Status",
  ];

  const g3b: Record<string, unknown> = {};
  hdr(g3b, "A1", "GSTR-3B — MONTHLY DATA");
  mergeRange(g3b, [`A1:${col(gstr3bHdr.length - 1)}1`]);
  note(g3b, "A2", "CLAUDE: Fill one row per month from GSTR-3B. Amounts in absolute INR. Filing Status: 'Filed' · 'Late' · 'Not Filed'. Leave blank if month not applicable.");
  mergeRange(g3b, [`A2:${col(gstr3bHdr.length - 1)}2`]);
  gstr3bHdr.forEach((h, i) => subHdr(g3b, `${col(i)}3`, h));
  months24.forEach((m, ri) => {
    lbl(g3b, `A${ri + 4}`, m);
    for (let ci = 1; ci < gstr3bHdr.length - 2; ci++) num(g3b, `${col(ci)}${ri + 4}`);
    inp(g3b, `${col(gstr3bHdr.length - 2)}${ri + 4}`); // Filing Date
    inp(g3b, `${col(gstr3bHdr.length - 1)}${ri + 4}`); // Filing Status
  });
  g3b["!ref"] = `A1:${col(gstr3bHdr.length - 1)}${months24.length + 3}`;
  g3b["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 28 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, g3b as never, "GSTR-3B");

  // ── GSTR-1 sheet ──────────────────────────────────────────────────────────
  const gstr1Hdr = [
    "Month-Year",
    "Turnover Declared in GSTR-1 (₹)",
    "Filing Date (DD-MM-YYYY)",
    "Filing Status",
  ];
  const g1: Record<string, unknown> = {};
  hdr(g1, "A1", "GSTR-1 — MONTHLY TURNOVER");
  mergeRange(g1, [`A1:${col(gstr1Hdr.length - 1)}1`]);
  note(g1, "A2", "CLAUDE: Fill turnover as declared in GSTR-1 (B2B + B2C + exports). Amounts in absolute INR. Filing Status: 'Filed' · 'Late' · 'Not Filed'. Annual returns (GSTR-9) go here with 'Annual' as month.");
  mergeRange(g1, [`A2:${col(gstr1Hdr.length - 1)}2`]);
  gstr1Hdr.forEach((h, i) => subHdr(g1, `${col(i)}3`, h));
  months24.forEach((m, ri) => {
    lbl(g1, `A${ri + 4}`, m);
    num(g1, `B${ri + 4}`);
    inp(g1, `C${ri + 4}`);
    inp(g1, `D${ri + 4}`);
  });
  g1["!ref"] = `A1:D${months24.length + 3}`;
  g1["!cols"] = [{ wch: 12 }, { wch: 32 }, { wch: 22 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, g1 as never, "GSTR-1");

  // ── Claude Instructions sheet ─────────────────────────────────────────────
  const cWs: Record<string, unknown> = {};
  const cRows: [string, string][] = [
    ["INSTRUCTIONS FOR CLAUDE", ""],
    ["", ""],
    ["TASK",          "You have been given GST return documents (GSTR-3B / GSTR-1 PDFs, GST portal screenshots, or GST summary reports) and this Excel template. Extract the GST data and fill in the template."],
    ["PROFILE SHEET", "Fill Column B with company details for each field in Column A. GSTIN is 15 characters. Date of GST Registration in DD-MM-YYYY format."],
    ["GSTR-3B SHEET", "Fill one row per month from GSTR-3B filings. Include only months where data is available — leave rows blank for months not yet filed. All amounts in absolute INR (do NOT convert to Lakhs or Crores)."],
    ["TURNOVER",      "Taxable Turnover = total sales attracting GST (excluding exempt/nil). Exempt = sales exempt from GST. Total Turnover = Taxable + Exempt."],
    ["TAX",           "Output Tax = GST charged on sales. ITC Claimed = Input Tax Credit from purchases. Net Tax Paid = Output Tax − ITC Claimed (cash paid to govt)."],
    ["GSTR-1 SHEET",  "Fill turnover declared in GSTR-1 for each month. This is the outward supply value (B2B + B2C + exports). If quarterly filer, fill the quarter month only."],
    ["FILING STATUS", "Use exactly: 'Filed' (on time), 'Late' (filed after due date), 'Not Filed' (not yet filed). Due date for GSTR-3B is 20th of the next month."],
    ["FILING DATE",   "Date the return was actually filed — format DD-MM-YYYY, e.g. 22-05-2024. Leave blank if Not Filed."],
    ["MONTH FORMAT",  "Use 'Mon-YY' format — e.g. 'Apr-24', 'Mar-25'. Do not use 'April 2024' or '04-2024'."],
    ["AMOUNTS",       "All monetary values in absolute INR. No Lakhs or Crores conversion. Use numbers only — no ₹ symbol or commas needed."],
    ["MISSING",       "Leave cells blank if data is not available. Do not write 'N/A', '0', or '-' as placeholders."],
    ["OUTPUT",        "Return only the completed Excel file. Do not add extra rows or sheets. Do not change Column A labels or header rows."],
  ];
  cRows.forEach(([k, v], i) => {
    if (i === 0) { hdr(cWs, `A${i + 1}`, k); lbl(cWs, `B${i + 1}`, v); }
    else { subHdr(cWs, `A${i + 1}`, k); lbl(cWs, `B${i + 1}`, v); }
  });
  cWs["!ref"] = `A1:B${cRows.length}`;
  cWs["!cols"] = [{ wch: 16 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, cWs as never, "Claude Instructions");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  return buf as ArrayBuffer;
}

// ─── TRIANGULATION TEMPLATE ───────────────────────────────────────────────────
export async function buildTriangulationTemplate(): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const SOURCES = ["ITR", "BSA", "GST (Primary)"];

  // ── Profile ──────────────────────────────────────────────────────────────────
  const prof: Record<string, unknown> = {};
  hdr(prof, "A1", "SOURCE DATE RANGE");
  ["#", "Source", "Start Date", "End Date"].forEach((h, i) => subHdr(prof, `${col(i)}2`, h));
  [["1", "GST", "01-04-2024", "31-03-2025"], ["2", "BSA", "01-04-2024", "31-03-2025"], ["3", "ITR", "01-04-2024", "31-03-2025"]].forEach((row, ri) => {
    row.forEach((v, ci) => lbl(prof, `${col(ci)}${3 + ri}`, v));
  });

  hdr(prof, "A7", "PROFILE DETAILS");
  ["Sr.No.", "Particular", "Result (Match/Mismatch/-)", ...SOURCES].forEach((h, i) => subHdr(prof, `${col(i)}8`, h));
  [
    ["1", "Name", ""],
    ["2", "Date of Birth/Incorporation", ""],
    ["3", "Address", ""],
    ["4", "Contact details", ""],
    ["5", "E-mail id", ""],
  ].forEach((row, ri) => {
    row.forEach((v, ci) => lbl(prof, `${col(ci)}${9 + ri}`, v));
    SOURCES.forEach((_, si) => lbl(prof, `${col(3 + si)}${9 + ri}`, ""));
  });

  hdr(prof, "A15", "BANKING INFORMATION");
  ["Sr.No.", "Bank Name", "Account Number", "Account Type", "Banking", "ITR AIS"].forEach((h, i) => subHdr(prof, `${col(i)}16`, h));
  for (let r = 1; r <= 5; r++) {
    lbl(prof, `A${16 + r}`, String(r));
    for (let c = 1; c <= 5; c++) lbl(prof, `${col(c)}${16 + r}`, "");
  }

  prof["!ref"] = `A1:F22`;
  prof["!cols"] = [{ wch: 8 }, { wch: 30 }, { wch: 26 }, { wch: 30 }, { wch: 30 }, { wch: 20 }];
  mergeRange(prof, ["A1:F1", "A7:F7", "A15:F15"]);
  XLSX.utils.book_append_sheet(wb, prof as never, "Profile");

  // ── Summary ───────────────────────────────────────────────────────────────────
  const summ: Record<string, unknown> = {};
  const summPeriods = ["2024-2025", "2025-2026", "YTD (Apr-26 to Apr-26)"];
  ["Particular", ...summPeriods].forEach((h, i) => hdr(summ, `${col(i)}1`, h));
  [
    "Revenue from Operations (ITR)",
    "Adjusted Revenue (Total, GST)",
    "Adjusted Purchases and Expenses (Total, GST)",
    "Margin (GST)",
    "EBITDA (ITR)",
    "PAT (ITR)",
    "GST Annualized",
    "Banking Credits",
    "Banking Credits vis a vis GST Revenue",
    "Banking Credits vis a vis Revenue from Operations",
    "GST Revenue vis a vis Revenue from Operations",
  ].forEach((label, ri) => {
    lbl(summ, `A${ri + 2}`, label);
    summPeriods.forEach((_, ci) => num(summ, `${col(ci + 1)}${ri + 2}`));
  });
  summ["!ref"] = `A1:D${13}`;
  summ["!cols"] = [{ wch: 48 }, { wch: 18 }, { wch: 18 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, summ as never, "Summary");

  // ── Customers ─────────────────────────────────────────────────────────────────
  const custs: Record<string, unknown> = {};
  hdr(custs, "A1", "TOP CUSTOMERS — GST vs BANKING (TTM)");
  ["Sr.No.", "Customer Name", "GST Revenue", "% of Total", "Active Months", "Trend", "Banking Annualized", "Realization"].forEach((h, i) => subHdr(custs, `${col(i)}2`, h));
  for (let r = 1; r <= 20; r++) {
    lbl(custs, `A${r + 2}`, String(r));
    for (let c = 1; c <= 7; c++) num(custs, `${col(c)}${r + 2}`);
  }
  custs["!ref"] = `A1:H22`;
  custs["!cols"] = [{ wch: 8 }, { wch: 40 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 14 }];
  mergeRange(custs, ["A1:H1"]);
  XLSX.utils.book_append_sheet(wb, custs as never, "Customers");

  // ── Suppliers ─────────────────────────────────────────────────────────────────
  const supps: Record<string, unknown> = {};
  hdr(supps, "A1", "TOP SUPPLIERS — GST vs BANKING (TTM)");
  ["Sr.No.", "Supplier Name", "GST Expenses", "% of Total", "Active Months", "Trend", "Banking Debited", ""].forEach((h, i) => subHdr(supps, `${col(i)}2`, h));
  for (let r = 1; r <= 20; r++) {
    lbl(supps, `A${r + 2}`, String(r));
    for (let c = 1; c <= 6; c++) num(supps, `${col(c)}${r + 2}`);
  }
  supps["!ref"] = `A1:G22`;
  supps["!cols"] = custs["!cols"] as never;
  mergeRange(supps, ["A1:G1"]);
  XLSX.utils.book_append_sheet(wb, supps as never, "Suppliers");

  // ── Related Party ─────────────────────────────────────────────────────────────
  const rp: Record<string, unknown> = {};
  hdr(rp, "A1", "RELATED PARTY & CIRCULAR TRANSACTIONS");
  const rpPeriods = ["2024-25", "TTM (May-25 to Apr-26)"];
  subHdr(rp, "A2", "Party Name");
  rpPeriods.forEach((p, pi) => {
    hdr(rp, `${col(1 + pi * 4)}2`, p);
    ["GST Revenue", "GST Purchase", "Banking Credit", "Banking Debit"].forEach((h, hi) => {
      subHdr(rp, `${col(1 + pi * 4 + hi)}3`, h);
    });
  });
  for (let r = 1; r <= 20; r++) {
    lbl(rp, `A${r + 3}`, "");
    for (let c = 1; c <= 8; c++) num(rp, `${col(c)}${r + 3}`);
  }
  rp["!ref"] = `A1:I24`;
  rp["!cols"] = [{ wch: 36 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  mergeRange(rp, ["A1:I1", "B2:E2", "F2:I2"]);
  XLSX.utils.book_append_sheet(wb, rp as never, "Related Party");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  return buf as ArrayBuffer;
}

// ─── AUDITED FINANCIALS TEMPLATE (Corpository-compatible) ────────────────────
// Row labels match financialRules.ts exactly so the rules engine auto-derives
// all computed totals on import. Section headers must have blank value cells
// (the parser detects them as is_section rows).
export async function buildAuditedTemplate(): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");

  const FY_COLS = ["2022-2023", "2023-2024", "2024-2025"];
  const N = FY_COLS.length;
  const ALIAS_COL = N + 1; // column E

  const COMPUTED_FILL = { fgColor: { rgb: "E8F4F0" } };
  const COMPUTED_FONT = { color: { rgb: "1B6449" }, sz: 9, italic: true };
  const INPUT_INDENT_FONT = { color: { rgb: "1C1C1E" }, sz: 9 };
  const ALIAS_FONT = { color: { rgb: "8B7355" }, sz: 8, italic: true };

  function computed(ws: Record<string, unknown>, addr: string, v: string) {
    styleCell(ws, addr, v, { font: COMPUTED_FONT, fill: COMPUTED_FILL, border: BORDER, alignment: { horizontal: "left" } });
  }
  function computedNum(ws: Record<string, unknown>, addr: string) {
    styleCell(ws, addr, "", { font: COMPUTED_FONT, fill: COMPUTED_FILL, border: BORDER, alignment: { horizontal: "right" }, numFmt: "#,##0.00" });
  }
  function indentLbl(ws: Record<string, unknown>, addr: string, v: string) {
    styleCell(ws, addr, `  ${v}`, { font: INPUT_INDENT_FONT, border: BORDER, alignment: { indentLevel: 1 } });
  }
  function aliasCell(ws: Record<string, unknown>, a: string, v: string) {
    styleCell(ws, a, v, { font: ALIAS_FONT, border: BORDER, alignment: { horizontal: "left", wrapText: true } });
  }

  // [label, type, aliases?]
  type RowDef = [string, "section" | "input" | "input_indent" | "computed", string?];

  function makeSheet(sheetTitle: string, rowDefs: RowDef[]) {
    const ws: Record<string, unknown> = {};

    hdr(ws, "A1", sheetTitle);
    for (let i = 0; i < N; i++) hdr(ws, `${col(i + 1)}1`, FY_COLS[i]);
    hdr(ws, `${col(ALIAS_COL)}1`, "ALIASES (reference only — do not edit)");

    note(ws, "A2", "CLAUDE: Fill value columns in ₹ Lakhs from the PDF. Use ALIASES column to match items. Leave COMPUTED (teal) rows blank — auto-derived. Do NOT edit column A labels.");
    mergeRange(ws, [`A2:${col(ALIAS_COL)}2`]);

    subHdr(ws, "A3", "PARTICULARS");
    for (let i = 0; i < N; i++) subHdr(ws, `${col(i + 1)}3`, FY_COLS[i]);
    subHdr(ws, `${col(ALIAS_COL)}3`, "Aliases / Also known as");

    let r = 3;
    for (const [label, type, aliases] of rowDefs) {
      const excelRow = r + 1;
      if (type === "section") {
        sec(ws, `A${excelRow}`, label);
        for (let i = 0; i < N; i++) sec(ws, `${col(i + 1)}${excelRow}`, "");
        sec(ws, `${col(ALIAS_COL)}${excelRow}`, "");
      } else if (type === "computed") {
        computed(ws, `A${excelRow}`, `${label}  ← auto`);
        for (let i = 0; i < N; i++) computedNum(ws, `${col(i + 1)}${excelRow}`);
        aliasCell(ws, `${col(ALIAS_COL)}${excelRow}`, aliases ?? "auto-computed — leave blank");
      } else if (type === "input_indent") {
        indentLbl(ws, `A${excelRow}`, label);
        for (let i = 0; i < N; i++) num(ws, `${col(i + 1)}${excelRow}`);
        aliasCell(ws, `${col(ALIAS_COL)}${excelRow}`, aliases ?? "");
      } else {
        lbl(ws, `A${excelRow}`, label);
        for (let i = 0; i < N; i++) num(ws, `${col(i + 1)}${excelRow}`);
        aliasCell(ws, `${col(ALIAS_COL)}${excelRow}`, aliases ?? "");
      }
      r++;
    }

    ws["!ref"] = `A1:${col(ALIAS_COL)}${r + 1}`;
    colWidth(ws, [42, ...Array(N).fill(18), 56]);
    return ws;
  }

  // ── Balance Sheet rows ─────────────────────────────────────────────────────
  const bsRows: RowDef[] = [
    ["SHAREHOLDERS FUND",                        "section"],
    ["Share Capital",                            "input_indent", "Paid-up Capital · Equity Share Capital"],
    ["Reserves & Surplus",                       "input_indent", "Other Equity · Retained Earnings · Free Reserves · General Reserve · Securities Premium"],
    ["Money Received against Warrants",          "input_indent", "Share warrants · Warrants outstanding"],
    ["Share Application Money Pending Allotment","input_indent", "Share application money pending allotment"],
    ["Minority Interest",                        "input_indent", "Non-controlling Interest"],
    ["Networth",                                 "computed",     "Shareholders Funds · Total Equity · Net Worth · Book Value — auto-derived"],

    ["NON CURRENT LIABILITIES",                  "section"],
    ["Long-term Borrowings",                     "input_indent", "Non-current Borrowings · Term Loans · Secured/Unsecured Long-term Debt · NCDs · Debentures"],
    ["Deferred Tax Liabilities",                 "input_indent", "DTL · Deferred Tax Liability (Net)"],
    ["Other Non Current Liabilities",            "input_indent", "Other Long-term Liabilities"],
    ["Long-term Provisions",                     "input_indent", "Provision for Employee Benefits (Long-term) · Warranty Provisions"],
    ["Total Non Current Liabilities",            "computed",     "auto-derived"],

    ["CURRENT LIABILITIES",                      "section"],
    ["Short-term Borrowings",                    "input_indent", "Current Borrowings · CC / OD / Cash Credit · Working Capital Loans · Current Maturities of LT Debt"],
    ["Trade Payables",                           "input_indent", "Creditors · Sundry Creditors · Accounts Payable"],
    ["Other Current Liabilities",                "input_indent", "Other Payables · Advances from Customers · Statutory Dues · Accrued Liabilities"],
    ["Short-term Provisions",                    "input_indent", "Provision for Tax · Proposed Dividend · Dividend Payable"],
    ["Total Current Liabilities",                "computed",     "auto-derived"],
    ["Total Equity & Liabilities",               "computed",     "auto-derived (must equal Total Assets)"],

    ["FIXED ASSET",                              "section"],
    ["Tangible Assets",                          "input_indent", "Property Plant & Equipment (Gross) · Gross Block · Gross Fixed Assets"],
    ["Intangible Assets",                        "input_indent", "Goodwill · Patents · Trademarks · Software (Gross)"],
    ["Net Block of Assets",                      "computed",     "auto-derived"],
    ["Capital Work in Progress",                 "input_indent", "CWIP · Assets under Construction · Capital Advances"],
    ["Intangible Asset under Development",       "input_indent", "Intangible assets under development"],
    ["Total Fixed Asset",                        "computed",     "auto-derived"],

    ["NON CURRENT ASSETS",                       "section"],
    ["Non Current Investment",                   "input_indent", "Long-term Investments · Investments in Subsidiaries / Associates"],
    ["Deferred Tax Assets (Net)",                "input_indent", "DTA · Deferred Tax Asset (Net)"],
    ["Long-term Loans & Advances",               "input_indent", "Capital Advances · Security Deposits (LT) · Long-term Prepayments"],
    ["Other Non Current Assets",                 "input_indent", "Other Non-current Assets · Misc. Expenditure (to the extent not written off)"],
    ["Total Non Current Assets",                 "computed",     "auto-derived"],

    ["CURRENT ASSETS",                           "section"],
    ["Current Investment",                       "input_indent", "Short-term Investments · Liquid Mutual Funds · Treasury Bills"],
    ["Inventories",                              "input_indent", "Stock · Raw Material + WIP + Finished Goods + Stores & Spares"],
    ["Trade Receivables",                        "input_indent", "Debtors · Sundry Debtors · Accounts Receivable"],
    ["Cash & Cash Equivalents",                  "input_indent", "Cash and Bank Balances · Cash at Hand + Bank Balance + FD < 3 months"],
    ["Short-term Loans & Advances",              "input_indent", "Advance to Suppliers · Prepaid Expenses · Security Deposits (ST) · Advance Tax"],
    ["Other Current Assets",                     "input_indent", "Accrued Income · GST Receivable · Unbilled Revenue · Other Receivables"],
    ["Total Current Assets",                     "computed",     "auto-derived"],
    ["TOTAL ASSETS",                             "computed",     "auto-derived (must equal Total Equity & Liabilities)"],
  ];

  // ── Profit & Loss rows ─────────────────────────────────────────────────────
  const plRows: RowDef[] = [
    ["REVENUE",                                                              "section"],
    ["Revenue from Sale of Products",                                        "input_indent", "Product Sales · Sales of Goods · Manufacturing Sales · Trading Sales"],
    ["Revenue from Sale of Services",                                        "input_indent", "Service Revenue · Contract Revenue · Consulting / Professional Fees"],
    ["Other Operating Revenues",                                             "input_indent", "Scrap Sales · Export Incentives · Other Operating Income"],
    ["Gross Sales",                                                          "computed",     "auto-derived"],
    ["Less:Duties",                                                          "input_indent", "Excise Duty deducted · GST rebate / adjustment"],
    ["Total Revenue from Operations",                                        "computed",     "Net Revenue · Net Sales · Revenue from Operations — auto-derived"],
    ["Other Income",                                                         "input",        "Non-operating Income · Dividend Income · Interest Income from investments · Profit on sale of assets"],
    ["Total Revenue",                                                        "computed",     "auto-derived"],

    ["EXPENSES",                                                             "section"],
    ["Cost of Materials Consumed",                                           "input_indent", "Raw Material Cost · RM Consumed · Material Consumption · Direct Material"],
    ["Purchases of Stock in Trade",                                          "input_indent", "Trading Purchases · Stock-in-Trade Purchases"],
    ["Changes in Inventories of Finished Goods, Work In Progress and Stock In Trade", "input_indent", "Inventory change · Increase/(Decrease) in Stock · Opening Stock − Closing Stock"],
    ["Total Employee Benefit Expense",                                       "input_indent", "Staff Costs · Personnel Expenses · Salaries & Wages + PF + Gratuity + ESIC"],
    ["Total Other Expenses",                                                 "input_indent", "Other Operating Expenses · Manufacturing OH · Selling & Distribution + Admin + Rent + Power + Repairs"],
    ["EBITDA",                                                               "computed",     "auto-derived"],
    ["Total Depreciation, Depletion and Amortization Expense",               "input_indent", "D&A · Depreciation & Amortisation · Dep on Fixed Assets + Amortisation of Intangibles"],
    ["Finance Costs",                                                        "input_indent", "Interest Expense · Interest & Finance Charges · Borrowing Costs · Bank Charges"],
    ["Total Expenses",                                                       "computed",     "auto-derived"],

    ["Prior Period Items before Tax",                                        "input",        "Prior period adjustments (income or expense)"],
    ["Exceptional Items",                                                    "input",        "Exceptional income / (expense) · Impairment losses · VRS costs · One-time items"],
    ["Extraordinary Items",                                                  "input",        "Extraordinary income / expense (rare — mostly pre-Ind AS)"],
    ["Profit before Exceptional and Extraordinary Items and Tax",            "computed",     "auto-derived"],
    ["Profit before Extraordinary Items and Tax",                            "computed",     "auto-derived"],
    ["Profit before Tax",                                                    "computed",     "PBT · Profit/(Loss) before Tax — auto-derived"],

    ["TAX EXPENSE",                                                          "section"],
    ["Current Tax",                                                          "input_indent", "Tax Expense — Current · Provision for Income Tax · MAT"],
    ["Deferred Tax",                                                         "input_indent", "DTL/DTA movement · Deferred Tax Expense / (Benefit)"],
    ["Profit/(Loss) for the Period from Continuing Operations",              "computed",     "auto-derived"],
    ["Profit/(Loss) from Discontinuing Operations (After Tax)",              "input",        "Income/(loss) from discontinued operations (net of tax)"],
    ["Profit/(Loss)",                                                        "computed",     "PAT · Net Profit · Profit for the Year · Profit After Tax — auto-derived"],

    ["EBIT",                                                                 "computed",     "Earnings Before Interest & Tax — auto-derived"],
    ["Gross Profit",                                                         "computed",     "Revenue from Operations − COGS — auto-derived"],
  ];

  // ── Cash Flow rows ─────────────────────────────────────────────────────────
  const cfRows: RowDef[] = [
    ["Cash flows from used in operating activities",   "section"],
    ["Profit before tax",                              "input_indent", "PBT — starting point for indirect method cash flow"],
    ["Depreciation & amortisation",                    "input_indent", "D&A add-back · Non-cash charge adjustment"],
    ["Changes in working capital",                     "input_indent", "Net change in trade receivables, payables, inventory, advances"],
    ["Income tax paid",                                "input_indent", "Direct taxes paid · TDS · Advance tax (net of refunds)"],
    ["Net cash flows from (used in) operating activities",  "input",   "CFO · Operating Cash Flow · Net cash from operations"],

    ["Cash flows from used in investing activities",   "section"],
    ["Purchase of fixed assets",                       "input_indent", "Capex · Capital Expenditure · Purchase of PPE / CWIP (negative = outflow)"],
    ["Sale of fixed assets",                           "input_indent", "Proceeds from disposal / sale of PPE"],
    ["Investments / divestments",                      "input_indent", "Purchase/Sale of investments · Acquisition/disposal of subsidiary"],
    ["Net cash flows from (used in) investing activities",  "input",   "CFI · Investing Cash Flow"],

    ["Cash flows from used in financing activities",   "section"],
    ["Proceeds from borrowings",                       "input_indent", "New loans raised · Proceeds from issue of debentures / NCDs"],
    ["Repayment of borrowings",                        "input_indent", "Loan repayments · Debt repaid (negative = outflow)"],
    ["Dividends paid",                                 "input_indent", "Dividend outflow including tax on dividend"],
    ["Net cash flows from (used in) financing activities",  "input",   "CFF · Financing Cash Flow"],

    ["Effect of exchange rate changes on cash and cash equivalents", "input", "Forex impact on cash balance (for companies with foreign currency transactions)"],
    ["Net increase (decrease) in cash and cash equivalents before effect of exchange rate changes", "computed", "auto-derived"],
    ["Net increase (decrease) in cash and cash equivalents",         "computed", "auto-derived"],
    ["Cash and cash equivalents cash flow statement at beginning of period", "input", "Opening cash · Cash & Bank at start of year"],
    ["Cash and cash equivalents cash flow statement at end of period",       "computed", "Closing cash — must match Cash & Cash Equivalents in Balance Sheet"],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet("Balance Sheet · ₹ Lakhs", bsRows) as never, "Balance Sheet");
  XLSX.utils.book_append_sheet(wb, makeSheet("Profit & Loss · ₹ Lakhs", plRows) as never, "Profit & Loss");
  XLSX.utils.book_append_sheet(wb, makeSheet("Cash Flow · ₹ Lakhs", cfRows) as never, "Cash Flow");

  // ── Claude Prompt sheet ────────────────────────────────────────────────────
  const claudeSheet: Record<string, unknown> = {};
  const claudeRows: [string, string][] = [
    ["INSTRUCTIONS FOR CLAUDE", ""],
    ["", ""],
    ["TASK",        "You have been given an audited financial statement PDF and this Excel template. Extract the financial data and fill in the value columns (B, C, D) on the Balance Sheet, Profit & Loss, and Cash Flow sheets."],
    ["UNIT",        "All values must be in ₹ Lakhs. If the PDF uses Crores, multiply by 100. If absolute INR, divide by 1,00,000. If Thousands, divide by 100. Do NOT mix units across sheets."],
    ["COLUMNS",     "Column B = oldest year, C = middle year, D = latest year. The column headers show fiscal year ranges (e.g. 2023-2024 = FY ending March 2024). Rename headers to match the PDF years."],
    ["LABELS",      "Do NOT change any text in Column A. Use the ALIASES column (last column) to match PDF line items to the correct template row."],
    ["COMPUTED",    "Teal rows marked '← auto' are auto-derived by the system — leave them blank. You may fill them if you want to cross-check, but it is not required."],
    ["SECTIONS",    "Dark-gold section header rows (e.g. SHAREHOLDERS FUND, REVENUE) must remain blank in the value columns."],
    ["MISSING",     "If a line item does not appear in the PDF, leave the cell blank. Do not write 0 unless the PDF explicitly shows zero."],
    ["SIGN",        "Use positive numbers for all items. Exception: 'Changes in Inventories' should be negative if inventory increased during the year (as per standard format)."],
    ["CORPOSITORY", "If you have a Corpository Advanced Excel export, the row labels already match — note that for reference. Fill the template from the PDF."],
    ["OUTPUT",      "Return only the filled Excel file. Do not add extra rows, columns, or sheets, and do not change any Column A labels."],
  ];
  claudeRows.forEach(([k, v], i) => {
    if (i === 0) { hdr(claudeSheet, `A${i + 1}`, k); lbl(claudeSheet, `B${i + 1}`, v); }
    else { subHdr(claudeSheet, `A${i + 1}`, k); lbl(claudeSheet, `B${i + 1}`, v); }
  });
  claudeSheet["!ref"] = `A1:B${claudeRows.length}`;
  claudeSheet["!cols"] = [{ wch: 16 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, claudeSheet as never, "Claude Instructions");

  // ── Human Instructions sheet ───────────────────────────────────────────────
  const instr: Record<string, unknown> = {};
  const instrRows: [string, string][] = [
    ["REHBAR — AUDITED FINANCIALS TEMPLATE (Corpository-compatible)", ""],
    ["", ""],
    ["UNIT",            "All monetary values in ₹ Lakhs (1 Lakh = ₹ 1,00,000). Do NOT mix units."],
    ["FY COLUMNS",      "Columns B/C/D map to fiscal years. Parser reads 'YYYY-YYYY' (e.g. 2023-2024 → FY2024). Rename if needed."],
    ["SECTION ROWS",    "Dark-gold rows (e.g. SHAREHOLDERS FUND) are section headers — leave value cells blank. Do not delete them."],
    ["COMPUTED ROWS",   "Teal rows marked '← auto' are auto-derived from component rows on import. You may leave them blank OR fill them to override."],
    ["ALIASES COLUMN",  "The last column lists alternative names for each row — helps Claude match PDF labels. Do not edit this column."],
    ["PARTICULARS",     "Cell A3 must remain 'PARTICULARS' — the parser uses it to locate the header row."],
    ["SHEET NAMES",     "'Balance Sheet', 'Profit & Loss', 'Cash Flow' are detected by keyword. Do not rename sheets."],
    ["INDENTED ROWS",   "Indented rows are sub-components that feed into the computed parent totals above them."],
    ["UPLOAD",          "Case page → Review tab → Import Financial Excel button (top of page). One file for all 3 sheets."],
    ["CORPOSITORY",     "This template uses the same row labels as Corpository Advanced Excel exports. If you have a Corpository file, import it directly without filling this template."],
    ["WITH AI",         "To use Claude: upload this template + the financial PDF to Claude chat. Claude fills value columns using the Aliases column and Claude Instructions sheet as guidance."],
  ];
  instrRows.forEach(([k, v], i) => {
    if (i === 0) { hdr(instr, `A${i + 1}`, k); lbl(instr, `B${i + 1}`, v); }
    else { subHdr(instr, `A${i + 1}`, k); lbl(instr, `B${i + 1}`, v); }
  });
  instr["!ref"] = `A1:B${instrRows.length}`;
  instr["!cols"] = [{ wch: 22 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, instr as never, "Instructions");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  return buf as ArrayBuffer;
}

// ─── MCA / CORPOSITORY COMPANY PROFILE TEMPLATE ──────────────────────────────
// Designed for AI-assisted extraction: give this template + an MCA/Corpository
// PDF or screenshot to Claude. Claude fills the Profile and Directors sheets.
// The filled file can then be uploaded to Rehbar (New Case → Import MCA Excel).
export async function buildMcaTemplate(): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const INPUT_FILL = { fgColor: { rgb: "FAFAF8" } };
  const HINT_FONT  = { color: { rgb: "9B8C6E" }, sz: 8, italic: true };

  function inp(ws: Record<string, unknown>, a: string) {
    styleCell(ws, a, "", { font: LABEL_FONT, fill: INPUT_FILL, border: BORDER, alignment: { horizontal: "left" } });
  }
  function hintCell(ws: Record<string, unknown>, a: string, v: string) {
    styleCell(ws, a, v, { font: HINT_FONT, border: BORDER, alignment: { horizontal: "left", wrapText: true } });
  }

  // ── Profile sheet ─────────────────────────────────────────────────────────
  // Layout: A = field label, B = value (Claude fills), C = hint (parser ignores),
  //         D = date label, E = date value (Claude fills)
  // The parser (parseAccumnExcel) reads A/B pairs and D/E pairs — col C is skipped.
  const prof: Record<string, unknown> = {};

  sec(prof, "A1", "COMPANY DETAILS");
  mergeRange(prof, ["A1:E1"]);

  note(prof, "A2", "CLAUDE INSTRUCTIONS: Fill Column B with the value for each field labeled in Column A. For the three date fields (Column D = label), fill Column E. Do NOT edit Column A or D labels. Leave a cell blank if the data is not available.");
  mergeRange(prof, ["A2:E2"]);

  subHdr(prof, "A3", "FIELD");
  subHdr(prof, "B3", "VALUE  ← fill here");
  subHdr(prof, "C3", "Hints / aliases (do not edit)");
  subHdr(prof, "D3", "DATE FIELD");
  subHdr(prof, "E3", "DATE VALUE  ← fill here");

  // [field label, hint text, optional date label for col D]
  type ProfRow = [string, string, string?];
  const profRows: ProfRow[] = [
    ["CIN",               "Unique company identifier — starts with U or L, 21 chars, e.g. U12345MH2010PTC123456",    "Date of Incorporation"],
    ["Name",              "Full legal name in CAPS as on MCA, e.g. ABC MANUFACTURING PRIVATE LIMITED",                "Last Balance Sheet Date"],
    ["PAN",               "10-char PAN, e.g. AABCA1234H",                                                            "Last AGM Date"],
    ["LEI",               "Legal Entity Identifier (20 chars) — leave blank if not available"],
    ["Category",          "Private · Public · LLP · OPC · Section 8 · Nidhi"],
    ["Sub Category",      "e.g. Non-govt Company · Indian Non-Govt Company · Guarantee Company"],
    ["Type",              "Company · LLP · Partnership Firm"],
    ["Status",            "Active · Struck Off · Under Process of Striking Off · Amalgamated · Dissolved"],
    ["NSE Sector",        "NSE industry sector, e.g. CONSUMER GOODS · CAPITAL GOODS · IT · FINANCIAL SERVICES"],
    ["Corpository Sector","MCA/Corpository sector classification, e.g. Plastics & Chemicals · FMCG · Real Estate"],
    ["Products/Services", "Brief description of main products and services offered by the company"],
    ["Authorized Capital","Amount as shown on MCA, e.g. 5,00,00,000 — do NOT convert to Lakhs or Crores"],
    ["Paid Up Capital",   "Amount as shown on MCA, e.g. 2,50,00,000 — do NOT convert to Lakhs or Crores"],
    ["Email ID",          "Registered email address as on MCA"],
    ["Website",           "Company website, e.g. www.company.com (without https://)"],
    ["Telephone",         "Registered office phone number or contact number"],
    ["Full Address",      "Complete registered office address including city, state, and pincode"],
    ["About",             "Company business description / overview — copy from Corpository or MCA (max 3000 chars)"],
  ];

  profRows.forEach(([field, hint, dateLabel], i) => {
    const r = i + 4;
    lbl(prof, `A${r}`, field);
    inp(prof, `B${r}`);
    hintCell(prof, `C${r}`, hint);
    if (dateLabel) {
      lbl(prof, `D${r}`, dateLabel);
      inp(prof, `E${r}`);
    } else {
      styleCell(prof, `D${r}`, "", { border: BORDER });
      styleCell(prof, `E${r}`, "", { border: BORDER });
    }
  });

  prof["!ref"] = `A1:E${profRows.length + 3}`;
  prof["!cols"] = [{ wch: 24 }, { wch: 44 }, { wch: 52 }, { wch: 26 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, prof as never, "Profile");

  // ── Directors sheet ───────────────────────────────────────────────────────
  // Column 0 (A) must be "Name" and column 1 (B) must contain "DIN" for the
  // parser to auto-detect this as the Directors sheet.
  const dirWs: Record<string, unknown> = {};
  const dirCols = [
    "Name",                               // 0 — format: "FULL NAME (DOB: DD/MM/YYYY)"
    "DIN/PAN",                            // 1 — format: "XXXXXXXX(PANABCDE1234F)"
    "DIN Status",                         // 2
    "DSC Status",                         // 3
    "Age",                                // 4
    "Gender",                             // 5
    "Nationality",                        // 6
    "Address",                            // 7
    "Appointment at Current Designation", // 8
    "Designation/Category",               // 9
    "Originally Appointed",               // 10
    "Cessation Date",                     // 11
    "Shareholding",                       // 12
    "Email Address",                      // 13
    "Phone Number",                       // 14
    "Remarks",                            // 15
  ];
  const lastDirCol = col(dirCols.length - 1); // "P"

  hdr(dirWs, "A1", "DIRECTORS — MCA / CORPOSITORY DATA");
  mergeRange(dirWs, [`A1:${lastDirCol}1`]);

  note(dirWs, "A2",
    'CLAUDE: One row per director. NAME format: "FULL NAME (DOB: DD/MM/YYYY)" e.g. "RAJESH KUMAR (DOB: 15/01/1975)". ' +
    'DIN/PAN format: "00012345(AAHPS2338C)" — DIN digits first, PAN in parentheses. ' +
    'If PAN not available use "00012345(-)". Include all directors (current and ceased). ' +
    'Fill Cessation Date column for resigned/removed directors.'
  );
  mergeRange(dirWs, [`A2:${lastDirCol}2`]);

  dirCols.forEach((h, i) => subHdr(dirWs, `${col(i)}3`, h));
  for (let r = 1; r <= 15; r++) {
    dirCols.forEach((_, ci) => inp(dirWs, `${col(ci)}${3 + r}`));
  }

  dirWs["!ref"] = `A1:${lastDirCol}18`;
  dirWs["!cols"] = [
    { wch: 40 }, // Name
    { wch: 22 }, // DIN/PAN
    { wch: 12 }, // DIN Status
    { wch: 12 }, // DSC Status
    { wch:  6 }, // Age
    { wch: 10 }, // Gender
    { wch: 14 }, // Nationality
    { wch: 36 }, // Address
    { wch: 22 }, // Appointment at Current
    { wch: 28 }, // Designation/Category
    { wch: 20 }, // Originally Appointed
    { wch: 16 }, // Cessation Date
    { wch: 16 }, // Shareholding
    { wch: 28 }, // Email
    { wch: 16 }, // Phone
    { wch: 20 }, // Remarks
  ];
  XLSX.utils.book_append_sheet(wb, dirWs as never, "Directors");

  // ── Claude Instructions sheet ─────────────────────────────────────────────
  const cWs: Record<string, unknown> = {};
  const cRows: [string, string][] = [
    ["INSTRUCTIONS FOR CLAUDE", ""],
    ["", ""],
    ["TASK",             "You have been given a business document (PDF, image, or text — could be MCA/ROC, Corpository, ITR, financial statement, or any company document) and this Excel template. Fill in every field that has matching data in the document. Leave blank what you cannot find. No explanations, no commentary, no questions — just fill the file and return it."],
    ["RULE",             "Fill what you can find. Skip what you cannot. Return the file."],
    ["PROFILE SHEET",   "Fill Column B with the value for each field in Column A. For the three date fields in Column D, fill Column E. Do NOT change Column A or D labels."],
    ["DATES",           "All dates in DD/MM/YYYY format (e.g. 15/06/2010). Applies to all date fields including director DOBs."],
    ["DIRECTORS SHEET", "Fill one row per director, partner, or proprietor found in the document. For ceased directors, fill the Cessation Date column."],
    ["NAME FORMAT",     "Director Name column: 'FULL NAME (DOB: DD/MM/YYYY)' e.g. 'RAJESH KUMAR (DOB: 15/01/1975)'. If no DOB, just the name."],
    ["DIN/PAN FORMAT",  "DIN/PAN column: 'XXXXXXXX(PANABCDE1234F)'. If no DIN (e.g. proprietorship/partnership), write PAN alone. If PAN unavailable: 'XXXXXXXX(-)'."],
    ["CAPITAL",         "Authorized Capital and Paid Up Capital: enter exactly as shown in the document. Do NOT convert to Lakhs or Crores."],
    ["OUTPUT",          "Return only the filled Excel file. No text before or after the file. Do not add extra rows, columns, or sheets."],
  ];
  cRows.forEach(([k, v], i) => {
    if (i === 0) { hdr(cWs, `A${i + 1}`, k); lbl(cWs, `B${i + 1}`, v); }
    else { subHdr(cWs, `A${i + 1}`, k); lbl(cWs, `B${i + 1}`, v); }
  });
  cWs["!ref"] = `A1:B${cRows.length}`;
  cWs["!cols"] = [{ wch: 18 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, cWs as never, "Claude Instructions");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  return buf as ArrayBuffer;
}

// ─── Download helper ──────────────────────────────────────────────────────────
export function downloadBuffer(filename: string, buf: ArrayBuffer) {
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
