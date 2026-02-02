#!/usr/bin/env python3
"""
sec_process_8k.py - 8-K Event Processor

Processes 8-K filings to extract material events, generate AI summaries,
and classify priority levels.

Usage:
    python scripts/sec_process_8k.py --pending
    python scripts/sec_process_8k.py --filing-id 123
    python scripts/sec_process_8k.py --company BF.B --days 30
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
from sec_edgar import init_edgar_client, get_filing_document
from sec_parser import init_parser, parse_8k_items, ITEM_8K_DEFINITIONS

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def get_pending_8k_filings(limit: int = 50) -> List[Dict]:
    """Get 8-K filings pending processing."""
    result = d1_execute(f"""
        SELECT
            sf.id, sf.accession_number, sf.filing_date, sf.edgar_url,
            sf.r2_key, sc.cik, sc.ticker, sc.company_name
        FROM sec_filings sf
        JOIN sec_companies sc ON sf.sec_company_id = sc.id
        WHERE sf.filing_type = '8-K'
          AND sf.processing_status = 'pending_8k_processing'
        ORDER BY sf.filing_date DESC
        LIMIT {limit}
    """)

    if result.get("success") and result.get("result"):
        return result["result"][0].get("results", [])
    return []


def get_filing_content(cik: str, accession: str) -> Optional[str]:
    """Download 8-K filing content from EDGAR."""
    return get_filing_document(cik, accession)


def generate_headline(item: Dict, company_name: str) -> str:
    """Generate a headline for the 8-K event using Claude."""
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        # Fallback to basic headline
        return f"{company_name}: {item['item_title']}"

    prompt = f"""Generate a brief, informative headline (max 100 characters) for this SEC 8-K filing event.

Company: {company_name}
Event Type: Item {item['item_number']} - {item['item_title']}

Event Content (first 1000 chars):
{item['raw_content'][:1000]}

Guidelines:
- Focus on the business impact, not the regulatory filing
- Use active voice
- Include the company name
- Make it newsworthy and specific

Respond with ONLY the headline, no quotes or explanation."""

    try:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": anthropic_key,
                "anthropic-version": "2023-06-01"
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 150,
                "messages": [{"role": "user", "content": prompt}]
            },
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        headline = data["content"][0]["text"].strip()
        return headline[:150]  # Limit length
    except Exception as e:
        logger.error(f"Failed to generate headline: {e}")
        return f"{company_name}: {item['item_title']}"


def generate_summary(item: Dict, company_name: str) -> str:
    """Generate a summary of the 8-K event using Claude."""
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        # Fallback to first paragraph
        content = item['raw_content']
        first_para = content.split('\n\n')[0][:500]
        return first_para

    prompt = f"""Summarize this SEC 8-K filing event in 2-3 sentences for beverage industry professionals.

Company: {company_name}
Event Type: Item {item['item_number']} - {item['item_title']}

Event Content:
{item['raw_content'][:3000]}

Guidelines:
- Focus on business implications for the beverage alcohol industry
- Mention specific details (names, amounts, dates) if relevant
- Use professional language suitable for industry reports
- Keep it concise but informative

