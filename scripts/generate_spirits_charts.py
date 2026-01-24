#!/usr/bin/env python3
"""
generate_spirits_charts.py - Generate charts from TTB spirits statistics

Creates publication-ready charts for articles and LinkedIn posts.

Usage:
    python generate_spirits_charts.py                    # Generate all charts for latest data
    python generate_spirits_charts.py --monthly 2025 10  # Charts for specific month
    python generate_spirits_charts.py --yearly 2024      # Charts for specific year
    python generate_spirits_charts.py --trend whisky     # Multi-year trend chart
"""

import os
import sys
import subprocess
import json
import argparse
from datetime import datetime

# Try to import matplotlib, install if needed
try:
    import matplotlib.pyplot as plt
    import matplotlib.ticker as ticker
except ImportError:
    print("Installing matplotlib...")
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'matplotlib'])
    import matplotlib.pyplot as plt
    import matplotlib.ticker as ticker

# Chart output directory
CHART_DIR = os.path.join(os.path.dirname(__file__), 'content-queue', 'charts')
WORKER_DIR = os.path.join(os.path.dirname(__file__), '..', 'worker')

# Color palette (professional, colorblind-friendly)
COLORS = {
    'primary': '#1a365d',      # Dark blue
    'secondary': '#2c5282',    # Medium blue
    'accent': '#38a169',       # Green
    'warning': '#c53030',      # Red
    'neutral': '#718096',      # Gray
    'whisky': '#b7791f',       # Amber
    'brandy': '#9c4221',       # Brown
    'rum_gin_vodka': '#2b6cb0', # Blue
    'neutral_spirits': '#a0aec0', # Light gray
}

# Style settings
plt.style.use('seaborn-v0_8-whitegrid')
plt.rcParams['font.family'] = 'sans-serif'
plt.rcParams['font.sans-serif'] = ['Arial', 'Helvetica', 'DejaVu Sans']
plt.rcParams['font.size'] = 11
plt.rcParams['axes.titlesize'] = 14
plt.rcParams['axes.titleweight'] = 'bold'
plt.rcParams['figure.facecolor'] = 'white'
plt.rcParams['axes.facecolor'] = 'white'
plt.rcParams['savefig.facecolor'] = 'white'
plt.rcParams['savefig.dpi'] = 150


def run_d1_query(sql):
    """Execute D1 query via wrangler and return results."""
    # Escape double quotes in SQL for command line
    sql_escaped = sql.replace('"', '\\"').replace('\n', ' ')

    cmd = f'npx wrangler d1 execute bevalc-colas --remote --json --command="{sql_escaped}"'
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=WORKER_DIR, shell=True,
                           encoding='utf-8', errors='replace')

    if result.returncode == 0 and result.stdout:
        # Parse JSON output
        output = result.stdout
        # Find the JSON array in the output
        start = output.find('[')
        if start >= 0:
            try:
                data = json.loads(output[start:])
                if data and isinstance(data, list) and len(data) > 0:
                    if 'results' in data[0]:
                        return data[0]['results']
            except json.JSONDecodeError as e:
                print(f"JSON parse error: {e}")
    return []


def format_millions(x, pos):
    """Format axis labels in millions."""
    return f'{x/1_000_000:.0f}M'


def format_billions(x, pos):
    """Format axis labels in billions."""
    return f'{x/1_000_000_000:.1f}B'


