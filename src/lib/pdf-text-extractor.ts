import * as pdfjsLib from "pdfjs-dist";

// Use the bundled worker via Vite's ?url import
// @ts-expect-error — Vite resolves this at build time
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl as string;

/** Extract all text from a PDF File. Returns empty string on failure. */
export async function extractPdfText(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items as Array<{ str?: string }>)
        .map(item => item.str ?? "")
        .join(" ");
      pages.push(pageText);
    }
    return pages.join("\n");
  } catch {
    return "";
  }
}

export type PdfPage = { pageNum: number; text: string };

/** Extract text per page from a PDF File. Returns empty array on failure. */
export async function extractPdfPages(file: File): Promise<PdfPage[]> {
  try {
    const buffer = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: PdfPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = (content.items as Array<{ str?: string }>)
        .map(item => item.str ?? "")
        .join(" ")
        .trim();
      pages.push({ pageNum: i, text });
    }
    return pages;
  } catch {
    return [];
  }
}

const FINANCIAL_KEYWORDS = [
  "balance sheet", "profit & loss", "profit and loss", "p&l", "cash flow",
  "total assets", "net worth", "turnover", "ebitda", "depreciation",
  "liabilities", "equity", "revenue", "expenses", "net profit",
  "shareholders", "reserves", "borrowings", "inventories", "receivables",
  "fixed assets", "current assets", "total debt", "share capital",
];

/** Returns page numbers that likely contain financial tables. */
export function detectFinancialPages(pages: PdfPage[]): number[] {
  return pages
    .filter(p => {
      const lower = p.text.toLowerCase();
      return FINANCIAL_KEYWORDS.some(kw => lower.includes(kw));
    })
    .map(p => p.pageNum);
}
