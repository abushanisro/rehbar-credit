"""Three-tier confidence routing.

auto_approve     → avg_confidence ≥ 90 AND no HIGH validation flags
analyst_review   → avg_confidence ≥ 70 (or HIGH flags present)
gemini_then_review → avg_confidence < 70 (Phase 3: send uncertain rows to Gemini)
"""
from app.schemas.models import ValidationFlag
from app.config import CONFIDENCE_AUTO_APPROVE, CONFIDENCE_ANALYST_REVIEW


def route(avg_confidence: float, flags: list[ValidationFlag]) -> str:
    has_high = any(f.severity == "HIGH" for f in flags)
    if avg_confidence >= CONFIDENCE_AUTO_APPROVE and not has_high:
        return "auto_approve"
    if avg_confidence >= CONFIDENCE_ANALYST_REVIEW:
        return "analyst_review"
    return "gemini_then_review"
