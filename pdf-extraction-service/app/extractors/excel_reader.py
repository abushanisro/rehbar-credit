"""Excel reader — converts .xlsx/.xls sheets into PageContent format.

Each sheet becomes one "page". The sheet's data is converted to a table
(list of rows) exactly like pdfplumber produces, so the same table_parser
pipeline can process it without changes.
"""
import io
from app.schemas.models import PageContent


def extract_excel(file_bytes: bytes) -> list[PageContent]:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    pages: list[PageContent] = []

    for sheet_idx, ws in enumerate(wb.worksheets, start=1):
        # Collect all rows, skipping fully-empty rows
        rows: list[list[str]] = []
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) if c is not None else "" for c in row]
            if any(c.strip() for c in cells):
                rows.append(cells)

        if not rows:
            continue

        # Build plain-text representation for section_detector
        text_lines = ["\t".join(row) for row in rows]
        text = f"[Sheet: {ws.title}]\n" + "\n".join(text_lines)

        pages.append(PageContent(
            page_num=sheet_idx,
            text=text,
            tables=[rows],
        ))

    return pages
