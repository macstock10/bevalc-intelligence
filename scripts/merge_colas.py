"""
merge_colas.py - Merge multiple worker databases into one

USAGE:
    # Auto-find all worker databases
    python merge_colas.py --auto
    
    # Specific databases
    python merge_colas.py --dbs data/w1.db data/w2.db data/w3.db
    
    # Include your existing test.db
    python merge_colas.py --dbs data/test.db data/w1.db data/w2.db
    
    # Specify output
    python merge_colas.py --auto --output data/all_colas.db
    
    # Export to JSON
    python merge_colas.py --export colas.json
    
    # Show status
    python merge_colas.py --status
"""

import os
import glob
import sqlite3
import json
import argparse
from datetime import datetime
from typing import List


def find_databases(data_dir: str = "data") -> List[str]:
    """Find all databases with COLA data."""
    all_dbs = glob.glob(os.path.join(data_dir, "*.db"))
    
    cola_dbs = []
    for db_path in all_dbs:
        # Skip output databases
        if any(x in db_path for x in ['merged', 'final', 'all_colas', 'coordinator']):
            continue
        
        # Check if it has colas or collected_links table
        try:
            conn = sqlite3.connect(db_path)
            tables = [t[0] for t in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()]
            conn.close()
            
            if 'colas' in tables or 'collected_links' in tables:
                cola_dbs.append(db_path)
        except:
            pass
    
    return sorted(cola_dbs)


