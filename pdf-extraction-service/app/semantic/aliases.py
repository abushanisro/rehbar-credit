"""Alias dictionary: raw PDF label → canonical label.

Sources:
- financialRules.ts (Rehbar existing label normalization)
- Indian CA format terminology (Schedule III, AS, Ind AS)
- Common abbreviations and variants seen in MSME financial statements

To add new mappings: append to the relevant canonical key's list.
Bump ALIAS_VERSION in config.py after any change.
"""

# canonical label → list of known aliases (case-insensitive during lookup)
ALIASES: dict[str, list[str]] = {

    # ── Profit & Loss ──────────────────────────────────────────────────────

    "Turnover": [
        "Revenue from Operations",
        "Revenue from operations",
        "Net Sales",
        "Sales Turnover",
        "Total Revenue from Operations",
        "Revenue",
        "Gross Revenue",
        "Net Revenue",
        "Sales",
        "Total Sales",
        "Income from Operations",
        "Revenue from Sale of Products",
        "Revenue from Sale of Services",
        "Revenue from sale of products",
        "Revenue from sale of services",
        "Other Operating Revenues",
        "Net Turnover",
        "Total Turnover",
        "Gross Turnover",
        "Total Income from Operations",
        "Total Revenue",
        "Net Income",
        "Total Operating Revenue",
        "Gross Sales",
        "Net Sales Turnover",
    ],

    "Cost of Goods Sold": [
        "COGS",
        "Cost of Materials Consumed",
        "Cost of Goods",
        "Purchase of Stock in Trade",
        "Purchases of Stock in Trade",
        "Direct Costs",
        "Manufacturing Costs",
        "Cost of Production",
        "Raw Material Consumed",
        "Material Cost",
        "Cost of Revenue",
        "Cost of Sales",
    ],

    "Gross Profit": [
        "Gross Margin",
        "Gross Income",
        "Gross Profit/(Loss)",
    ],

    "Operating Expenses": [
        "Total Other Expenses",
        "Other Expenses",
        "Operating Costs",
        "Selling & Admin Expenses",
        "Selling General Administrative",
        "SG&A",
        "Overhead",
        "Administrative Expenses",
        "Employee Benefit Expense",
        "Total Employee Benefit Expense",
        "Manpower Cost",
        "Staff Cost",
    ],

    "EBITDA": [
        "Operating Profit",
        "PBDITDA",
        "PBDIT",
        "Operating Income",
        "Earnings Before Interest Tax Depreciation Amortization",
        "Earnings Before Interest, Tax, Depreciation & Amortization",
        "Gross Operating Profit",
        "EBIDTA",
        "Profit before Depreciation Interest and Tax",
        "Profit Before Finance Charges and Depreciation",
        "Cash Profit",
    ],

    "Depreciation": [
        "D&A",
        "Depreciation and Amortization",
        "Depr & Amort",
        "Depreciation & Amortization",
        "Total Depreciation, Depletion and Amortization Expense",
        "Amortization",
        "Depreciation on Fixed Assets",
        "Depreciation/Amortization",
    ],

    "EBIT": [
        "Operating Profit After Depreciation",
        "Earnings Before Interest and Tax",
        "Earnings Before Interest & Tax",
        "Profit Before Interest and Tax",
        "PBIT",
    ],

    "Interest Expense": [
        "Finance Costs",
        "Finance Charges",
        "Borrowing Costs",
        "Interest Cost",
        "Interest and Finance Charges",
        "Interest Paid",
        "Financial Charges",
        "Interest on Loans",
        "Interest Expenditure",
        "Financial Expenses",
        "Net Finance Costs",
    ],

    "Profit Before Tax": [
        "PBT",
        "Profit before Tax",
        "Profit Before Taxation",
        "Profit/(Loss) Before Tax",
        "EBT",
        "Net Profit Before Tax",
        "Profit before Extraordinary Items and Tax",
        "Profit before Exceptional and Extraordinary Items and Tax",
    ],

    "Tax": [
        "Income Tax",
        "Tax Expense",
        "Current Tax",
        "Deferred Tax",
        "Tax Provision",
        "Provision for Tax",
        "Income Tax Expense",
        "Net Tax",
    ],

    "PAT": [
        "Net Profit",
        "Profit After Tax",
        "Profit/(Loss) for the Year",
        "Net Profit After Tax",
        "Profit After Taxation",
        "Net Earnings",
        "Net Income After Tax",
        "Profit for the Year",
        "Net Profit/(Loss)",
        "Profit/(Loss) for the Period",
        "Bottom Line",
        "Profit/(Loss)",
        "Net Profit for the Year",
        "Profit/(Loss) from Continuing Operations",
    ],

    # ── Balance Sheet ──────────────────────────────────────────────────────

    "Share Capital": [
        "Equity Share Capital",
        "Paid-up Capital",
        "Paid Up Capital",
        "Issued & Paid-up Capital",
        "Ordinary Share Capital",
        "Capital",
    ],

    "Reserves & Surplus": [
        "Reserves and Surplus",
        "Retained Earnings",
        "Accumulated Profit",
        "Free Reserves",
        "General Reserve",
        "Revenue Reserves",
        "Other Reserves",
        "Surplus in P&L",
        "Balance in Statement of P&L",
    ],

    "Net Worth": [
        "Shareholders Equity",
        "Shareholders' Equity",
        "Total Equity",
        "Networth",
        "Owners Equity",
        "Owner's Equity",
        "Total Shareholders Funds",
        "Total Shareholders' Funds",
        "Stockholders Equity",
        "Total Net Worth",
        "Total Equity & Reserves",
    ],

    "Long Term Borrowings": [
        "Long-term Borrowings",
        "Long Term Debt",
        "LTD",
        "Non-Current Borrowings",
        "Term Loans",
        "Long Term Loans",
        "Secured Long Term Loans",
        "Debentures",
    ],

    "Short Term Borrowings": [
        "Short-term Borrowings",
        "Short Term Debt",
        "STD",
        "Working Capital Loans",
        "Current Borrowings",
        "Cash Credit",
        "Overdraft",
        "Total Short-term Borrowings",
    ],

    "Total Debt": [
        "Total Borrowings",
        "Total Loans",
        "Total Financial Debt",
        "Total Interest Bearing Debt",
        "Gross Debt",
    ],

    "Trade Payables": [
        "Creditors",
        "Accounts Payable",
        "Trade Creditors",
        "Sundry Creditors",
        "Payables",
    ],

    "Other Current Liabilities": [
        "Other Liabilities",
        "Accruals",
        "Other Payables",
        "Provisions",
        "Short Term Provisions",
    ],

    "Current Liabilities": [
        "Total Current Liabilities",
        "Current Liabilities and Provisions",
        "Total Short Term Liabilities",
    ],

    "Total Liabilities": [
        "Total Equity & Liabilities",
        "Total Liabilities & Equity",
        "Total Capital & Liabilities",
        "Total Liabilities and Equity",
    ],

    "Fixed Assets (Net)": [
        "Net Block",
        "Net Fixed Assets",
        "Property Plant and Equipment",
        "PP&E",
        "Total Fixed Asset",
        "Net Block of Assets",
        "Tangible Assets",
        "Fixed Assets",
    ],

    "Inventory": [
        "Inventories",
        "Stock",
        "Stock in Trade",
        "Raw Material",
        "Finished Goods",
        "Work in Progress",
        "WIP",
        "Closing Stock",
    ],

    "Trade Receivables": [
        "Debtors",
        "Accounts Receivable",
        "Sundry Debtors",
        "Trade Debtors",
        "Receivables",
    ],

    "Cash & Bank": [
        "Cash and Cash Equivalents",
        "Cash & Cash Equivalents",
        "Cash",
        "Bank Balance",
        "Cash and Bank Balances",
        "Cash Balance",
        "Liquid Assets",
    ],

    "Other Current Assets": [
        "Loans and Advances",
        "Short-term Loans and Advances",
        "Prepaid Expenses",
        "Advance Tax",
        "Other Assets",
    ],

    "Current Assets": [
        "Total Current Assets",
        "Current Assets & Loans",
    ],

    "Total Assets": [
        "TOTAL ASSETS",
        "Total Asset",
        "Gross Total Assets",
    ],

    "Capital Employed": [
        "Total Capital Employed",
        "Capital and Borrowings",
        "Networth + Total Debt",
    ],

    # ── Cash Flow ──────────────────────────────────────────────────────────

    "Cash from Operations": [
        "Net Cash from Operating Activities",
        "Cash Flow from Operations",
        "Operating Cash Flow",
        "Net Cash Flow from Operating Activities",
        "Cash Generated from Operations",
        "Net cash flows from (used in) operating activities",
    ],

    "Cash from Investing": [
        "Net Cash from Investing Activities",
        "Cash Flow from Investing",
        "Investing Cash Flow",
        "Net Cash Flow from Investing Activities",
        "Net cash flows from (used in) investing activities",
    ],

    "Cash from Financing": [
        "Net Cash from Financing Activities",
        "Cash Flow from Financing",
        "Financing Cash Flow",
        "Net Cash Flow from Financing Activities",
        "Net cash flows from (used in) financing activities",
    ],

    "Net Change in Cash": [
        "Net Increase in Cash",
        "Net Decrease in Cash",
        "Net Increase/(Decrease) in Cash",
        "Change in Cash",
        "Net Movement in Cash",
        "Net increase (decrease) in cash and cash equivalents",
    ],

    "Opening Cash": [
        "Opening Balance",
        "Cash at Beginning",
        "Cash and Cash Equivalents at Beginning",
        "Opening Cash Balance",
    ],

    "Closing Cash": [
        "Closing Balance",
        "Cash at End",
        "Cash and Cash Equivalents at End",
        "Closing Cash Balance",
    ],

    # ── Projections ────────────────────────────────────────────────────────

    "Projected Turnover": ["Projected Revenue", "Projected Sales", "Expected Turnover"],
    "Projected EBITDA": ["Projected Operating Profit", "Expected EBITDA"],
    "Projected PAT": ["Projected Net Profit", "Expected PAT", "Projected Net Income"],
    "Projected Net Worth": ["Projected Equity", "Expected Networth"],
    "Projected Total Debt": ["Projected Borrowings", "Expected Debt"],
}

# ── Reverse index (built at import time, O(1) lookup) ─────────────────────────

REVERSE: dict[str, str] = {}
for _canonical, _aliases in ALIASES.items():
    REVERSE[_canonical.lower()] = _canonical        # self-match
    for _alias in _aliases:
        REVERSE[_alias.lower()] = _canonical
