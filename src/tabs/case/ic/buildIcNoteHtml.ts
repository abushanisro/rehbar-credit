import { PRODUCTS, RATIO_DISPLAY_NAMES, formatRatio } from "@/features/credit/domain";
import type { CaseRow, ExtractedRow, RatioRow, LineItem } from "@/features/case/types";
import { icGetItems, icLiVal, icFmt } from "./ICComponents";

// ── Shared constants ──────────────────────────────────────────────────────────

const NAVY    = "#0F1B2D";
const CREAM   = "#FAFAF6";
const GOLD    = "#8B6914";
const GOLD_LT = "#C4A04A";
const INK     = "#1C1C1E";
const RULE    = "#D4C9B0";
const MUTED   = "#6B6152";
const PASS    = "#1A4A2E";
const FAIL    = "#6B1A1A";
const CAUTION = "#6B4B00";

// ── Markdown → HTML converter ─────────────────────────────────────────────────

function mdToHtml(md: string, skipTables = false): string {
  if (!md?.trim()) return "";
  const lines = md.split("\n");
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const trim = lines[i].trim();

    if (trim.startsWith("|")) {
      const tl: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { tl.push(lines[i].trim()); i++; }
      if (!skipTables) {
        const rows = tl.filter(l => !/^\|[\s\-:|]+\|$/.test(l));
        if (rows.length) {
          const p = (l: string) => l.split("|").slice(1, -1).map(c => c.trim());
          const [hdr, ...body] = rows;
          html += `<div style="overflow-x:auto;margin:10px 0;border:1px solid ${RULE};border-radius:3px">
            <table style="font-size:10px;border-collapse:collapse;min-width:100%;font-family:'Source Serif 4',Georgia,serif">
              <thead><tr style="background:${NAVY};border-bottom:1px solid rgba(212,201,176,0.2)">
                ${p(hdr).map(h => `<th style="text-align:left;padding:7px 10px;font-size:7.5px;letter-spacing:0.12em;color:${GOLD_LT};text-transform:uppercase;font-weight:700;white-space:nowrap">${h}</th>`).join("")}
              </tr></thead><tbody>
                ${body.map((row, ri) => `<tr style="border-bottom:1px solid ${RULE};background:${ri % 2 === 1 ? "rgba(212,201,176,0.1)" : "transparent"}">
                  ${p(row).map(c => `<td style="padding:5px 10px;color:${c === "—" || c === "" ? MUTED : INK};font-size:10px">${c || "—"}</td>`).join("")}
                </tr>`).join("")}
              </tbody>
            </table>
          </div>`;
        }
      }
      continue;
    }

    if (/^[-*▸•]\s/.test(trim)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*▸•]\s/.test(lines[i].trim())) {
        bullets.push(lines[i].trim().replace(/^[-*▸•]\s+/, ""));
        i++;
      }
      html += `<div style="border-left:3px solid ${GOLD};padding-left:14px;margin:10px 0">
        ${bullets.map(b => `<div style="display:flex;gap:8px;margin-bottom:6px;font-size:11.5px;line-height:1.65;font-family:'Source Serif 4',Georgia,serif;color:${INK}">
          <span style="color:${GOLD};flex-shrink:0;margin-top:2px;font-weight:700;font-size:9px">▸</span>
          <span>${b.replace(/\*\*(.*?)\*\*/g, `<strong style="font-weight:700;color:${INK}">$1</strong>`)}</span>
        </div>`).join("")}
      </div>`;
      continue;
    }

    if (/^\*\*[^*]+\*\*$/.test(trim)) {
      html += `<div style="font-size:8px;font-weight:700;color:${GOLD};letter-spacing:0.14em;text-transform:uppercase;margin:16px 0 5px;border-bottom:1px solid ${RULE};padding-bottom:3px;font-family:'Source Serif 4',Georgia,serif">${trim.slice(2, -2)}</div>`;
      i++;
      continue;
    }

    if (trim) {
      html += `<p style="font-size:11.5px;color:${INK};margin:5px 0;line-height:1.7;font-family:'Source Serif 4',Georgia,serif">${trim.replace(/\*\*(.*?)\*\*/g, `<strong style="font-weight:700">$1</strong>`)}</p>`;
    }
    i++;
  }
  return html;
}

