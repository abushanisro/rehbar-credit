"""Parser for TransUnion CIBIL Commercial Credit Information Reports (PDF or Excel).

Extracts: header, borrower profile, CIBIL rank, credit summary, enquiry summary,
derogatory flags, credit facilities (with 24-month DPD history), promoter relationships,
and enquiry details into a structured dict suitable for JSONB storage.
"""

import re

import logging
from typing import Optional

log = logging.getLogger("cibil_parser")

MONTHS = r"(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)"


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _build_table_kv(pages) -> dict[str, str]:
    """Extract key-value pairs from tables. Handles both:
    - 2-column KV tables (row[0]=label, row[1]=value)
    - Multi-column tables where cells contain 'Label: Value' text
      (e.g. CIBIL borrower profile: 3 columns with embedded labels)
    First occurrence wins so borrower fields aren't overwritten by guarantor/relationship data.
    """
    kv: dict[str, str] = {}
    skip = {"field", "details", "", "source", "bureau name", "response",
            "rank name", "month", "ac / dpd", "o/s amount(rs)", "cf group"}

    for p in pages:
        for table in p.tables:
            for row in table:
                # Strategy 1: 2-column KV tables
                if len(row) == 2:
                    key = _clean(row[0]).rstrip(":").strip("*").strip()
                    val = _clean(row[1])
                    key_lower = key.lower()
                    if key_lower not in skip and val and key_lower not in kv:
                        kv[key_lower] = val

                # Strategy 2: parse "Label: Value" within each cell
                for cell in row:
                    cell_text = _clean(cell)
                    if ":" not in cell_text:
                        continue
                    label, _, value = cell_text.partition(":")
                    label = label.strip().strip("*").strip()
                    value = value.strip()
                    label_lower = label.lower()
                    if (label_lower not in skip and value
                            and label_lower not in kv and len(label) < 60):
                        kv[label_lower] = value
    return kv


def _parse_amount(s: str) -> Optional[float]:
    """Convert '1,72,96,475' or '13,36,20,690' to float."""
    try:
        return float(re.sub(r"[,\s]", "", s))
    except Exception:
        return None


def _find_pan(s: str) -> str:
    """Match PAN values from common label variants like 'PAN', 'PAN No', or 'PAN Number'."""
    m = re.search(
        r"\bPAN(?:\s*(?:No(?:\.)?|Number)?)?[:\s]+([A-Z]{5}\d{4}[A-Z])\b",
        s,
        re.IGNORECASE,
    )
    return m.group(1) if m else ""


def _parse_cibil_date(s: str) -> Optional[str]:
    """Convert '02-MAR-2026' to 'YYYY-MM-DD' for PostgreSQL date."""
    mon_map = {
        "JAN": "01", "FEB": "02", "MAR": "03", "APR": "04",
        "MAY": "05", "JUN": "06", "JUL": "07", "AUG": "08",
        "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12",
    }
    m = re.match(r"(\d{1,2})[- ](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[- ](\d{4})", s.upper())
    if m:
        return f"{m.group(3)}-{mon_map[m.group(2)]}-{int(m.group(1)):02d}"
    return None


def _is_crif_consumer_report(text: str) -> bool:
    return bool(re.search(r"CONSUMER\s+BASE|CRIF\s+High\s+Mark|CHM\s+Ref|PERFORM\s+CONSUMER", text, re.IGNORECASE))


def _extract_crif_header(text: str) -> dict:
    order_no = ""
    order_date = ""
    member = ""
    app_ref = ""

    m = re.search(r"CHM\s+Ref\s*#\s*[:\s]+([^\n]+)", text, re.IGNORECASE)
    if m:
        order_no = _clean(m.group(1))

    m = re.search(r"Date\s+of\s+Issue[:\s]+(\d{1,2}[- ]\d{2}[- ]\d{4})", text, re.IGNORECASE)
    if m:
        order_date = _clean(m.group(1))

    m = re.search(r"Prepared\s+For[:\s]+([A-Z0-9&.,\s]+?)\s*(?:Date of Request|Application ID|Inquiry|Name|DOB|$)", text, re.IGNORECASE)
    if m:
        member = _clean(m.group(1))

    m = re.search(r"Application\s+ID[:\s]+([A-Z0-9\-]+)", text, re.IGNORECASE)
    if m:
        app_ref = _clean(m.group(1))

    return {
        "report_order_no": order_no,
        "report_date": order_date,
        "member": member,
        "application_ref": app_ref,
    }


