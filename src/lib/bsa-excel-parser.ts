// Parser for Perfios Consolidated Bank Statement Analysis (BSA) Excel files.
// Key sheets parsed: Exec Summary, Flags, CAM Analysis, MoM Summary,
//                   Trade Credits, Trade Debits, Irregularity Indicators.

type Rows = unknown[][];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BsaAccount {
  bank: string;
  account_no: string;
  account_type: string;
  period: string;
  months: number | null;
}

export interface BsaExecSummary {
  company_name: string;
  period_covered: string;
  months_analyzed: number;
  accounts: BsaAccount[];
  total_net_credits: number | null;
  total_net_debits: number | null;
  abb: number | null;
  total_bounces: number;
  penal_charges: number;
  irregularity_count: number;
}

export interface BsaMonthlyRow {
  month: string;        // "Apr-25"
  month_iso: string;    // "2025-04"
  net_credits: number | null;
  credit_count: number | null;
  net_debits: number | null;
  debit_count: number | null;
  avg_eod_balance: number | null;
  min_eod_balance: number | null;
  max_eod_balance: number | null;
  inward_bounces: number;
  inward_bounce_amount: number | null;
}

export interface BsaFlag {
  sn: number;
  category: string;
  flag: string;
  description: string;
}

export interface BsaTradeParty {
  rank: number;
  name: string;
  amount: number;
  pct_of_total: number | null;
  monthly_avg: number | null;
  months_active: number | null;
  count: number | null;
}

export interface BsaIrregularity {
  sn: number;
  indicator: string;
  description: string;
  identified: boolean;
  triggers: number | null;
}