// ── HTML table builders ───────────────────────────────────────────────────────

function dataTable(headers: string[], rows: (string | number | null | undefined)[][], caption?: string): string {
  const headerHtml = headers.map(h =>
    `<th style="text-align:left;padding:7px 10px;font-size:7.5px;letter-spacing:0.12em;color:${GOLD_LT};text-transform:uppercase;font-weight:700;white-space:nowrap;font-family:'Source Serif 4',Georgia,serif">${h}</th>`
  ).join("");
  const bodyHtml = rows.map((row, ri) =>
    `<tr style="border-bottom:1px solid ${RULE};background:${ri % 2 === 1 ? "rgba(212,201,176,0.1)" : "transparent"}">
      ${row.map(c => `<td style="padding:5px 10px;font-size:11px;color:${INK};font-family:'Source Serif 4',Georgia,serif">${c ?? "—"}</td>`).join("")}
    </tr>`
  ).join("");
  return `${caption ? `<div style="font-size:8.5px;font-weight:700;color:${GOLD};letter-spacing:0.12em;text-transform:uppercase;margin:18px 0 6px;font-family:'Source Serif 4',Georgia,serif">${caption}</div>` : ""}
  <div style="overflow-x:auto;border:1px solid ${RULE};border-radius:3px;margin-bottom:12px">
    <table style="width:100%;border-collapse:collapse;font-family:'Source Serif 4',Georgia,serif">
      <thead><tr style="background:${NAVY};border-bottom:1px solid rgba(212,201,176,0.2)">${headerHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  </div>`;
}

function kvTable(pairs: [string, string | undefined | null][]): string {
  return `<div style="overflow-x:auto;border:1px solid ${RULE};border-radius:3px;margin:10px 0">
    <table style="width:100%;border-collapse:collapse;font-family:'Source Serif 4',Georgia,serif">
      <tbody>
        ${pairs.filter(([, v]) => v != null && v !== "").map(([label, value], i) =>
          `<tr style="border-bottom:1px solid ${RULE};background:${i % 2 === 1 ? "rgba(212,201,176,0.08)" : "transparent"}">
            <td style="padding:6px 10px;font-size:9px;font-weight:700;color:${MUTED};letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap;width:32%;vertical-align:top">${label}</td>
            <td style="padding:6px 10px;font-size:11px;color:${INK}">${value ?? "—"}</td>
          </tr>`
        ).join("")}
      </tbody>
    </table>
  </div>`;
}

function sectionHeader(roman: string, title: string): string {
  return `<div style="display:flex;align-items:baseline;gap:14px;margin-bottom:16px">
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:900;color:${GOLD};line-height:1;flex-shrink:0">${roman}</div>
    <div style="border-left:2px solid ${NAVY};padding-left:12px">
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:13px;font-weight:700;color:${NAVY};letter-spacing:0.02em">${title}</div>
    </div>
  </div>
  <div style="height:1px;background:${RULE};margin-bottom:16px"></div>`;
}

