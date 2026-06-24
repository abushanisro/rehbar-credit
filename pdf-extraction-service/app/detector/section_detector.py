"""Detect section boundaries within a multi-statement PDF.

A single audited financials PDF typically contains:
  - Balance Sheet
  - Profit & Loss
  - Cash Flow Statement
  - Notes to Accounts

This module scans pages and identifies which section each page belongs to,
so each section can be parsed with the right label set.
"""
import re
from app.schemas.models import PageContent, Section

# Regex patterns for section header detection (case-insensitive)
SECTION_PATTERNS: dict[str, list[str]] = {
    "balance_sheet": [
        r"balance\s+sheet",
        r"statement\s+of\s+financial\s+position",
        r"assets\s+and\s+liabilities",
    ],
    "profit_loss": [
        r"profit\s*(?:and|&)\s*loss",
        r"statement\s+of\s+(?:profit|income)",
        r"income\s+statement",
        r"statement\s+of\s+operations",
        r"revenue\s+and\s+expenditure",
    ],
    "cash_flow": [
        r"cash\s+flow\s+statement",
        r"statement\s+of\s+cash\s+flows",
        r"cash\s+flows?\s+from",
    ],
    "bank_statement": [
        r"account\s+statement",
        r"bank\s+statement",
        r"statement\s+of\s+account",
        r"transaction\s+statement",
    ],
    "gst": [
        r"gstr\s*[-–]?\s*[139]",
        r"gstin",
        r"gst\s+return",
        r"goods\s+and\s+services\s+tax",
    ],
}

_COMPILED: dict[str, list[re.Pattern]] = {
    section: [re.compile(p, re.IGNORECASE) for p in patterns]
    for section, patterns in SECTION_PATTERNS.items()
}


def _score_page(text: str) -> dict[str, int]:
    """Count keyword hits per section type for a page's text."""
    scores: dict[str, int] = {s: 0 for s in SECTION_PATTERNS}
    for section, patterns in _COMPILED.items():
        for pat in patterns:
            if pat.search(text):
                scores[section] += 1
    return scores


def detect_sections(pages: list[PageContent]) -> list[Section]:
    """Return sections detected within the page list.

    Strategy:
    1. Score first 3 lines of each page for section headers.
    2. When a new section header is found, close the previous section.
    3. A page with no header continues the current section.
    """
    if not pages:
        return []

    sections: list[Section] = []
    current_type: str = "unknown"
    current_start: int = pages[0].page_num
    current_pages: list[PageContent] = []

    for page in pages:
        # Check first 25 lines — Indian CA reports often have company headers before section title
        header_text = "\n".join(page.text.splitlines()[:25])
        scores = _score_page(header_text)
        best = max(scores, key=lambda s: scores[s])
        best_score = scores[best]

        if best_score > 0 and best != current_type:
            # Close current section
            if current_pages:
                sections.append(Section(
                    section_type=current_type,
                    start_page=current_start,
                    end_page=current_pages[-1].page_num,
                    pages=current_pages,
                ))
            # Start new section
            current_type = best
            current_start = page.page_num
            current_pages = [page]
        else:
            current_pages.append(page)

    # Close final section
    if current_pages:
        sections.append(Section(
            section_type=current_type,
            start_page=current_start,
            end_page=current_pages[-1].page_num,
            pages=current_pages,
        ))

    return sections


def classify_document(pages: list[PageContent]) -> str:
    """Quick document-level classification using first 3 pages.
    Returns the dominant section type across the whole document.
    Used when section-level detection finds only one section.
    """
    combined = " ".join(p.text for p in pages[:3])
    scores = _score_page(combined)
    best = max(scores, key=lambda s: scores[s])
    return best if scores[best] > 0 else "unknown"
