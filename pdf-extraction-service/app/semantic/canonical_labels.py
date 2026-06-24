"""Canonical label sets per statement type. These are the 18+18+6 standard labels
that map to extracted_financials line items and the ratio engine."""

CANONICAL: dict[str, list[str]] = {
    "profit_loss": [
        "Turnover",
        "Cost of Goods Sold",
        "Gross Profit",
        "Operating Expenses",
        "EBITDA",
        "Depreciation",
        "EBIT",
        "Interest Expense",
        "Profit Before Tax",
        "Tax",
        "PAT",
    ],
    "balance_sheet": [
        "Share Capital",
        "Reserves & Surplus",
        "Net Worth",
        "Long Term Borrowings",
        "Short Term Borrowings",
        "Total Debt",
        "Trade Payables",
        "Other Current Liabilities",
        "Current Liabilities",
        "Total Liabilities",
        "Fixed Assets (Net)",
        "Inventory",
        "Trade Receivables",
        "Cash & Bank",
        "Other Current Assets",
        "Current Assets",
        "Total Assets",
        "Capital Employed",
    ],
    "cash_flow": [
        "Cash from Operations",
        "Cash from Investing",
        "Cash from Financing",
        "Net Change in Cash",
        "Opening Cash",
        "Closing Cash",
    ],
    "projections": [
        "Projected Turnover",
        "Projected EBITDA",
        "Projected PAT",
        "Projected Net Worth",
        "Projected Total Debt",
    ],
}

ALL_CANONICAL: set[str] = {label for labels in CANONICAL.values() for label in labels}
