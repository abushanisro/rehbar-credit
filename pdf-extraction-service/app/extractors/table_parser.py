"""Parse financial tables from section pages into line items.

Core algorithm:
1. For each table in the section, detect fiscal year columns from header row.
2. For each subsequent row: normalize label → alias match → produce LineItem.
3. Return one ExtractedStatement per (statement_type, fiscal_year) found.
4. Also return RawTableRows for audit.
"""
import re
from typing import Optional
from app.schemas.models import (
    PageContent, Section, ExtractedStatement, LineItem, RawTableRow
)
from app.semantic import match_label


_FY_PATTERNS = [
    re.compile(r"\bFY\s*(\d{2,4})\b", re.IGNORECASE),
    re.compile(r"\b(\d{4})\s*[-–]\s*(\d{2,4})\b"),        # 2023-24 or 2023-2024
    re.compile(r"\bMarch\s+(\d{4})\b", re.IGNORECASE),
    re.compile(r"\b(\d{4})\b"),                             # bare 4-digit year
]

_NUMBER_RE = re.compile(r"[^\d.\-]")  # strip commas, parentheses etc.


def _parse_fy(text: str) -> Optional[int]:
    """Extract a 4-digit fiscal year from a header cell."""
    text = text.strip()
    # FY24 → 2024
    m = re.search(r"\bFY\s*(\d{2})\b", text, re.IGNORECASE)
    if m:
        yr = int(m.group(1))
        return 2000 + yr if yr < 100 else yr

    # 2023-24 → 2024 (end year convention for Indian FY)
    m = re.search(r"\b(\d{4})\s*[-–]\s*(\d{2,4})\b", text)
    if m:
        end = m.group(2)
        if len(end) == 2:
            return 2000 + int(end)
        return int(end)

    # March 2024
    m = re.search(r"\bMarch\s+(\d{4})\b", text, re.IGNORECASE)
    if m:
        return int(m.group(1))

    # Bare 4-digit year
    m = re.search(r"\b(20\d{2})\b", text)
    if m:
        return int(m.group(1))

    return None


def _parse_number(text: str) -> Optional[float]:
    """Convert cell text to float. Handles commas, parentheses (negatives)."""
    if not text or not text.strip():
        return None
    text = text.strip()
    negative = text.startswith("(") and text.endswith(")")
    cleaned = _NUMBER_RE.sub("", text)
    if not cleaned:
        return None
    try:
        val = float(cleaned)
        return -val if negative else val
    except ValueError:
        return None


def _detect_year_columns(header_row: list[str]) -> dict[int, int]:
    """Return {col_index: fiscal_year} for header cells that contain a year."""
    result: dict[int, int] = {}
    for i, cell in enumerate(header_row):
        fy = _parse_fy(cell)
        if fy:
            result[i] = fy
    return result


def _is_header_row(row: list[str]) -> bool:
    """Heuristic: a row is a header if it contains a year or 'FY' marker."""
    combined = " ".join(row)
    return bool(re.search(r"\b(FY|20\d{2}|March|Year)\b", combined, re.IGNORECASE))


def _is_section_label(row: list[str]) -> bool:
    """A row with a non-empty first cell but all-empty or non-numeric subsequent cells."""
    if not row or not row[0].strip():
        return False
    for cell in row[1:]:
        if _parse_number(cell) is not None:
            return False
    return True


def parse_section(
    section: Section,
    stmt_type: str,
) -> tuple[list[ExtractedStatement], list[RawTableRow]]:
    """Parse a detected section into ExtractedStatements and RawTableRows."""
    # Collect all tables from section pages
    raw_rows: list[RawTableRow] = []
    # fy → {label → LineItem}
    fy_items: dict[int, dict[str, LineItem]] = {}

    for page in section.pages:
        for tbl_idx, table in enumerate(page.tables):
            if len(table) < 2:
                continue

            # Find header row (first row containing a year — scan all rows up to 10)
            header_idx = 0
            year_cols: dict[int, int] = {}
            for row_idx, row in enumerate(table[:10]):
                yc = _detect_year_columns(row)
                if yc:
                    header_idx = row_idx
                    year_cols = yc
                    break

            if not year_cols:
                continue  # no years found in this table, skip

            # Parse data rows
            for row_idx, row in enumerate(table):
                if row_idx <= header_idx:
                    continue
                if not row or not row[0].strip():
                    continue
                label_raw = row[0].strip()
                if _is_section_label(row):
                    continue

                canonical, confidence, method = match_label(label_raw)

                for col_idx, fy in year_cols.items():
                    if col_idx >= len(row):
                        continue
                    value = _parse_number(row[col_idx])

                    raw_rows.append(RawTableRow(
                        page_number=page.page_num,
                        table_index=tbl_idx,
                        row_index=row_idx,
                        raw_cells=row,
                        mapped_label=canonical if method != "unmatched" else None,
                        mapped_value=value,
                        fiscal_year=fy,
                        statement_type=stmt_type,
                        match_method=method,
                        confidence=confidence,
                    ))

                    if fy not in fy_items:
                        fy_items[fy] = {}

                    # Don't overwrite a higher-confidence extraction
                    if canonical not in fy_items[fy] or confidence > fy_items[fy][canonical].confidence:
                        fy_items[fy][canonical] = LineItem(
                            label=canonical,
                            value=value,
                            confidence=confidence,
                            reviewed=confidence >= 90,
                            source_page=page.page_num,
                            source_table=tbl_idx,
                            extraction_method="pdfplumber",
                            match_method=method,
                        )

    # Assemble ExtractedStatements
    statements: list[ExtractedStatement] = []
    for fy, items in sorted(fy_items.items()):
        line_items = list(items.values())
        if not line_items:
            continue
        avg_conf = sum(li.confidence for li in line_items) / len(line_items)
        statements.append(ExtractedStatement(
            statement_type=stmt_type,
            fiscal_year=fy,
            line_items=line_items,
            avg_confidence=avg_conf,
        ))

    return statements, raw_rows
