#!/usr/bin/env python3
"""
Precompute category stats for hub pages.

Runs the slow GROUP BY queries once and caches results in category_stats table.
Runs daily after daily-sync completes via GitHub Actions.

Usage:
    python precompute_category_stats.py           # All categories
    python precompute_category_stats.py Wine Beer # Specific categories
"""

import json
import os
import sys
import logging
from datetime import datetime, timedelta
from pathlib import Path

# Add lib to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.d1_utils import d1_execute, init_d1_config

# Load .env file
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key.strip()] = value.strip()

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

CATEGORIES = ['Whiskey', 'Vodka', 'Tequila', 'Rum', 'Gin', 'Brandy',
              'Wine', 'Beer', 'Liqueur', 'Cocktails', 'Other']

# Initialize D1 config from environment
init_d1_config(logger=logger)

def get_results(result):
    """Extract results from D1 API response."""
    if not result or not result.get('success'):
        logger.error(f"D1 query failed: {result}")
        return []
    return result.get('result', [{}])[0].get('results', [])


def compute_category_stats(category: str) -> dict:
    """Compute all stats for a category."""
    logger.info(f"Computing stats for: {category}")

    now = datetime.now()
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    # 1. Total filings (fast with index)
    logger.info(f"  [{category}] Total filings...")
    result = d1_execute(
        f"SELECT COUNT(*) as cnt FROM colas WHERE category = '{category}'"
    )
    rows = get_results(result)
    total_filings = rows[0]['cnt'] if rows else 0
    logger.info(f"  [{category}] Total: {total_filings:,}")

    # 2. Week filings
    logger.info(f"  [{category}] Week filings...")
    result = d1_execute(f"""
        SELECT COUNT(*) as cnt FROM colas
        WHERE category = '{category}'
        AND (year > {week_ago.year}
             OR (year = {week_ago.year} AND month > {week_ago.month})
             OR (year = {week_ago.year} AND month = {week_ago.month} AND day >= {week_ago.day}))
    """)
    rows = get_results(result)
    week_filings = rows[0]['cnt'] if rows else 0
    logger.info(f"  [{category}] Week: {week_filings:,}")

    # 3. New companies this month
    logger.info(f"  [{category}] New companies this month...")
    result = d1_execute(f"""
        SELECT COUNT(DISTINCT company_name) as cnt FROM colas
        WHERE signal = 'NEW_COMPANY' AND category = '{category}'
        AND (year > {month_ago.year} OR (year = {month_ago.year} AND month >= {month_ago.month}))
    """)
    rows = get_results(result)
    month_new_companies = rows[0]['cnt'] if rows else 0
    logger.info(f"  [{category}] New companies: {month_new_companies:,}")

    # 4. Top 20 companies (the slow query - ~9s for Wine)
    logger.info(f"  [{category}] Top 20 companies...")
    result = d1_execute(f"""
        SELECT c.canonical_name, c.slug, COUNT(*) as cnt,
               MAX(co.year * 10000 + co.month * 100 + co.day) as last_filing
        FROM colas co
        JOIN company_aliases ca ON co.company_name = ca.raw_name
        JOIN companies c ON ca.company_id = c.id
        WHERE co.category = '{category}'
        GROUP BY c.id
        ORDER BY cnt DESC
        LIMIT 20
    """)
    top_companies = get_results(result)
    logger.info(f"  [{category}] Top companies: {len(top_companies)}")

    # 5. Top 20 brands (the slow query - ~8s for Wine)
    logger.info(f"  [{category}] Top 20 brands...")
    result = d1_execute(f"""
        SELECT brand_name, COUNT(*) as cnt
        FROM colas
        WHERE category = '{category}'
        GROUP BY brand_name
        ORDER BY cnt DESC
        LIMIT 20
    """)
    top_brands = get_results(result)
    logger.info(f"  [{category}] Top brands: {len(top_brands)}")

    logger.info(f"  [{category}] Done!")

    return {
        'category': category,
        'total_filings': total_filings,
        'week_filings': week_filings,
        'month_new_companies': month_new_companies,
        'top_companies': json.dumps(top_companies),
        'top_brands': json.dumps(top_brands),
        'updated_at': now.isoformat()
    }


def save_stats(stats: dict):
    """Save stats to category_stats table."""
    sql = f"""
        INSERT OR REPLACE INTO category_stats
        (category, total_filings, week_filings, month_new_companies, top_companies, top_brands, updated_at)
        VALUES (
            '{stats['category']}',
            {stats['total_filings']},
            {stats['week_filings']},
            {stats['month_new_companies']},
            '{stats['top_companies'].replace("'", "''")}',
            '{stats['top_brands'].replace("'", "''")}',
            '{stats['updated_at']}'
        )
    """
    result = d1_execute(sql)
    if result.get('success'):
        logger.info(f"  [{stats['category']}] Saved to category_stats")
    else:
        logger.error(f"  [{stats['category']}] Failed to save: {result}")


def main():
    # Get categories to process
    if len(sys.argv) > 1:
        categories = sys.argv[1:]
        # Validate
        for cat in categories:
            if cat not in CATEGORIES:
                logger.error(f"Unknown category '{cat}'")
                logger.error(f"Valid categories: {', '.join(CATEGORIES)}")
                sys.exit(1)
    else:
        categories = CATEGORIES

    logger.info(f"Precomputing stats for {len(categories)} categories...")
    start = datetime.now()

    for category in categories:
        try:
            stats = compute_category_stats(category)
            save_stats(stats)
        except Exception as e:
            logger.error(f"Failed to process {category}: {e}")

    elapsed = (datetime.now() - start).total_seconds()
    logger.info(f"Done! Processed {len(categories)} categories in {elapsed:.1f}s")


if __name__ == '__main__':
    main()
