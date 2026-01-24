#!/usr/bin/env python3
"""
generate_spirits_articles.py - Generate articles from TTB spirits statistics

Queries D1 for distilled spirits production data and generates analysis
articles following templates that avoid AI-sounding language.

Usage:
    python generate_spirits_articles.py                    # Interactive mode
    python generate_spirits_articles.py --auto             # Auto-generate based on latest data
    python generate_spirits_articles.py --monthly 2024 11  # Generate for specific month
    python generate_spirits_articles.py --yearly 2024      # Generate annual analysis
    python generate_spirits_articles.py --category whisky  # Generate category deep dive
"""

import os
import sys
import json
import logging
import argparse
from datetime import datetime
from typing import Dict, List, Optional, Tuple

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.lib.d1_utils import init_d1_config, d1_execute

# =============================================================================
# CONFIGURATION
# =============================================================================

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'content-queue')

# Category mapping for statistical_detail values
CATEGORIES = {
    '1-Whisky': 'Whisky',
    '2-Brandy': 'Brandy',
    '3-Rum': 'Rum',
    '4-Gin': 'Gin',
    '5-Vodka': 'Vodka',
    '6-Cordials and Liqueurs': 'Cordials',
    '7-Neutral Spirits': 'Neutral Spirits',
    '8-Other': 'Other',
}

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# DATA QUERIES
# =============================================================================

def get_latest_data_period() -> Tuple[Optional[int], Optional[int]]:
    """Get the most recent year/month with data."""
    result = d1_execute("""
        SELECT MAX(year) as year, MAX(month) as month
        FROM ttb_spirits_stats
        WHERE month IS NOT NULL
    """)

    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                return row.get("year"), row.get("month")
    return None, None


def get_production_by_category(year: int, month: int = None) -> List[Dict]:
    """
    Get production volumes by category for a period.

    Args:
        year: Year to query
        month: Month (None for yearly aggregate)

    Returns:
        List of {category, value, count_ims, yoy_change}
    """
    month_clause = f"AND month = {month}" if month else "AND month IS NULL"

    # Current period
    result = d1_execute(f"""
        SELECT statistical_detail, value, count_ims
        FROM ttb_spirits_stats
        WHERE year = {year} {month_clause}
        AND statistical_group LIKE '1-Distilled Spirits Production%'
        AND statistical_detail NOT LIKE '%Total%'
        AND statistical_detail NOT LIKE '%Production'
        ORDER BY value DESC
    """)

    current = {}
    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                detail = row.get("statistical_detail", "")
                current[detail] = {
                    "value": row.get("value", 0),
                    "count_ims": row.get("count_ims", 0)
                }

    # Prior year for YoY
    prior_year = year - 1
    result = d1_execute(f"""
        SELECT statistical_detail, value
        FROM ttb_spirits_stats
        WHERE year = {prior_year} {month_clause}
        AND statistical_group LIKE '1-Distilled Spirits Production%'
    """)

    prior = {}
    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                detail = row.get("statistical_detail", "")
                prior[detail] = row.get("value", 0)

    # Combine with YoY calculation
    categories = []
    for detail, data in current.items():
        prior_value = prior.get(detail, 0)
        yoy_change = None
        if prior_value and prior_value > 0:
            yoy_change = round((data["value"] - prior_value) / prior_value * 100, 1)

        categories.append({
            "category": detail,
            "display_name": CATEGORIES.get(detail, detail),
            "value": data["value"],
            "count_ims": data["count_ims"],
            "prior_value": prior_value,
            "yoy_change": yoy_change
        })

    return sorted(categories, key=lambda x: x["value"] or 0, reverse=True)


def get_total_production(year: int, month: int = None) -> Dict:
    """Get total production for a period."""
    month_clause = f"AND month = {month}" if month else "AND month IS NULL"

    result = d1_execute(f"""
        SELECT value, count_ims
        FROM ttb_spirits_stats
        WHERE year = {year} {month_clause}
        AND statistical_group LIKE '1-Distilled Spirits Production%'
        AND statistical_detail = '1-Distilled Spirits Production'
    """)

    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                return {
                    "value": row.get("value", 0),
                    "count_ims": row.get("count_ims", 0)
                }
    return {"value": 0, "count_ims": 0}


