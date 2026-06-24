"""FastAPI app — exposes /health and /unmatched endpoints.

The main processing is done by worker.py (polling loop).
This HTTP server exists for health checks, Railway deployment probes,
and the analyst unmatched-label review endpoint.
"""
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from app.config import SERVICE_SECRET, PARSER_VERSION, ALIAS_VERSION, VALIDATOR_VERSION
from app.review.unmatched_store import read_unmatched

app = FastAPI(title="Rehbar PDF Extraction Service", version="1.0.0")


def _check_secret(secret: str | None):
    if SERVICE_SECRET and secret != SERVICE_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "parser_version": PARSER_VERSION,
        "alias_version": ALIAS_VERSION,
        "validator_version": VALIDATOR_VERSION,
    }


@app.get("/unmatched")
def unmatched_labels(
    limit: int = 200,
    x_service_secret: str | None = Header(default=None),
):
    """Return recent unmatched labels for analyst review."""
    _check_secret(x_service_secret)
    return read_unmatched(limit=limit)