def _extract_crif_borrower(text: str, kv: dict[str, str] | None = None) -> dict:
    kv = kv or {}
    result: dict[str, str] = {
        "name": "", "pan": "", "cin": "", "constitution": "",
        "category": "", "industry": "", "incorporation_date": "", "address": "",
    }

    # Name and DOB
    result["name"] = kv.get("name", "")
    if not result["name"]:
        m = re.search(r"Name[:\s]+([A-Z][A-Z\s\.\-]+?)(?:\s+DOB|\s+DOB/Age|$)", text)
        if m:
            result["name"] = _clean(m.group(1))

    # PAN
    result["pan"] = kv.get("pan", "") or _find_pan(text)
    if not result["pan"]:
        m = re.search(r"ID\(s\)[:\s]+([A-Z0-9]+)\s*\[PAN\]", text, re.IGNORECASE)
        if m:
            result["pan"] = m.group(1).strip().upper()

    # Address
    if not result["address"]:
        m = re.search(r"Current Address[:\s]+(.+?)(?:\nOther Address:|\nEmail|\nID\(s\):|$)", text, re.IGNORECASE | re.DOTALL)
        if m:
            result["address"] = _clean(m.group(1))

    return result


def _extract_crif_score(text: str) -> dict:
    result = {"name": "", "value": "", "exclusions": []}
    m = re.search(r"(PERFORM\s+CONSUMER\s+[\d.]+)\s+([0-9]{3})", text, re.IGNORECASE)
    if m:
        result["name"] = _clean(m.group(1).upper())
        result["value"] = m.group(2)
    return result


def _extract_crif_credit_summary(text: str) -> dict:
    def _parse_row(label: str) -> dict:
        m = re.search(
            rf"{label}\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d,]+)\s+([\d,]+)",
            text,
            re.IGNORECASE,
        )
        if m:
            return {
                "open_cf": int(m.group(2)),
                "outstanding": _parse_amount(m.group(4)) or 0,
                "delinquent_cf": int(m.group(3)),
            }
        return {"open_cf": 0, "outstanding": 0, "delinquent_cf": 0}

    your_inst = _parse_row(r"Primary Match")
    outside = {"open_cf": 0, "outstanding": 0, "delinquent_cf": 0}
    total = _parse_row(r"Total")
    return {"your_institution": your_inst, "outside": outside, "total": total}


def _extract_crif_accounts(text: str) -> list:
    facilities = []
    parts = re.split(r"(?m)^\d+\s+Account Type:\s*", text)
    for part in parts[1:]:
        facility: dict = {
            "number": 0,
            "type": "",
            "member": "",
            "dpd_status": "",
            "status_open": False,
            "suit_filed": False,
            "wilful_default": False,
            "sanctioned": 0.0,
            "drawing_power": 0.0,
            "outstanding": 0.0,
            "overdue": 0.0,
            "sanctioned_date": "",
            "repayment_frequency": "",
            "dpd_history": [],
            "guarantors": []
        }

        m = re.search(r"^([0-9]+)\s+", part)
        if m:
            facility["number"] = int(m.group(1))

        m = re.search(r"Account Type:\s*([^\n]+?)\s+Credit Grantor:", part, re.IGNORECASE)
        if m:
            facility["type"] = _clean(m.group(1))
        else:
            m = re.search(r"^([A-Z][A-Z\s\(\)]+)$", part, re.MULTILINE)
            if m:
                facility["type"] = _clean(m.group(1))

        m = re.search(r"Credit Grantor:\s*([^\n]+)", part, re.IGNORECASE)
        if m:
            facility["member"] = _clean(m.group(1))

        m = re.search(r"Account #:\s*([^\s\n]+)", part, re.IGNORECASE)
        if m:
            facility["number"] = facility["number"] or 0

        m = re.search(r"Current Balance:\s*([\d,]+)", part, re.IGNORECASE)
        if m:
            facility["outstanding"] = _parse_amount(m.group(1)) or 0

        m = re.search(r"Disbd Amt/High Credit:\s*([\d,]+)", part, re.IGNORECASE)
        if m:
            facility["sanctioned"] = _parse_amount(m.group(1)) or 0

        m = re.search(r"Overdue Amt:\s*([\d,]+)", part, re.IGNORECASE)
        if m:
            facility["overdue"] = _parse_amount(m.group(1)) or 0

        m = re.search(r"Disbursed Date:\s*([0-9]{1,2}[- ][A-Z]{3}[- ][0-9]{4})", part, re.IGNORECASE)
        if m:
            facility["sanctioned_date"] = _clean(m.group(1))

        m = re.search(r"InstlAmt/Freq:\s*[^/]+/([A-Za-z]+)", part, re.IGNORECASE)
        if m:
            facility["repayment_frequency"] = _clean(m.group(1))

        m = re.search(r"^\s*(ACTIVE|CLOSED|GUARANTOR)\s*$", part, re.IGNORECASE | re.MULTILINE)
        if m:
            facility["status_open"] = m.group(1).upper() == "ACTIVE"
            facility["dpd_status"] = m.group(1).upper()

        if facility["type"] or facility["member"] or facility["outstanding"] or facility["sanctioned"]:
            facilities.append(facility)
    return facilities