def get_tax_paid_withdrawals(year: int, month: int = None) -> List[Dict]:
    """Get tax paid withdrawals (market demand indicator)."""
    month_clause = f"AND month = {month}" if month else "AND month IS NULL"

    result = d1_execute(f"""
        SELECT statistical_detail, value
        FROM ttb_spirits_stats
        WHERE year = {year} {month_clause}
        AND statistical_group LIKE '4-Tax Paid Withdrawals%'
        ORDER BY value DESC
    """)

    withdrawals = []
    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                withdrawals.append({
                    "category": row.get("statistical_detail", ""),
                    "value": row.get("value", 0)
                })
    return withdrawals


def get_industry_member_count(year: int, month: int = None) -> int:
    """Get total industry member count."""
    month_clause = f"AND month = {month}" if month else "AND month IS NULL"

    result = d1_execute(f"""
        SELECT value
        FROM ttb_spirits_stats
        WHERE year = {year} {month_clause}
        AND statistical_detail = 'Number of Industry Members'
    """)

    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                return row.get("value", 0)
    return 0


def get_multi_year_trend(category: str, years: int = 5) -> List[Dict]:
    """Get yearly trend for a category."""
    current_year = datetime.now().year

    result = d1_execute(f"""
        SELECT year, value, count_ims
        FROM ttb_spirits_stats
        WHERE month IS NULL
        AND statistical_detail = '{category}'
        AND statistical_group LIKE '1-Distilled Spirits Production%'
        AND year >= {current_year - years}
        ORDER BY year
    """)

    trend = []
    if result.get("success") and result.get("result"):
        for res in result.get("result", []):
            for row in res.get("results", []):
                trend.append({
                    "year": row.get("year"),
                    "value": row.get("value", 0),
                    "count_ims": row.get("count_ims", 0)
                })
    return trend


# =============================================================================
# ARTICLE GENERATION
# =============================================================================

def format_number(n: int) -> str:
    """Format large numbers with M/K suffix."""
    if n is None:
        return "N/A"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return f"{n:,}"


def format_proof_gallons(n: int) -> str:
    """Format proof gallon values."""
    if n is None:
        return "N/A"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f} million proof gallons"
    if n >= 1_000:
        return f"{n / 1_000:,.0f} thousand proof gallons"
    return f"{n:,} proof gallons"


