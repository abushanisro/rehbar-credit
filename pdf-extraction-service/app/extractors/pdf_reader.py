"""PDF reading layer.

Digital PDFs → pdfplumber (fast, no model needed, 99% accurate on clean text).
Scanned PDFs → PaddleOCR PP-StructureV3 (table + OCR in one pass).

Scanned detection: if average chars per page < 50, treat as scanned.
"""
import io
from app.schemas.models import PageContent

_SCANNED_CHAR_THRESHOLD = 50


def _avg_chars_per_page(pdf_bytes: bytes) -> float:
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if not pdf.pages:
                return 0
            total = sum(len(p.extract_text() or "") for p in pdf.pages)
            return total / len(pdf.pages)
    except Exception:
        return 0


def is_scanned(pdf_bytes: bytes) -> bool:
    return _avg_chars_per_page(pdf_bytes) < _SCANNED_CHAR_THRESHOLD


def _pdfplumber_extract(pdf_bytes: bytes) -> list[PageContent]:
    import pdfplumber
    results: list[PageContent] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            raw_tables = page.extract_tables() or []
            # Normalize: replace None cells with empty string
            tables = [
                [[cell or "" for cell in row] for row in table]
                for table in raw_tables
            ]
            results.append(PageContent(
                page_num=page.page_number,
                text=text,
                tables=tables,
            ))
    return results


def _paddleocr_extract(pdf_bytes: bytes) -> list[PageContent]:
    """PaddleOCR PP-StructureV3 for scanned PDFs.

    Converts each PDF page to an image then runs PP-Structure which combines
    OCR + table detection in a single pass.
    """
    try:
        import fitz  # PyMuPDF
        from paddleocr import PPStructure
        import numpy as np
        from PIL import Image

        engine = PPStructure(table=True, ocr=True, show_log=False)
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        results: list[PageContent] = []

        for page_idx, page in enumerate(doc):
            mat = fitz.Matrix(2, 2)  # 2x scale for better OCR quality
            pix = page.get_pixmap(matrix=mat)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            img_array = np.array(img)

            layout = engine(img_array)

            text_parts: list[str] = []
            tables: list[list[list[str]]] = []

            for region in layout:
                if region["type"] == "text":
                    for line in region.get("res", []):
                        text_parts.append(line[1][0])
                elif region["type"] == "table":
                    html = region.get("res", {}).get("html", "")
                    table = _parse_table_html(html)
                    if table:
                        tables.append(table)

            results.append(PageContent(
                page_num=page_idx + 1,
                text="\n".join(text_parts),
                tables=tables,
            ))
        return results
    except ImportError:
        # PaddleOCR not installed — fall back to pdfplumber with warning
        import warnings
        warnings.warn("PaddleOCR not available; falling back to pdfplumber for scanned PDF")
        return _pdfplumber_extract(pdf_bytes)


def _parse_table_html(html: str) -> list[list[str]]:
    """Convert PaddleOCR table HTML to list-of-rows format."""
    try:
        from html.parser import HTMLParser

        class _Parser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.rows: list[list[str]] = []
                self._row: list[str] = []
                self._cell = ""
                self._in_cell = False

            def handle_starttag(self, tag, attrs):
                if tag in ("td", "th"):
                    self._in_cell = True
                    self._cell = ""
                elif tag == "tr":
                    self._row = []

            def handle_endtag(self, tag):
                if tag in ("td", "th"):
                    self._row.append(self._cell.strip())
                    self._in_cell = False
                elif tag == "tr" and self._row:
                    self.rows.append(self._row)

            def handle_data(self, data):
                if self._in_cell:
                    self._cell += data

        parser = _Parser()
        parser.feed(html)
        return parser.rows
    except Exception:
        return []


def extract_pdf(pdf_bytes: bytes) -> tuple[list[PageContent], str]:
    """Extract pages from PDF. Returns (pages, method).
    method is 'pdfplumber' or 'paddleocr'.
    """
    if is_scanned(pdf_bytes):
        return _paddleocr_extract(pdf_bytes), "paddleocr"
    return _pdfplumber_extract(pdf_bytes), "pdfplumber"