def create_production_bar_chart(year, month=None, output_path=None):
    """
    Create horizontal bar chart of production by category.

    Args:
        year: Year of data
        month: Month (None for yearly)
        output_path: Output file path
    """
    month_clause = f"AND month = {month}" if month else "AND month IS NULL"

    sql = f"""
    SELECT statistical_detail, value, count_ims
    FROM ttb_spirits_stats
    WHERE year = {year} {month_clause}
    AND statistical_group LIKE '1-Distilled Spirits Production%'
    AND statistical_detail NOT LIKE '0-%'
    AND statistical_detail NOT LIKE '1-Distilled%'
    ORDER BY value DESC
    """

    results = run_d1_query(sql)
    if not results:
        print(f"No data found for {year}-{month or 'annual'}")
        return None

    # Prepare data (exclude neutral spirits for beverage focus)
    categories = []
    values = []
    colors = []

    color_map = {
        '1-Whisky': COLORS['whisky'],
        '2-Brandy': COLORS['brandy'],
        '3-Rum, Gin, & Vodka': COLORS['rum_gin_vodka'],
        '4-Alcohol, Neutral Spirits, & Other': COLORS['neutral_spirits'],
    }

    for row in results:
        cat = row['statistical_detail']
        val = row['value']

        # Clean up category name
        display_name = cat.split('-', 1)[1] if '-' in cat else cat

        categories.append(display_name)
        values.append(val)
        colors.append(color_map.get(cat, COLORS['neutral']))

    # Create figure
    fig, ax = plt.subplots(figsize=(10, 6))

    # Create horizontal bar chart
    y_pos = range(len(categories))
    bars = ax.barh(y_pos, values, color=colors, edgecolor='white', linewidth=0.5)

    # Customize
    ax.set_yticks(y_pos)
    ax.set_yticklabels(categories)
    ax.invert_yaxis()  # Largest at top

    # Format x-axis
    if max(values) > 1_000_000_000:
        ax.xaxis.set_major_formatter(ticker.FuncFormatter(format_billions))
        ax.set_xlabel('Production (Billions of Proof Gallons)')
    else:
        ax.xaxis.set_major_formatter(ticker.FuncFormatter(format_millions))
        ax.set_xlabel('Production (Millions of Proof Gallons)')

    # Title
    if month:
        month_name = datetime(2000, month, 1).strftime('%B')
        ax.set_title(f'Distilled Spirits Production: {month_name} {year}')
    else:
        ax.set_title(f'Distilled Spirits Production: {year}')

    # Add value labels
    for bar, val in zip(bars, values):
        if val > 1_000_000_000:
            label = f'{val/1_000_000_000:.1f}B'
        elif val > 1_000_000:
            label = f'{val/1_000_000:.1f}M'
        else:
            label = f'{val/1_000:.0f}K'
        ax.text(bar.get_width() + max(values)*0.01, bar.get_y() + bar.get_height()/2,
                label, va='center', fontsize=9, color=COLORS['primary'])

    # Add source
    fig.text(0.99, 0.01, 'Source: TTB Distilled Spirits Statistics',
             ha='right', va='bottom', fontsize=8, color=COLORS['neutral'])

    plt.tight_layout()

    # Save
    if output_path is None:
        os.makedirs(CHART_DIR, exist_ok=True)
        suffix = f"{year}-{month:02d}" if month else str(year)
        output_path = os.path.join(CHART_DIR, f'production-bar-{suffix}.png')

    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()

    print(f"Created: {output_path}")
    return output_path


def create_beverage_bar_chart(year, month=None, output_path=None):
    """
    Create bar chart focused on beverage spirits only (excluding neutral spirits).
    """
    month_clause = f"AND month = {month}" if month else "AND month IS NULL"

    sql = f"""
    SELECT statistical_detail, value, count_ims
    FROM ttb_spirits_stats
    WHERE year = {year} {month_clause}
    AND statistical_group LIKE '1-Distilled Spirits Production%'
    AND statistical_detail IN ('1-Whisky', '2-Brandy', '3-Rum, Gin, & Vodka')
    ORDER BY value DESC
    """

    results = run_d1_query(sql)
    if not results:
        print(f"No beverage data found for {year}-{month or 'annual'}")
        return None

    # Prepare data
    categories = []
    values = []
    producers = []
    colors = []

    color_map = {
        '1-Whisky': COLORS['whisky'],
        '2-Brandy': COLORS['brandy'],
        '3-Rum, Gin, & Vodka': COLORS['rum_gin_vodka'],
    }

    for row in results:
        cat = row['statistical_detail']
        display_name = cat.split('-', 1)[1] if '-' in cat else cat

        categories.append(display_name)
        values.append(row['value'])
        producers.append(row['count_ims'])
        colors.append(color_map.get(cat, COLORS['neutral']))

    # Create figure with two subplots
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    # Production volume chart
    y_pos = range(len(categories))
    bars1 = ax1.barh(y_pos, values, color=colors, edgecolor='white')
    ax1.set_yticks(y_pos)
    ax1.set_yticklabels(categories)
    ax1.invert_yaxis()
    ax1.xaxis.set_major_formatter(ticker.FuncFormatter(format_millions))
    ax1.set_xlabel('Proof Gallons')
    ax1.set_title('Production Volume')

    # Add value labels
    for bar, val in zip(bars1, values):
        label = f'{val/1_000_000:.1f}M'
        ax1.text(bar.get_width() + max(values)*0.02, bar.get_y() + bar.get_height()/2,
                label, va='center', fontsize=9)

    # Producer count chart
    bars2 = ax2.barh(y_pos, producers, color=colors, edgecolor='white')
    ax2.set_yticks(y_pos)
    ax2.set_yticklabels(categories)
    ax2.invert_yaxis()
    ax2.set_xlabel('Number of Producers')
    ax2.set_title('Active Producers')

    # Add value labels
    for bar, val in zip(bars2, producers):
        ax2.text(bar.get_width() + max(producers)*0.02, bar.get_y() + bar.get_height()/2,
                str(val), va='center', fontsize=9)

    # Title
    if month:
        month_name = datetime(2000, month, 1).strftime('%B')
        fig.suptitle(f'Beverage Spirits: {month_name} {year}', fontsize=14, fontweight='bold')
    else:
        fig.suptitle(f'Beverage Spirits: {year}', fontsize=14, fontweight='bold')

    # Source
    fig.text(0.99, 0.01, 'Source: TTB Distilled Spirits Statistics',
             ha='right', va='bottom', fontsize=8, color=COLORS['neutral'])

    plt.tight_layout()

    # Save
    if output_path is None:
        os.makedirs(CHART_DIR, exist_ok=True)
        suffix = f"{year}-{month:02d}" if month else str(year)
        output_path = os.path.join(CHART_DIR, f'beverage-bar-{suffix}.png')

    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()

    print(f"Created: {output_path}")
    return output_path