def get_month_name(month: int) -> str:
    """Convert month number to name."""
    months = [
        "", "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ]
    return months[month] if 1 <= month <= 12 else str(month)


def generate_monthly_recap(year: int, month: int) -> str:
    """
    Generate monthly recap article.

    Returns markdown content following the monthly-recap template.
    """
    logger.info(f"Generating monthly recap for {year}-{month:02d}")

    # Gather all data
    production = get_production_by_category(year, month)
    total = get_total_production(year, month)
    withdrawals = get_tax_paid_withdrawals(year, month)
    im_count = get_industry_member_count(year, month)

    # Prior month for MoM comparison
    prior_month = month - 1 if month > 1 else 12
    prior_year = year if month > 1 else year - 1
    prior_total = get_total_production(prior_year, prior_month)

    # Find the most significant finding for headline
    top_category = production[0] if production else None
    biggest_change = max(production, key=lambda x: abs(x.get("yoy_change") or 0)) if production else None

    month_name = get_month_name(month)

    # Build the article
    lines = []

    # Title
    if biggest_change and biggest_change.get("yoy_change"):
        direction = "Up" if biggest_change["yoy_change"] > 0 else "Down"
        lines.append(f"# {month_name} {year}: {biggest_change['display_name']} Production {direction} {abs(biggest_change['yoy_change']):.0f}% Year Over Year")
    else:
        lines.append(f"# {month_name} {year}: Distilled Spirits Production Update")

    lines.append("")

    # Opening paragraph
    if total.get("value"):
        total_val = format_proof_gallons(total["value"])
        yoy_total = None
        prior_year_total = get_total_production(year - 1, month)
        if prior_year_total.get("value") and prior_year_total["value"] > 0:
            yoy_total = round((total["value"] - prior_year_total["value"]) / prior_year_total["value"] * 100, 1)

        lines.append(f"American distillers produced {total_val} in {month_name} {year}.")
        if yoy_total is not None:
            direction = "up" if yoy_total > 0 else "down"
            lines.append(f"That is {direction} {abs(yoy_total):.1f}% from {month_name} {year - 1}.")
        lines.append("")

    # Production by category
    lines.append("## Production by Category")
    lines.append("")
    lines.append("| Category | Volume (PG) | Producers | YoY Change |")
    lines.append("|----------|-------------|-----------|------------|")

    for cat in production[:8]:  # Top 8 categories
        vol = format_number(cat["value"])
        producers = cat["count_ims"] or "-"
        yoy = f"{cat['yoy_change']:+.1f}%" if cat.get("yoy_change") is not None else "-"
        lines.append(f"| {cat['display_name']} | {vol} | {producers} | {yoy} |")

    lines.append("")

    # Analysis section
    lines.append("## What the Numbers Show")
    lines.append("")

    # Find notable movements
    gainers = [c for c in production if c.get("yoy_change") and c["yoy_change"] > 5]
    decliners = [c for c in production if c.get("yoy_change") and c["yoy_change"] < -5]

    if gainers:
        top_gainer = max(gainers, key=lambda x: x["yoy_change"])
        lines.append(f"{top_gainer['display_name']} posted the strongest growth at {top_gainer['yoy_change']:+.1f}% year over year.")
        lines.append(f"{top_gainer['count_ims']} producers reported {top_gainer['display_name'].lower()} production this month.")
        lines.append("")

    if decliners:
        top_decliner = min(decliners, key=lambda x: x["yoy_change"])
        lines.append(f"{top_decliner['display_name']} declined {abs(top_decliner['yoy_change']):.1f}% compared to {month_name} {year - 1}.")
        lines.append("")

    # Industry member count
    if im_count:
        lines.append(f"The industry totaled {im_count:,} active producers in {month_name}.")
        prior_im = get_industry_member_count(year - 1, month)
        if prior_im:
            im_change = im_count - prior_im
            direction = "more" if im_change > 0 else "fewer"
            lines.append(f"That is {abs(im_change)} {direction} than the same month last year.")
        lines.append("")

    # Closing
    lines.append("---")
    lines.append("")
    lines.append(f"*Source: TTB Distilled Spirits Statistics, data through {month_name} {year}*")
    lines.append("")
    lines.append("*For more beverage alcohol market intelligence, visit [bevalcintel.com](https://bevalcintel.com)*")

    return "\n".join(lines)


def generate_yearly_analysis(year: int) -> str:
    """
    Generate annual analysis article.

    Returns markdown content following the yearly-analysis template.
    """
    logger.info(f"Generating yearly analysis for {year}")

    # Gather data
    production = get_production_by_category(year)
    total = get_total_production(year)
    im_count = get_industry_member_count(year)

    # Prior year
    prior_production = get_production_by_category(year - 1)
    prior_total = get_total_production(year - 1)
    prior_im = get_industry_member_count(year - 1)

    # Calculate YoY for total
    total_yoy = None
    if prior_total.get("value") and prior_total["value"] > 0:
        total_yoy = round((total["value"] - prior_total["value"]) / prior_total["value"] * 100, 1)

    # Build article
    lines = []

    # Title
    if total_yoy is not None:
        direction = "Grows" if total_yoy > 0 else "Contracts"
        lines.append(f"# The {year} American Spirits Industry: Production {direction} {abs(total_yoy):.1f}%")
    else:
        lines.append(f"# The {year} American Spirits Industry: Annual Production Analysis")

    lines.append("")

    # Executive summary
    lines.append("## Key Figures")
    lines.append("")
    lines.append(f"- **Total production:** {format_proof_gallons(total['value'])}")
    if total_yoy is not None:
        lines.append(f"- **Year-over-year change:** {total_yoy:+.1f}%")
    if im_count:
        lines.append(f"- **Active producers:** {im_count:,}")
        if prior_im:
            im_change = im_count - prior_im
            lines.append(f"- **Producer count change:** {im_change:+,}")
    lines.append("")

    # Category breakdown
    lines.append("## Production by Category")
    lines.append("")
    lines.append("| Category | {0} Volume | YoY Change | Producers |".format(year))
    lines.append("|----------|------------|------------|-----------|")

    for cat in production[:10]:
        vol = format_number(cat["value"])
        yoy = f"{cat['yoy_change']:+.1f}%" if cat.get("yoy_change") is not None else "-"
        producers = cat["count_ims"] or "-"
        lines.append(f"| {cat['display_name']} | {vol} PG | {yoy} | {producers} |")

    lines.append("")

    # Category analysis
    lines.append("## Category Analysis")
    lines.append("")

    # Whisky (usually largest)
    whisky = next((c for c in production if "Whisky" in c["category"]), None)
    if whisky:
        lines.append(f"### Whisky")
        lines.append("")
        lines.append(f"American whisky production reached {format_proof_gallons(whisky['value'])} in {year}.")
        if whisky.get("yoy_change") is not None:
            direction = "increased" if whisky["yoy_change"] > 0 else "decreased"
            lines.append(f"Output {direction} {abs(whisky['yoy_change']):.1f}% from {year - 1}.")
        lines.append(f"{whisky['count_ims']} producers reported whisky production, making it the most fragmented major spirits category.")
        lines.append("")

    # Vodka
    vodka = next((c for c in production if "Vodka" in c["category"]), None)
    if vodka:
        lines.append(f"### Vodka")
        lines.append("")
        lines.append(f"Vodka production totaled {format_proof_gallons(vodka['value'])}.")
        if vodka.get("yoy_change") is not None:
            if vodka["yoy_change"] < 0:
                lines.append(f"The category continued its multi-year decline, down {abs(vodka['yoy_change']):.1f}% year over year.")
            else:
                lines.append(f"Production rose {vodka['yoy_change']:.1f}% compared to {year - 1}.")
        lines.append("")

    # Other notable categories
    for cat in production:
        if cat["display_name"] not in ["Whisky", "Vodka"] and cat.get("yoy_change") and abs(cat["yoy_change"]) > 10:
            lines.append(f"### {cat['display_name']}")
            lines.append("")
            direction = "grew" if cat["yoy_change"] > 0 else "declined"
            lines.append(f"{cat['display_name']} {direction} {abs(cat['yoy_change']):.1f}% to {format_proof_gallons(cat['value'])}.")
            lines.append(f"{cat['count_ims']} producers reported activity in this category.")
            lines.append("")

    # Industry structure
    lines.append("## Industry Structure")
    lines.append("")
    if im_count and prior_im:
        change = im_count - prior_im
        if change > 0:
            lines.append(f"The industry added {change} producers in {year}, reaching {im_count:,} total.")
        elif change < 0:
            lines.append(f"The producer count fell by {abs(change)} to {im_count:,}.")
        else:
            lines.append(f"The producer count held steady at {im_count:,}.")
    elif im_count:
        lines.append(f"The industry counted {im_count:,} active producers in {year}.")
    lines.append("")

    # Closing
    lines.append("---")
    lines.append("")
    lines.append(f"*Source: TTB Distilled Spirits Statistics, {year} annual data*")
    lines.append("")
    lines.append("*For more beverage alcohol market intelligence, visit [bevalcintel.com](https://bevalcintel.com)*")

    return "\n".join(lines)


def generate_category_deep_dive(category_code: str, year: int) -> str:
    """
    Generate category deep dive article.

    Args:
        category_code: TTB category code (e.g., "1-Whisky")
        year: Year to analyze

    Returns markdown content.
    """
    logger.info(f"Generating category deep dive for {category_code} in {year}")

    # Get multi-year trend
    trend = get_multi_year_trend(category_code, years=5)

    # Current year data
    current = next((t for t in trend if t["year"] == year), None)
    if not current:
        return f"# No data available for {category_code} in {year}"

    display_name = CATEGORIES.get(category_code, category_code)

    # Calculate 5-year CAGR if we have enough data
    cagr = None
    if len(trend) >= 2:
        start_val = trend[0]["value"]
        end_val = trend[-1]["value"]
        years_diff = trend[-1]["year"] - trend[0]["year"]
        if start_val and end_val and years_diff > 0:
            cagr = ((end_val / start_val) ** (1 / years_diff) - 1) * 100

    # Build article
    lines = []

    # Title
    if len(trend) >= 2:
        recent_change = ((current["value"] - trend[-2]["value"]) / trend[-2]["value"] * 100) if trend[-2]["value"] else 0
        direction = "Grows" if recent_change > 0 else "Contracts"
        lines.append(f"# American {display_name} in {year}: Production {direction} {abs(recent_change):.0f}%")
    else:
        lines.append(f"# American {display_name} in {year}: Production Analysis")

    lines.append("")

    # Category context
    lines.append("## Category Overview")
    lines.append("")
    lines.append(f"{display_name} production in the United States reached {format_proof_gallons(current['value'])} in {year}.")
    lines.append(f"The category had {current['count_ims']:,} active producers.")
    lines.append("")

    # Trend table
    lines.append("## Five-Year Trend")
    lines.append("")
    lines.append("| Year | Production (PG) | Producers | YoY Change |")
    lines.append("|------|-----------------|-----------|------------|")

    for i, t in enumerate(trend):
        vol = format_number(t["value"])
        producers = t["count_ims"] or "-"
        if i > 0 and trend[i-1]["value"]:
            yoy = ((t["value"] - trend[i-1]["value"]) / trend[i-1]["value"]) * 100
            yoy_str = f"{yoy:+.1f}%"
        else:
            yoy_str = "-"
        lines.append(f"| {t['year']} | {vol} | {producers} | {yoy_str} |")

    lines.append("")

    if cagr is not None:
        lines.append(f"The five-year compound annual growth rate stands at {cagr:+.1f}%.")
        lines.append("")

    # Analysis
    lines.append("## Analysis")
    lines.append("")

    # Determine trend direction
    if len(trend) >= 3:
        recent_values = [t["value"] for t in trend[-3:]]
        if all(recent_values[i] < recent_values[i+1] for i in range(len(recent_values)-1)):
            lines.append(f"{display_name} production has increased for three consecutive years.")
        elif all(recent_values[i] > recent_values[i+1] for i in range(len(recent_values)-1)):
            lines.append(f"{display_name} production has declined for three consecutive years.")
        else:
            lines.append(f"{display_name} production has fluctuated over the past three years.")
        lines.append("")

    # Producer count analysis
    if len(trend) >= 2:
        producer_change = current["count_ims"] - trend[0]["count_ims"]
        if producer_change > 0:
            lines.append(f"The number of {display_name.lower()} producers has grown by {producer_change} since {trend[0]['year']}.")
        elif producer_change < 0:
            lines.append(f"The category has lost {abs(producer_change)} producers since {trend[0]['year']}.")
        lines.append("")

    # Closing
    lines.append("---")
    lines.append("")
    lines.append(f"*Source: TTB Distilled Spirits Statistics*")
    lines.append("")
    lines.append("*For more beverage alcohol market intelligence, visit [bevalcintel.com](https://bevalcintel.com)*")

    return "\n".join(lines)


def generate_linkedin_post(year: int, month: int = None) -> str:
    """
    Generate LinkedIn post for latest data.

    Returns short-form content suitable for LinkedIn.
    """
    logger.info(f"Generating LinkedIn post for {year}-{month or 'annual'}")

    production = get_production_by_category(year, month)
    total = get_total_production(year, month)

    lines = []

    if month:
        month_name = get_month_name(month)
        lines.append(f"American distillers produced {format_proof_gallons(total['value'])} in {month_name} {year}.")
        lines.append("")

        # Top categories
        lines.append("The breakdown:")
        for cat in production[:5]:
            yoy = f" ({cat['yoy_change']:+.1f}% YoY)" if cat.get("yoy_change") is not None else ""
            lines.append(f"- {cat['display_name']}: {format_number(cat['value'])} PG{yoy}")

        lines.append("")
        lines.append(f"Source: TTB Distilled Spirits Statistics")
        lines.append(f"Data through {month_name} {year}")
    else:
        lines.append(f"The {year} American spirits industry in numbers:")
        lines.append("")
        lines.append(f"Total production: {format_proof_gallons(total['value'])}")
        lines.append("")
        for cat in production[:5]:
            yoy = f" ({cat['yoy_change']:+.1f}%)" if cat.get("yoy_change") is not None else ""
            lines.append(f"- {cat['display_name']}: {format_number(cat['value'])} PG{yoy}")
        lines.append("")
        lines.append("Source: TTB Distilled Spirits Statistics")

    return "\n".join(lines)


# =============================================================================
# OUTPUT
# =============================================================================

def save_article(content: str, filename: str):
    """Save article to content-queue directory."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    filepath = os.path.join(OUTPUT_DIR, filename)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    logger.info(f"Saved: {filepath}")
    return filepath


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Generate articles from TTB spirits statistics"
    )
    parser.add_argument(
        '--auto', action='store_true',
        help='Auto-generate based on latest available data'
    )
    parser.add_argument(
        '--monthly', nargs=2, type=int, metavar=('YEAR', 'MONTH'),
        help='Generate monthly recap for specific year and month'
    )
    parser.add_argument(
        '--yearly', type=int, metavar='YEAR',
        help='Generate annual analysis for specific year'
    )
    parser.add_argument(
        '--category', type=str,
        help='Generate category deep dive (whisky, vodka, rum, gin, brandy)'
    )
    parser.add_argument(
        '--linkedin', action='store_true',
        help='Generate LinkedIn post instead of full article'
    )
    parser.add_argument(
        '--output', type=str,
        help='Output file path (default: content-queue/)'
    )

    args = parser.parse_args()

    # Initialize D1
    init_d1_config(logger=logger)

    # Check for data
    latest_year, latest_month = get_latest_data_period()
    if not latest_year:
        logger.error("No TTB statistics data found. Run sync_ttb_statistics.py first.")
        sys.exit(1)

    logger.info(f"Latest data available: {latest_year}-{latest_month:02d}")

    # Determine what to generate
    if args.monthly:
        year, month = args.monthly
        if args.linkedin:
            content = generate_linkedin_post(year, month)
            filename = f"spirits-linkedin-{year}-{month:02d}.md"
        else:
            content = generate_monthly_recap(year, month)
            filename = f"spirits-monthly-{year}-{month:02d}.md"
        save_article(content, args.output or filename)

    elif args.yearly:
        year = args.yearly
        if args.linkedin:
            content = generate_linkedin_post(year)
            filename = f"spirits-linkedin-{year}.md"
        else:
            content = generate_yearly_analysis(year)
            filename = f"spirits-yearly-{year}.md"
        save_article(content, args.output or filename)

    elif args.category:
        # Map category name to code
        category_map = {
            'whisky': '1-Whisky',
            'brandy': '2-Brandy',
            'rum': '3-Rum',
            'gin': '4-Gin',
            'vodka': '5-Vodka',
            'cordials': '6-Cordials and Liqueurs',
        }
        category_code = category_map.get(args.category.lower())
        if not category_code:
            logger.error(f"Unknown category: {args.category}")
            logger.info(f"Valid categories: {', '.join(category_map.keys())}")
            sys.exit(1)

        content = generate_category_deep_dive(category_code, latest_year)
        filename = f"spirits-{args.category.lower()}-{latest_year}.md"
        save_article(content, args.output or filename)

    elif args.auto:
        # Generate all content types for latest period
        logger.info("Auto-generating content for latest data period")

        # Monthly recap
        content = generate_monthly_recap(latest_year, latest_month)
        save_article(content, f"spirits-monthly-{latest_year}-{latest_month:02d}.md")

        # LinkedIn post
        content = generate_linkedin_post(latest_year, latest_month)
        save_article(content, f"spirits-linkedin-{latest_year}-{latest_month:02d}.md")

        # If December, also generate yearly
        if latest_month == 12:
            content = generate_yearly_analysis(latest_year)
            save_article(content, f"spirits-yearly-{latest_year}.md")

        logger.info("Content generation complete")

    else:
        # Interactive mode
        print(f"\nLatest data: {latest_year}-{latest_month:02d}")
        print("\nUsage:")
        print("  --auto                      Generate all content for latest period")
        print("  --monthly 2024 11           Generate monthly recap")
        print("  --yearly 2024               Generate annual analysis")
        print("  --category whisky           Generate category deep dive")
        print("  --linkedin                  Generate short LinkedIn post")


if __name__ == "__main__":
    main()