def _extract_crif_enquiry_summary(text: str) -> dict:
    inquiries = {"1m": 0, "2_3m": 0, "4_6m": 0, "7_12m": 0, "12_24m": 0, "over_24m": 0, "total": 0}
    m = re.search(r"Inquiries in last 24 Months[:\s]+(\d+)", text, re.IGNORECASE)
    if m:
        inquiries["total"] = int(m.group(1))
    return {"your_institution": inquiries, "outside": inquiries, "total": inquiries}


# ── Section extractors ──────────────────────────────────────────────────────────

def _extract_header(text: str) -> dict:
    order_no = ""
    order_date = ""
    member = ""
    app_ref = ""

    m = re.search(r"Report Order Number[:\s]+([\w\-]+)", text)
    if m:
        order_no = m.group(1).strip()

    m = re.search(r"Report Order Date[:\s]+(\d{1,2}[- ][A-Z]{3}[- ]\d{4})", text, re.IGNORECASE)
    if m:
        order_date = m.group(1).strip()

    # Member line appears after "Member:" or "Report Ordered By:" context
    m = re.search(r"\nMember[:\s]+([A-Z][A-Z\s&]+?)\s*\n", text)
    if m:
        member = _clean(m.group(1))

    m = re.search(r"Application Ref(?:erence)? Num(?:ber)?[:\s]+(\w+)", text, re.IGNORECASE)
    if m:
        app_ref = m.group(1).strip()

    return {
        "report_order_no": order_no,
        "report_date": order_date,
        "member": member,
        "application_ref": app_ref,
    }