function pageBreak(): string {
  return `<div style="page-break-after:always;height:0;border:none"></div>`;
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildIcNoteHtml(
  cc: CaseRow,
  extracted: ExtractedRow[],
  ratios: RatioRow[],
  ic: {
    sections: Record<string, { markdown: string }>;
    risks: Array<{ category: string; risk: string; mitigant: string; severity: string }>;
    conditions_precedent: string[];
    swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  },
  annotationsSvg?: string,
): string {
  const product     = PRODUCTS[cc.product_type];
  const fyYears     = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const ratioGroups = Array.from(new Set(ratios.map(r => r.category)));
  const histRows    = extracted.filter(r => r.statement_type !== "projections");
  const histYears   = Array.from(new Set(histRows.map(r => r.fiscal_year))).sort();
  const projRows    = extracted.filter(r => r.statement_type === "projections");
  const projYears   = Array.from(new Set(projRows.map(r => r.fiscal_year))).sort();
  const unit        = extracted.find(r => r.unit)?.unit ?? "";
  const ul          = unit ? `₹ ${unit}` : "₹";
  const fmtAmt      = (v: number | null | undefined) => v ? `₹${v} Cr` : "—";
  const today       = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const KEY_RATIOS  = ["dscr","current_ratio","debt_to_equity","interest_coverage","ebitda_margin","roe"];

  const yoyPct = (vals: (number | null)[]) => {
    const l = vals[vals.length - 1], p = vals.length >= 2 ? vals[vals.length - 2] : null;
    return (l !== null && p !== null && p !== 0) ? ((l! - p!) / Math.abs(p!) * 100).toFixed(1) + "%" : "—";
  };

  // ── Cover page ─────────────────────────────────────────────────────────────
  let h = `
  <!-- COVER PAGE -->
  <div style="page-break-after:always;min-height:100vh;display:flex;flex-direction:column;background:${CREAM}">

    <!-- Brand header -->
    <div style="background:${NAVY};padding:28px 48px;border-bottom:4px solid ${GOLD}">
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:10px;font-weight:700;color:${GOLD_LT};letter-spacing:0.25em;text-transform:uppercase;margin-bottom:6px">
        Rehbar Financial Services
      </div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:9px;color:rgba(250,250,246,0.5);letter-spacing:0.08em">
        Sharia-Compliant NBFC · Asset Financing &amp; Structured Credit
      </div>
      <div style="margin-top:28px;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:700;color:${CREAM};letter-spacing:0.03em;line-height:1.3">
        Investment Committee<br>Credit Appraisal Note
      </div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:10px;color:rgba(250,250,246,0.35);margin-top:4px">
        Prepared pursuant to Rehbar SOP §I–XII
      </div>
    </div>

    <!-- Client & deal summary -->
    <div style="padding:36px 48px;flex:1">
      <div style="border:1px solid ${RULE};border-radius:4px;overflow:hidden;margin-bottom:28px">
        <div style="background:${GOLD};padding:8px 16px">
          <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;font-weight:700;color:${CREAM}">${cc.client_name}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0">
          ${([
            ["Case Reference", cc.case_code ?? "—"],
            ["Product",        product.label],
            ["Facility Amount", fmtAmt(cc.deal_amount)],
            ["Tenure",         cc.tenure_months ? `${cc.tenure_months} months` : "—"],
            ["Expected IRR",   cc.expected_irr  ? `${cc.expected_irr}%` : "—"],
            ["Industry",       cc.industry ?? "—"],
          ] as [string, string][]).map(([label, value], i) => `
            <div style="padding:14px 18px;border-right:${(i + 1) % 3 !== 0 ? `1px solid ${RULE}` : "none"};border-bottom:${i < 3 ? `1px solid ${RULE}` : "none"}">
              <div style="font-size:7px;letter-spacing:0.18em;color:${MUTED};text-transform:uppercase;font-family:'Source Serif 4',Georgia,serif;margin-bottom:4px">${label}</div>
              <div style="font-size:12px;font-weight:600;color:${INK};font-family:'Source Serif 4',Georgia,serif">${value}</div>
            </div>
          `).join("")}
        </div>
      </div>

      ${cc.end_use ? `<div style="border-left:3px solid ${GOLD};padding:10px 16px;margin-bottom:20px;background:rgba(139,105,20,0.04)">
        <div style="font-size:7.5px;letter-spacing:0.12em;color:${GOLD};font-weight:700;text-transform:uppercase;font-family:'Source Serif 4',Georgia,serif;margin-bottom:4px">End Use of Funds</div>
        <div style="font-size:11px;color:${INK};font-family:'Source Serif 4',Georgia,serif;line-height:1.6">${cc.end_use}</div>
      </div>` : ""}
    </div>

    <!-- Footer -->
    <div style="background:${NAVY};padding:10px 48px;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:7.5px;color:rgba(196,160,74,0.5);letter-spacing:0.14em;text-transform:uppercase;font-family:'Source Serif 4',Georgia,serif">
        CONFIDENTIAL · AI-Generated Draft · Analyst Review Required
      </div>
      <div style="font-size:7.5px;color:rgba(250,250,246,0.3);font-family:'Source Serif 4',Georgia,serif">${today}</div>
    </div>
  </div>`;

  // Page footer helper
  const footerBar = () => `<div style="margin-top:28px;padding-top:8px;border-top:1px solid ${RULE};display:flex;justify-content:space-between">
    <div style="font-size:7px;color:${MUTED};letter-spacing:0.1em;font-family:'Source Serif 4',Georgia,serif;text-transform:uppercase">
      CONFIDENTIAL · REHBAR FINANCIAL SERVICES · ${today}
    </div>
    <div style="font-size:7px;color:${MUTED};font-family:'Source Serif 4',Georgia,serif">${cc.case_code ?? ""}</div>
  </div>`;

  const wrapSection = (inner: string) =>
    `<div style="padding:36px 48px;background:${CREAM}">${inner}${footerBar()}</div>`;

  // ── I. Executive Summary ──────────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("I", "EXECUTIVE SUMMARY")}
    ${kvTable([
      ["Client",           cc.client_name],
      ["Product",          product.label],
      ["Amount",           fmtAmt(cc.deal_amount)],
      ["Tenure",           cc.tenure_months ? `${cc.tenure_months} months` : undefined],
      ["Expected IRR",     cc.expected_irr  ? `${cc.expected_irr}%` : undefined],
      ["Industry / Sector", cc.industry],
      ["Collateral",       cc.collateral_summary],
      ["Policy Exceptions", cc.policy_exceptions],
    ])}
    ${fyYears.length > 0 && KEY_RATIOS.some(n => ratios.find(r => r.ratio_name === n)) ? dataTable(
      ["Ratio", ...fyYears.map(y => `FY${y}`), "Benchmark", "Status"],
      KEY_RATIOS.flatMap(name => {
        const rows = ratios.filter(r => r.ratio_name === name);
        if (!rows.length) return [];
        const latest = rows.sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
        const s = latest.threshold_status ?? "na";
        const icon = s === "green" ? "✓" : s === "red" ? "✗" : s === "amber" ? "~" : "—";
        return [[
          `${RATIO_DISPLAY_NAMES[name] ?? name} ${icon}`,
          ...fyYears.map(y => { const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y); return r?.ratio_value != null ? formatRatio(name, Number(r.ratio_value)) : "—"; }),
          latest.benchmark != null ? formatRatio(name, Number(latest.benchmark)) : "—",
          s.toUpperCase(),
        ]];
      }),
      "Key Ratio Snapshot",
    ) : ""}
    ${mdToHtml(ic.sections["executive_summary"]?.markdown ?? "", false)}
  `);

  // ── II. Client & Promoter ─────────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("II", "CLIENT &amp; PROMOTER PROFILE")}
    ${kvTable([
      ["Client Name",         cc.client_name],
      ["Legal Constitution",  cc.legal_constitution],
      ["Industry / Sector",   cc.industry],
      ["Year Established",    String(cc.year_established ?? "—")],
      ["Principal Borrower",  cc.principal_borrower],
      ["Website",             cc.website],
    ])}
    ${cc.promoter_details ? `<div style="margin:12px 0"><div style="font-size:8px;font-weight:700;color:${GOLD};letter-spacing:0.12em;text-transform:uppercase;font-family:'Source Serif 4',Georgia,serif;margin-bottom:4px">Promoter Details</div><div style="font-size:11px;color:${INK};line-height:1.65;font-family:'Source Serif 4',Georgia,serif">${cc.promoter_details}</div></div>` : ""}
    ${cc.group_summary ? `<div style="margin:12px 0"><div style="font-size:8px;font-weight:700;color:${GOLD};letter-spacing:0.12em;text-transform:uppercase;font-family:'Source Serif 4',Georgia,serif;margin-bottom:4px">Group Summary</div><div style="font-size:11px;color:${INK};line-height:1.65;font-family:'Source Serif 4',Georgia,serif">${cc.group_summary}</div></div>` : ""}
    ${mdToHtml(ic.sections["client_promoter"]?.markdown ?? "", false)}
  `);

  // ── III. Investment Structure ─────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("III", "PROPOSED INVESTMENT STRUCTURE")}
    ${kvTable([
      ["Product",           product.label],
      ["Legal Nature",      product.legalNature],
      ["Return Mechanism",  product.returnMechanism],
      ["Proposed Amount",   fmtAmt(cc.deal_amount)],
      ["Tenure",            cc.tenure_months ? `${cc.tenure_months} months` : undefined],
      ["Expected IRR",      cc.expected_irr  ? `${cc.expected_irr}%` : undefined],
      ["Residual Value",    cc.residual_value  != null ? `₹${cc.residual_value}` : undefined],
      ["Security Deposit",  cc.security_deposit != null ? `₹${cc.security_deposit}` : undefined],
    ])}
    ${cc.end_use ? `<div style="border-left:3px solid ${GOLD};padding:8px 12px;margin:12px 0;background:rgba(139,105,20,0.04)"><div style="font-size:8px;font-weight:700;color:${GOLD};font-family:'Source Serif 4',Georgia,serif;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.1em">End Use of Funds</div><div style="font-size:11px;color:${INK};line-height:1.65;font-family:'Source Serif 4',Georgia,serif">${cc.end_use}</div></div>` : ""}
    ${cc.collateral_summary ? `<div style="border-left:3px solid ${GOLD};padding:8px 12px;margin:12px 0;background:rgba(139,105,20,0.04)"><div style="font-size:8px;font-weight:700;color:${GOLD};font-family:'Source Serif 4',Georgia,serif;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.1em">Collateral &amp; Security</div><div style="font-size:11px;color:${INK};line-height:1.65;font-family:'Source Serif 4',Georgia,serif">${cc.collateral_summary}</div></div>` : ""}
    ${mdToHtml(ic.sections["investment_structure"]?.markdown ?? "", false)}
  `);

  // ── IV. Rehbar Funding History ────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("IV", "REHBAR FUNDING HISTORY")}
    ${kvTable([
      ["Funder",          "Rehbar Financial Services"],
      ["Business Model",  "Sharia-compliant NBFC — asset financing &amp; structured credit"],
      ["Core Products",   "Operating Lease · Finance Lease · PLS · Project Finance · Trade Finance · Home Loan"],
      ["Prior Exposure",  `No prior Rehbar funding history on record for ${cc.client_name}`],
    ])}
    ${mdToHtml(ic.sections["rehbar_funding_history"]?.markdown ?? "", false)}
  `);

  // ── V. Historical Financials ──────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("V", "HISTORICAL FINANCIAL ANALYSIS")}
    ${histYears.length > 0 ? (() => {
      const fyItems = histYears.map(y => icGetItems(extracted, y));
      let out = "";
      for (const [labels, caption] of [
        [["Turnover","Gross Profit","EBITDA","EBIT","Interest Expense","PAT"], `P&amp;L Summary (${ul})`],
        [["Net Worth","Total Debt","Current Assets","Fixed Assets (Net)","Total Assets","Capital Employed"], `Balance Sheet (${ul})`],
      ] as [string[], string][]) {
        out += dataTable(
          ["Item", ...histYears.map(y => `FY${y}`), ...(histYears.length >= 2 ? ["YoY%"] : [])],
          labels.map(label => {
            const vals = fyItems.map(items => icLiVal(items, label));
            return [label, ...vals.map(v => icFmt(v)), ...(histYears.length >= 2 ? [yoyPct(vals)] : [])];
          }),
          caption,
        );
      }
      return out;
    })() : `<p style="color:${MUTED};font-style:italic;font-size:11px;font-family:'Source Serif 4',Georgia,serif">No historical financial data extracted.</p>`}
    ${mdToHtml(ic.sections["historical_financial"]?.markdown ?? "", true)}
  `);

  // ── VI. Projections ───────────────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("VI", "PROJECTIONS &amp; ESTIMATES")}
    ${projRows.length > 0 ? (() => {
      const pairs: [string, string][] = [
        ["Turnover","Projected Turnover"],["EBITDA","Projected EBITDA"],["PAT","Projected PAT"],
        ["Net Worth","Projected Net Worth"],["Total Debt","Projected Total Debt"],
      ];
      return dataTable(
        ["Metric", ...histYears.slice(-2).map(y => `FY${y}(A)`), ...projYears.map(y => `FY${y}(P)`)],
        pairs.map(([hl, pl]) => [
          hl,
          ...histYears.slice(-2).map(y => icFmt(icLiVal(icGetItems(extracted, y), hl))),
          ...projYears.map(y => icFmt(icLiVal((projRows.find(r => r.fiscal_year === y)?.line_items ?? []) as unknown as LineItem[], pl))),
        ]),
        `Historical vs Projected (${ul})`,
      );
    })() : `<p style="color:${MUTED};font-style:italic;font-size:11px;font-family:'Source Serif 4',Georgia,serif">No projection data submitted — refer to SOP §XII for waiver conditions.</p>`}
    ${mdToHtml(ic.sections["projections"]?.markdown ?? "", true)}
  `);

  // ── VII. Key Financial Ratios ─────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("VII", "KEY FINANCIAL RATIOS")}
    ${ratioGroups.map(cat => {
      const names = Array.from(new Set(ratios.filter(r => r.category === cat).map(r => r.ratio_name)));
      return dataTable(
        ["Ratio", ...fyYears.map(y => `FY${y}`), "Benchmark", "Status"],
        names.map(name => {
          const latest = ratios.filter(r => r.ratio_name === name).sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
          const s = latest?.threshold_status ?? "na";
          const icon = s === "green" ? "✓" : s === "red" ? "✗" : s === "amber" ? "~" : "—";
          return [
            `${RATIO_DISPLAY_NAMES[name] ?? name} ${icon}`,
            ...fyYears.map(y => { const r = ratios.find(x => x.ratio_name === name && x.fiscal_year === y); return r?.ratio_value != null ? formatRatio(name, Number(r.ratio_value)) : "—"; }),
            latest?.benchmark != null ? formatRatio(name, Number(latest.benchmark)) : "—",
            s.toUpperCase(),
          ];
        }),
        cat,
      );
    }).join("")}
    ${mdToHtml(ic.sections["key_ratios"]?.markdown ?? "", true)}
  `);

  // ── VIII. Cash Flow ───────────────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("VIII", "CASH FLOW STATEMENT")}
    ${histYears.length > 0 ? (() => {
      const fyItems = histYears.map(y => icGetItems(extracted, y));
      const cfLabels = ["Cash from Operations","Cash from Investing","Cash from Financing","Net Change in Cash","Opening Cash","Closing Cash"];
      const cfRows = cfLabels.map(label => ({ label, vals: fyItems.map(items => icLiVal(items, label)) })).filter(({ vals }) => vals.some(v => v !== null));
      return cfRows.length ? dataTable(["Item", ...histYears.map(y => `FY${y}`)], cfRows.map(({ label, vals }) => [label, ...vals.map(v => icFmt(v))]), `Cash Flow (${ul})`) : "";
    })() : ""}
    ${mdToHtml(ic.sections["cash_flow"]?.markdown ?? "", false)}
  `);

  // ── IX. Due Diligence ─────────────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("IX", "DUE DILIGENCE EXCERPTS")}
    ${mdToHtml(ic.sections["due_diligence"]?.markdown ?? "", false) || `<p style="color:${MUTED};font-style:italic;font-size:11px;font-family:'Source Serif 4',Georgia,serif">Analyst to complete following site visit and external checks.</p>`}
  `);

  // ── X. Risk Assessment ────────────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("X", "RISK ASSESSMENT &amp; MITIGATION")}
    ${mdToHtml(ic.sections["risk_assessment"]?.markdown ?? "", false)}
  `);

  // ── XI. Visit & Reference ─────────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("XI", "VISIT REPORT, REFERENCE CHECKS &amp; EXECUTIVE RECOMMENDATION")}
    ${cc.analyst_notes ? `<div style="border-left:3px solid ${GOLD};padding:8px 12px;margin:10px 0;background:rgba(139,105,20,0.04)"><div style="font-size:8px;font-weight:700;color:${GOLD};font-family:'Source Serif 4',Georgia,serif;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px">Analyst Notes</div><div style="font-size:11px;color:${INK};line-height:1.65;font-family:'Source Serif 4',Georgia,serif">${cc.analyst_notes}</div></div>` : ""}
    ${mdToHtml(ic.sections["visit_reference"]?.markdown ?? "", false)}
    ${dataTable(
      ["Check Type", "Source", "Status"],
      [
        ["Banker Reference",  "Principal Bank",     "Pending — analyst to confirm"],
        ["Vendor / Supplier", "Key Suppliers",       "Pending — analyst to confirm"],
        ["Customer Reference","Major Clients",        "Pending — analyst to confirm"],
        ["Site Visit",        "Business Premises",   "Pending — analyst to confirm"],
      ],
      "Reference Check Checklist",
    )}
  `);

  // ── XII. Product Specifics ────────────────────────────────────────────────
  h += pageBreak();
  h += wrapSection(`
    ${sectionHeader("XII", "SPECIFIC PRODUCT REQUIREMENTS &amp; EXEMPTIONS")}
    ${kvTable([
      ["Product",          product.label],
      ["Legal Nature",     product.legalNature],
      ["Return Mechanism", product.returnMechanism],
    ])}
    <div style="margin:14px 0">
      <div style="font-size:8px;font-weight:700;color:${GOLD};letter-spacing:0.12em;text-transform:uppercase;font-family:'Source Serif 4',Georgia,serif;margin-bottom:8px">SOP Rules</div>
      <div style="border-left:3px solid ${GOLD};padding-left:14px">
        ${product.rules.map(r => `<div style="display:flex;gap:8px;margin-bottom:6px;font-size:11px;line-height:1.6;font-family:'Source Serif 4',Georgia,serif;color:${INK}"><span style="color:${GOLD};font-weight:700;flex-shrink:0;font-size:9px">▸</span><span>${r}</span></div>`).join("")}
      </div>
    </div>
    ${cc.policy_exceptions ? `<div style="border-left:3px solid ${FAIL};padding:8px 12px;margin:12px 0;background:${FAIL}10"><div style="font-size:8px;font-weight:700;color:${FAIL};font-family:'Source Serif 4',Georgia,serif;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px">Policy Exceptions</div><div style="font-size:11px;color:${INK};font-family:'Source Serif 4',Georgia,serif">${cc.policy_exceptions}</div></div>` : ""}
    ${mdToHtml(ic.sections["product_specifics"]?.markdown ?? "", false)}
  `);

  // ── Risk Register ─────────────────────────────────────────────────────────
  if (ic.risks?.length) {
    h += pageBreak();
    h += wrapSection(`
      ${sectionHeader("R", "RISK REGISTER")}
      <div style="overflow-x:auto;border:1px solid ${RULE};border-radius:3px">
        <table style="width:100%;border-collapse:collapse;font-family:'Source Serif 4',Georgia,serif">
          <thead><tr style="background:${NAVY}">
            ${["Category","Risk Factor","Mitigant","Severity"].map(h => `<th style="text-align:left;padding:8px 12px;font-size:7.5px;letter-spacing:0.12em;color:${GOLD_LT};text-transform:uppercase;font-weight:700;white-space:nowrap">${h}</th>`).join("")}
          </tr></thead>
          <tbody>
            ${ic.risks.map((r, i) => {
              const sevBg    = r.severity === "high" ? "#F3EAEA" : r.severity === "medium" ? "#F5F0E4" : "#EAF3EC";
              const sevColor = r.severity === "high" ? FAIL : r.severity === "medium" ? CAUTION : PASS;
              return `<tr style="border-bottom:1px solid ${RULE};background:${i % 2 === 1 ? "rgba(212,201,176,0.08)" : "transparent"}">
                <td style="padding:7px 12px;font-size:9px;font-weight:700;color:${GOLD};text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap">${r.category}</td>
                <td style="padding:7px 12px;font-size:11px;color:${INK}">${r.risk}</td>
                <td style="padding:7px 12px;font-size:11px;color:${MUTED}">${r.mitigant}</td>
                <td style="padding:7px 12px;text-align:center"><span style="font-size:8px;font-weight:700;padding:3px 8px;border-radius:3px;background:${sevBg};color:${sevColor};letter-spacing:0.1em">${r.severity?.toUpperCase()}</span></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `);
  }

  // ── Conditions Precedent ──────────────────────────────────────────────────
  if (ic.conditions_precedent?.length) {
    h += pageBreak();
    h += wrapSection(`
      ${sectionHeader("CP", "CONDITIONS PRECEDENT")}
      <div>
        ${ic.conditions_precedent.map((c, i) =>
          `<div style="display:flex;gap:14px;margin-bottom:10px;align-items:flex-start">
            <span style="font-size:9px;font-family:'Playfair Display',Georgia,serif;font-weight:700;color:${GOLD};flex-shrink:0;margin-top:2px;min-width:20px">${String(i + 1).padStart(2, "0")}.</span>
            <span style="font-size:11.5px;color:${INK};line-height:1.65;font-family:'Source Serif 4',Georgia,serif">${c}</span>
          </div>`
        ).join("")}
      </div>
    `);
  }

  // ── SWOT ──────────────────────────────────────────────────────────────────
  if (ic.swot) {
    h += pageBreak();
    h += wrapSection(`
      ${sectionHeader("SW", "SWOT ANALYSIS")}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${([
          ["Strengths",     ic.swot.strengths,     "+", PASS,    "#EAF3EC"],
          ["Weaknesses",    ic.swot.weaknesses,    "−", FAIL,    "#F3EAEA"],
          ["Opportunities", ic.swot.opportunities, "↑", "#1A3A5C", "#EAF0F5"],
          ["Threats",       ic.swot.threats,       "▲", CAUTION, "#F5F0E4"],
        ] as [string, string[], string, string, string][]).map(([label, items, icon, color, bg]) =>
          `<div style="background:${bg};border:1px solid ${color}30;padding:14px 16px;border-radius:3px">
            <div style="font-size:8px;font-weight:700;color:${color};letter-spacing:0.14em;text-transform:uppercase;margin-bottom:10px;font-family:'Source Serif 4',Georgia,serif">${icon} ${label}</div>
            ${(items ?? []).map(item => `<div style="display:flex;gap:8px;margin-bottom:6px;font-size:11px;line-height:1.55;font-family:'Source Serif 4',Georgia,serif;color:${INK}"><span style="color:${color};font-weight:700;flex-shrink:0;margin-top:1px">${icon}</span><span>${item}</span></div>`).join("")}
          </div>`
        ).join("")}
      </div>
    `);
  }

  // ── Annotation SVG overlay ────────────────────────────────────────────────
  if (annotationsSvg) {
    h = `<div style="position:relative">${h}<div style="position:absolute;top:0;left:0;width:100%;pointer-events:none;z-index:100">${annotationsSvg}</div></div>`;
  }

  return h;
}

// ── Print CSS (injected by dlPdf wrapper) ─────────────────────────────────────
export function buildIcNotePrintCss(): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Source Serif 4', Georgia, serif;
      background: ${CREAM};
      color: ${INK};
      font-size: 11px;
      line-height: 1.6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    @page {
      size: A4;
      margin: 0;
    }

    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
    }

    table { border-collapse: collapse; }
    th, td { vertical-align: top; }
  `;
}
