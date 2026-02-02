#!/usr/bin/env python3
"""
sec_compute_mda_diffs.py - MD&A Diff Engine

Computes diffs between consecutive MD&A sections to highlight changes
in management discussion. Identifies boilerplate vs meaningful changes
and generates AI summaries.

Usage:
    python scripts/sec_compute_mda_diffs.py --company BF.B
    python scripts/sec_compute_mda_diffs.py --all
    python scripts/sec_compute_mda_diffs.py --filing-id 123
"""

import os
import sys
import json
import argparse
import logging
import difflib
import re
from typing import List, Dict, Optional, Tuple
from collections import Counter

import requests

# Add lib to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))

from d1_utils import init_d1_config, d1_execute, escape_sql_value

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def get_filing_pairs(sec_company_id: int) -> List[Tuple[Dict, Dict]]:
    """
    Get pairs of consecutive filings for MD&A comparison.

    Returns pairs like (FY2024, FY2023) or (Q2 2024, Q2 2023).
    """
    # Get all 10-K and 10-Q filings for company
    result = d1_execute(f"""
        SELECT
            sf.id, sf.filing_type, sf.fiscal_year, sf.fiscal_quarter,
            sf.filing_date, sf.accession_number
        FROM sec_filings sf
        WHERE sf.sec_company_id = {sec_company_id}
          AND sf.filing_type IN ('10-K', '10-Q')
          AND sf.processing_status = 'processed'
        ORDER BY sf.fiscal_year DESC, sf.fiscal_quarter DESC NULLS FIRST
    """)

    if not result.get("success") or not result.get("result"):
        return []

    filings = result["result"][0].get("results", [])

    # Build pairs: compare to same period in prior year
    pairs = []
    filings_by_period = {}

    for filing in filings:
        fy = filing["fiscal_year"]
        fq = filing["fiscal_quarter"]
        ftype = filing["filing_type"]

        key = (ftype, fq)  # e.g., ('10-K', None) or ('10-Q', 2)
        if key not in filings_by_period:
            filings_by_period[key] = {}
        filings_by_period[key][fy] = filing

    # Create pairs with prior year comparisons
    for (ftype, fq), by_year in filings_by_period.items():
        years = sorted(by_year.keys(), reverse=True)
        for i in range(len(years) - 1):
            current = by_year[years[i]]
            previous = by_year[years[i + 1]]
            pairs.append((current, previous))

    return pairs


def get_mda_content(filing_id: int) -> Optional[str]:
    """Get MD&A section content for a filing."""
    result = d1_execute(f"""
        SELECT content FROM sec_filing_sections
        WHERE filing_id = {filing_id}
          AND section_type = 'mda'
    """)

    if result.get("success") and result.get("result"):
        rows = result["result"][0].get("results", [])
        if rows:
            return rows[0].get("content")

    return None


def split_into_sentences(text: str) -> List[str]:
    """Split text into sentences for comparison."""
    # Basic sentence splitting
    sentences = re.split(r'(?<=[.!?])\s+', text)
    # Filter out very short fragments
    sentences = [s.strip() for s in sentences if len(s.strip()) > 20]
    return sentences


def compute_diff(current: str, previous: str) -> Dict:
    """
    Compute diff between two MD&A sections.

    Returns dict with diff statistics and HTML diff.
    """
    # Split into lines for difflib
    current_lines = current.split('\n')
    previous_lines = previous.split('\n')

    # Generate unified diff
    diff = list(difflib.unified_diff(
        previous_lines, current_lines,
        fromfile='Previous', tofile='Current',
        lineterm=''
    ))

    # Count changes
    additions = sum(1 for line in diff if line.startswith('+') and not line.startswith('+++'))
    deletions = sum(1 for line in diff if line.startswith('-') and not line.startswith('---'))

    # Generate HTML diff for display
    html_diff = difflib.HtmlDiff().make_table(
        previous_lines[:500],  # Limit for performance
        current_lines[:500],
        fromdesc='Previous Year',
        todesc='Current Year',
        context=True,
        numlines=2
    )

    # Calculate similarity ratio
    matcher = difflib.SequenceMatcher(None, previous, current)
    similarity = matcher.ratio()

    return {
        "additions": additions,
        "deletions": deletions,
        "similarity": similarity,
        "diff_html": html_diff if len(html_diff) < 500000 else None,  # Limit size
        "raw_diff": '\n'.join(diff[:1000])  # First 1000 lines
    }