export interface BsaParseResult {
  exec_summary: BsaExecSummary;
  monthly_data: BsaMonthlyRow[];
  flags: BsaFlag[];
  trade_credits: BsaTradeParty[];
  trade_debits: BsaTradeParty[];
  irregularities: BsaIrregularity[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_SHORT: Record<string, string> = {
  Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09',
  Oct: '10', Nov: '11', Dec: '12', Jan: '01', Feb: '02', Mar: '03',
};

function toMonthIso(label: string): string | null {
  const m = label.trim().match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const mon = MONTH_SHORT[m[1]];
  if (!mon) return null;
  const yr = parseInt(m[2]);
  const year = yr >= 25 ? 2000 + yr : 2100 + yr;
  return `${year}-${mon}`;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/,/g, '').replace(/%/, ''));
  return isFinite(n) ? n : null;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function isMonthLabel(v: unknown): boolean {
  return typeof v === 'string' && /^[A-Za-z]{3}-\d{2}$/.test(v.trim());
}

// ── Sheet parsers ─────────────────────────────────────────────────────────────

function parseExecSummary(rows: Rows): BsaExecSummary {
  const companyName = str(rows[0]?.[0]) || str(rows[1]?.[0]);

  // Row 4: Particulars, Consolidated, "Account Number: XXXX, Bank Name", ...
  const headerRow = (rows[4] as unknown[]) ?? [];
  const accounts: BsaAccount[] = [];
  for (let c = 2; c < headerRow.length; c++) {
    const hdr = str(headerRow[c]);
    if (!hdr) continue;
    const m = hdr.match(/Account Number[:\s]+([^,]+),\s*(.+)/i);
    if (m) {
      accounts.push({ bank: m[2].trim(), account_no: m[1].trim(), account_type: '', period: '', months: null });
    }
  }

  // Build key→values map from rows 5–30 (first col = label, rest = values per bank)
  const kv = new Map<string, (string | null)[]>();
  for (let i = 5; i < Math.min(rows.length, 32); i++) {
    const r = (rows[i] as unknown[]) ?? [];
    const label = str(r[0]).toLowerCase().trim();
    if (!label) continue;
    kv.set(label, r.slice(1).map(v => str(v) || null));
  }

  const get = (key: string) => kv.get(key) ?? [];

  // Fill account-level fields
  const typeRow   = get('type of account');
  const periodRow = get('period of analysis');
  const monthsRow = get('statement uploaded for no. of months');
  for (let i = 0; i < accounts.length; i++) {
    accounts[i].account_type = typeRow[i + 1] ?? '';
    accounts[i].period       = periodRow[i + 1] ?? '';
    accounts[i].months       = toNum(monthsRow[i + 1]);
  }

  const creditRow = get('total value of net credits of period of analysis');
  const debitRow  = get('total value of net debits of period of analysis');
  const abbRow    = get('abb of period of analysis');
  const bounceRow = get('total number of cheque/emi bounces');
  const penalRow  = get('penal interest/charges');
  const irregRow  = get('irregularity indicators');
  const mAnalRow  = get('statement uploaded for no. of months');
  const periodStr = (periodRow[1] ?? periodRow[0] ?? '').replace(/\s*to\s*/i, ' — ');

  return {
    company_name:       companyName,
    period_covered:     periodStr,
    months_analyzed:    toNum(mAnalRow[0]) ?? 12,
    accounts,
    total_net_credits:  toNum(creditRow[0]),
    total_net_debits:   toNum(debitRow[0]),
    abb:                toNum(abbRow[0]),
    total_bounces:      toNum(bounceRow[0]) ?? 0,
    penal_charges:      toNum(penalRow[0]) ?? 0,
    irregularity_count: toNum(irregRow[0]) ?? 0,
  };
}

function parseFlags(rows: Rows): BsaFlag[] {
  const flags: BsaFlag[] = [];
  for (let i = 4; i < rows.length; i++) {
    const r = (rows[i] as unknown[]) ?? [];
    const sn = toNum(r[0]);
    if (sn === null) break;
    const flag = str(r[2]);
    if (!flag) continue;
    flags.push({ sn, category: str(r[1]), flag, description: str(r[3]) });
  }
  return flags;
}

function parseCamAnalysis(rows: Rows): Map<string, {
  credits: number; credit_count: number; debits: number; debit_count: number;
  inward_bounce_count: number; inward_bounce_amount: number;
}> {
  // CAM Analysis has multiple sections (Consolidated, ICICI, Kotak…) each starting with
  // a "Month-Year" header row. Only bank-specific sections have actual credit/debit values.
  const acc = new Map<string, { credits: number; credit_count: number; debits: number; debit_count: number; inward_bounce_count: number; inward_bounce_amount: number }>();

  let inSection = false;
  for (const row of rows) {
    const r = row as unknown[];
    const c0 = str(r[0]);

    if (c0 === 'Month-Year' || c0 === 'Month Year') { inSection = true; continue; }
    if (c0 === 'Grand Total' || c0 === 'Average Balance') { inSection = false; continue; }
    if (!inSection || !isMonthLabel(c0)) continue;

    const creditAmt = toNum(r[2]);
    const debitAmt  = toNum(r[4]);
    if (creditAmt === null && debitAmt === null) continue; // consolidated nulls

    const existing = acc.get(c0) ?? { credits: 0, credit_count: 0, debits: 0, debit_count: 0, inward_bounce_count: 0, inward_bounce_amount: 0 };
    existing.credits             += creditAmt ?? 0;
    existing.credit_count        += toNum(r[1]) ?? 0;
    existing.debits              += debitAmt ?? 0;
    existing.debit_count         += toNum(r[3]) ?? 0;
    existing.inward_bounce_count += toNum(r[5]) ?? 0;
    existing.inward_bounce_amount += toNum(r[6]) ?? 0;
    acc.set(c0, existing);
  }
  return acc;
}

function parseMomSummary(rows: Rows): {
  months: string[];
  avgBalance: Map<string, number>;
  minBalance: Map<string, number>;
  maxBalance: Map<string, number>;
} {
  // Row 5: [Particulars, Apr-25, May-25, ...]
  const hdrRow = (rows[5] as unknown[]) ?? [];
  const colToMonth: Record<number, string> = {};
  const months: string[] = [];
  for (let c = 1; c < hdrRow.length; c++) {
    const lbl = str(hdrRow[c]);
    if (isMonthLabel(lbl)) { months.push(lbl); colToMonth[c] = lbl; }
  }

  const avgBalance = new Map<string, number>();
  const minBalance = new Map<string, number>();
  const maxBalance = new Map<string, number>();

  for (let i = 6; i < rows.length; i++) {
    const r = (rows[i] as unknown[]) ?? [];
    const label = str(r[0]).toLowerCase().trim();
    let target: Map<string, number> | null = null;
    if (label === 'average eod balance') target = avgBalance;
    else if (label === 'min eod balance') target = minBalance;
    else if (label === 'max eod balance') target = maxBalance;
    if (!target) continue;
    for (const [col, mon] of Object.entries(colToMonth)) {
      const v = toNum(r[parseInt(col)]);
      if (v !== null) target.set(mon, v);
    }
  }

  return { months, avgBalance, minBalance, maxBalance };
}

function parseTradeParties(rows: Rows): BsaTradeParty[] {
  const parties: BsaTradeParty[] = [];
  // Header at row 5: Ranking, TRANSFER From/To, AMOUNT, % of Total, MONTHLY AVG, NO. OF MONTHS, AVG PER COUNT, COUNT
  for (let i = 6; i < rows.length; i++) {
    const r = (rows[i] as unknown[]) ?? [];
    const rank = toNum(r[0]);
    if (rank === null) continue;
    const name   = str(r[1]);
    const amount = toNum(r[2]);
    if (!name || amount === null) continue;
    parties.push({
      rank,
      name,
      amount,
      pct_of_total:  toNum(r[3]),
      monthly_avg:   toNum(r[4]),
      months_active: toNum(r[5]),
      count:         toNum(r[7]),
    });
  }
  return parties;
}

function parseIrregularities(rows: Rows): BsaIrregularity[] {
  const irr: BsaIrregularity[] = [];
  for (let i = 4; i < rows.length; i++) {
    const r = (rows[i] as unknown[]) ?? [];
    const sn = toNum(r[0]);
    if (sn === null) break;
    irr.push({
      sn,
      indicator:   str(r[1]),
      description: str(r[2]),
      identified:  str(r[3]).toUpperCase() === 'Y',
      triggers:    toNum(r[4]),
    });
  }
  return irr;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isBsaExcel(sheetNames: string[]): boolean {
  const required = ['Exec Summary', 'Flags', 'CAM Analysis'];
  return required.every(n => sheetNames.includes(n));
}

export async function parseBsaExcel(file: File): Promise<BsaParseResult> {
  const XLSX = await import('xlsx');
  const buf  = await file.arrayBuffer();
  const wb   = XLSX.read(buf, { type: 'array', cellDates: false });

  if (!isBsaExcel(wb.SheetNames)) {
    throw new Error('Not a BSA Excel — expected sheets: Exec Summary, Flags, CAM Analysis');
  }

  const getRows = (name: string): Rows =>
    wb.Sheets[name]
      ? (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null }) as Rows)
      : [];

