"""PDF extraction cache backed by Supabase extraction_cache table.

Cache key: (pdf_hash, job_type, parser_version, alias_version, validator_version).
Version columns ensure stale cache entries are automatically bypassed when rules change.
"""
import hashlib
from typing import Optional
from app.config import PARSER_VERSION, ALIAS_VERSION, VALIDATOR_VERSION


def hash_pdf(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()


async def get_cached(
    pdf_hash: str,
    job_type: str,
    supabase,
) -> Optional[dict]:
    """Return cached result if it exists for the current version tuple, else None."""
    try:
        resp = (
            supabase.table("extraction_cache")
            .select("result")
            .eq("pdf_hash", pdf_hash)
            .eq("job_type", job_type)
            .eq("parser_version", PARSER_VERSION)
            .eq("alias_version", ALIAS_VERSION)
            .eq("validator_version", VALIDATOR_VERSION)
            .maybe_single()
            .execute()
        )
        return resp.data["result"] if resp.data else None
    except Exception:
        return None


async def set_cached(
    pdf_hash: str,
    job_type: str,
    result: dict,
    supabase,
) -> None:
    """Store extraction result in cache."""
    try:
        supabase.table("extraction_cache").upsert({
            "pdf_hash": pdf_hash,
            "job_type": job_type,
            "parser_version": PARSER_VERSION,
            "alias_version": ALIAS_VERSION,
            "validator_version": VALIDATOR_VERSION,
            "result": result,
        }).execute()
    except Exception:
        pass  # cache write failure is non-critical
