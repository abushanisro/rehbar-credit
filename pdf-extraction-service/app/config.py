import os
from pathlib import Path

# Load .env from service root if present (dev convenience)
_env_file = Path(__file__).parent.parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ[_k.strip()] = _v.strip()

# Supabase connection (required at runtime, not at import time)
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = "".join(os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").split())
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "case-files")

# Service auth
SERVICE_SECRET = os.getenv("SERVICE_SECRET", "")

# Extraction versioning — bump when rules change, old cache entries auto-invalidated
PARSER_VERSION    = "1.2.0"
ALIAS_VERSION     = "2026-06-06"
VALIDATOR_VERSION = "1.0.0"

# Review routing thresholds
CONFIDENCE_AUTO_APPROVE = int(os.getenv("CONFIDENCE_AUTO_APPROVE", "90"))
CONFIDENCE_ANALYST_REVIEW = int(os.getenv("CONFIDENCE_ANALYST_REVIEW", "70"))

# Worker
WORKER_POLL_INTERVAL_S = int(os.getenv("WORKER_POLL_INTERVAL_S", "3"))
WORKER_BATCH_SIZE = int(os.getenv("WORKER_BATCH_SIZE", "5"))
WORKER_MAX_RETRIES = int(os.getenv("WORKER_MAX_RETRIES", "3"))

# Phase feature flags
EMBEDDING_ENABLED = os.getenv("EMBEDDING_ENABLED", "false").lower() == "true"
LLM_FALLBACK_ENABLED = os.getenv("LLM_FALLBACK_ENABLED", "false").lower() == "true"

# Unmatched label log path
UNMATCHED_LOG_PATH = os.getenv("UNMATCHED_LOG_PATH", "/tmp/unmatched_labels.jsonl")