def _extract_borrower(text: str, kv: dict[str, str] | None = None) -> dict:
    kv = kv or {}
    result: dict[str, str] = {
        "name": "", "pan": "", "cin": "", "constitution": "",
        "category": "", "industry": "", "incorporation_date": "", "address": "",
    }

    # Name: KV dict → Search Criteria → regex fallbacks
    result["name"] = kv.get("name", "") or kv.get("customer name", "")
    if not result["name"]:
        m = re.search(r"Search Criteria[:\s]+([A-Z][A-Z\s&()\-\.,]+?),\s*[A-Z]{5}\d{4}[A-Z]", text)
        if m:
            result["name"] = _clean(m.group(1))
    if not result["name"]:
        m = re.search(r"(?:Borrower|Customer)\s*Name[:\s]+([A-Z][A-Z\s&()\-\.,]+?)(?:\n|$)", text, re.IGNORECASE)
        if m:
            result["name"] = _clean(m.group(1))
    if not result["name"]:
        m = re.search(r"\bName[:\s]+([A-Z][A-Z\s&()\-\.,]*?(?:LIMITED|LTD|PVT|PRIVATE|LLP|CORP)[\w\s]*?)(?:\n|$)", text)
        if m:
            result["name"] = _clean(m.group(1))

    # PAN
    result["pan"] = kv.get("pan", "") or kv.get("pan no", "") or kv.get("pan number", "")
    if not result["pan"]:
        result["pan"] = _find_pan(text)

    # CIN
    result["cin"] = kv.get("cin", "")

    # Legal Constitution
    result["constitution"] = kv.get("legal constitution", "")
    if not result["constitution"]:
        m = re.search(r"Legal Constitution[:\s]+([A-Za-z\s]+?)(?:\n|Telephone|Class|$)", text)
        if m:
            result["constitution"] = _clean(m.group(1))

    # Business Category
    result["category"] = kv.get("business category", "")
    if not result["category"]:
        m = re.search(r"Business Category[:\s]+([A-Za-z\s]+?)(?:\n|Industry|$)", text)
        if m:
            result["category"] = _clean(m.group(1))

    # Industry Type
    result["industry"] = kv.get("industry type", "")
    if not result["industry"]:
        m = re.search(r"Industry Type[:\s]+([A-Za-z\s&]+?)(?:\n|Sales|$)", text)
        if m:
            result["industry"] = _clean(m.group(1))

    # Date of Incorporation
    result["incorporation_date"] = kv.get("date of incorporation", "")
    if not result["incorporation_date"]:
        m = re.search(r"Date of Incorporation[:\s]+(\d{1,2}[- ][A-Z]{3}[- ]\d{4})", text, re.IGNORECASE)
        if m:
            result["incorporation_date"] = m.group(1).strip()

    # Registered Office Address
    result["address"] = kv.get("registered office address", "")
    if not result["address"]:
        m = re.search(r"Registered Office Address[:\s]+(.+?)(?:PAN:|Telephone|$)", text, re.DOTALL)
        if m:
            result["address"] = _clean(m.group(1))

    return result


def _extract_rank(text: str) -> dict:
    result = {"name": "CIBIL MSME Rank", "value": "", "exclusions": []}

    # Rank value like "CMR-2" or "CMR-10"
    m = re.search(r"CIBIL MSME Rank\s+(CMR[-\s]?\d+)", text, re.IGNORECASE)
    if m:
        result["value"] = re.sub(r"\s", "", m.group(1).upper())  # normalize "CMR 2" → "CMR-2"
        result["value"] = result["value"].replace("CMR", "CMR-").replace("CMR--", "CMR-")

    # Exclusion reason codes (like ACCE6G, AGTR4R, UTIL2R — alphanumeric codes followed by dash-description)
    exclusions = re.findall(r"([A-Z0-9]{6,8}\s*[-–]\s*[A-Za-z][A-Za-z\s,]+?)(?=\n[A-Z0-9]{6}|\nCommercial|\n\d+\.|$)", text)
    if exclusions:
        result["exclusions"] = [_clean(e) for e in exclusions[:10]]
    else:
        # Fallback: lines under the rank section
        rank_section = re.search(r"CIBIL MSME Rank.{0,200}", text, re.DOTALL)
        if rank_section:
            lines = [line.strip() for line in rank_section.group(0).split("\n") if len(line.strip()) > 10]
            result["exclusions"] = lines[2:6]  # skip rank name + rank value lines

    return result