def merge_databases(source_dbs: List[str], output_path: str):
    """Merge multiple databases into one."""
    print(f"\n{'='*60}")
    print("MERGING DATABASES")
    print(f"{'='*60}")
    print(f"Output: {output_path}")
    print(f"Sources:")
    for db in source_dbs:
        print(f"  - {db}")
    print()
    
    # Backup existing output
    if os.path.exists(output_path):
        backup = f"{output_path}.bak.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        os.rename(output_path, backup)
        print(f"Backed up existing to: {backup}\n")
    
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    
    out = sqlite3.connect(output_path)
    
    # Create schema
    out.executescript("""
        CREATE TABLE IF NOT EXISTS collected_links (
            id INTEGER PRIMARY KEY,
            ttb_id TEXT UNIQUE NOT NULL,
            detail_url TEXT,
            year INTEGER,
            month INTEGER,
            scraped INTEGER DEFAULT 0,
            source_db TEXT,
            collected_at TEXT
        );
        
        CREATE TABLE IF NOT EXISTS colas (
            id INTEGER PRIMARY KEY,
            ttb_id TEXT UNIQUE NOT NULL,
            
            -- Core fields
            status TEXT,
            vendor_code TEXT,
            serial_number TEXT,
            class_type_code TEXT,
            origin_code TEXT,
            brand_name TEXT,
            fanciful_name TEXT,
            type_of_application TEXT,
            for_sale_in TEXT,
            total_bottle_capacity TEXT,
            formula TEXT,
            approval_date TEXT,
            qualifications TEXT,
            
            -- Wine-specific fields
            grape_varietal TEXT,
            wine_vintage TEXT,
            appellation TEXT,
            
            -- Other product fields
            alcohol_content TEXT,
            ph_level TEXT,
            
            -- Company info
            plant_registry TEXT,
            company_name TEXT,
            street TEXT,
            state TEXT,
            contact_person TEXT,
            phone_number TEXT,
            
            -- Metadata
            year INTEGER,
            month INTEGER,
            source_db TEXT,
            scraped_at TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_links_ttb ON collected_links(ttb_id);
        CREATE INDEX IF NOT EXISTS idx_colas_ttb ON colas(ttb_id);
        CREATE INDEX IF NOT EXISTS idx_colas_date ON colas(approval_date);
        CREATE INDEX IF NOT EXISTS idx_colas_ym ON colas(year, month);
    """)
    out.commit()
    
    total_links = 0
    total_colas = 0
    
    for db_path in source_dbs:
        if not os.path.exists(db_path):
            print(f"WARNING  Skipping {db_path} (not found)")
            continue
        
        print(f"Processing: {db_path}")
        
        try:
            src = sqlite3.connect(db_path)
            src.row_factory = sqlite3.Row
            
            tables = [t[0] for t in src.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()]
            
            links_added = 0
            colas_added = 0
            
            # Merge links
            if 'collected_links' in tables:
                rows = src.execute("SELECT * FROM collected_links").fetchall()
                col_names = [desc[0] for desc in src.execute("SELECT * FROM collected_links LIMIT 1").description]
                
                for row in rows:
                    try:
                        r = dict(zip(col_names, row))
                        out.execute("""
                            INSERT OR IGNORE INTO collected_links
                            (ttb_id, detail_url, year, month, scraped, source_db, collected_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (
                            r.get('ttb_id'), r.get('detail_url'),
                            r.get('year'), r.get('month'),
                            r.get('scraped', 0), db_path,
                            r.get('collected_at')
                        ))
                        if out.execute("SELECT changes()").fetchone()[0] > 0:
                            links_added += 1
                    except:
                        pass
            
            # Merge colas
            if 'colas' in tables:
                rows = src.execute("SELECT * FROM colas").fetchall()
                # Get column names
                col_names = [desc[0] for desc in src.execute("SELECT * FROM colas LIMIT 1").description]
                
                for row in rows:
                    try:
                        # Convert row to dict
                        r = dict(zip(col_names, row))
                        
                        out.execute("""
                            INSERT OR IGNORE INTO colas
                            (ttb_id, status, vendor_code, serial_number, class_type_code,
                             origin_code, brand_name, fanciful_name, type_of_application,
                             for_sale_in, total_bottle_capacity, formula, approval_date, 
                             qualifications, grape_varietal, wine_vintage, appellation,
                             alcohol_content, ph_level, plant_registry, company_name, 
                             street, state, contact_person, phone_number, year, month, 
                             source_db, scraped_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            r.get('ttb_id'), r.get('status'), r.get('vendor_code'),
                            r.get('serial_number'), r.get('class_type_code'),
                            r.get('origin_code'), r.get('brand_name'),
                            r.get('fanciful_name'), r.get('type_of_application'),
                            r.get('for_sale_in'), r.get('total_bottle_capacity'),
                            r.get('formula'), r.get('approval_date'), 
                            r.get('qualifications'), r.get('grape_varietal'),
                            r.get('wine_vintage'), r.get('appellation'),
                            r.get('alcohol_content'), r.get('ph_level'),
                            r.get('plant_registry'), r.get('company_name'), 
                            r.get('street'), r.get('state'),
                            r.get('contact_person'), r.get('phone_number'),
                            r.get('year'), r.get('month'), db_path,
                            r.get('scraped_at')
                        ))
                        if out.execute("SELECT changes()").fetchone()[0] > 0:
                            colas_added += 1
                    except Exception as e:
                        if colas_added == 0:
                            print(f"    Error on first row: {e}")
                        pass
            
            out.commit()
            src.close()
            
            print(f"  -> Links: +{links_added:,}, COLAs: +{colas_added:,}")
            total_links += links_added
            total_colas += colas_added
            
        except Exception as e:
            print(f"  WARNING  Error: {e}")
    
    out.close()
    
    print(f"\n{'='*60}")
    print("MERGE COMPLETE")
    print(f"{'='*60}")
    print(f"Total links: {total_links:,}")
    print(f"Total COLAs: {total_colas:,}")
    print(f"Output: {output_path}")
    print(f"{'='*60}\n")


def export_json(db_path: str, output_path: str):
    """Export COLAs to JSON for the website."""
    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}")
        return
    
    conn = sqlite3.connect(db_path)
    
    # Get all COLAs
    cursor = conn.execute("""
        SELECT * FROM colas ORDER BY approval_date DESC
    """)
    
    col_names = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()
    
    colas = []
    states = set()
    class_types = set()
    statuses = set()
    
    for row in rows:
        cola = dict(zip(col_names, row))
        
        # Remove internal fields
        for key in ['id', 'scraped_at', 'source_db']:
            cola.pop(key, None)
        
        # Collect filter values
        if cola.get('state'):
            states.add(cola['state'])
        if cola.get('class_type_code'):
            class_types.add(cola['class_type_code'])
        if cola.get('status'):
            statuses.add(cola['status'])
        
        colas.append(cola)
    
    conn.close()
    
    # Build JSON structure with filters for dropdowns
    data = {
        'metadata': {
            'generated_at': datetime.now().isoformat(),
            'total_count': len(colas),
            'last_update': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        },
        'filters': {
            'states': sorted(list(states)),
            'class_types': sorted(list(class_types)),
            'statuses': sorted(list(statuses)),
        },
        'colas': colas
    }
    
    # Write JSON
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    
    file_size = os.path.getsize(output_path) / (1024 * 1024)  # MB
    
    print(f"Exported {len(colas):,} COLAs ({file_size:.1f} MB)")
    print(f"  States: {len(states)}")
    print(f"  Class/Types: {len(class_types)}")
    print(f"  Statuses: {len(statuses)}")
    conn.close()


