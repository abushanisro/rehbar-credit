"""Bank statement monthly extraction.

Strategy:
1. Scan pages for month headers (YYYY-MM or month-name year patterns).
2. Find opening/closing balance, total credits/debits from each page or summary table.
3. Detect bounces (CHQ RETURN, ECS RETURN, DISHONOURED patterns).
4. Detect EMI outflows (EMI, LOAN INSTALLMENT, NACH DR patterns).

Returns list of BankStatementRow (one per month × account).
"""
import re
from typing import Optional
from app.schemas.models import PageContent, BankStatementRow

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}

_MONTH_YR_RE = re.compile(
    r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
    r"[\s\-/\']*(\d{2,4})\b",
    re.IGNORECASE,
)
_YYYYMM_RE = re.compile(r"\b(20\d{2})[-/](\d{2})\b")
_ACCOUNT_RE = re.compile(r"(?:account\s+(?:no|number)\.?\s*:?\s*)(\w+)", re.IGNORECASE)
_BANK_RE = re.compile(
    r"\b(HDFC|ICICI|SBI|Axis|Kotak|Yes Bank|Punjab National|PNB|Bank of Baroda|BOB|"
    r"Canara|Union Bank|Indian Bank|IDBI|Federal Bank|IndusInd|RBL)\b",
    re.IGNORECASE,
)

_BALANCE_PATTERNS = [
    (re.compile(r"opening\s+balance[\s:]*([0-9,.\-]+)", re.IGNORECASE), "opening"),
    (re.compile(r"closing\s+balance[\s:]*([0-9,.\-]+)", re.IGNORECASE), "closing"),
    (re.compile(r"total\s+credits?[\s:]*([0-9,.\-]+)", re.IGNORECASE), "credits"),
    (re.compile(r"total\s+debits?[\s:]*([0-9,.\-]+)", re.IGNORECASE), "debits"),
    (re.compile(r"credit\s+(?:amount|sum)[\s:]*([0-9,.\-]+)", re.IGNORECASE), "credits"),
    (re.compile(r"debit\s+(?:amount|sum)[\s:]*([0-9,.\-]+)", re.IGNORECASE), "debits"),
]

_BOUNCE_PATTERNS = [
    re.compile(r"(?:CHQ|ECS|NACH|SI)\s+RETURN", re.IGNORECASE),
    re.compile(r"DISHONOUR(?:ED)?", re.IGNORECASE),
    re.compile(r"BOUNCE", re.IGNORECASE),
    re.compile(r"INWARD\s+RETURN", re.IGNORECASE),
    re.compile(r"OUTWARD\s+RETURN", re.IGNORECASE),
]

_EMI_PATTERNS = [
    re.compile(r"\bEMI\b", re.IGNORECASE),
    re.compile(r"LOAN\s+INSTALMENT", re.IGNORECASE),
    re.compile(r"NACH\s+DR", re.IGNORECASE),
    re.compile(r"LOAN\s+REPAYMENT", re.IGNORECASE),
    re.compile(r"TERM\s+LOAN", re.IGNORECASE),
]


def _clean_num(text: str) -> Optional[float]:
    cleaned = re.sub(r"[^0-9.\-]", "", text)
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def _extract_month_key(text: str) -> Optional[str]:
    """Extract YYYY-MM key from text."""
    m = _YYYYMM_RE.search(text)
    if m:
        return f"{m.group(1)}-{m.group(2).zfill(2)}"
    m = _MONTH_YR_RE.search(text)
    if m:
        mon_str = m.group(1)[:3].lower()
        mon_num = _MONTHS.get(mon_str)
        yr = m.group(2)
        if mon_num and yr:
            yr_int = int(yr)
            if yr_int < 100:
                yr_int += 2000
            return f"{yr_int}-{str(mon_num).zfill(2)}"
    return None