def _extract_credit_summary(text: str) -> dict:
    def _row(label_pattern: str) -> dict:
        m = re.search(
            label_pattern + r"[\s\d]+?(\d[\d,]+)\s+(\d[\d,]+)\s+(\d[\d,]*)",
            text, re.IGNORECASE
        )
        if m:
            return {
                "open_cf":       int(_parse_amount(m.group(1)) or 0),
                "outstanding":   _parse_amount(m.group(2)) or 0,
                "delinquent_cf": int(_parse_amount(m.group(3)) or 0),
            }
        return {"open_cf": 0, "outstanding": 0, "delinquent_cf": 0}

    # Try to find the Credit Profile Summary section totals
    your_inst = _row(r"Your Institution")
    outside   = _row(r"Outside\s*-\s*Total|Outside Total")
    total     = _row(r"^Total\s")

    # Better approach: look for the summary table
    # Pattern: lines like "Your Institution 1 8 0 8 17,25,91,065 ..."
    m = re.search(r"Your Institution\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d,]+)", text)
    if m:
        your_inst = {
            "open_cf": int(m.group(4)),
            "outstanding": _parse_amount(m.group(5)) or 0,
            "delinquent_cf": 0,
        }

    m = re.search(r"(?:Outside\s*-\s*Total|Outside Total)\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d,\(\)\.%]+)", text)
    if m:
        outside = {
            "open_cf": int(m.group(4)),
            "outstanding": _parse_amount(re.sub(r"[()%]", "", m.group(5))) or 0,
            "delinquent_cf": 0,
        }

    m = re.search(r"^Total\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d,]+)", text, re.MULTILINE)
    if m:
        total = {
            "open_cf": int(m.group(3)),
            "outstanding": _parse_amount(m.group(4)) or 0,
            "delinquent_cf": 0,
        }

    return {"your_institution": your_inst, "outside": outside, "total": total}


def _extract_enquiry_summary(text: str) -> dict:
    def _parse_row(pattern: str) -> dict:
        m = re.search(pattern + r"\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)", text, re.IGNORECASE | re.MULTILINE)
        if m:
            return {
                "1m": int(m.group(1)), "2_3m": int(m.group(2)), "4_6m": int(m.group(3)),
                "7_12m": int(m.group(4)), "12_24m": int(m.group(5)), "over_24m": int(m.group(6)),
                "total": int(m.group(7)),
            }
        return {"1m": 0, "2_3m": 0, "4_6m": 0, "7_12m": 0, "12_24m": 0, "over_24m": 0, "total": 0}

    your_inst = _parse_row(r"Your Institution")
    outside   = _parse_row(r"Outside")
    total_row = _parse_row(r"^Total")

    # Most recent outside enquiry date
    m = re.search(r"Outside\s+[\d\s]+(\d{2}-[A-Z]{3}-\d{4})", text)
    if m:
        outside["most_recent"] = m.group(1)

    return {"your_institution": your_inst, "outside": outside, "total": total_row}


def _extract_derogatory(text: str) -> bool:
    if re.search(r"No Derogatory information Reported", text, re.IGNORECASE):
        return False
    if re.search(r"Suit Filed|Wilful Default|Written Off|Settled|NPA", text, re.IGNORECASE):
        return True
    return False


def _extract_facilities(text: str) -> list:
    """Split on 'Credit Facility N. Type:' boundaries and parse each block."""
    # Split text into facility blocks
    blocks = re.split(r"Credit Facility\s+(\d+)\.\s*Type:", text)
    # blocks = [pre_text, num1, body1, num2, body2, ...]

    facilities = []
    i = 1
    while i < len(blocks) - 1:
        num_str = blocks[i].strip()
        body    = blocks[i + 1]
        i += 2

        facility: dict = {"number": int(num_str) if num_str.isdigit() else len(facilities) + 1}

        # Type is the first line of body
        lines = body.strip().splitlines()
        facility["type"] = _clean(lines[0]) if lines else ""

        # Member
        m = re.search(r"Member[:\s]+([A-Z][A-Z\s&]+?)(?:\n|$)", body)
        facility["member"] = _clean(m.group(1)) if m else ""

        # DPD / Asset Classification status
        m = re.search(r"(\d+ Day Past Due|NPA|Substandard|Doubtful|Loss|Standard)", body)
        facility["dpd_status"] = m.group(1) if m else ""

        # Open/closed
        facility["status_open"] = bool(re.search(r"\bOpen\b", body, re.IGNORECASE))
        facility["suit_filed"]  = bool(re.search(r"\bSuit Filed\b", body, re.IGNORECASE)) and \
                                   not bool(re.search(r"Not a Suit Filed", body, re.IGNORECASE))
        facility["wilful_default"] = bool(re.search(r"Wilful Defaulter", body, re.IGNORECASE)) and \
                                      not bool(re.search(r"Not Wilful", body, re.IGNORECASE))

        # Amounts
        for field, pat in [
            ("sanctioned",     r"Sanctioned\s*:\s*([\d,]+)"),
            ("drawing_power",  r"Drawing Power[:\s]+([\d,]+)"),
            ("outstanding",    r"Outstanding Balance[:\s]+([\d,]+)"),
            ("overdue",        r"Overdue[:\s]+([\d,]+)"),
        ]:
            m = re.search(pat, body)
            facility[field] = _parse_amount(m.group(1)) if m else 0.0

        # Sanctioned date
        m = re.search(r"Sanctioned[:\s]+(\d{1,2}[- ][A-Z]{3}[- ]\d{4})", body)
        if m:
            facility["sanctioned_date"] = m.group(1)
        else:
            facility["sanctioned_date"] = ""


        # Repayment frequency


        m = re.search(r"Repayment Frequency[:\s]+([A-Za-z]+)", body)
        if m:
            facility["repayment_frequency"] = m.group(1)
        else:
            facility["repayment_frequency"] = ""

        # 24-month DPD history
        facility["dpd_history"] = _extract_dpd_history(body)

        # Guarantors
        facility["guarantors"] = _extract_guarantors(body)

        facilities.append(facility)

    return facilities


