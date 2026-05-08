import { PRODUCTS, RATIO_DISPLAY_NAMES, formatRatio } from "@/features/credit/domain";
import type { CaseRow, ExtractedRow, RatioRow, LineItem } from "@/features/case/types";
import { icGetItems, icLiVal, icFmt } from "./ICComponents";

export function buildIcNoteHtml(
  cc: CaseRow,
  extracted: ExtractedRow[],
  ratios: RatioRow[],
  ic: { sections: Record<string,{markdown:string}>; risks: Array<{category:string;risk:string;mitigant:string;severity:string}>; conditions_precedent: string[]; swot?: {strengths:string[];weaknesses:string[];opportunities:string[];threats:string[]} },
): string {
  const product = PRODUCTS[cc.product_type];
  const fyYears = Array.from(new Set(ratios.map(r => r.fiscal_year))).sort();
  const ratioGroups = Array.from(new Set(ratios.map(r => r.category)));
  const histExtracted = extracted.filter(r => r.statement_type !== "projections");
  const histYears = Array.from(new Set(histExtracted.map(r => r.fiscal_year))).sort();
  const projRows = extracted.filter(r => r.statement_type === "projections");
  const projYears = Array.from(new Set(projRows.map(r => r.fiscal_year))).sort();
  const unit = extracted.find(r => r.unit)?.unit ?? "";
  const ul = unit ? `₹ ${unit}` : "₹";

  const bul = (md: string) => {
    const items = md.split("\n").filter(l => /^[-*]\s/.test(l.trim())).map(l => l.trim().replace(/^[-*]\s+/,""));
    return items.length ? `<ul>${items.map(b=>`<li>${b}</li>`).join("")}</ul>` : "";
  };
  const tblRow = (label: string, ...vals: (string|number|null|undefined)[]) =>
    `<tr><td class="lbl">${label}</td>${vals.map(v=>`<td>${v??'—'}</td>`).join("")}</tr>`;
  const dataTable = (headers: string[], rows: (string|number|null|undefined)[][], caption?: string) =>
    `${caption?`<h3>${caption}</h3>`:""}<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??'—'}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

  const KEY_RATIOS = ["dscr","current_ratio","debt_to_equity","interest_coverage","ebitda_margin","roe"];

  let h = `<h1>${cc.client_name} — IC APPRAISAL NOTE</h1>
<div class="meta">
  <div class="mi"><div class="lbl">Case</div><div class="val">${cc.case_code}</div></div>
  <div class="mi"><div class="lbl">Amount</div><div class="val">₹${cc.deal_amount??'—'} Cr</div></div>
  <div class="mi"><div class="lbl">Tenure</div><div class="val">${cc.tenure_months??'—'}M</div></div>
  <div class="mi"><div class="lbl">IRR</div><div class="val">${cc.expected_irr??'—'}%</div></div>
  <div class="mi"><div class="lbl">Product</div><div class="val">${product.label}</div></div>
  <div class="mi"><div class="lbl">Industry</div><div class="val">${cc.industry??'—'}</div></div>
</div>`;

  // ── I. Executive Summary ──────────────────────────────────────────────────
  h += `<div class="sec"><h2>I. Executive Summary</h2>`;
  h += `<table><tbody>
    ${tblRow("Client", cc.client_name, "Product", product.label)}
    ${tblRow("Amount", `₹${cc.deal_amount??'—'} Cr`, "Tenure", `${cc.tenure_months??'—'}M`)}
    ${tblRow("IRR", `${cc.expected_irr??'—'}%`, "Industry", cc.industry)}
    ${cc.end_use?tblRow("End Use","<i>"+cc.end_use+"</i>"):""}
  </tbody></table>`;
  if (fyYears.length > 0 && KEY_RATIOS.some(n => ratios.find(r=>r.ratio_name===n))) {
    h += dataTable(["Ratio",...fyYears.map(y=>`FY${y}`),"Benchmark","Status"],
      KEY_RATIOS.flatMap(name => {
        const rows = ratios.filter(r=>r.ratio_name===name);
        if (!rows.length) return [];
        const latest = rows.sort((a,b)=>b.fiscal_year-a.fiscal_year)[0];
        const s = latest.threshold_status??"na";
        const cls = s==="green"?"✓":s==="red"?"✗":s==="amber"?"~":"—";
        return [[`${RATIO_DISPLAY_NAMES[name]??name} ${cls}`,...fyYears.map(y=>{const r=ratios.find(x=>x.ratio_name===name&&x.fiscal_year===y);return r?.ratio_value!=null?formatRatio(name,Number(r.ratio_value)):"—";}),latest.benchmark!=null?formatRatio(name,Number(latest.benchmark)):"—",s.toUpperCase()]];
      }), "Key Ratio Snapshot");
  }
  h += bul(ic.sections["executive_summary"]?.markdown??"");
  h += `</div>`;

  // ── II. Client & Promoter ─────────────────────────────────────────────────
  h += `<div class="sec"><h2>II. Client &amp; Promoter Profile</h2>`;
  h += `<table><tbody>
    ${tblRow("Client Name", cc.client_name)}
    ${tblRow("Legal Constitution", cc.legal_constitution)}
    ${tblRow("Industry / Sector", cc.industry)}
    ${tblRow("Year Established", cc.year_established)}
    ${tblRow("Product Applied", product.label)}
    ${tblRow("Principal Borrower", cc.principal_borrower)}
    ${tblRow("Website", cc.website)}
  </tbody></table>`;
  if (cc.promoter_details) h += `<p><b>Promoter Details:</b><br>${cc.promoter_details}</p>`;
  if (cc.group_summary) h += `<p><b>Group Summary:</b><br>${cc.group_summary}</p>`;
  h += bul(ic.sections["client_promoter"]?.markdown??"");
  h += `</div>`;

  // ── III. Investment Structure ─────────────────────────────────────────────
  h += `<div class="sec"><h2>III. Proposed Investment Structure</h2>`;
  h += `<table><tbody>
    ${tblRow("Product", product.label)}
    ${tblRow("Legal Nature", product.legalNature)}
    ${tblRow("Return Mechanism", product.returnMechanism)}
    ${tblRow("Proposed Amount", `₹${cc.deal_amount??'—'} Crores`)}
    ${tblRow("Tenure", `${cc.tenure_months??'—'} Months`)}
    ${tblRow("Expected IRR", `${cc.expected_irr??'—'}%`)}
    ${cc.residual_value!=null?tblRow("Residual Value",`₹${cc.residual_value}`):""}
    ${cc.security_deposit!=null?tblRow("Security Deposit",`₹${cc.security_deposit}`):""}
  </tbody></table>`;
  if (cc.end_use) h += `<p><b>End Use of Funds:</b><br>${cc.end_use}</p>`;
  if (cc.collateral_summary) h += `<p><b>Collateral / Security:</b><br>${cc.collateral_summary}</p>`;
  h += bul(ic.sections["investment_structure"]?.markdown??"");
  h += `</div>`;

  // ── IV. Rehbar Funding History ────────────────────────────────────────────
  h += `<div class="sec"><h2>IV. Rehbar Funding History</h2>`;
  h += `<table><tbody>
    ${tblRow("Funder", "Rehbar Financial Services")}
    ${tblRow("Business Model", "Sharia-compliant NBFC — asset financing & structured credit")}
    ${tblRow("Core Products", "Operating Lease · Finance Lease · PLS · Project Finance · Trade Finance · Home Loan")}
    ${tblRow("Prior Exposure", `No prior Rehbar funding history on record for ${cc.client_name}. New relationship.`)}
  </tbody></table>`;
  h += bul(ic.sections["rehbar_funding_history"]?.markdown??"");
  h += `</div>`;

  // ── V. Historical Financials ──────────────────────────────────────────────
  h += `<div class="sec"><h2>V. Historical Financial Analysis</h2>`;
  if (histYears.length > 0) {
    const fyItems = histYears.map(y => icGetItems(extracted, y));
    const yoyPct = (vals: (number|null)[]) => {
      const l = vals[vals.length-1], p = vals.length>=2?vals[vals.length-2]:null;
      return (l!==null&&p!==null&&p!==0) ? ((l!-p!)/Math.abs(p!)*100).toFixed(1)+"%" : "—";
    };
    for (const [labels, caption] of [
      [["Turnover","Gross Profit","EBITDA","EBIT","Interest Expense","PAT"], `P&L Summary (${ul})`],
      [["Net Worth","Total Debt","Current Assets","Fixed Assets (Net)","Total Assets","Capital Employed"], `Balance Sheet (${ul})`],
    ] as [string[], string][]) {
      h += dataTable(
        ["Item",...histYears.map(y=>`FY${y}`),...(histYears.length>=2?["YoY%"]:[])],
        labels.map(label => {
          const vals = fyItems.map(items => icLiVal(items, label));
          return [label, ...vals.map(v=>icFmt(v)), ...(histYears.length>=2?[yoyPct(vals)]:[])];
        }),
        caption,
      );
    }
  }
  h += bul(ic.sections["historical_financial"]?.markdown??"");
  h += `</div>`;

  // ── VI. Projections ───────────────────────────────────────────────────────
  h += `<div class="sec"><h2>VI. Projections &amp; Estimates</h2>`;
  if (projRows.length > 0) {
    const actCols = histYears;
    const pairs: [string,string][] = [
      ["Turnover","Projected Turnover"],["EBITDA","Projected EBITDA"],["PAT","Projected PAT"],
      ["Net Worth","Projected Net Worth"],["Total Debt","Projected Total Debt"],
    ];
    h += dataTable(
      ["Metric",...actCols.map(y=>`FY${y}(A)`),...projYears.map(y=>`FY${y}(P)`)],
      pairs.map(([hl,pl]) => [
        hl,
        ...actCols.map(y=>icFmt(icLiVal(icGetItems(extracted,y),hl))),
        ...projYears.map(y=>icFmt(icLiVal((projRows.find(r=>r.fiscal_year===y)?.line_items??[]) as unknown as LineItem[],pl))),
      ]),
      `Historical vs Projected (${ul})`,
    );
  }
  h += bul(ic.sections["projections"]?.markdown??"");
  h += `</div>`;

  // ── VII. Key Financial Ratios ─────────────────────────────────────────────
  h += `<div class="sec"><h2>VII. Key Financial Ratios</h2>`;
  for (const cat of ratioGroups) {
    const names = Array.from(new Set(ratios.filter(r=>r.category===cat).map(r=>r.ratio_name)));
    h += dataTable(
      ["Ratio",...fyYears.map(y=>`FY${y}`),"Benchmark","Status"],
      names.map(name => {
        const latest = ratios.filter(r=>r.ratio_name===name).sort((a,b)=>b.fiscal_year-a.fiscal_year)[0];
        const s = latest?.threshold_status??"na";
        return [
          RATIO_DISPLAY_NAMES[name]??name,
          ...fyYears.map(y=>{const r=ratios.find(x=>x.ratio_name===name&&x.fiscal_year===y);return r?.ratio_value!=null?formatRatio(name,Number(r.ratio_value)):"—";}),
          latest?.benchmark!=null?formatRatio(name,Number(latest.benchmark)):"—",
          s.toUpperCase(),
        ];
      }),
      cat,
    );
  }
  h += `</div>`;

  // ── VIII. Cash Flow ───────────────────────────────────────────────────────
  h += `<div class="sec"><h2>VIII. Cash Flow Statement</h2>`;
  if (histYears.length > 0) {
    const fyItems = histYears.map(y => icGetItems(extracted, y));
    const cfLabels = ["Cash from Operations","Cash from Investing","Cash from Financing","Net Change in Cash","Opening Cash","Closing Cash"];
    const cfRows = cfLabels
      .map(label => ({ label, vals: fyItems.map(items => icLiVal(items, label)) }))
      .filter(({ vals }) => vals.some(v => v !== null));
    if (cfRows.length) {
      h += dataTable(["Item",...histYears.map(y=>`FY${y}`)], cfRows.map(({label,vals})=>[label,...vals.map(v=>icFmt(v))]), `Cash Flow (${ul})`);
    }
  }
  h += bul(ic.sections["cash_flow"]?.markdown??"");
  h += `</div>`;

  // ── IX. Due Diligence ─────────────────────────────────────────────────────
  h += `<div class="sec"><h2>IX. Due Diligence Excerpts</h2>`;
  h += bul(ic.sections["due_diligence"]?.markdown??"") || `<p style="color:#999;font-style:italic">Analyst to complete.</p>`;
  h += `</div>`;

  // ── X. Risk Assessment ────────────────────────────────────────────────────
  h += `<div class="sec"><h2>X. Risk Assessment &amp; Mitigation</h2>`;
  h += bul(ic.sections["risk_assessment"]?.markdown??"");
  h += `</div>`;

  // ── XI. Visit & Reference ─────────────────────────────────────────────────
  h += `<div class="sec"><h2>XI. Visit Report, Reference Checks &amp; Exec Recommendation</h2>`;
  if (cc.analyst_notes) h += `<p><b>Analyst Notes:</b><br>${cc.analyst_notes}</p>`;
  h += bul(ic.sections["visit_reference"]?.markdown??"");
  h += dataTable(["Check Type","Source","Status"],[
    ["Banker Reference","Principal Bank","Pending"],
    ["Vendor / Supplier Check","Key Suppliers","Pending"],
    ["Customer Reference","Major Clients","Pending"],
    ["Site Visit","Business Premises","Pending"],
  ], "Reference Check Template");
  h += `</div>`;

  // ── XII. Product Specifics ────────────────────────────────────────────────
  h += `<div class="sec"><h2>XII. Specific Product Requirements &amp; Exemptions</h2>`;
  h += `<table><tbody>
    ${tblRow("Product", product.label)}
    ${tblRow("Legal Nature", product.legalNature)}
    ${tblRow("Return Mechanism", product.returnMechanism)}
  </tbody></table>`;
  h += `<ul>${product.rules.map(r=>`<li>${r}</li>`).join("")}</ul>`;
  if (cc.policy_exceptions) h += `<p><b>Policy Exceptions:</b> ${cc.policy_exceptions}</p>`;
  h += bul(ic.sections["product_specifics"]?.markdown??"");
  h += `</div>`;

  // ── Risk Register ─────────────────────────────────────────────────────────
  if (ic.risks?.length) {
    h += `<div class="sec"><h2>Risk Register</h2>
    <table><thead><tr><th>Category</th><th>Risk</th><th>Mitigant</th><th>Severity</th></tr></thead><tbody>`;
    ic.risks.forEach(r => {
      const cls = r.severity==="high"?"fail":r.severity==="medium"?"caution":"pass";
      h += `<tr><td>${r.category}</td><td>${r.risk}</td><td>${r.mitigant}</td><td class="${cls}">${r.severity?.toUpperCase()}</td></tr>`;
    });
    h += `</tbody></table></div>`;
  }

  // ── Conditions Precedent ──────────────────────────────────────────────────
  if (ic.conditions_precedent?.length) {
    h += `<div class="sec"><h2>Conditions Precedent</h2><ul>${ic.conditions_precedent.map(c=>`<li>${c}</li>`).join("")}</ul></div>`;
  }

  // ── SWOT ──────────────────────────────────────────────────────────────────
  if (ic.swot) {
    h += `<div class="sec"><h2>SWOT Analysis</h2><div class="grid2">`;
    ([["Strengths",ic.swot.strengths],["Weaknesses",ic.swot.weaknesses],["Opportunities",ic.swot.opportunities],["Threats",ic.swot.threats]] as [string,string[]][]).forEach(([label,items]) => {
      h += `<div><h3>${label}</h3><ul>${items.map(i=>`<li>${i}</li>`).join("")}</ul></div>`;
    });
    h += `</div></div>`;
  }

  return h;
}