def detect_boilerplate_sentences(
    current: str,
    historical: List[str],
    min_appearances: int = 2
) -> Tuple[List[str], float]:
    """
    Detect boilerplate sentences that appear in multiple filings.

    Args:
        current: Current MD&A content
        historical: List of previous MD&A contents (2-4 years)
        min_appearances: Minimum times a sentence must appear to be boilerplate

    Returns:
        (list of boilerplate sentences, boilerplate score 0-1)
    """
    current_sentences = split_into_sentences(current)

    # Count sentence appearances across historical filings
    sentence_counts = Counter()
    for hist in historical:
        hist_sentences = set(split_into_sentences(hist))
        for sent in hist_sentences:
            # Normalize for comparison
            normalized = re.sub(r'\s+', ' ', sent.lower().strip())
            sentence_counts[normalized] += 1

    # Find boilerplate in current
    boilerplate = []
    for sent in current_sentences:
        normalized = re.sub(r'\s+', ' ', sent.lower().strip())
        if sentence_counts.get(normalized, 0) >= min_appearances:
            boilerplate.append(sent)

    # Calculate boilerplate score
    if current_sentences:
        boilerplate_score = len(boilerplate) / len(current_sentences)
    else:
        boilerplate_score = 0

    return boilerplate, boilerplate_score


def extract_significant_changes(diff_result: Dict, current: str, previous: str) -> List[Dict]:
    """
    Extract the most significant changes between MD&A versions.

    Returns list of change dicts with type, location, and content.
    """
    changes = []

    # Split into paragraphs for paragraph-level comparison
    current_paras = [p.strip() for p in current.split('\n\n') if len(p.strip()) > 50]
    previous_paras = [p.strip() for p in previous.split('\n\n') if len(p.strip()) > 50]

    # Find new paragraphs (not in previous)
    prev_set = set(previous_paras)
    for para in current_paras:
        if para not in prev_set:
            # Check if it's truly new or just modified
            is_new = True
            for prev_para in previous_paras:
                if difflib.SequenceMatcher(None, para, prev_para).ratio() > 0.7:
                    is_new = False
                    break

            if is_new and len(para) > 100:
                changes.append({
                    "type": "addition",
                    "excerpt": para[:500],
                    "length": len(para)
                })

    # Find removed paragraphs
    curr_set = set(current_paras)
    for para in previous_paras:
        if para not in curr_set:
            is_removed = True
            for curr_para in current_paras:
                if difflib.SequenceMatcher(None, para, curr_para).ratio() > 0.7:
                    is_removed = False
                    break

            if is_removed and len(para) > 100:
                changes.append({
                    "type": "removal",
                    "excerpt": para[:500],
                    "length": len(para)
                })

    # Sort by length (most significant first)
    changes.sort(key=lambda x: x["length"], reverse=True)

    return changes[:10]  # Top 10 changes


def generate_ai_summary(
    current_filing: Dict,
    previous_filing: Dict,
    changes: List[Dict],
    diff_result: Dict
) -> str:
    """Generate AI summary of MD&A changes."""
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        return f"MD&A changed by {(1 - diff_result['similarity']) * 100:.1f}% with {len(changes)} significant changes."

    # Build context from changes
    change_descriptions = []
    for change in changes[:5]:
        change_descriptions.append(f"- {change['type'].upper()}: {change['excerpt'][:200]}...")

    prompt = f"""Analyze the changes between two years of MD&A (Management's Discussion and Analysis) sections from a beverage alcohol company's SEC filings.

Company Filing Comparison:
- Current: FY{current_filing.get('fiscal_year', 'N/A')} {current_filing.get('filing_type', '')}
- Previous: FY{previous_filing.get('fiscal_year', 'N/A')} {previous_filing.get('filing_type', '')}

Change Statistics:
- Overall similarity: {diff_result['similarity'] * 100:.1f}%
- Lines added: {diff_result['additions']}
- Lines removed: {diff_result['deletions']}

Key Changes Detected:
{chr(10).join(change_descriptions) if change_descriptions else 'No significant paragraph-level changes detected.'}

Write a 2-3 sentence executive summary of what changed in management's discussion. Focus on:
1. Business strategy or outlook changes
2. New risk factors or opportunities mentioned
3. Changes in segment performance or guidance

Respond with ONLY the summary, no quotes or formatting."""

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
        return data["content"][0]["text"].strip()
    except Exception as e:
        logger.error(f"Failed to generate AI summary: {e}")
        return f"MD&A changed by {(1 - diff_result['similarity']) * 100:.1f}% with {len(changes)} significant changes."


def save_diff_result(
    sec_company_id: int,
    current_filing: Dict,
    previous_filing: Dict,
    diff_result: Dict,
    ai_summary: str,
    changes: List[Dict],
    boilerplate_score: float
) -> Optional[int]:
    """Save diff result to database."""
    diff_type = "annual" if current_filing["filing_type"] == "10-K" else "quarterly"

    result = d1_execute(
        """INSERT INTO sec_mda_diffs
           (sec_company_id, current_filing_id, previous_filing_id, diff_type,
            ai_summary, significant_changes, boilerplate_score, diff_html)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id""",
        [
            sec_company_id,
            current_filing["id"],
            previous_filing["id"],
            diff_type,
            ai_summary,
            json.dumps(changes),
            boilerplate_score,
            diff_result.get("diff_html")
        ]
    )

    if result.get("success") and result.get("result"):
        rows = result["result"][0].get("results", [])
        if rows:
            return rows[0]["id"]

    return None