def show_status(db_path: str):
    """Show database status."""
    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}")
        return
    
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    
    print(f"\n{'='*60}")
    print(f"DATABASE: {db_path}")
    print(f"{'='*60}")
    
    # Totals
    links = conn.execute("SELECT COUNT(*) FROM collected_links").fetchone()[0]
    colas = conn.execute("SELECT COUNT(*) FROM colas").fetchone()[0]
    
    print(f"\nTotals:")
    print(f"  Links: {links:,}")
    print(f"  COLAs: {colas:,}")
    
    # By year
    print(f"\nCOLAs by Year:")
    rows = conn.execute("""
        SELECT year, COUNT(*) as count 
        FROM colas 
        WHERE year IS NOT NULL
        GROUP BY year 
        ORDER BY year DESC
    """).fetchall()
    
    for row in rows:
        year = row['year']
        count = row['count']
        print(f"  {year}: {count:,}")
    
    # By month for most recent year
    if rows:
        latest_year = rows[0]['year']
        print(f"\nCOLAs by Month ({latest_year}):")
        rows = conn.execute("""
            SELECT month, COUNT(*) as count 
            FROM colas 
            WHERE year = ?
            GROUP BY month 
            ORDER BY month
        """, (latest_year,)).fetchall()
        
        for row in rows:
            print(f"  {latest_year}-{row['month']:02d}: {row['count']:,}")
    
    print(f"{'='*60}\n")
    conn.close()


