"""Log unmatched labels to a JSONL file for analyst review.

Analysts review this log in a feedback screen and map new labels to canonical names.
Approved mappings get committed back to aliases.py — this is how the alias dict grows.
"""
import json
import os
from datetime import datetime, timezone
from app.config import UNMATCHED_LOG_PATH


def record_unmatched(raw_label: str, pdf_id: str = "", page: int = 0, table: int = 0):
    """Append an unmatched label to the log file."""
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "raw_label": raw_label,
        "pdf_id": pdf_id,
        "page": page,
        "table": table,
    }
    try:
        with open(UNMATCHED_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError:
        pass  # non-critical — don't fail extraction because of logging


def read_unmatched(limit: int = 500) -> list[dict]:
    """Read recent unmatched labels for the analyst review UI."""
    if not os.path.exists(UNMATCHED_LOG_PATH):
        return []
    try:
        with open(UNMATCHED_LOG_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()
        return [json.loads(line) for line in lines[-limit:]]
    except (OSError, json.JSONDecodeError):
        return []
