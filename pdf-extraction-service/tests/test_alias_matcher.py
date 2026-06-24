"""Tests for alias-based label matching."""
import pytest
from app.semantic import match_label


@pytest.mark.parametrize("raw,expected_canonical", [
    ("Revenue from Operations", "Turnover"),
    ("revenue from operations", "Turnover"),   # case-insensitive
    ("Net Sales", "Turnover"),
    ("Sales Turnover", "Turnover"),
    ("Profit After Tax", "PAT"),
    ("Net Profit", "PAT"),
    ("Profit/(Loss) for the Year", "PAT"),
    ("Finance Costs", "Interest Expense"),
    ("Borrowing Costs", "Interest Expense"),
    ("Shareholders Equity", "Net Worth"),
    ("Total Equity", "Net Worth"),
    ("Inventories", "Inventory"),
    ("Trade Debtors", "Trade Receivables"),
    ("Cash and Cash Equivalents", "Cash & Bank"),
    ("Net Cash from Operating Activities", "Cash from Operations"),
    ("Operating Profit", "EBITDA"),
    ("PBDITDA", "EBITDA"),
    ("Long-term Borrowings", "Long Term Borrowings"),
    ("Total Short-term Borrowings", "Short Term Borrowings"),
])
def test_known_alias_matches(raw, expected_canonical):
    canonical, confidence, method = match_label(raw)
    assert canonical == expected_canonical, f"Expected {expected_canonical!r}, got {canonical!r} for {raw!r}"
    assert confidence >= 85
    assert method == "alias"


def test_exact_canonical_self_match():
    canonical, confidence, method = match_label("Turnover")
    assert canonical == "Turnover"
    assert method == "alias"


def test_unmatched_label_returns_raw():
    canonical, confidence, method = match_label("Some Random Unknown Field XYZ")
    assert method == "unmatched"
    assert confidence < 70


def test_unmatched_log_written(tmp_path, monkeypatch):
    """Verify unmatched labels are written to the log file."""
    import app.review.unmatched_store as us
    import app.config as cfg
    log_path = str(tmp_path / "unmatched.jsonl")
    monkeypatch.setattr(cfg, "UNMATCHED_LOG_PATH", log_path)
    monkeypatch.setattr(us, "UNMATCHED_LOG_PATH", log_path)

    match_label("Totally Unknown Label ABCD")

    records = us.read_unmatched()
    assert any("Totally Unknown Label ABCD" in r.get("raw_label", "") for r in records)
