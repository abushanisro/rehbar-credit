"""Evaluation metrics for extraction accuracy.

Field Accuracy: extracted value within 2% of ground truth value.
Precision: correct extractions / total extractions attempted.
Recall: correct extractions / total ground truth fields.
Missing Field Rate: % of ground truth fields not found.
False Mapping Rate: fields mapped to wrong canonical label.
"""
from dataclasses import dataclass


@dataclass
class EvalResult:
    pdf_id: str
    statement_type: str
    fiscal_year: int
    field_accuracy: float       # % of fields within 2% of ground truth
    precision: float
    recall: float
    missing_field_rate: float
    false_mapping_rate: float
    avg_confidence: float
    method: str
    total_gt_fields: int
    matched_fields: int
    missing_fields: list[str]
    wrong_mapped: list[str]


def _within_pct(a: float, b: float, pct: float = 2.0) -> bool:
    if a == 0 and b == 0:
        return True
    if a == 0 or b == 0:
        return False
    return abs(a - b) / max(abs(a), abs(b)) <= pct / 100


def evaluate_statement(
    pdf_id: str,
    extracted: list[dict],
    ground_truth: list[dict],
    statement_type: str,
    fiscal_year: int,
    avg_confidence: float = 0.0,
    method: str = "unknown",
) -> EvalResult:
    """Compare extracted line items against ground truth.

    extracted: list of {label, value, confidence}
    ground_truth: list of {label, value}
    """
    gt_map = {item["label"]: item["value"] for item in ground_truth if item.get("value") is not None}
    ex_map = {item["label"]: item.get("value") for item in extracted if item.get("value") is not None}

    matched = 0
    missing: list[str] = []
    wrong_mapped: list[str] = []

    for gt_label, gt_value in gt_map.items():
        if gt_label not in ex_map:
            missing.append(gt_label)
        else:
            ex_value = ex_map[gt_label]
            if ex_value is not None and _within_pct(float(ex_value), float(gt_value)):
                matched += 1
            else:
                wrong_mapped.append(gt_label)

    total_gt = len(gt_map)
    total_ex = len(ex_map)

    precision = matched / total_ex if total_ex else 0.0
    recall = matched / total_gt if total_gt else 0.0
    field_accuracy = matched / total_gt if total_gt else 0.0
    missing_rate = len(missing) / total_gt if total_gt else 0.0
    false_mapping_rate = len(wrong_mapped) / total_gt if total_gt else 0.0

    return EvalResult(
        pdf_id=pdf_id,
        statement_type=statement_type,
        fiscal_year=fiscal_year,
        field_accuracy=field_accuracy,
        precision=precision,
        recall=recall,
        missing_field_rate=missing_rate,
        false_mapping_rate=false_mapping_rate,
        avg_confidence=avg_confidence,
        method=method,
        total_gt_fields=total_gt,
        matched_fields=matched,
        missing_fields=missing,
        wrong_mapped=wrong_mapped,
    )


def print_summary(results: list[EvalResult]):
    if not results:
        print("No results.")
        return
    avg_fa = sum(r.field_accuracy for r in results) / len(results)
    avg_prec = sum(r.precision for r in results) / len(results)
    avg_rec = sum(r.recall for r in results) / len(results)
    avg_miss = sum(r.missing_field_rate for r in results) / len(results)
    avg_conf = sum(r.avg_confidence for r in results) / len(results)

    print(f"\n{'='*50}")
    print(f"Evaluation Summary ({len(results)} statements)")
    print(f"{'='*50}")
    print(f"Field Accuracy:      {avg_fa:.1%}")
    print(f"Precision:           {avg_prec:.1%}")
    print(f"Recall:              {avg_rec:.1%}")
    print(f"Missing Field Rate:  {avg_miss:.1%}")
    print(f"Avg Confidence:      {avg_conf:.1f}")
    print(f"{'='*50}")

    by_type: dict[str, list[EvalResult]] = {}
    for r in results:
        by_type.setdefault(r.statement_type, []).append(r)
    for stype, rlist in sorted(by_type.items()):
        fa = sum(x.field_accuracy for x in rlist) / len(rlist)
        print(f"  {stype:<25} {fa:.1%}  (n={len(rlist)})")