def validate_against_ttb(db_path: str):
    """
    Query TTB for each month and compare against database counts.
    Shows discrepancies.
    """
    import time
    import re
    from datetime import datetime
    from calendar import monthrange
    
    try:
        from selenium import webdriver
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.firefox.service import Service as FirefoxService
        from webdriver_manager.firefox import GeckoDriverManager
    except ImportError:
        print("Selenium not available. Install with: pip install selenium webdriver-manager")
        return
    
    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}")
        return
    
    conn = sqlite3.connect(db_path)
    
    # Get months in database
    rows = conn.execute("""
        SELECT DISTINCT year, month, COUNT(*) as count
        FROM colas 
        WHERE year IS NOT NULL AND month IS NOT NULL
        GROUP BY year, month
        ORDER BY year DESC, month DESC
    """).fetchall()
    
    if not rows:
        print("No data in database")
        conn.close()
        return
    
    db_counts = {(r[0], r[1]): r[2] for r in rows}
    
    print(f"\n{'='*70}")
    print("VALIDATING AGAINST TTB")
    print(f"{'='*70}")
    print("Starting browser to query TTB...")
    
    # Start browser
    driver = webdriver.Firefox(service=FirefoxService(GeckoDriverManager().install()))
    driver.set_page_load_timeout(30)
    
    results = []
    
    try:
        for (year, month), db_count in sorted(db_counts.items()):
            # Get TTB count for this month
            last_day = monthrange(year, month)[1]
            date_from = f"{month:02d}/01/{year}"
            date_to = f"{month:02d}/{last_day}/{year}"
            
            driver.get('https://ttbonline.gov/colasonline/publicSearchColasBasic.do')
            time.sleep(2)
            
            try:
                WebDriverWait(driver, 30).until(
                    EC.presence_of_element_located((By.NAME, 'searchCriteria.dateCompletedFrom'))
                )
                
                driver.find_element(By.NAME, 'searchCriteria.dateCompletedFrom').clear()
                driver.find_element(By.NAME, 'searchCriteria.dateCompletedFrom').send_keys(date_from)
                driver.find_element(By.NAME, 'searchCriteria.dateCompletedTo').clear()
                driver.find_element(By.NAME, 'searchCriteria.dateCompletedTo').send_keys(date_to)
                
                driver.find_element(By.XPATH, '//input[@type="submit" and @value="Search"]').click()
                time.sleep(2)
                
                # Get count
                html = driver.page_source
                match = re.search(r'Total Matching Records:\s*([\d,]+)', html)
                if match:
                    ttb_count = int(match.group(1).replace(',', ''))
                else:
                    ttb_count = None
                
                results.append({
                    'year': year,
                    'month': month,
                    'db_count': db_count,
                    'ttb_count': ttb_count,
                    'diff': (ttb_count - db_count) if ttb_count else None
                })
                
            except Exception as e:
                results.append({
                    'year': year,
                    'month': month,
                    'db_count': db_count,
                    'ttb_count': None,
                    'diff': None,
                    'error': str(e)
                })
            
            time.sleep(1)
    
    finally:
        driver.quit()
    
    conn.close()
    
    # Print results
    print(f"\n{'Month':<10} {'DB Count':>10} {'TTB Count':>10} {'Diff':>10} {'Status':<10}")
    print("-" * 55)
    
    total_db = 0
    total_ttb = 0
    total_diff = 0
    discrepancies = []
    
    for r in sorted(results, key=lambda x: (x['year'], x['month'])):
        month_str = f"{r['year']}-{r['month']:02d}"
        db_count = r['db_count']
        ttb_count = r.get('ttb_count')
        diff = r.get('diff')
        
        total_db += db_count
        
        if ttb_count is not None:
            total_ttb += ttb_count
            
            if diff == 0:
                status = "OK"
            elif diff > 0:
                status = f"MISSING -{diff}"
                discrepancies.append(r)
                total_diff += diff
            else:
                status = f"WARNING +{-diff}"
            
            print(f"{month_str:<10} {db_count:>10,} {ttb_count:>10,} {diff:>+10,} {status:<10}")
        else:
            print(f"{month_str:<10} {db_count:>10,} {'ERROR':>10} {'N/A':>10} {'WARNING':<10}")
    
    print("-" * 55)
    print(f"{'TOTAL':<10} {total_db:>10,} {total_ttb:>10,} {total_diff:>+10,}")
    
    # Summary
    print(f"\n{'='*70}")
    if discrepancies:
        print(f"DISCREPANCIES FOUND: {len(discrepancies)} months need attention")
        print(f"Total missing COLAs: {total_diff:,}")
        print(f"\nTo fix, re-run workers for these months:")
        for r in discrepancies:
            print(f"  python cola_worker.py --name fix_{r['year']}_{r['month']:02d} --months {r['year']}-{r['month']:02d}")
        print(f"\nThen re-merge:")
        print(f"  python merge_colas.py --auto --output {db_path}")
    else:
        print("OK ALL MONTHS MATCH TTB COUNTS")
    print(f"{'='*70}\n")


def main():
    parser = argparse.ArgumentParser(description='Merge COLA databases')
    
    parser.add_argument('--auto', action='store_true',
                        help='Auto-find databases in data/')
    parser.add_argument('--dbs', nargs='+',
                        help='Specific databases to merge')
    parser.add_argument('--output', default='data/consolidated_colas.db',
                        help='Output database path')
    parser.add_argument('--export',
                        help='Export to JSON file')
    parser.add_argument('--status', action='store_true',
                        help='Show database status')
    parser.add_argument('--validate', action='store_true',
                        help='Validate database against TTB counts')
    parser.add_argument('--data-dir', default='data',
                        help='Directory to search for databases')
    
    args = parser.parse_args()
    
    if args.validate:
        validate_against_ttb(args.output)
    
    elif args.status:
        show_status(args.output)
    
    elif args.export:
        db = args.output if os.path.exists(args.output) else 'data/consolidated_colas.db'
        export_json(db, args.export)
    
    elif args.auto or args.dbs:
        if args.auto:
            dbs = find_databases(args.data_dir)
            if not dbs:
                print("No databases found")
                return
        else:
            dbs = args.dbs
        
        merge_databases(dbs, args.output)
        show_status(args.output)
    
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
