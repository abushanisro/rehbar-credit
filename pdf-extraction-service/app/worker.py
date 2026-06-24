"""Async worker — polls extraction_jobs table and processes pending jobs.

Runs as the main process in the Docker container.
Future migration path: replace asyncio.sleep with Postgres NOTIFY/LISTEN.
"""
import asyncio
import io
import json
import logging
import sys
from typing import Any

import httpx
from supabase import create_client, Client

from app.config import (
    SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_STORAGE_BUCKET,
    WORKER_POLL_INTERVAL_S, WORKER_BATCH_SIZE, WORKER_MAX_RETRIES,
    PARSER_VERSION, ALIAS_VERSION, VALIDATOR_VERSION,
)
from app.cache.pdf_cache import hash_pdf, get_cached, set_cached
from app.extractors.pdf_reader import extract_pdf, is_scanned
from app.extractors.excel_reader import extract_excel
from app.detector.section_detector import detect_sections
from app.extractors.table_parser import parse_section
from app.extractors.bank_parser import parse_bank_statement
from app.extractors.gst_parser import parse_gst
from app.extractors.cibil_parser import parse_cibil, parse_cibil_date_for_db
from app.validator.financial_validator import validate_statement, validate_bank_row
from app.review.confidence_router import route

logging.basicConfig(stream=sys.stdout, level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("worker")


def _make_client() -> Client:
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    # Force HTTP/1.1 — Supabase PostgREST resets HTTP/2 streams on Windows
    old = client.postgrest.session
    client.postgrest.session = httpx.Client(
        base_url=old.base_url,
        headers=dict(old.headers),
        http2=False,
    )
    old.close()
    return client


async def _fetch_pending(supabase: Client) -> list[dict]:
    resp = (
        supabase.table("extraction_jobs")
        .select("*")
        .eq("status", "pending")
        .order("created_at")
        .limit(WORKER_BATCH_SIZE)
        .execute()
    )
    return resp.data or []


def _log_event(supabase: Client, event_type: str, status: str, title: str,
               case_id: str | None = None, resource_id: str | None = None,
               resource_type: str | None = None, metadata: dict | None = None):
    try:
        supabase.table("activity_log").insert({
            "event_category": "extraction",
            "event_type": event_type,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "case_id": case_id,
            "actor_role": "worker",
            "status": status,
            "title": title,
            "metadata": metadata or {},
        }).execute()
    except Exception as e:
        log.warning(f"Failed to write activity_log: {e}")


async def _mark_running(job_id: str, supabase: Client):
    supabase.table("extraction_jobs").update({"status": "running"}).eq("id", job_id).execute()


async def _mark_completed(job_id: str, summary: dict, supabase: Client):
    supabase.table("extraction_jobs").update({
        "status": "completed",
        "result_summary": summary,
    }).eq("id", job_id).execute()


async def _mark_failed(job_id: str, error: str, supabase: Client):
    supabase.table("extraction_jobs").update({
        "status": "failed",
        "error_message": error,
    }).eq("id", job_id).execute()


async def _requeue(job_id: str, retry_count: int, supabase: Client):
    supabase.table("extraction_jobs").update({
        "status": "pending",
        "retry_count": retry_count + 1,
    }).eq("id", job_id).execute()


async def _download_pdf(doc_id: str, supabase: Client) -> tuple[bytes, dict]:
    doc_resp = supabase.table("financial_documents").select("*").eq("id", doc_id).single().execute()
    doc = doc_resp.data
    file_resp = supabase.storage.from_(SUPABASE_STORAGE_BUCKET).download(doc["file_path"])
    return file_resp, doc


async def _upsert_financials(
    case_id: str,
    document_id: str,
    user_id: str,
    statements: list[Any],
    unit: str | None,
    supabase: Client,
) -> int:
    count = 0
    for stmt in statements:
        line_items = [li.model_dump() for li in stmt.line_items]
        meta = {
            "parser_version": PARSER_VERSION,
            "alias_version": ALIAS_VERSION,
            "validator_version": VALIDATOR_VERSION,
            "avg_confidence": stmt.avg_confidence,
            "validation_flags": [
                {"rule": f.rule, "message": f.message, "severity": f.severity}
                for f in stmt.validation_flags
            ],
        }
        supabase.table("extracted_financials").upsert({
            "case_id": case_id,
            "document_id": document_id,
            "user_id": user_id,
            "fiscal_year": stmt.fiscal_year,
            "statement_type": stmt.statement_type,
            "line_items": line_items,
            "confirmed": stmt.review_status == "auto_approve",
            "unit": unit,
            "extraction_meta": meta,
        }, on_conflict="case_id,fiscal_year,statement_type").execute()
        count += 1
    return count


async def _upsert_raw_rows(
    case_id: str,
    document_id: str,
    raw_rows: list[Any],
    supabase: Client,
):
    if not raw_rows:
        return
    rows_data = [
        {
            "document_id": document_id,
            "case_id": case_id,
            "page_number": r.page_number,
            "table_index": r.table_index,
            "row_index": r.row_index,
            "raw_cells": r.raw_cells,
            "mapped_label": r.mapped_label,
            "mapped_value": r.mapped_value,
            "fiscal_year": r.fiscal_year,
            "statement_type": r.statement_type,
            "match_method": r.match_method,
            "confidence": r.confidence,
        }
        for r in raw_rows
    ]
    supabase.table("extraction_raw_rows").insert(rows_data).execute()


async def _process_financials(
    pdf_bytes: bytes,
    payload: dict,
    case_id: str,
    document_id: str,
    user_id: str,
    method: str,
    supabase: Client,
) -> dict:
    scanned = False
    if method == "excel":
        pages = extract_excel(pdf_bytes)
    else:
        scanned = is_scanned(pdf_bytes)
        pages, method = extract_pdf(pdf_bytes)

    tables_found = sum(len(p.tables) for p in pages)
    log.info(f"Extracted {len(pages)} pages, {tables_found} tables, scanned={scanned}, method={method}")

    sections = detect_sections(pages)
    log.info(f"Detected {len(sections)} sections: {[s.section_type for s in sections]}")

    statement_types = payload.get("statement_types", ["profit_loss", "balance_sheet", "cash_flow"])

    all_statements = []
    all_raw_rows = []

    for section in sections:
        if section.section_type not in statement_types and section.section_type != "unknown":
            continue
        stmt_type = section.section_type if section.section_type != "unknown" else statement_types[0]
        stmts, raws = parse_section(section, stmt_type)
        log.info(f"  Section {section.section_type}: {len(stmts)} statements, {len(raws)} raw rows")
        all_statements.extend(stmts)
        all_raw_rows.extend(raws)

    # Run validation and routing on each statement
    for stmt in all_statements:
        flags = validate_statement(stmt.statement_type, stmt.line_items)
        stmt.validation_flags = flags
        stmt.review_status = route(stmt.avg_confidence, flags)

    unit = payload.get("unit") or _detect_unit(all_statements)

    upserted = await _upsert_financials(case_id, document_id, user_id, all_statements, unit, supabase)
    await _upsert_raw_rows(case_id, document_id, all_raw_rows, supabase)

    return {
        "statements_extracted": upserted,
        "method": method,
        "raw_rows_stored": len(all_raw_rows),
        "pages_found": len(pages),
        "tables_found": tables_found,
        "sections_found": len(sections),
        "is_scanned": scanned,
    }


async def _process_bank_statement(
    pdf_bytes: bytes,
    payload: dict,
    case_id: str,
    document_id: str,
    user_id: str,
    supabase: Client,
) -> dict:
    pages, _ = extract_pdf(pdf_bytes)
    rows = parse_bank_statement(pages)
    flags_by_month = {}
    for row in rows:
        flags = validate_bank_row(row)
        if flags:
            flags_by_month[row.month] = [f.message for f in flags]

    for row in rows:
        row_data = row.model_dump()
        row_data["case_id"] = case_id
        row_data["document_id"] = document_id
        row_data["user_id"] = user_id
        supabase.table("bank_statement_data").upsert(
            row_data,
            on_conflict="case_id,month,bank_name",
        ).execute()

    return {"months_extracted": len(rows), "validation_issues": flags_by_month}


async def _process_gst(
    pdf_bytes: bytes,
    payload: dict,
    case_id: str,
    document_id: str,
    user_id: str,
    supabase: Client,
) -> dict:
    pages, _ = extract_pdf(pdf_bytes)
    rows = parse_gst(pages)

    for row in rows:
        row_data = row.model_dump()
        row_data["case_id"] = case_id
        row_data["document_id"] = document_id
        row_data["user_id"] = user_id
        supabase.table("gst_return_data").upsert(
            row_data,
            on_conflict="case_id,period,return_type",
        ).execute()

    return {"periods_extracted": len(rows)}


async def _process_cibil(
    pdf_bytes: bytes,
    payload: dict,
    case_id: str,
    document_id: str,
    user_id: str,
    supabase: Client,
) -> dict:
    file_type = payload.get("file_type", "pdf")
    if file_type == "excel":
        pages = extract_excel(pdf_bytes)
    else:
        pages, _ = extract_pdf(pdf_bytes)

    report_data = parse_cibil(pages)

    report_date_str = parse_cibil_date_for_db(report_data.get("report_date", ""))
    total_outstanding = (
        report_data.get("credit_summary", {}).get("total", {}).get("outstanding") or None
    )

    response = supabase.table("cibil_report_data").upsert({
        "case_id":          case_id,
        "document_id":      document_id,
        "user_id":          user_id,
        "report_data":      report_data,
        "report_order_no":  report_data.get("report_order_no") or None,
        "report_date":      report_date_str,
        "borrower_name":    report_data.get("borrower", {}).get("name") or None,
        "cibil_rank":       report_data.get("rank", {}).get("value") or None,
        "total_outstanding": total_outstanding,
    }, on_conflict="case_id,document_id").execute()
    if getattr(response, 'error', None):
        raise RuntimeError(f"CIBIL report insert failed: {response.error}")

    return {"facilities_parsed": len(report_data.get("facilities", []))}


def _detect_unit(statements: list[Any]) -> str | None:
    """Heuristic unit detection from magnitude of extracted values."""
    values = []
    for stmt in statements:
        for li in stmt.line_items:
            if li.value and abs(li.value) > 0:
                values.append(abs(li.value))
    if not values:
        return None
    median = sorted(values)[len(values) // 2]
    if median > 10_000:
        return "Crores"
    if median > 100:
        return "Lakhs"
    return "Crores"


async def process_job(job: dict, supabase: Client):
    job_id = job["id"]
    case_id = job["case_id"]
    document_id = job["document_id"]
    user_id = job["user_id"]
    job_type = job["job_type"]
    payload = job.get("payload") or {}
    retry_count = job.get("retry_count", 0)

    await _mark_running(job_id, supabase)
    log.info(f"Processing job {job_id} type={job_type} case={case_id}")
    _log_event(supabase, "job_started", "success",
               f"Extraction job started ({job_type})",
               case_id=case_id, resource_id=job_id, resource_type="extraction_job",
               metadata={"job_id": job_id, "job_type": job_type, "document_id": document_id})

    try:
        pdf_bytes, doc = await _download_pdf(document_id, supabase)
        pdf_hash = hash_pdf(pdf_bytes)

        # Check cache
        cached = await get_cached(pdf_hash, job_type, supabase)
        if cached:
            log.info(f"Cache hit for job {job_id}")
            summary = cached.get("summary", {})
            _log_event(supabase, "cache_hit", "success",
                       f"Cache hit — skipping re-extraction ({job_type})",
                       case_id=case_id, resource_id=job_id, resource_type="extraction_job",
                       metadata={"job_id": job_id, "job_type": job_type, "pdf_hash": pdf_hash[:12]})
        else:
            supabase.table("financial_documents").update(
                {"extraction_status": "running"}
            ).eq("id", document_id).execute()

            file_type = doc.get("file_type", "pdf")
            method = "excel" if file_type == "excel" else "pdfplumber"
            if job_type == "financials":
                summary = await _process_financials(
                    pdf_bytes, payload, case_id, document_id, user_id, method, supabase
                )
            elif job_type == "bank_statement":
                summary = await _process_bank_statement(
                    pdf_bytes, payload, case_id, document_id, user_id, supabase
                )
            elif job_type == "gst":
                summary = await _process_gst(
                    pdf_bytes, payload, case_id, document_id, user_id, supabase
                )
            elif job_type == "cibil":
                summary = await _process_cibil(
                    pdf_bytes, payload, case_id, document_id, user_id, supabase
                )
            else:
                raise ValueError(f"Unknown job_type: {job_type}")

            await set_cached(pdf_hash, job_type, {"summary": summary}, supabase)

        extracted_count = (
            summary.get("statements_extracted", 0)
            or summary.get("months_extracted", 0)
            or summary.get("periods_extracted", 0)
            or summary.get("facilities_parsed", 0)
        )
        if extracted_count == 0 and job_type == "financials":
            if summary.get("is_scanned"):
                fail_reason = (
                    "Scanned/image PDF — no text tables found. "
                    "PaddleOCR is not installed on this worker. "
                    "Please upload a digital (text-based) PDF or use the Excel template."
                )
            elif summary.get("tables_found", 0) == 0:
                fail_reason = (
                    f"No tables detected in {summary.get('pages_found', 0)} page(s). "
                    "Make sure this is an audited financial statement with Balance Sheet, P&L, or Cash Flow tables."
                )
            else:
                fail_reason = (
                    f"Found {summary.get('tables_found')} table(s) but no year headers matched. "
                    "The document may use an unsupported format — try the Excel template."
                )
            log.warning(f"Job {job_id} zero extractions: {fail_reason}")
            _log_event(supabase, "job_zero_extractions", "failure",
                       f"Extraction completed with 0 results — {fail_reason[:80]}",
                       case_id=case_id, resource_id=job_id, resource_type="extraction_job",
                       metadata={"job_id": job_id, "job_type": job_type, "reason": fail_reason,
                                 "is_scanned": summary.get("is_scanned"), "pages": summary.get("pages_found"),
                                 "tables": summary.get("tables_found"), "document_id": document_id})
            supabase.table("financial_documents").update(
                {"extraction_status": "failed", "extraction_error": fail_reason}
            ).eq("id", document_id).execute()
        else:
            supabase.table("financial_documents").update(
                {"extraction_status": "extracted", "extraction_error": None}
            ).eq("id", document_id).execute()
            _log_event(supabase, "job_completed", "success",
                       f"Extraction completed — {extracted_count} record(s) extracted ({job_type})",
                       case_id=case_id, resource_id=job_id, resource_type="extraction_job",
                       metadata={**summary, "job_id": job_id, "document_id": document_id})

        await _mark_completed(job_id, summary, supabase)
        log.info(f"Job {job_id} completed: {summary}")

    except Exception as e:
        log.exception(f"Job {job_id} failed: {e}")
        err_str = str(e)
        _log_event(supabase, "job_error", "failure",
                   f"Extraction job crashed: {err_str[:120]}",
                   case_id=case_id, resource_id=job_id, resource_type="extraction_job",
                   metadata={"job_id": job_id, "job_type": job_type, "error": err_str,
                             "retry_count": retry_count, "document_id": document_id})
        supabase.table("financial_documents").update(
            {"extraction_status": "failed", "extraction_error": err_str}
        ).eq("id", document_id).execute()

        if retry_count < WORKER_MAX_RETRIES:
            await _requeue(job_id, retry_count, supabase)
            log.info(f"Job {job_id} requeued (attempt {retry_count + 1})")
        else:
            await _mark_failed(job_id, err_str, supabase)
            log.error(f"Job {job_id} permanently failed after {retry_count + 1} attempts")


async def run():
    log.info("Worker starting...")
    supabase = _make_client()

    while True:
        try:
            jobs = await _fetch_pending(supabase)
            if jobs:
                log.info(f"Fetched {len(jobs)} pending job(s)")
                await asyncio.gather(*[process_job(j, supabase) for j in jobs])
        except Exception as e:
            log.exception(f"Worker poll error: {e}")

        await asyncio.sleep(WORKER_POLL_INTERVAL_S)


if __name__ == "__main__":
    asyncio.run(run())