def create_trend_line_chart(category='1-Whisky', years=6, output_path=None):
    """
    Create line chart showing multi-year trend for a category.

    Args:
        category: TTB category code (e.g., '1-Whisky')
        years: Number of years to show
        output_path: Output file path
    """
    sql = f"""
    SELECT year, value, count_ims
    FROM ttb_spirits_stats
    WHERE month IS NULL
    AND statistical_detail = '{category}'
    AND statistical_group LIKE '1-Distilled Spirits Production%'
    ORDER BY year DESC
    LIMIT {years}
    """

    results = run_d1_query(sql)
    if not results:
        print(f"No trend data found for {category}")
        return None

    # Reverse to chronological order
    results = list(reversed(results))

    years_list = [r['year'] for r in results]
    values = [r['value'] for r in results]
    producers = [r['count_ims'] for r in results]

    # Create figure with dual y-axis
    fig, ax1 = plt.subplots(figsize=(10, 6))
    ax2 = ax1.twinx()

    # Production line
    color1 = COLORS['whisky'] if 'Whisky' in category else COLORS['primary']
    line1 = ax1.plot(years_list, values, color=color1, linewidth=2.5, marker='o',
                     markersize=8, label='Production')
    ax1.fill_between(years_list, values, alpha=0.1, color=color1)

    # Producer count line
    line2 = ax2.plot(years_list, producers, color=COLORS['secondary'], linewidth=2,
                     marker='s', markersize=6, linestyle='--', label='Producers')

    # Format axes
    ax1.yaxis.set_major_formatter(ticker.FuncFormatter(format_millions))
    ax1.set_ylabel('Production (Proof Gallons)', color=color1)
    ax1.tick_params(axis='y', labelcolor=color1)

    ax2.set_ylabel('Number of Producers', color=COLORS['secondary'])
    ax2.tick_params(axis='y', labelcolor=COLORS['secondary'])

    ax1.set_xlabel('Year')
    ax1.set_xticks(years_list)

    # Title
    display_name = category.split('-', 1)[1] if '-' in category else category
    ax1.set_title(f'{display_name} Production Trend ({years_list[0]}-{years_list[-1]})')

    # Legend
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper left')

    # Add data labels on production line
    for x, y in zip(years_list, values):
        ax1.annotate(f'{y/1_000_000:.0f}M', (x, y), textcoords="offset points",
                    xytext=(0, 10), ha='center', fontsize=9, color=color1)

    # Source
    fig.text(0.99, 0.01, 'Source: TTB Distilled Spirits Statistics',
             ha='right', va='bottom', fontsize=8, color=COLORS['neutral'])

    plt.tight_layout()

    # Save
    if output_path is None:
        os.makedirs(CHART_DIR, exist_ok=True)
        cat_slug = category.lower().replace(' ', '-').replace(',', '').replace('&', 'and')
        output_path = os.path.join(CHART_DIR, f'trend-{cat_slug}.png')

    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()

    print(f"Created: {output_path}")
    return output_path


