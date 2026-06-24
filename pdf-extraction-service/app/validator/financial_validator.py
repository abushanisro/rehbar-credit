"""Financial consistency validator.

After extraction, before writing to DB. Checks mathematical relationships.
Flags violations as HIGH (blocking concern for analyst) or MEDIUM (informational).

Never blocks the write — flags are stored as notes/errors for human review.
"""
from typing import Optional
from app.schemas.models import ValidationFlag, BankStatementRow


def _within_pct(a: float, b: float, pct: float) -> bool:
    """Check if a and b are within pct% of each other."""
    if a == 0 and b == 0:
        return True
    if a == 0 or b == 0:
        return False
    return abs(a - b) / max(abs(a), abs(b)) <= pct / 100


def _get(items: dict[str, Optional[float]], key: str) -> Optional[float]:
    return items.get(key)


def validate_balance_sheet(items: dict[str, Optional[float]]) -> list[ValidationFlag]:
    flags: list[ValidationFlag] = []
    ta = _get(items, "Total Assets")
    tl = _get(items, "Total Liabilities")
    nw = _get(items, "Net Worth")

    # Rule 1: Total Assets ≈ Total Liabilities (which already includes Net Worth)
    if ta and tl and not _within_pct(ta, tl, 5):
        flags.append(ValidationFlag(
            rule="BS_IMBALANCE",
            message=f"Total Assets ({ta:,.2f}) ≠ Total Liabilities ({tl:,.2f}) — difference {abs(ta-tl):,.2f}",
            severity="HIGH",
        ))

    # Rule 2: Net Worth = Share Capital + Reserves
    sc = _get(items, "Share Capital")
    rs = _get(items, "Reserves & Surplus")
    if nw and sc and rs and not _within_pct(nw, sc + rs, 3):
        flags.append(ValidationFlag(
            rule="NW_MISMATCH",
            message=f"Net Worth ({nw:,.2f}) ≠ Share Capital + Reserves ({sc+rs:,.2f})",
            severity="MEDIUM",
        ))

    # Rule 3: Current Assets must be less than Total Assets
    ca = _get(items, "Current Assets")
    if ca and ta and ca > ta * 1.05:
        flags.append(ValidationFlag(
            rule="CA_OVERFLOW",
            message=f"Current Assets ({ca:,.2f}) > Total Assets ({ta:,.2f}) — impossible",
            severity="HIGH",
        ))

    # Rule 4: Total Debt = LTB + STB
    ltd = _get(items, "Long Term Borrowings")
    stb = _get(items, "Short Term Borrowings")
    td = _get(items, "Total Debt")
    if td and ltd and stb and not _within_pct(td, ltd + stb, 3):
        flags.append(ValidationFlag(
            rule="DEBT_MISMATCH",
            message=f"Total Debt ({td:,.2f}) ≠ LTB + STB ({ltd+stb:,.2f})",
            severity="MEDIUM",
        ))

    return flags


def validate_profit_loss(items: dict[str, Optional[float]]) -> list[ValidationFlag]:
    flags: list[ValidationFlag] = []

    pbt = _get(items, "Profit Before Tax")
    tax = _get(items, "Tax")
    pat = _get(items, "PAT")
    ebitda = _get(items, "EBITDA")
    depr = _get(items, "Depreciation")
    ebit = _get(items, "EBIT")
    interest = _get(items, "Interest Expense")

    # Rule: PAT ≈ PBT - Tax
    if pbt is not None and tax is not None and pat is not None:
        expected_pat = pbt - (tax or 0)
        if not _within_pct(pat, expected_pat, 3):
            flags.append(ValidationFlag(
                rule="PAT_MISMATCH",
                message=f"PAT ({pat:,.2f}) ≠ PBT - Tax ({expected_pat:,.2f})",
                severity="HIGH",
            ))

    # Rule: EBIT ≈ EBITDA - Depreciation
    if ebitda is not None and depr is not None and ebit is not None:
        expected_ebit = ebitda - depr
        if not _within_pct(ebit, expected_ebit, 3):
            flags.append(ValidationFlag(
                rule="EBIT_MISMATCH",
                message=f"EBIT ({ebit:,.2f}) ≠ EBITDA - Depreciation ({expected_ebit:,.2f})",
                severity="MEDIUM",
            ))

    # Rule: PBT ≈ EBIT - Interest
    if ebit is not None and interest is not None and pbt is not None:
        expected_pbt = ebit - interest
        if not _within_pct(pbt, expected_pbt, 3):
            flags.append(ValidationFlag(
                rule="PBT_MISMATCH",
                message=f"PBT ({pbt:,.2f}) ≠ EBIT - Interest ({expected_pbt:,.2f})",
                severity="MEDIUM",
            ))

    # Rule: PAT should not exceed Turnover
    turnover = _get(items, "Turnover")
    if turnover and pat and abs(pat) > abs(turnover):
        flags.append(ValidationFlag(
            rule="PAT_EXCEEDS_REVENUE",
            message=f"PAT ({pat:,.2f}) > Turnover ({turnover:,.2f}) — likely extraction error",
            severity="HIGH",
        ))

    return flags


def validate_cash_flow(items: dict[str, Optional[float]]) -> list[ValidationFlag]:
    flags: list[ValidationFlag] = []

    ops = _get(items, "Cash from Operations")
    inv = _get(items, "Cash from Investing")
    fin = _get(items, "Cash from Financing")
    net = _get(items, "Net Change in Cash")
    opening = _get(items, "Opening Cash")
    closing = _get(items, "Closing Cash")

    # Rule: Net Change = Ops + Investing + Financing
    if ops is not None and inv is not None and fin is not None and net is not None:
        expected = ops + inv + fin
        if not _within_pct(net, expected, 2):
            flags.append(ValidationFlag(
                rule="CF_NET_MISMATCH",
                message=f"Net Change in Cash ({net:,.2f}) ≠ Ops+Inv+Fin ({expected:,.2f})",
                severity="HIGH",
            ))

    # Rule: Closing = Opening + Net Change
    if opening is not None and net is not None and closing is not None:
        expected_closing = opening + net
        if not _within_pct(closing, expected_closing, 2):
            flags.append(ValidationFlag(
                rule="CF_CLOSING_MISMATCH",
                message=f"Closing Cash ({closing:,.2f}) ≠ Opening + Net Change ({expected_closing:,.2f})",
                severity="HIGH",
            ))

    return flags


def validate_bank_row(row: BankStatementRow) -> list[ValidationFlag]:
    flags: list[ValidationFlag] = []
    op = row.opening_balance
    cl = row.closing_balance
    cr = row.total_credits
    db = row.total_debits

    if op is not None and cl is not None and cr is not None and db is not None:
        expected_closing = op + cr - db
        if not _within_pct(cl, expected_closing, 2):
            flags.append(ValidationFlag(
                rule="BANK_BALANCE_MISMATCH",
                message=(
                    f"Month {row.month}: Closing ({cl:,.2f}) ≠ "
                    f"Opening + Credits - Debits ({expected_closing:,.2f})"
                ),
                severity="HIGH",
            ))

    return flags


def validate_statement(
    stmt_type: str,
    line_items: list,
) -> list[ValidationFlag]:
    """Dispatch to the correct validator by statement type."""
    items = {li.label: li.value for li in line_items if li.value is not None}
    if stmt_type == "balance_sheet":
        return validate_balance_sheet(items)
    if stmt_type == "profit_loss":
        return validate_profit_loss(items)
    if stmt_type == "cash_flow":
        return validate_cash_flow(items)
    return []