def diff_exists(current_id: int, previous_id: int) -> bool:
    """Check if diff already exists for this filing pair."""
    result = d1_execute(f"""
        SELECT id FROM sec_mda_diffs
        WHERE current_filing_id = {current_id}
          AND previous_filing_id = {previous_id}
    """)

    if result.get("success") and result.get("result"):
        rows = result["result"][0].get("results", [])
        return len(rows) > 0

    return False


def process_company_diffs(ticker: str) -> Dict:
    """Process all MD&A diffs for a company."""
    # Get company ID
    result = d1_execute(f"SELECT id FROM sec_companies WHERE ticker = '{ticker}'")
    if not result.get("success") or not result.get("result"):
        return {"error": f"Company not found: {ticker}"}

    rows = result["result"][0].get("results", [])
    if not rows:
        return {"error": f"Company not found: {ticker}"}

    sec_company_id = rows[0]["id"]

    # Get filing pairs
    pairs = get_filing_pairs(sec_company_id)

    if not pairs:
        return {"error": "No filing pairs found for comparison"}

    logger.info(f"Found {len(pairs)} filing pairs for {ticker}")

    # Collect historical MD&A for boilerplate detection
    all_mda = []
    for current, previous in pairs:
        mda = get_mda_content(previous["id"])
        if mda:
            all_mda.append(mda)

    stats = {"processed": 0, "skipped": 0, "errors": 0}

    for current, previous in pairs:
        # Check if already computed
        if diff_exists(current["id"], previous["id"]):
            logger.debug(f"Skipping existing diff: FY{current['fiscal_year']} vs FY{previous['fiscal_year']}")
            stats["skipped"] += 1
            continue

        logger.info(f"Computing diff: {ticker} FY{current['fiscal_year']} vs FY{previous['fiscal_year']}")

        # Get MD&A content
        current_mda = get_mda_content(current["id"])
        previous_mda = get_mda_content(previous["id"])

        if not current_mda or not previous_mda:
            logger.warning(f"Missing MD&A content for comparison")
            stats["errors"] += 1
            continue

        # Compute diff
        diff_result = compute_diff(current_mda, previous_mda)

        # Detect boilerplate
        boilerplate, boilerplate_score = detect_boilerplate_sentences(current_mda, all_mda[:5])

        # Extract significant changes
        changes = extract_significant_changes(diff_result, current_mda, previous_mda)

        # Generate AI summary
        ai_summary = generate_ai_summary(current, previous, changes, diff_result)

        # Save result
        diff_id = save_diff_result(
            sec_company_id, current, previous,
            diff_result, ai_summary, changes, boilerplate_score
        )

        if diff_id:
            logger.info(f"  Created diff {diff_id}: {len(changes)} changes, {boilerplate_score:.0%} boilerplate")
            stats["processed"] += 1
        else:
            stats["errors"] += 1

    logger.info(f"Completed {ticker}: {stats}")
    return stats


def main():
    parser = argparse.ArgumentParser(description="Compute MD&A diffs between filings")
    parser.add_argument("--company", help="Process diffs for a specific company ticker")
    parser.add_argument("--all", action="store_true", help="Process all tracked companies")
    parser.add_argument("--filing-id", type=int, help="Process diff for a specific current filing")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be processed")
    args = parser.parse_args()

    # Initialize D1
    init_d1_config(logger=logger)

    if args.dry_run:
        if args.company:
            result = d1_execute(f"SELECT id FROM sec_companies WHERE ticker = '{args.company}'")
            if result.get("success") and result.get("result"):
                rows = result["result"][0].get("results", [])
                if rows:
                    pairs = get_filing_pairs(rows[0]["id"])
                    logger.info(f"[DRY RUN] Would process {len(pairs)} filing pairs for {args.company}")
                    for current, previous in pairs[:5]:
                        logger.info(f"  - FY{current['fiscal_year']} vs FY{previous['fiscal_year']}")
        return

    if args.company:
        result = process_company_diffs(args.company)
        print(json.dumps(result, indent=2))

    elif args.all:
        # Get all tracked companies
        result = d1_execute("SELECT ticker FROM sec_companies")
        if result.get("success") and result.get("result"):
            tickers = [r["ticker"] for r in result["result"][0].get("results", [])]

            all_results = {}
            for ticker in tickers:
                all_results[ticker] = process_company_diffs(ticker)

            print(json.dumps(all_results, indent=2))

    elif args.filing_id:
        # Find the previous filing and compute diff
        result = d1_execute(f"""
            SELECT
                sf.id, sf.filing_type, sf.fiscal_year, sf.fiscal_quarter,
                sf.sec_company_id, sc.ticker
            FROM sec_filings sf
            JOIN sec_companies sc ON sf.sec_company_id = sc.id
            WHERE sf.id = {args.filing_id}
        """)

        if result.get("success") and result.get("result"):
            rows = result["result"][0].get("results", [])
            if rows:
                current = rows[0]
                ticker = current["ticker"]
                logger.info(f"Processing diff for {ticker} filing {args.filing_id}")
                result = process_company_diffs(ticker)
                print(json.dumps(result, indent=2))
            else:
                print(json.dumps({"error": "Filing not found"}))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
