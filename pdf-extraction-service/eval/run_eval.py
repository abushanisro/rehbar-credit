"""Batch evaluation runner.

Usage:
    python -m eval.run_eval --pdf-dir /path/to/pdfs --gt-dir eval/ground_truth

Ground truth files are JSON with shape:
    {
      "pdf_id": "bs_001",
      "verified_by": "analyst@rehbar.co.in",
      "verified_at": "2026-06-06",
      "statement_type": "balance_sheet",
      "fiscal_year": 2024,
      "unit": "Lakhs",
      "line_items": [
        {"label": "Turnover", "value": 1234.56},
        ...
      ]
    }

Gate: field_accuracy >= 0.92 on 100 verified PDFs before Phase 3.
"""
import argparse
import json
import os
import sys

from eval.metrics import evaluate_statement, print_summary, EvalResult
from app.extractors.pdf_reader import extract_pdf
from app.detector.section_detector import detect_sections
from app.extractors.table_parser import parse_section
from app.validator.financial_validator import validate_statement


def load_ground_truth(gt_dir: str) -> list[dict]:
    gt_files = []
    for root, _, files in os.walk(gt_dir):
        for fname in files:
            if fname.endswith(".json"):
                with open(os.path.join(root, fname)) as f:
                    gt_files.append(json.load(f))
    return gt_files


def eval_pdf(pdf_path: str, gt: dict) -> EvalResult | None:
    try:
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
    except FileNotFoundError:
        print(f"  PDF not found: {pdf_path}")
        return None

    pages, method = extract_pdf(pdf_bytes)
    sections = detect_sections(pages)

    stmt_type = gt["statement_type"]
    fiscal_year = gt["fiscal_year"]

    all_statements = []
    for section in sections:
        if section.section_type in (stmt_type, "unknown"):
            stmts, _ = parse_section(section, stmt_type)
            all_statements.extend(stmts)

    # Find matching statement for this FY
    stmt = next((s for s in all_statements if s.fiscal_year == fiscal_year), None)
    if not stmt:
        print(f"  No statement found for FY {fiscal_year} in {pdf_path}")
        return EvalResult(
            pdf_id=gt["pdf_id"],
            statement_type=stmt_type,
            fiscal_year=fiscal_year,
            field_accuracy=0.0,
            precision=0.0,
            recall=0.0,
            missing_field_rate=1.0,
            false_mapping_rate=0.0,
            avg_confidence=0.0,
            method=method,
            total_gt_fields=len(gt["line_items"]),
            matched_fields=0,
            missing_fields=[li["label"] for li in gt["line_items"]],
            wrong_mapped=[],
        )

    return evaluate_statement(
        pdf_id=gt["pdf_id"],
        extracted=[li.model_dump() for li in stmt.line_items],
        ground_truth=gt["line_items"],
        statement_type=stmt_type,
        fiscal_year=fiscal_year,
        avg_confidence=stmt.avg_confidence,
        method=method,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-dir", required=True, help="Directory with PDF files")
    parser.add_argument("--gt-dir", default="eval/ground_truth", help="Ground truth directory")
    parser.add_argument("--gate", type=float, default=0.92, help="Min field accuracy gate")
    args = parser.parse_args()

    ground_truths = load_ground_truth(args.gt_dir)
    if not ground_truths:
        print("No ground truth files found.")
        sys.exit(1)

    print(f"Evaluating {len(ground_truths)} ground truth files...")
    results: list[EvalResult] = []

    for gt in ground_truths:
        pdf_path = os.path.join(args.pdf_dir, f"{gt['pdf_id']}.pdf")
        print(f"  {gt['pdf_id']} ({gt['statement_type']} FY{gt['fiscal_year']})...", end=" ")
        result = eval_pdf(pdf_path, gt)
        if result:
            results.append(result)
            print(f"{result.field_accuracy:.1%}")

    print_summary(results)

    if results:
        avg_fa = sum(r.field_accuracy for r in results) / len(results)
        if avg_fa < args.gate:
            print(f"\n❌ GATE FAILED: avg field accuracy {avg_fa:.1%} < {args.gate:.1%}")
            sys.exit(1)
        else:
            print(f"\n✅ GATE PASSED: avg field accuracy {avg_fa:.1%} >= {args.gate:.1%}")


if __name__ == "__main__":
    main()
