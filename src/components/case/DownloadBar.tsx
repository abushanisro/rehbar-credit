export async function dlExcel(
  sheets: { name: string; rows: (string | number | null | undefined)[][] }[],
  filename: string,
) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

export function dlPdf(html: string, title: string) {
  const win = window.open("", "_blank", "width=1000,height=800");
  if (!win) return;
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  win.document.write(`<!DOCTYPE html><html><head><title>${safeTitle}</title><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Courier New",monospace;font-size:10px;color:#000;background:#fff;padding:24px 32px}
    h1{font-size:14px;font-weight:bold;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:16px;letter-spacing:2px;text-transform:uppercase}
    h2{font-size:11px;font-weight:bold;margin:18px 0 6px;padding:4px 8px;background:#000;color:#fff;letter-spacing:1px;text-transform:uppercase}
    h3{font-size:10px;font-weight:bold;margin:10px 0 4px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #ccc;padding-bottom:2px}
    table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:9px}
    th{text-align:left;border-bottom:2px solid #000;padding:3px 8px;font-weight:bold;text-transform:uppercase;font-size:8px;letter-spacing:0.5px}
    td{border-bottom:1px dashed #ddd;padding:3px 8px;vertical-align:top}
    .meta{display:flex;gap:32px;margin-bottom:16px;font-size:9px;border-bottom:1px solid #ccc;padding-bottom:10px}
    .mi .lbl{font-size:8px;text-transform:uppercase;color:#666;letter-spacing:0.5px}
    .mi .val{font-weight:bold;font-size:11px}
    ul{list-style:none;padding:0}
    li{margin-bottom:3px;padding-left:14px;position:relative;font-size:9px}
    li::before{content:">";position:absolute;left:0;color:#666}
    .pass{color:#16a34a;font-weight:bold}
    .fail{color:#dc2626;font-weight:bold}
    .caution{color:#d97706;font-weight:bold}
    .sec{margin-bottom:20px;page-break-inside:avoid}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:8px}
    .lbl{font-size:8px;text-transform:uppercase;color:#666;letter-spacing:0.5px;margin-bottom:1px}
    .val{font-size:10px}
    .disc{font-size:8px;color:#999;border-top:1px solid #ccc;margin-top:20px;padding-top:8px;font-style:italic}
    @media print{body{padding:10px 14px}}
  </style></head><body>${html}<div class="disc">AI-GENERATED DRAFT — REQUIRES ANALYST REVIEW. NO CREDIT RECOMMENDATION IS MADE BY AI. © REHBAR FINANCIAL SERVICES</div></body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

export function DownloadBar({ onExcel, onPdf, onTemplate }: {
  onExcel?: () => void;
  onPdf?: () => void;
  onTemplate?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pt-3 mt-1 border-t border-border/40">
      <span className="text-[10px] text-muted-foreground tracking-widest">↓ DOWNLOAD</span>
      {onExcel && (
        <button onClick={onExcel} className="text-[10px] border border-border text-primary px-3 py-1 hover:bg-primary/10 tracking-widest font-bold">
          [EXCEL]
        </button>
      )}
      {onPdf && (
        <button onClick={onPdf} className="text-[10px] border border-border text-primary px-3 py-1 hover:bg-primary/10 tracking-widest font-bold">
          [PDF]
        </button>
      )}
      {onTemplate && (
        <button onClick={onTemplate} className="text-[10px] border border-accent/50 text-accent px-3 py-1 hover:bg-accent/10 tracking-widest font-bold">
          [TEMPLATE]
        </button>
      )}
    </div>
  );
}
