"""GST return extraction (GSTR-1, GSTR-3B, GSTR-9).

Indian GST returns use standardized government form layouts.
Known field labels are matched with regex from the text layer.
"""
import re
from typing import Optional
from app.schemas.models import PageContent, GstReturnRow

_GSTIN_RE = re.compile(r"\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z0-9])\b")
_RETURN_TYPE_RE = re.compile(r"\b(GSTR\s*[-–]?\s*[139][AB]?)\b", re.IGNORECASE)
_PERIOD_RE = re.compile(
    r"\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-/\']*(?:20\d{2})|"
    r"Q[1-4]\s*(?:FY)?\s*(?:20\d{2}[-–]\d{2,4}|20\d{2})|"
    r"(?:20\d{2})[-/](?:\d{2}))\b",
    re.IGNORECASE,
)

_FIELD_PATTERNS = [
    (re.compile(r"(?:taxable|taxable\s+value|taxable\s+turnover)[\s:]*([0-9,]+(?:\.\d+)?)", re.IGNORECASE), "taxable_turnover"),
    (re.compile(r"(?:total\s+turnover|gross\s+turnover)[\s:]*([0-9,]+(?:\.\d+)?)", re.IGNORECASE), "total_turnover"),
    (re.compile(r"(?:exempt|nil\s+rated|exempted)[\s:]*([0-9,]+(?:\.\d+)?)", re.IGNORECASE), "exempt_turnover"),
    (re.compile(r"(?:output\s+tax|igst\s+payable|cgst\s+payable|total\s+tax\s+liability)[\s:]*([0-9,]+(?:\.\d+)?)", re.IGNORECASE), "output_tax"),
    (re.compile(r"(?:ITC\s+claimed|input\s+tax\s+credit|ITC\s+availed)[\s:]*([0-9,]+(?:\.\d+)?)", re.IGNORECASE), "itc_claimed"),
    (re.compile(r"(?:net\s+tax\s+paid|tax\s+paid|amount\s+paid)[\s:]*([0-9,]+(?:\.\d+)?)", re.IGNORECASE), "net_tax_paid"),
    (re.compile(r"(?:date\s+of\s+filing|filed\s+on)[\s:]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})", re.IGNORECASE), "filing_date"),
]

_FILING_STATUS_RE = re.compile(r"\b(filed|not\s+filed|late\s+filed|pending)\b", re.IGNORECASE)


def _clean_num(text: str) -> Optional[float]:
    cleaned = re.sub(r"[^0-9.\-]", "", text)
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def _normalize_return_type(raw: str) -> str:
    raw = raw.upper().replace(" ", "").replace("-", "").replace("–", "")
    if "GSTR1" in raw:
        return "GSTR-1"
    if "GSTR3B" in raw:
        return "GSTR-3B"
    if "GSTR9" in raw:
        return "GSTR-9"
    return raw


def parse_gst(pages: list[PageContent]) -> list[GstReturnRow]:
    """Extract GST return rows from pages."""
    full_text = "\n".join(p.text for p in pages)
    rows: list[GstReturnRow] = []

    # Detect GSTIN
    gstin: Optional[str] = None
    m = _GSTIN_RE.search(full_text)
    if m:
        gstin = m.group(1)

    # Detect return types present in document
    return_types = list({_normalize_return_type(m.group(1)) for m in _RETURN_TYPE_RE.finditer(full_text)})
    if not return_types:
        return_types = ["GSTR-3B"]  # default assumption

    # Detect periods
    periods = list({m.group(1).strip() for m in _PERIOD_RE.finditer(full_text)})
    if not periods:
        periods = ["unknown"]

    for return_type in return_types:
        for period in periods:
            data: dict = {"period": period, "return_type": return_type, "gstin": gstin}

            # Extract financial fields
            for pattern, field in _FIELD_PATTERNS:
                m = pattern.search(full_text)
                if m:
                    if field == "filing_date":
                        data[field] = m.group(1).strip()
                    else:
                        val = _clean_num(m.group(1))
                        if val is not None:
                            data[field] = val

            # Filing status
            m = _FILING_STATUS_RE.search(full_text)
            if m:
                status = m.group(1).lower()
                if "late" in status:
                    data["filing_status"] = "late"
                elif "not" in status:
                    data["filing_status"] = "not_filed"
                else:
                    data["filing_status"] = "filed"

            rows.append(GstReturnRow(**{k: v for k, v in data.items() if k in GstReturnRow.model_fields}))

    return rows
