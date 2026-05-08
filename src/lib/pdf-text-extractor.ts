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
