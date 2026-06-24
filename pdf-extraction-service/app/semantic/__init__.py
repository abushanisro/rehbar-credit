from .aliases import ALIASES, REVERSE
from .canonical_labels import CANONICAL, ALL_CANONICAL
from app.config import EMBEDDING_ENABLED
from app.review.unmatched_store import record_unmatched


def match_label(raw: str) -> tuple[str, int, str]:
    """Map a raw PDF label to a canonical label.

    Returns (canonical_label, confidence, match_method).
    match_method: alias | embedding | unmatched
    """
    normalized = raw.strip().lower()

    # Tier 1: exact alias lookup
    canonical = REVERSE.get(normalized)
    if canonical:
        return canonical, 92, "alias"

    # Tier 2: embedding (Phase 2 — gated by feature flag)
    if EMBEDDING_ENABLED:
        try:
            from .embedding_matcher import embedding_matcher
            canonical, sim = embedding_matcher.match(raw)
            if sim >= 0.85:
                return canonical, int(sim * 100), "embedding"
        except ImportError:
            pass

    # No match — log for analyst review
    record_unmatched(raw)
    return raw, 45, "unmatched"
