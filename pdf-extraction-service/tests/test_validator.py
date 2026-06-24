"""Tests for financial validation rules."""
import pytest
from app.validator.financial_validator import (
    validate_balance_sheet,
    validate_profit_loss,
    validate_cash_flow,
    validate_bank_row,
)
from app.schemas.models import BankStatementRow


class TestBalanceSheet:
    def test_balanced_sheet_no_flags(self):
        items = {
            "Total Assets": 10000.0,
            "Total Liabilities": 10000.0,
            "Net Worth": 4000.0,
            "Share Capital": 1000.0,
            "Reserves & Surplus": 3000.0,
            "Current Assets": 4000.0,
        }
        flags = validate_balance_sheet(items)
        high = [f for f in flags if f.severity == "HIGH"]
        assert not high

    def test_imbalanced_sheet_flags_high(self):
        items = {"Total Assets": 10000.0, "Total Liabilities": 8000.0}
        flags = validate_balance_sheet(items)
        rules = {f.rule for f in flags}
        assert "BS_IMBALANCE" in rules

    def test_current_assets_overflow(self):
        items = {"Total Assets": 5000.0, "Current Assets": 6000.0}
        flags = validate_balance_sheet(items)
        rules = {f.rule for f in flags}
        assert "CA_OVERFLOW" in rules


class TestProfitLoss:
    def test_consistent_pl_no_flags(self):
        items = {
            "Turnover": 10000.0,
            "EBITDA": 2000.0,
            "Depreciation": 300.0,
            "EBIT": 1700.0,
            "Interest Expense": 200.0,
            "Profit Before Tax": 1500.0,
            "Tax": 450.0,
            "PAT": 1050.0,
        }
        flags = validate_profit_loss(items)
        high = [f for f in flags if f.severity == "HIGH"]
        assert not high

    def test_pat_mismatch_flags_high(self):
        items = {
            "Profit Before Tax": 1000.0,
            "Tax": 300.0,
            "PAT": 800.0,   # wrong: should be ~700
        }
        flags = validate_profit_loss(items)
        rules = {f.rule for f in flags}
        assert "PAT_MISMATCH" in rules

    def test_pat_exceeds_revenue(self):
        items = {"Turnover": 1000.0, "PAT": 2000.0}
        flags = validate_profit_loss(items)
        rules = {f.rule for f in flags}
        assert "PAT_EXCEEDS_REVENUE" in rules


class TestCashFlow:
    def test_consistent_cf_no_flags(self):
        items = {
            "Cash from Operations": 500.0,
            "Cash from Investing": -200.0,
            "Cash from Financing": -100.0,
            "Net Change in Cash": 200.0,
            "Opening Cash": 100.0,
            "Closing Cash": 300.0,
        }
        flags = validate_cash_flow(items)
        assert not flags

    def test_net_change_mismatch(self):
        items = {
            "Cash from Operations": 500.0,
            "Cash from Investing": -200.0,
            "Cash from Financing": -100.0,
            "Net Change in Cash": 500.0,   # wrong: should be 200
        }
        flags = validate_cash_flow(items)
        rules = {f.rule for f in flags}
        assert "CF_NET_MISMATCH" in rules


class TestBankRow:
    def test_balanced_bank_row(self):
        row = BankStatementRow(
            month="2024-03",
            opening_balance=100000.0,
            closing_balance=150000.0,
            total_credits=200000.0,
            total_debits=150000.0,
        )
        flags = validate_bank_row(row)
        assert not flags

    def test_imbalanced_bank_row(self):
        row = BankStatementRow(
            month="2024-04",
            opening_balance=100000.0,
            closing_balance=200000.0,   # wrong
            total_credits=50000.0,
            total_debits=30000.0,
        )
        flags = validate_bank_row(row)
        rules = {f.rule for f in flags}
        assert "BANK_BALANCE_MISMATCH" in rules
