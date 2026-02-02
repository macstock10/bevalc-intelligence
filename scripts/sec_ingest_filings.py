#!/usr/bin/env python3
"""
sec_ingest_filings.py - SEC Filing Ingestion Script

Ingests SEC filings (10-K, 10-Q, 8-K) for tracked beverage alcohol companies.
Downloads filings from EDGAR, parses sections, stores in D1, and uploads to R2.

Usage:
    python scripts/sec_ingest_filings.py --company BF.B --years 1
    python scripts/sec_ingest_filings.py --all --backfill
    python scripts/sec_ingest_filings.py --recent --days 7
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional

import requests

# Add lib to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))

from d1_utils import init_d1_config, d1_execute, escape_sql_value
from sec_edgar import (
    init_edgar_client,
    get_company_filings,
    get_filing_document,
    get_historical_filings,
    parse_fiscal_period,
    TARGET_COMPANIES,
)
from sec_parser import (
    init_parser,
    parse_10k_sections,
    parse_10q_sections,
    parse_8k_items,
    chunk_text,
)
from r2_utils import init_r2_client, upload_to_r2 as r2_upload, file_exists_in_r2

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Track processing stats
_stats = {
    "filings_processed": 0,
    "filings_skipped": 0,
    "filings_failed": 0,
    "sections_extracted": 0,
    "chunks_created": 0,
    "r2_uploads": 0,
}


def upload_to_r2(content: str, key: str, metadata: Dict = None) -> bool:
    """
    Upload filing content to R2 bucket.

    Args:
        content: HTML content to upload
        key: R2 object key (path)
        metadata: Optional metadata dict

    Returns:
        True if successful
    """
    try:
        success = r2_upload(content, key, content_type="text/html", metadata=metadata)
        if success:
            _stats["r2_uploads"] += 1
        return success
    except Exception as e:
        logger.warning(f"R2 upload failed for {key}: {e}")
        # Continue even if R2 fails - we still have content in D1
        return False


def get_or_create_sec_company(ticker: str) -> Optional[int]:
    """Get or create sec_companies record, return sec_company_id."""
    company = TARGET_COMPANIES.get(ticker)
    if not company:
        logger.error(f"Unknown ticker: {ticker}")
        return None

    # Check if exists
    result = d1_execute(
        "SELECT id FROM sec_companies WHERE ticker = ?",
        [ticker]
    )

    if result.get("success") and result.get("result"):
        rows = result["result"][0].get("results", [])
        if rows:
            return rows[0]["id"]

    # Create new record
    result = d1_execute(
        """INSERT INTO sec_companies (ticker, cik, company_name)
           VALUES (?, ?, ?)
           RETURNING id""",
        [ticker, company["cik"], company["name"]]
    )

    if result.get("success") and result.get("result"):
        rows = result["result"][0].get("results", [])
        if rows:
            logger.info(f"Created sec_companies record for {ticker}")
            return rows[0]["id"]

    logger.error(f"Failed to create sec_companies record for {ticker}")
    return None


def filing_exists(accession_number: str) -> bool:
    """Check if filing already exists in database."""
    result = d1_execute(
        "SELECT id FROM sec_filings WHERE accession_number = ?",
        [accession_number]
    )

    if result.get("success") and result.get("result"):
        rows = result["result"][0].get("results", [])
        return len(rows) > 0

    return False


def insert_filing(sec_company_id: int, filing: Dict) -> Optional[int]:
    """Insert filing record and return filing_id."""
    if filing_exists(filing["accession_number"]):
        logger.debug(f"Filing already exists: {filing['accession_number']}")
        return None

    fiscal = parse_fiscal_period(filing["filing_type"], filing.get("report_date"))

    result = d1_execute(
        """INSERT INTO sec_filings
           (sec_company_id, accession_number, filing_type, filing_date,
            period_end_date, fiscal_year, fiscal_quarter, edgar_url,
            processing_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
           RETURNING id""",
        [
            sec_company_id,
            filing["accession_number"],
            filing["filing_type"],
            filing["filing_date"],
            filing.get("report_date"),
            fiscal["fiscal_year"],
            fiscal["fiscal_quarter"],
            filing["edgar_url"],
        ]
    )

    if result.get("success") and result.get("result"):
        rows = result["result"][0].get("results", [])
        if rows:
            filing_id = rows[0]["id"]
            logger.info(f"Inserted filing {filing['accession_number']} (id={filing_id})")
            return filing_id

    logger.error(f"Failed to insert filing: {filing['accession_number']}")
    return None


def insert_section(filing_id: int, section_type: str, section_data: Dict) -> Optional[int]:
    """Insert filing section and return section_id."""
    result = d1_execute(
        """INSERT INTO sec_filing_sections
           (filing_id, section_type, section_title, content, content_hash)
           VALUES (?, ?, ?, ?, ?)
           RETURNING id""",
        [
            filing_id,
            section_type,
            section_data.get("section_title"),
            section_data.get("content"),
            section_data.get("content_hash"),
        ]
    )

    if result.get("success") and result.get("result"):
        rows = result["result"][0].get("results", [])
        if rows:
            return rows[0]["id"]

    return None


def insert_chunks(filing_id: int, section_id: int, chunks: List[Dict]) -> int:
    """Insert text chunks for a section. Returns count inserted."""
    if not chunks:
        return 0

    values = []
    for chunk in chunks:
        values.append(
            f"({filing_id}, {section_id if section_id else 'NULL'}, "
            f"{chunk['chunk_index']}, {escape_sql_value(chunk['content'])}, "
            f"{chunk['token_count']}, NULL)"
        )

    # Batch insert
    inserted = 0
    batch_size = 50

    for i in range(0, len(values), batch_size):
        batch = values[i:i + batch_size]
        sql = f"""INSERT INTO sec_filing_chunks
                  (filing_id, section_id, chunk_index, content, token_count, vector_id)
                  VALUES {','.join(batch)}"""

        result = d1_execute(sql)
        if result.get("success"):
            for res in result.get("result", []):
                inserted += res.get("meta", {}).get("changes", 0)

    return inserted


def update_filing_status(filing_id: int, status: str, r2_key: str = None):
    """Update filing processing status."""
    if r2_key:
        d1_execute(
            "UPDATE sec_filings SET processing_status = ?, r2_key = ?, processed_at = datetime('now') WHERE id = ?",
            [status, r2_key, filing_id]
        )
    else:
        d1_execute(
            "UPDATE sec_filings SET processing_status = ?, processed_at = datetime('now') WHERE id = ?",
            [status, filing_id]
        )


def process_filing(sec_company_id: int, filing: Dict, skip_existing: bool = True) -> bool:
    """
    Process a single filing: download, parse sections, store in D1.

    Args:
        sec_company_id: ID from sec_companies table
        filing: Filing metadata dict
        skip_existing: Skip if filing already in database

    Returns:
        True if processed successfully
    """
    accession = filing["accession_number"]
    filing_type = filing["filing_type"]

    # Check if already processed
    if skip_existing and filing_exists(accession):
        logger.debug(f"Skipping existing filing: {accession}")
        return True

    # Insert filing record
    filing_id = insert_filing(sec_company_id, filing)
    if not filing_id:
        return False

    # Download filing content
    cik = filing["cik"]
    doc_name = filing.get("primary_document")

    logger.info(f"Downloading {filing_type} {accession}...")
    content = get_filing_document(cik, accession, doc_name)

    if not content:
        logger.error(f"Failed to download filing: {accession}")
        update_filing_status(filing_id, "download_failed")
        return False

    # Upload raw content to R2
    r2_key = f"sec-filings/{cik}/{accession}.html"
    upload_to_r2(content, r2_key)

    # Parse sections based on filing type
    sections = {}
    if filing_type == "10-K":
        sections = parse_10k_sections(content)
    elif filing_type == "10-Q":
        sections = parse_10q_sections(content)
    elif filing_type == "8-K":
        # 8-K processing is different - handled by sec_process_8k.py
        update_filing_status(filing_id, "pending_8k_processing", r2_key)
        return True

    # Insert parsed sections
    total_chunks = 0
    for section_type, section_data in sections.items():
        section_id = insert_section(filing_id, section_type, section_data)

        if section_id:
            # Create chunks for embedding
            chunks = chunk_text(section_data.get("content", ""))
            chunk_count = insert_chunks(filing_id, section_id, chunks)
            total_chunks += chunk_count
            logger.debug(f"  {section_type}: {chunk_count} chunks")

    logger.info(f"Processed {filing_type} {accession}: {len(sections)} sections, {total_chunks} chunks")
    update_filing_status(filing_id, "processed", r2_key)

    return True


def ingest_company(ticker: str, years_10k: int = 5, years_10q: int = 3, years_8k: int = 2) -> Dict:
    """
    Ingest historical filings for a company.

    Args:
        ticker: Company ticker symbol
        years_10k: Years of 10-K filings to fetch
        years_10q: Years of 10-Q filings to fetch
        years_8k: Years of 8-K filings to fetch

    Returns:
        Dict with counts of filings processed
    """
    logger.info(f"Ingesting filings for {ticker}...")

    # Get or create company record
    sec_company_id = get_or_create_sec_company(ticker)
    if not sec_company_id:
        return {"error": f"Failed to get company record for {ticker}"}

    # Fetch filing list from EDGAR
    filings = get_historical_filings(
        ticker,
        years_10k=years_10k,
        years_10q=years_10q,
        years_8k=years_8k
    )

    if not filings:
        return {"error": f"No filings found for {ticker}"}

    logger.info(f"Found {len(filings)} filings for {ticker}")

    # Process each filing
    stats = {"10-K": 0, "10-Q": 0, "8-K": 0, "errors": 0}

    for filing in filings:
        filing_type = filing["filing_type"]

        try:
            success = process_filing(sec_company_id, filing)
            if success:
                stats[filing_type] = stats.get(filing_type, 0) + 1
            else:
                stats["errors"] += 1
        except Exception as e:
            logger.error(f"Error processing {filing['accession_number']}: {e}")
            stats["errors"] += 1

    logger.info(f"Completed {ticker}: {stats}")
    return stats


def ingest_recent(days: int = 7) -> Dict:
    """
    Ingest recent filings across all tracked companies.

    Args:
        days: Number of days to look back

    Returns:
        Dict with counts by company
    """
    logger.info(f"Ingesting filings from last {days} days...")

    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    results = {}

    for ticker, company in TARGET_COMPANIES.items():
        sec_company_id = get_or_create_sec_company(ticker)
        if not sec_company_id:
            continue

        filings = get_company_filings(
            company["cik"],
            filing_types=["10-K", "10-Q", "8-K"],
            start_date=start_date,
            max_filings=50
        )

        stats = {"processed": 0, "skipped": 0, "errors": 0}

        for filing in filings:
            try:
                if filing_exists(filing["accession_number"]):
                    stats["skipped"] += 1
                else:
                    success = process_filing(sec_company_id, filing)
                    if success:
                        stats["processed"] += 1
                    else:
                        stats["errors"] += 1
            except Exception as e:
                logger.error(f"Error processing {filing['accession_number']}: {e}")
                stats["errors"] += 1

        results[ticker] = stats
        logger.info(f"{ticker}: {stats}")

    return results


def main():
    parser = argparse.ArgumentParser(description="Ingest SEC filings")
    parser.add_argument("--company", help="Single company ticker to ingest")
    parser.add_argument("--all", action="store_true", help="Ingest all tracked companies")
    parser.add_argument("--recent", action="store_true", help="Ingest recent filings only")
    parser.add_argument("--days", type=int, default=7, help="Days to look back for --recent")
    parser.add_argument("--years", type=int, default=5, help="Years of history for backfill")
    parser.add_argument("--backfill", action="store_true", help="Full historical backfill")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be done")
    args = parser.parse_args()

    # Initialize modules
    init_d1_config(logger=logger)
    init_edgar_client(logger=logger)
    init_parser(logger=logger)

    if args.dry_run:
        logger.info("[DRY RUN] Would process:")
        if args.company:
            logger.info(f"  Company: {args.company}")
        elif args.all:
            logger.info(f"  All companies: {list(TARGET_COMPANIES.keys())}")
        return

    if args.recent:
        results = ingest_recent(days=args.days)
        print(json.dumps(results, indent=2))

    elif args.company:
        if args.backfill:
            stats = ingest_company(
                args.company,
                years_10k=5,
                years_10q=3,
                years_8k=2
            )
        else:
            stats = ingest_company(
                args.company,
                years_10k=args.years,
                years_10q=min(args.years, 3),
                years_8k=min(args.years, 2)
            )
        print(json.dumps(stats, indent=2))

    elif args.all:
        all_results = {}
        for ticker in TARGET_COMPANIES.keys():
            if args.backfill:
                stats = ingest_company(
                    ticker,
                    years_10k=5,
                    years_10q=3,
                    years_8k=2
                )
            else:
                stats = ingest_company(
                    ticker,
                    years_10k=args.years,
                    years_10q=min(args.years, 3),
                    years_8k=min(args.years, 2)
                )
            all_results[ticker] = stats

        print(json.dumps(all_results, indent=2))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
