#!/usr/bin/env python3
"""
cli.py - Command-line interface for BevAlc Intelligence

Usage:
    python -m src.cli scrape --days 7
    python -m src.cli scrape --start 2025-01-01 --end 2025-01-07
    python -m src.cli resume
    python -m src.cli images
    python -m src.cli export
    python -m src.cli stats
"""

import argparse
import sys
import json
from datetime import datetime, timedelta
from pathlib import Path

from .database import get_database
from .scraper import ColaScraper, scrape_week, scrape_recent_days
from .images import ImageDownloader, download_all_images


def parse_date(date_str: str) -> datetime:
    """Parse a date string in various formats."""
    formats = ['%Y-%m-%d', '%m/%d/%Y', '%d-%m-%Y']
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: {date_str}. Use YYYY-MM-DD format.")


def cmd_scrape(args):
    """Run the scraper."""
    if args.days:
        end_date = datetime.now()
        start_date = end_date - timedelta(days=args.days)
    elif args.week is not None:
        # Calculate week dates
        today = datetime.now()
        start_of_this_week = today - timedelta(days=today.weekday())
        start_date = start_of_this_week - timedelta(weeks=args.week)
        end_date = start_date + timedelta(days=6)
    elif args.start and args.end:
        start_date = parse_date(args.start)
        end_date = parse_date(args.end)
    else:
        # Default: last 7 days
        end_date = datetime.now()
        start_date = end_date - timedelta(days=7)
    
    print(f"\n{'='*60}")
    print(f"BevAlc Intelligence - COLA Scraper")
    print(f"{'='*60}")
    print(f"Date range: {start_date.date()} to {end_date.date()}")
    print(f"Headless: {args.headless}")
    print(f"{'='*60}\n")
    
    scraper = ColaScraper(headless=args.headless)
    
    try:
        stats = scraper.scrape_date_range(
            start_date=start_date,
            end_date=end_date,
            class_type_from=args.class_from,
            class_type_to=args.class_to
        )
        
        print(f"\n{'='*60}")
        print("Scrape Complete!")
        print(f"{'='*60}")
        print(f"Links collected: {stats.get('links_collected', 0)}")
        print(f"Details scraped: {stats.get('details_scraped', 0)}")
        print(f"New records: {stats.get('new_records', 0)}")
        print(f"Updated records: {stats.get('updated_records', 0)}")
        print(f"Failed: {stats.get('failed', 0)}")
        print(f"CAPTCHAs solved: {stats.get('captchas_solved', 0)}")
        print(f"{'='*60}\n")
        
    finally:
        scraper.close()


def cmd_resume(args):
    """Resume pending work."""
    print(f"\n{'='*60}")
    print(f"BevAlc Intelligence - Resume Pending")
    print(f"{'='*60}\n")
    
    scraper = ColaScraper(headless=args.headless)
    
    try:
        stats = scraper.resume_pending()
        
        print(f"\n{'='*60}")
        print("Resume Complete!")
        print(f"Details scraped: {stats.get('details_scraped', 0)}")
        print(f"Failed: {stats.get('failed', 0)}")
        print(f"{'='*60}\n")
        
    finally:
        scraper.close()


def cmd_images(args):
    """Download images."""
    print(f"\n{'='*60}")
    print(f"BevAlc Intelligence - Image Downloader")
    print(f"{'='*60}\n")
    
    if args.ttb_id:
        # Download for specific COLA
        downloader = ImageDownloader()
        try:
            count, paths = downloader.download_images_for_cola(
                args.ttb_id, 
                headless=args.headless
            )
            print(f"Downloaded {count} images for {args.ttb_id}")
        finally:
            downloader.close()
    else:
        # Download all pending
        stats = download_all_images(limit=args.limit, headless=args.headless)
        
        print(f"\n{'='*60}")
        print("Image Download Complete!")
        print(f"Downloaded: {stats.get('downloaded', 0)}")
        print(f"Skipped (existing): {stats.get('skipped', 0)}")
        print(f"Failed: {stats.get('failed', 0)}")
        print(f"Compressed: {stats.get('compressed', 0)}")
        print(f"Space saved: {stats.get('bytes_saved_mb', 0):.2f} MB")
        print(f"{'='*60}\n")


def cmd_export(args):
    """Export data to JSON."""
    db = get_database()
    
    # Default output path
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = Path(__file__).parent.parent / "exports" / "colas.json"
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print(f"Exporting to: {output_path}")
    
    count = db.export_to_json(str(output_path))
    
    print(f"Exported {count} COLAs")
    print(f"File size: {output_path.stat().st_size / (1024*1024):.2f} MB")


