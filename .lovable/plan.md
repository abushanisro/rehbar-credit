
# Rehbar Credit Analysis Software — Build Plan

Re-scoping the existing terminal app to fully match the BRD + SOP. The Bloomberg-terminal aesthetic stays; the data model, workflow, and outputs change to match a real credit shop.

---

## What changes vs. what we have today

The current app is a generic "investment thesis." The BRD/SOP describe a **credit appraisal workflow** with very specific structure. Major changes:

| Today | Target (Rehbar) |
|---|---|
| Single "thesis" entity | **Credit Case** with deal type, product, status pipeline |
| PDF only | PDF, Image (JPG/PNG), **Excel** |
| One AI shot → result JSON | **3-stage pipeline**: Extraction → Confirmation → Ratio engine + Narrative |
| No confidence/review | **Per-field confidence score** (High/Med/Low), <80% requires manual review |
| BUY/HOLD/SELL verdict | **No AI verdict** (BRD forbids it). Analyst writes recommendation. |
| 5 generic modules | **12 IC Note sections** + product-specific rules |
| Generic ratios | Liquidity / Leverage / Efficiency / Profitability / Coverage with **traffic-light thresholds** + peer benchmarks + multi-year trend |
| No exports | **Excel ratio sheet** + **Word IC Note** export (PPT in phase 2) |
| Generic auth | **Roles**: Analyst, Credit Committee, Operations, Admin |

---

## Scope — Phase 1 (this build)

**Must-Have features per BRD:**
1. **CAS-MH-01 — AI Data Extraction** with confidence scoring, side-by-side review, manual override
2. **CAS-MH-02 — Automated Ratio Analysis** with traffic-light coloring, multi-year trend, Excel export
3. **CAS-MH-03 — Smart Narrative Generation** producing the 12-section IC Note draft, editable rich text, Word export

**Plus the SOP-driven structure:**
- Product taxonomy: Operating Lease (core), Finance Lease, PF, TF, PLS, Home Loan, Employee Car Lease
- Product-specific rules (e.g., projections waived for PF/TF, <100L deals; HL FOIR ≤50%, LTV ≤60%)
- Case status pipeline: Draft → Extraction → Analysis → IC Review → Approved/Declined
- 12 IC Note sections rendered as terminal panels

**Phase 2 (deferred):**
- CAS-GH-01 PPT Proposal Generator
- CAS-GH-02 Template-Based Agreement Generation
- CAS-GH-03 Document Sufficiency Indicator
- Peer benchmark admin UI (we'll seed with sensible defaults in phase 1)
- Deal vault / version control for legal docs

---

## Data model (new)

```text
credit_cases
  id, user_id, client_name, legal_constitution, registered_address,
  industry, year_established, principal_borrower,
  product_type (operating_lease | finance_lease | pf | tf | pls | home_loan | employee_car_lease),
  deal_amount, tenure_months, expected_irr, residual_value, security_deposit,
  collateral_summary, end_use, strategic_rationale,
  status (draft | extracting | extracted | analysis | ic_review | approved | declined),
  ic_note (jsonb — 12 sections), narrative_status, recommendation_text,
  created_at, updated_at

financial_documents
  id, case_id, file_path, file_type (pdf|image|excel),
  doc_class (pl|balance_sheet|cash_flow|projections|other),
  fiscal_year, upload_status, extraction_status

extracted_financials
  id, case_id, fiscal_year, statement_type,
  line_items (jsonb [{label, value, confidence, source_doc_id, reviewed, override_value}]),
  confirmed_at, confirmed_by

financial_ratios
  id, case_id, fiscal_year, category, ratio_name, value,
  benchmark, threshold_status (green|amber|red|na), formula_note

ratio_thresholds   (admin/seed data)
  industry, ratio_name, green_min, amber_min, red_max, peer_median

user_roles
  user_id, role (analyst | credit_committee | operations | admin)
```

Roles in a separate table per security policy. RLS: analysts see own cases + cases assigned to them; credit committee sees all submitted; operations sees approved.

---

## Workflow (terminal flow)

```text
[F2 NEW CASE]
  → Step 1: Client & deal info (product type drives required fields)
  → Step 2: Upload financials (PDF/Image/Excel, multiple years)
  → Step 3: Auto-classify docs → AI extraction with confidence
  → Step 4: Side-by-side REVIEW screen (extracted table left, original doc right)
            - Low-confidence fields highlighted amber/red
            - Analyst overrides values, hits CONFIRM
  → Step 5: Ratio engine fires → traffic-light table + trend chart
  → Step 6: Generate Narrative → 12-section IC Note draft in editor
  → Step 7: Analyst edits, marks "Analyst Reviewed", submits to IC
  → Step 8: Exports: Ratio Excel + IC Note Word
```

---

## UI surface (terminal panels stay)

- **Pipeline board** (Kanban-style status columns, dense)
- **Case detail** with side rail of 12 IC sections, each a panel
- **Extraction review** — dual-pane (extracted JSON table | PDF preview) with override inputs
- **Ratio matrix** — multi-year columns × ratios rows, each cell color-coded, peer column
- **Narrative editor** — markdown editor per section with "AI-Generated Draft" banner
- **Risk Register** — table of risks + mitigants
- **Product rules sidebar** — surfaces what's mandatory/waived for the chosen product

---

## Edge functions (new/updated)

- `extract-financials` — runs on PDF/image upload, calls Gemini 2.5 Pro with vision, returns structured line items + per-field confidence, writes to `extracted_financials`
- `compute-ratios` — pure TypeScript (no AI): reads confirmed financials, computes all ratios, applies thresholds from `ratio_thresholds`, writes to `financial_ratios`
- `generate-narrative` — calls Gemini with confirmed data + deal context; returns 12-section IC Note via tool calling; never includes a verdict
- `export-ratio-excel` — uses `xlsx` to build the formatted Excel with traffic-light fills
- `export-ic-note-docx` — uses `docx` npm package to build the Word IC Note in Rehbar's structure

Excel parsing for uploads handled client-side via SheetJS to avoid heavy edge-function payloads; extracted rows posted to extraction function for normalization.

---

## Technical notes (for the engineer in you)

- **No AI credit verdict** — BRD §CAS-MH-03 is explicit. We surface a Preliminary Assessment paragraph but BUY/HOLD/SELL goes away.
- **DSCR** is configured by Finance, not analyst-overridable — store formula in `ratio_thresholds.formula_note`, render as read-only.
- **PII** never sent to LLM (promoter personal details, CIBIL) — extraction prompt explicitly excludes those columns.
- **Confidence** comes from Gemini's own structured response; we ask it to score each field 0–100, then bucket: ≥90 High, 80–89 Med, <80 Low (mandatory review).
- **Traffic-light coloring** in Excel uses conditional fills, not hardcoded colors, so admin threshold changes propagate.
- **Realtime** subscription on `credit_cases` so the case detail page updates as extraction/narrative completes.
- **File size**: 20MB cap per file, 10 files per case. Excel parsed client-side; PDF/image sent to extraction function as base64 (chunked if needed).

---

## What I need from you before I start

Two decisions and one confirmation:

1. **Roles in v1?** Should I implement all four roles (Analyst, Credit Committee, Operations, Admin) with role-gated views now, or ship as single-user "Analyst" in v1 and add roles in v2?
2. **Excel ingestion**: parse client-side with SheetJS (faster, free) or send to AI extraction same as PDFs (more flexible, slower)?
3. **Confirm**: drop the BUY/HOLD/SELL verdict per BRD, replace with analyst-written recommendation + IC decision field. OK?

Once you answer, I'll execute the full Phase 1 build in one pass.
