"""Shared test fixtures."""
import pytest
from app.schemas.models import PageContent, Section


@pytest.fixture
def simple_pl_table():
    """A simple P&L table with two fiscal years."""
    return [
        ["", "FY2024", "FY2023"],
        ["Revenue from Operations", "12,345.67", "10,234.56"],
        ["Cost of Materials Consumed", "8,000.00", "6,500.00"],
        ["EBITDA", "4,345.67", "3,734.56"],
        ["Finance Costs", "500.00", "450.00"],
        ["Profit After Tax", "1,200.00", "950.00"],
    ]


@pytest.fixture
def simple_bs_table():
    """A simple Balance Sheet table."""
    return [
        ["", "FY2024", "FY2023"],
        ["Share Capital", "1,000.00", "1,000.00"],
        ["Reserves and Surplus", "3,000.00", "2,500.00"],
        ["Shareholders Equity", "4,000.00", "3,500.00"],
        ["Long-term Borrowings", "5,000.00", "4,500.00"],
        ["Total Assets", "9,000.00", "8,000.00"],
    ]


@pytest.fixture
def pl_page(simple_pl_table):
    return PageContent(
        page_num=1,
        text="Profit and Loss Account\nFY2024 FY2023",
        tables=[simple_pl_table],
    )


@pytest.fixture
def pl_section(pl_page):
    return Section(
        section_type="profit_loss",
        start_page=1,
        end_page=1,
        pages=[pl_page],
    )
