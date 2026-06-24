from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from pydantic import BaseModel


# ── Line item (maps to extracted_financials.line_items jsonb array) ──────────

class LineItem(BaseModel):
    label: str
    value: Optional[float] = None
    confidence: int
    reviewed: bool = False
    override_value: Optional[float] = None
    note: str = ""
    # Provenance (Phase 2 — stored in jsonb, no migration needed)
    source_page: Optional[int] = None
    source_table: Optional[int] = None
    extraction_method: Optional[str] = None   # pdfplumber | paddleocr
    match_method: Optional[str] = None        # alias | embedding | unmatched


# ── Raw table row (maps to extraction_raw_rows table) ─────────────────────────

@dataclass
class RawTableRow:
    page_number: int
    table_index: int
    row_index: int
    raw_cells: list[str]
    mapped_label: Optional[str]
    mapped_value: Optional[float]
    fiscal_year: Optional[int]
    statement_type: Optional[str]
    match_method: str
    confidence: int


# ── Section detected in PDF ───────────────────────────────────────────────────

@dataclass
class Section:
    section_type: str   # profit_loss | balance_sheet | cash_flow | bank_statement | gst | unknown
    start_page: int
    end_page: int
    pages: list["PageContent"] = field(default_factory=list)


# ── Page content from PDF reader ─────────────────────────────────────────────

@dataclass
class PageContent:
    page_num: int
    text: str
    tables: list[list[list[str]]] = field(default_factory=list)


# ── Validation flag ───────────────────────────────────────────────────────────

@dataclass
class ValidationFlag:
    rule: str
    message: str
    severity: str   # HIGH | MEDIUM | LOW


# ── Extracted statement (one per statement_type × fiscal_year) ───────────────

@dataclass
class ExtractedStatement:
    statement_type: str
    fiscal_year: int
    line_items: list[LineItem]
    review_status: str = "analyst_review"   # auto_approve | analyst_review | gemini_then_review
    validation_flags: list[ValidationFlag] = field(default_factory=list)
    avg_confidence: float = 0.0


# ── Full extraction result ────────────────────────────────────────────────────

@dataclass
class ExtractionResult:
    unit: Optional[str]
    statements: list[ExtractedStatement]
    raw_rows: list[RawTableRow]
    method: str   # pdfplumber | paddleocr
    avg_confidence: float


# ── Bank statement row (maps to bank_statement_data) ─────────────────────────

class BankStatementRow(BaseModel):
    month: str                          # YYYY-MM
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    opening_balance: Optional[float] = None
    closing_balance: Optional[float] = None
    total_credits: Optional[float] = None
    total_debits: Optional[float] = None
    credit_count: Optional[int] = None
    debit_count: Optional[int] = None
    avg_balance: Optional[float] = None
    min_balance: Optional[float] = None
    max_balance: Optional[float] = None
    bounce_inward: int = 0
    bounce_outward: int = 0
    emi_outflows: Optional[float] = None
    remarks: str = ""


# ── GST return row (maps to gst_return_data) ─────────────────────────────────

class GstReturnRow(BaseModel):
    period: str                         # YYYY-MM or Q1 FY2025
    return_type: str                    # GSTR-1 | GSTR-3B | GSTR-9
    gstin: Optional[str] = None
    taxable_turnover: Optional[float] = None
    exempt_turnover: Optional[float] = None
    total_turnover: Optional[float] = None
    output_tax: Optional[float] = None
    itc_claimed: Optional[float] = None
    net_tax_paid: Optional[float] = None
    filing_date: Optional[str] = None
    filing_status: Optional[str] = None  # filed | not_filed | late