  const exec_summary   = parseExecSummary(getRows('Exec Summary'));
  const flags          = parseFlags(getRows('Flags'));
  const camAcc         = parseCamAnalysis(getRows('CAM Analysis'));
  const mom            = parseMomSummary(getRows('MoM Summary'));
  const trade_credits  = parseTradeParties(getRows('Trade Credits'));
  const trade_debits   = parseTradeParties(getRows('Trade Debits'));
  const irregularities = parseIrregularities(getRows('Irregularity Indicators'));

  const allMonths = mom.months.length > 0 ? mom.months : Array.from(camAcc.keys());

  const monthly_data: BsaMonthlyRow[] = allMonths.map(mon => {
    const cam = camAcc.get(mon);
    return {
      month:                mon,
      month_iso:            toMonthIso(mon) ?? mon,
      net_credits:          cam?.credits ?? null,
      credit_count:         cam?.credit_count ?? null,
      net_debits:           cam?.debits ?? null,
      debit_count:          cam?.debit_count ?? null,
      avg_eod_balance:      mom.avgBalance.get(mon) ?? null,
      min_eod_balance:      mom.minBalance.get(mon) ?? null,
      max_eod_balance:      mom.maxBalance.get(mon) ?? null,
      inward_bounces:       cam?.inward_bounce_count ?? 0,
      inward_bounce_amount: cam?.inward_bounce_amount ?? null,
    };
  });

  return { exec_summary, monthly_data, flags, trade_credits, trade_debits, irregularities };
}