Respond with ONLY the summary, no quotes or explanation."""

    try:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": anthropic_key,
                "anthropic-version": "2023-06-01"
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 300,
                "messages": [{"role": "user", "content": prompt}]
            },
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        summary = data["content"][0]["text"].strip()
        return summary[:1000]  # Limit length
    except Exception as e:
        logger.error(f"Failed to generate summary: {e}")
        content = item['raw_content']
        first_para = content.split('\n\n')[0][:500]
        return first_para


def insert_8k_event(filing_id: int, item: Dict, headline: str, summary: str) -> Optional[int]:
    """Insert 8-K event record into database."""
    result = d1_execute(
        """INSERT INTO sec_8k_events
           (filing_id, item_number, item_title, headline, summary, priority, raw_content)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           RETURNING id""",
        [
            filing_id,
            item["item_number"],
            item["item_title"],
            headline,
            summary,
            item["priority"],
            item["raw_content"][:50000],  # Limit content size
        ]
    )

    if result.get("success") and result.get("result"):
        rows = result["result"][0].get("results", [])
        if rows:
            return rows[0]["id"]

    return None


def update_filing_status(filing_id: int, status: str):
    """Update filing processing status."""
    d1_execute(
        "UPDATE sec_filings SET processing_status = ?, processed_at = datetime('now') WHERE id = ?",
        [status, filing_id]
    )


def process_8k_filing(filing: Dict) -> Dict:
    """
    Process a single 8-K filing.

    Args:
        filing: Filing metadata dict from database

    Returns:
        Dict with processing results
    """
    filing_id = filing["id"]
    accession = filing["accession_number"]
    company_name = filing["company_name"]
    cik = filing["cik"]

    logger.info(f"Processing 8-K: {company_name} - {accession}")

    # Download filing content
    content = get_filing_content(cik, accession)
    if not content:
        logger.error(f"Failed to download filing: {accession}")
        update_filing_status(filing_id, "download_failed")
        return {"error": "Download failed"}

    # Parse 8-K items
    items = parse_8k_items(content)

    if not items:
        logger.info(f"No material items found in {accession}")
        update_filing_status(filing_id, "processed")
        return {"items": 0}

    logger.info(f"Found {len(items)} items in {accession}")

    # Process each item
    events_created = 0
    for item in items:
        # Generate AI content
        headline = generate_headline(item, company_name)
        summary = generate_summary(item, company_name)

        # Insert event
        event_id = insert_8k_event(filing_id, item, headline, summary)
        if event_id:
            events_created += 1
            logger.info(f"  Created event {event_id}: {item['item_number']} ({item['priority']})")

    update_filing_status(filing_id, "processed")

    return {
        "items": len(items),
        "events_created": events_created
    }


def process_pending_filings(limit: int = 50) -> Dict:
    """Process all pending 8-K filings."""
    filings = get_pending_8k_filings(limit)

    if not filings:
        logger.info("No pending 8-K filings to process")
        return {"processed": 0}

    logger.info(f"Processing {len(filings)} pending 8-K filings...")

    stats = {"processed": 0, "events": 0, "errors": 0}

    for filing in filings:
        try:
            result = process_8k_filing(filing)
            if "error" in result:
                stats["errors"] += 1
            else:
                stats["processed"] += 1
                stats["events"] += result.get("events_created", 0)
        except Exception as e:
            logger.error(f"Error processing {filing['accession_number']}: {e}")
            stats["errors"] += 1

    logger.info(f"Completed: {stats}")
    return stats


def process_by_filing_id(filing_id: int) -> Dict:
    """Process a specific filing by ID."""
    result = d1_execute(f"""
        SELECT
            sf.id, sf.accession_number, sf.filing_date, sf.edgar_url,
            sf.r2_key, sc.cik, sc.ticker, sc.company_name
        FROM sec_filings sf
        JOIN sec_companies sc ON sf.sec_company_id = sc.id
        WHERE sf.id = {filing_id}
    """)

    if not result.get("success") or not result.get("result"):
        return {"error": "Filing not found"}

    rows = result["result"][0].get("results", [])
    if not rows:
        return {"error": "Filing not found"}

    return process_8k_filing(rows[0])


def main():
    parser = argparse.ArgumentParser(description="Process 8-K filings")
    parser.add_argument("--pending", action="store_true", help="Process all pending 8-K filings")
    parser.add_argument("--filing-id", type=int, help="Process a specific filing by ID")
    parser.add_argument("--company", help="Process recent 8-K filings for a company")
    parser.add_argument("--days", type=int, default=30, help="Days to look back for --company")
    parser.add_argument("--limit", type=int, default=50, help="Max filings to process")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be processed")
    args = parser.parse_args()

    # Initialize modules
    init_d1_config(logger=logger)
    init_edgar_client(logger=logger)
    init_parser(logger=logger)

    if args.dry_run:
        filings = get_pending_8k_filings(args.limit)
        logger.info(f"[DRY RUN] Would process {len(filings)} filings:")
        for f in filings[:10]:
            logger.info(f"  - {f['company_name']}: {f['accession_number']}")
        return

    if args.filing_id:
        result = process_by_filing_id(args.filing_id)
        print(json.dumps(result, indent=2))

    elif args.pending:
        result = process_pending_filings(args.limit)
        print(json.dumps(result, indent=2))

    elif args.company:
        # Find and process recent 8-K filings for a company
        start_date = (datetime.now() - timedelta(days=args.days)).strftime("%Y-%m-%d")
        query_result = d1_execute(f"""
            SELECT
                sf.id, sf.accession_number, sf.filing_date, sf.edgar_url,
                sf.r2_key, sc.cik, sc.ticker, sc.company_name
            FROM sec_filings sf
            JOIN sec_companies sc ON sf.sec_company_id = sc.id
            WHERE sc.ticker = '{args.company}'
              AND sf.filing_type = '8-K'
              AND sf.filing_date >= '{start_date}'
            ORDER BY sf.filing_date DESC
            LIMIT {args.limit}
        """)

        if query_result.get("success") and query_result.get("result"):
            filings = query_result["result"][0].get("results", [])
            logger.info(f"Found {len(filings)} 8-K filings for {args.company}")

            for filing in filings:
                result = process_8k_filing(filing)
                print(f"{filing['accession_number']}: {result}")
        else:
            logger.error(f"No filings found for {args.company}")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