def cmd_stats(args):
    """Show database statistics."""
    db = get_database()
    
    total = db.get_cola_count()
    queue_stats = db.get_queue_stats()
    
    print(f"\n{'='*60}")
    print(f"BevAlc Intelligence - Database Statistics")
    print(f"{'='*60}")
    print(f"\nTotal COLAs in database: {total:,}")
    print(f"\nQueue status:")
    print(f"  Pending: {queue_stats.get('pending', 0):,}")
    print(f"  Completed: {queue_stats.get('completed', 0):,}")
    print(f"  Failed: {queue_stats.get('failed', 0):,}")
    
    # Show filter value counts
    print(f"\nData breakdown:")
    try:
        states = db.get_distinct_values('state')
        print(f"  States: {len(states)}")
        
        statuses = db.get_distinct_values('status')
        print(f"  Status values: {', '.join(statuses[:5])}")
        
        class_types = db.get_distinct_values('class_type_code')
        print(f"  Class/Type codes: {len(class_types)}")
    except Exception:
        pass
    
    print(f"{'='*60}\n")


def cmd_search(args):
    """Search the database."""
    db = get_database()
    
    results = db.search_colas(
        class_type=args.class_type,
        state=args.state,
        status=args.status,
        brand_name=args.brand,
        date_from=args.date_from,
        date_to=args.date_to,
        limit=args.limit
    )
    
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print(f"\nFound {len(results)} results:\n")
        for cola in results:
            print(f"  {cola['ttb_id']} | {cola.get('brand_name', 'N/A')} | {cola.get('class_type_code', 'N/A')} | {cola.get('state', 'N/A')}")
        print()


def cmd_retry(args):
    """Retry failed items."""
    db = get_database()
    db.retry_failed_items()
    print("Reset failed items to pending status.")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='BevAlc Intelligence - TTB COLA Database',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  Scrape last 7 days:
    python -m src.cli scrape --days 7

  Scrape specific date range:
    python -m src.cli scrape --start 2025-01-01 --end 2025-01-07

  Scrape last week:
    python -m src.cli scrape --week 1

  Resume pending work:
    python -m src.cli resume

  Download images:
    python -m src.cli images

  Export to JSON:
    python -m src.cli export

  Show statistics:
    python -m src.cli stats
        """
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Available commands')
    
    # Scrape command
    scrape_parser = subparsers.add_parser('scrape', help='Scrape COLAs from TTB')
    scrape_parser.add_argument('--days', type=int, help='Number of days to look back')
    scrape_parser.add_argument('--week', type=int, help='Week number (0=current, 1=last week, etc.)')
    scrape_parser.add_argument('--start', help='Start date (YYYY-MM-DD)')
    scrape_parser.add_argument('--end', help='End date (YYYY-MM-DD)')
    scrape_parser.add_argument('--class-from', help='Class/Type code range start')
    scrape_parser.add_argument('--class-to', help='Class/Type code range end')
    scrape_parser.add_argument('--headless', action='store_true', help='Run browser in headless mode')
    scrape_parser.set_defaults(func=cmd_scrape)
    
    # Resume command
    resume_parser = subparsers.add_parser('resume', help='Resume pending work')
    resume_parser.add_argument('--headless', action='store_true', help='Run browser in headless mode')
    resume_parser.set_defaults(func=cmd_resume)
    
    # Images command
    images_parser = subparsers.add_parser('images', help='Download label images')
    images_parser.add_argument('--ttb-id', help='Download images for specific TTB ID')
    images_parser.add_argument('--limit', type=int, help='Maximum COLAs to process')
    images_parser.add_argument('--headless', action='store_true', help='Run browser in headless mode')
    images_parser.set_defaults(func=cmd_images)
    
    # Export command
    export_parser = subparsers.add_parser('export', help='Export data to JSON')
    export_parser.add_argument('--output', '-o', help='Output file path')
    export_parser.set_defaults(func=cmd_export)
    
    # Stats command
    stats_parser = subparsers.add_parser('stats', help='Show database statistics')
    stats_parser.set_defaults(func=cmd_stats)
    
    # Search command
    search_parser = subparsers.add_parser('search', help='Search the database')
    search_parser.add_argument('--state', help='Filter by state')
    search_parser.add_argument('--class-type', help='Filter by class/type code')
    search_parser.add_argument('--status', help='Filter by status')
    search_parser.add_argument('--brand', help='Search brand name')
    search_parser.add_argument('--date-from', help='Filter by approval date from')
    search_parser.add_argument('--date-to', help='Filter by approval date to')
    search_parser.add_argument('--limit', type=int, default=20, help='Max results')
    search_parser.add_argument('--json', action='store_true', help='Output as JSON')
    search_parser.set_defaults(func=cmd_search)
    
    # Retry command
    retry_parser = subparsers.add_parser('retry', help='Retry failed items')
    retry_parser.set_defaults(func=cmd_retry)
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        sys.exit(1)
    
    args.func(args)


if __name__ == '__main__':
    main()