def parse_bank_statement(pages: list[PageContent]) -> list[BankStatementRow]:
    """Extract monthly bank data from statement pages."""
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    monthly_data: dict[str, dict] = {}

    full_text = "\n".join(p.text for p in pages)

    # Detect bank name and account number from full text
    m = _BANK_RE.search(full_text)
    if m:
        bank_name = m.group(0)
    m = _ACCOUNT_RE.search(full_text)
    if m:
        account_number = m.group(1)

    # Try to extract from summary tables first (most reliable)
    for page in pages:
        for table in page.tables:
            _parse_summary_table(table, monthly_data)

    # Fall back to text-based extraction for months with missing data
    for page in pages:
        month_key = _extract_month_key(page.text)
        if not month_key:
            # Try page header
            header_lines = page.text.splitlines()[:5]
            for line in header_lines:
                month_key = _extract_month_key(line)
                if month_key:
                    break

        if not month_key:
            continue

        if month_key not in monthly_data:
            monthly_data[month_key] = {}

        data = monthly_data[month_key]
        text = page.text

        # Extract balances
        for pattern, field in _BALANCE_PATTERNS:
            if field not in data:
                m = pattern.search(text)
                if m:
                    val = _clean_num(m.group(1))
                    if val is not None:
                        data[field] = val

        # Count bounces
        bounce_in = data.get("bounce_inward", 0)
        bounce_out = data.get("bounce_outward", 0)
        for line in text.splitlines():
            lower = line.lower()
            if any(p.search(line) for p in _BOUNCE_PATTERNS):
                if "inward" in lower or "inw" in lower:
                    bounce_in += 1
                elif "outward" in lower or "otw" in lower or "return" in lower:
                    bounce_out += 1
                else:
                    bounce_in += 1  # default to inward
        data["bounce_inward"] = bounce_in
        data["bounce_outward"] = bounce_out

        # Sum EMI outflows
        emi_total = data.get("emi_outflows", 0.0)
        for line in text.splitlines():
            if any(p.search(line) for p in _EMI_PATTERNS):
                # Find amount on same line
                amounts = re.findall(r"([0-9,]+\.\d{2})", line)
                if amounts:
                    val = _clean_num(amounts[-1])
                    if val:
                        emi_total += val
        data["emi_outflows"] = emi_total

    rows: list[BankStatementRow] = []
    for month_key, data in sorted(monthly_data.items()):
        rows.append(BankStatementRow(
            month=month_key,
            bank_name=bank_name,
            account_number=account_number,
            opening_balance=data.get("opening"),
            closing_balance=data.get("closing"),
            total_credits=data.get("credits"),
            total_debits=data.get("debits"),
            credit_count=data.get("credit_count"),
            debit_count=data.get("debit_count"),
            bounce_inward=data.get("bounce_inward", 0),
            bounce_outward=data.get("bounce_outward", 0),
            emi_outflows=data.get("emi_outflows") or None,
        ))
    return rows


def _parse_summary_table(table: list[list[str]], monthly_data: dict):
    """Try to extract monthly summary data from a structured table."""
    if len(table) < 2:
        return
    # Check if header row contains months
    header = table[0]
    col_months: dict[int, str] = {}
    for i, cell in enumerate(header):
        key = _extract_month_key(cell)
        if key:
            col_months[i] = key

    if not col_months:
        # Try row-based format (each row = a month)
        for row in table[1:]:
            if not row:
                continue
            month_key = _extract_month_key(row[0]) if row else None
            if month_key:
                if month_key not in monthly_data:
                    monthly_data[month_key] = {}
                # Heuristic: cols 1-4 are opening, closing, credits, debits
                for idx, field in [(1, "opening"), (2, "closing"), (3, "credits"), (4, "debits")]:
                    if idx < len(row) and field not in monthly_data[month_key]:
                        val = _clean_num(row[idx])
                        if val is not None:
                            monthly_data[month_key][field] = val
    else:
        # Column-based format: each column = a month
        for row in table[1:]:
            label = row[0].lower() if row else ""
            for col_idx, month_key in col_months.items():
                if col_idx >= len(row):
                    continue
                if month_key not in monthly_data:
                    monthly_data[month_key] = {}
                val = _clean_num(row[col_idx])
                if val is None:
                    continue
                if "opening" in label:
                    monthly_data[month_key].setdefault("opening", val)
                elif "closing" in label:
                    monthly_data[month_key].setdefault("closing", val)
                elif "credit" in label:
                    monthly_data[month_key].setdefault("credits", val)
                elif "debit" in label:
                    monthly_data[month_key].setdefault("debits", val)