def create_yoy_comparison_chart(year, month, output_path=None):
    """
    Create YoY comparison chart for a specific month.
    """
    # Get current and prior year data
    sql = f"""
    SELECT year, statistical_detail, value
    FROM ttb_spirits_stats
    WHERE month = {month}
    AND year IN ({year}, {year-1})
    AND statistical_group LIKE '1-Distilled Spirits Production%'
    AND statistical_detail IN ('1-Whisky', '2-Brandy', '3-Rum, Gin, & Vodka')
    ORDER BY statistical_detail, year
    """

    results = run_d1_query(sql)
    if not results:
        print(f"No YoY data found for {year}-{month}")
        return None

    # Organize data
    data = {}
    for row in results:
        cat = row['statistical_detail']
        yr = row['year']
        if cat not in data:
            data[cat] = {}
        data[cat][yr] = row['value']

    categories = []
    current_values = []
    prior_values = []
    changes = []

    for cat in sorted(data.keys()):
        if year in data[cat] and year-1 in data[cat]:
            display_name = cat.split('-', 1)[1] if '-' in cat else cat
            categories.append(display_name)
            current_values.append(data[cat][year])
            prior_values.append(data[cat][year-1])
            change = (data[cat][year] - data[cat][year-1]) / data[cat][year-1] * 100
            changes.append(change)

    if not categories:
        return None

    # Create figure
    fig, ax = plt.subplots(figsize=(10, 6))

    x = range(len(categories))
    width = 0.35

    bars1 = ax.bar([i - width/2 for i in x], prior_values, width,
                   label=str(year-1), color=COLORS['neutral'], edgecolor='white')
    bars2 = ax.bar([i + width/2 for i in x], current_values, width,
                   label=str(year), color=COLORS['primary'], edgecolor='white')

    ax.set_ylabel('Proof Gallons')
    ax.set_xticks(x)
    ax.set_xticklabels(categories)
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(format_millions))
    ax.legend()

    # Add change labels
    for i, (bar, change) in enumerate(zip(bars2, changes)):
        color = COLORS['accent'] if change > 0 else COLORS['warning']
        sign = '+' if change > 0 else ''
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height(),
                f'{sign}{change:.1f}%', ha='center', va='bottom',
                fontsize=10, fontweight='bold', color=color)

    # Title
    month_name = datetime(2000, month, 1).strftime('%B')
    ax.set_title(f'Beverage Spirits: {month_name} {year} vs {year-1}')

    # Source
    fig.text(0.99, 0.01, 'Source: TTB Distilled Spirits Statistics',
             ha='right', va='bottom', fontsize=8, color=COLORS['neutral'])

    plt.tight_layout()

    # Save
    if output_path is None:
        os.makedirs(CHART_DIR, exist_ok=True)
        output_path = os.path.join(CHART_DIR, f'yoy-comparison-{year}-{month:02d}.png')

    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()

    print(f"Created: {output_path}")
    return output_path


def create_all_charts(year, month=None):
    """Generate all chart types for a given period."""
    charts = []

    # Production bar chart (all categories)
    chart = create_production_bar_chart(year, month)
    if chart:
        charts.append(chart)

    # Beverage-only chart
    chart = create_beverage_bar_chart(year, month)
    if chart:
        charts.append(chart)

    # YoY comparison (monthly only)
    if month:
        chart = create_yoy_comparison_chart(year, month)
        if chart:
            charts.append(chart)

    # Trend charts for major categories
    for category in ['1-Whisky', '2-Brandy', '3-Rum, Gin, & Vodka']:
        chart = create_trend_line_chart(category)
        if chart:
            charts.append(chart)

    return charts


def main():
    parser = argparse.ArgumentParser(description='Generate TTB spirits statistics charts')
    parser.add_argument('--monthly', nargs=2, type=int, metavar=('YEAR', 'MONTH'),
                       help='Generate charts for specific month')
    parser.add_argument('--yearly', type=int, metavar='YEAR',
                       help='Generate charts for specific year')
    parser.add_argument('--trend', type=str, metavar='CATEGORY',
                       help='Generate trend chart for category (whisky, brandy, rum)')
    parser.add_argument('--all', action='store_true',
                       help='Generate all chart types')

    args = parser.parse_args()

    os.makedirs(CHART_DIR, exist_ok=True)

    if args.monthly:
        year, month = args.monthly
        print(f"\nGenerating charts for {year}-{month:02d}...")
        create_all_charts(year, month)

    elif args.yearly:
        year = args.yearly
        print(f"\nGenerating charts for {year}...")
        create_all_charts(year)

    elif args.trend:
        category_map = {
            'whisky': '1-Whisky',
            'brandy': '2-Brandy',
            'rum': '3-Rum, Gin, & Vodka',
            'vodka': '3-Rum, Gin, & Vodka',
            'gin': '3-Rum, Gin, & Vodka',
        }
        category = category_map.get(args.trend.lower(), args.trend)
        print(f"\nGenerating trend chart for {category}...")
        create_trend_line_chart(category)

    elif args.all:
        # Get latest data period
        sql = "SELECT MAX(year) as y, MAX(month) as m FROM ttb_spirits_stats WHERE month IS NOT NULL"
        results = run_d1_query(sql)
        if results:
            year = results[0]['y']
            month = results[0]['m']
            print(f"\nGenerating all charts for latest data ({year}-{month:02d})...")
            create_all_charts(year, month)
            create_all_charts(year)  # Also yearly

    else:
        # Default: latest monthly data
        sql = "SELECT MAX(year) as y, MAX(month) as m FROM ttb_spirits_stats WHERE month IS NOT NULL"
        results = run_d1_query(sql)
        if results:
            year = results[0]['y']
            month = results[0]['m']
            print(f"\nGenerating charts for {year}-{month:02d}...")
            create_all_charts(year, month)
        else:
            print("No data found. Run sync_ttb_statistics.py first.")


if __name__ == '__main__':
    main()