def _extract_dpd_history(block: str) -> list:
    """Extract month-by-month DPD history from a facility block."""
    history = []

    # Find month rows: "Month JAN 2026 DEC 2025 ..." then "AC / DPD ... " then "O/S Amount ..."
    month_header = re.search(r"Month\s+((?:" + MONTHS + r"\s+\d{4}\s*)+)", block)
    dpd_row      = re.search(r"AC\s*/\s*DPD\s+((?:[\w\s]+?(?:Due|Standard)\s*)+)", block)
    os_row       = re.search(r"O/S Amount\(Rs\)\s+((?:[-\d,\s]+))", block)

    if not month_header:
        return history

    months_raw = re.findall(MONTHS + r"\s+\d{4}", month_header.group(1))
    dpd_vals   = re.findall(r"(\d+ Day Past Due|Standard|NPA|Substandard)", dpd_row.group(1)) if dpd_row else []
    os_vals    = re.findall(r"[-\d,]+", os_row.group(1)) if os_row else []

    for idx, mon in enumerate(months_raw):
        entry: dict = {"month": _clean(mon)}
        if idx < len(dpd_vals):
            entry["dpd"] = dpd_vals[idx]
        if idx < len(os_vals):
            entry["outstanding"] = _parse_amount(os_vals[idx])
        history.append(entry)

    return history


def _extract_guarantors(block: str) -> list:
    guarantors = []
    # Each guarantor block starts with "GUARANTOR DETAILS"
    parts = re.split(r"GUARANTOR DETAILS", block)
    for part in parts[1:]:
        g: dict = {}
        m = re.search(r"Name[:\s]+([A-Z][A-Z\s]+?)(?:\n|Address)", part)
        if m:
            g["name"] = _clean(m.group(1))
        g["pan"] = _find_pan(part)
        m = re.search(r"Date of Birth[:\s]+(\d{1,2}[- ][A-Z]{3}[- ]\d{4})", part)
        if m:
            g["dob"] = m.group(1)
        m = re.search(r"Gender[:\s]+(\w+)", part)
        if m:
            g["gender"] = m.group(1)
        if g:
            guarantors.append(g)
    return guarantors


def _extract_relationships(text: str) -> list:
    """Extract Promoter Directors / Related Parties from Relationship Details section."""
    relationships = []

    # Split on "Relationship N\n" markers
    parts = re.split(r"Relationship\s+\d+\s*\n", text)
    for part in parts[1:]:
        r: dict = {}
        m = re.search(r"Name[:\s]+([A-Z][A-Z\s]+?)(?:\n|Address)", part)
        if m:
            r["name"] = _clean(m.group(1))
        m = re.search(r"Type[:\s]+([A-Za-z\s]+?)(?:\n|$)", part)
        if m:
            r["type"] = _clean(m.group(1))
        m = re.search(r"Relationship[:\s]+([A-Za-z\s]+?)(?:\n|Percentage|$)", part)
        if m:
            r["relationship"] = _clean(m.group(1))
        m = re.search(r"Percentage Holding[:\s]+([\d.]+)%?", part)
        if m:
            r["holding_pct"] = float(m.group(1))
        else:
            r["holding_pct"] = 0.0
        m = re.search(r"Date of Birth[:\s]+(\d{1,2}[- ][A-Z]{3}[- ]\d{4})", part)
        if m:
            r["dob"] = m.group(1)
        m = re.search(r"Gender[:\s]+(\w+)", part)
        if m:
            r["gender"] = m.group(1)
        r["pan"] = _find_pan(part)
        m = re.search(r"\bDIN[:\s]+([\d]+)\b", part)
        if m:
            r["din"] = m.group(1)
        else:
            r["din"] = ""
        if r.get("name"):
            relationships.append(r)

    return relationships


def _extract_enquiry_details(text: str) -> list:
    """Extract enquiry history table (last 24 months)."""
    details = []

    # Find section 14 (or "Enquiry Details in Last 24 Months")
    section_m = re.search(r"14\.?Enquiry Details.+?(?=END OF REPORT|\Z)", text, re.DOTALL | re.IGNORECASE)
    if not section_m:
        section_m = re.search(r"Enquiry Details in\s+Last 24 Months.+?(?=END OF REPORT|\Z)", text, re.DOTALL | re.IGNORECASE)

    if not section_m:
        return details

    section = section_m.group(0)

    # Lines like: "ICICI BANK LIMITED 01-DEC-2025 Overdraft 1,000"
    rows = re.findall(
        r"([A-Z][A-Z\s&\-]+?)\s+(\d{2}-[A-Z]{3}-\d{4})\s+([A-Za-z][A-Za-z\s\-]+?)\s+([\d,]+)\s*\n",
        section
    )
    for row in rows:
        details.append({
            "lender": _clean(row[0]),
            "date":   row[1],
            "type":   _clean(row[2]),
            "amount": _parse_amount(row[3]),
        })

    return details


# ── Public API ──────────────────────────────────────────────────────────────────

def parse_cibil(pages) -> dict:
    """Parse CIBIL Commercial Credit Report pages into structured dict.

    Args:
        pages: list[PageContent] from pdf_reader or excel_reader
    Returns:
        dict suitable for storage in cibil_report_data.report_data (JSONB)
    """
    text = "\n".join(p.text for p in pages)
    kv = _build_table_kv(pages)

    if len(text.strip()) < 100:
        log.warning("CIBIL parse: very little text extracted — may be scanned or empty PDF")

    if _is_crif_consumer_report(text):
        header = _extract_crif_header(text)
        borrower = _extract_crif_borrower(text, kv)
        rank = _extract_crif_score(text)
        credit_summary = _extract_crif_credit_summary(text)
        enquiry_summary = _extract_crif_enquiry_summary(text)
        derogatory = _extract_derogatory(text)
        facilities = _extract_crif_accounts(text)
        relationships = []
        enquiry_details = []
    else:
        header = _extract_header(text)
        borrower = _extract_borrower(text, kv)
        rank = _extract_rank(text)
        credit_summary = _extract_credit_summary(text)
        enquiry_summary = _extract_enquiry_summary(text)
        derogatory = _extract_derogatory(text)
        facilities = _extract_facilities(text)
        relationships = _extract_relationships(text)
        enquiry_details = _extract_enquiry_details(text)

    log.info(
        f"CIBIL parsed: borrower={borrower.get('name', '')!r} rank={rank.get('value', '')} "
        f"facilities={len(facilities)} relationships={len(relationships)} enquiries={len(enquiry_details)}"
    )

    return {
        **header,
        "borrower":        borrower,
        "rank":            rank,
        "credit_summary":  credit_summary,
        "enquiry_summary": enquiry_summary,
        "derogatory":      derogatory,
        "facilities":      facilities,
        "relationships":   relationships,
        "enquiry_details": enquiry_details,
    }


def parse_cibil_date_for_db(date_str: str) -> Optional[str]:
    """Exposed helper for worker.py to convert CIBIL date to DB-compatible format."""
    return _parse_cibil_date(date_str or "")
