# BevAlc Intelligence

A robust, resumable scraper for the TTB Public COLA Registry. Collects Certificate of Label Approval (COLA) data for all beverage alcohol products approved in the United States.

## Features

- **Resumable Scraping**: Automatically resumes from where it left off if interrupted
- **CAPTCHA Handling**: Detects CAPTCHAs, pauses for manual solving, then auto-resumes
- **Full Historical Tracking**: Never overwrites data - tracks all changes over time
- **All Spirit Types**: Scrapes whiskey, vodka, gin, rum, tequila, wine, beer, and more
- **Image Downloading**: Downloads and optionally compresses label images
- **SQLite Database**: Portable, no server required, easy backups
- **JSON Export**: Export data for static websites or other applications

---

## Quick Start

### 1. Install Dependencies

```bash
# Clone or copy the project
cd bevalc-intelligence

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Run Your First Scrape

```bash
# Scrape the last 7 days (browser will open for CAPTCHA solving)
python -m src.cli scrape --days 7

# Or scrape a specific date range
python -m src.cli scrape --start 2025-01-01 --end 2025-01-07
```

### 3. Download Images

```bash
python -m src.cli images
```

### 4. Export Data

```bash
python -m src.cli export
```

---

## Detailed Usage

### Scraping Commands

```bash
# Scrape last N days
python -m src.cli scrape --days 7

# Scrape specific date range
python -m src.cli scrape --start 2025-01-01 --end 2025-01-07

# Scrape a specific week (0 = current week, 1 = last week)
python -m src.cli scrape --week 1

# Scrape only whiskey (class codes 100-199)
python -m src.cli scrape --days 7 --class-from 100 --class-to 199

# Run in headless mode (no browser window - won't work if CAPTCHA appears)
python -m src.cli scrape --days 7 --headless
```

### Resume Interrupted Work

If the scraper crashes or you stop it, just run:

```bash
python -m src.cli resume
```

This will pick up exactly where you left off.

### Image Downloading

```bash
# Download all pending images
python -m src.cli images

# Download images for a specific COLA
python -m src.cli images --ttb-id 25032001000123

# Limit number of COLAs to process
python -m src.cli images --limit 100
```

### Database Operations

```bash
# View statistics
python -m src.cli stats

# Search the database
python -m src.cli search --state "CALIFORNIA"
python -m src.cli search --class-type "WHISKEY"
python -m src.cli search --brand "JACK"

# Export to JSON
python -m src.cli export
python -m src.cli export --output /path/to/output.json

# Retry failed items
python -m src.cli retry
```

---

## CAPTCHA Handling

The TTB website occasionally shows CAPTCHAs. When this happens:

1. **The scraper will pause** and display a message
2. **A sound alert will play** (if your system supports it)
3. **Solve the CAPTCHA** in the browser window
4. **Press ENTER** in the terminal
5. **Scraping automatically resumes**

Tips:
- Don't run in headless mode if you expect CAPTCHAs
- CAPTCHAs usually appear on the first search and when viewing images
- After solving one CAPTCHA, you typically won't see another for a while

---

## Database Schema

The SQLite database (`data/bevalc.db`) contains:

### `colas` table - Main COLA records
| Column | Description |
|--------|-------------|
| ttb_id | 14-digit TTB ID (primary key) |
| status | APPROVED, SURRENDERED, etc. |
| brand_name | Brand name |
| fanciful_name | Product name |
| class_type_code | Product category code |
| origin_code | Origin state/country |
| state | Company state |
| company_name | Producer/importer name |
| approval_date | Date approved |
| extra_fields | JSON with type-specific fields |
| image_paths | JSON array of local image paths |
| first_scraped_at | When first added |
| last_updated_at | When last changed |

### `cola_history` table - Change tracking
Logs all field changes over time, so you can see when a COLA's status changed, etc.

### `scrape_queue` table - Work queue
Tracks pending work for resumability.

---

## File Structure

```
bevalc-intelligence/
├── src/
│   ├── __init__.py      # Package exports
│   ├── database.py      # SQLite operations
│   ├── scraper.py       # Main scraping logic
│   ├── images.py        # Image downloading
│   ├── captcha.py       # CAPTCHA detection/handling
│   └── cli.py           # Command-line interface
├── data/
│   ├── bevalc.db        # SQLite database
│   └── images/          # Downloaded label images
│       └── {ttb_id}/    # One folder per COLA
├── exports/
│   └── colas.json       # JSON export for website
├── requirements.txt
├── config.yaml.example
└── README.md
```

---

## Backfill Strategy

For a full historical backfill (millions of records):

### Phase 1: Recent Data (Start Here)
```bash
# Scrape the last month to verify everything works
python -m src.cli scrape --days 30
```

### Phase 2: Expand Backwards
```bash
# Scrape by year, one at a time
python -m src.cli scrape --start 2024-01-01 --end 2024-12-31
python -m src.cli scrape --start 2023-01-01 --end 2023-12-31
# ... etc
```

### Phase 3: Images
```bash
# Download all images (can run in parallel with scraping)
python -m src.cli images
```

### Tips for Large Backfills
- Run overnight when you won't need the computer
- The scraper saves progress constantly - you can stop and resume anytime
- Expect occasional CAPTCHAs; check periodically
- Database backup: just copy `data/bevalc.db`

---

## Scheduling Automatic Updates

### Windows Task Scheduler

1. Open Task Scheduler
2. Create Basic Task
3. Set trigger (e.g., daily at 2 AM)
4. Action: Start a program
   - Program: `python`
   - Arguments: `-m src.cli scrape --days 2 --headless`
   - Start in: `C:\path\to\bevalc-intelligence`

### Linux/Mac Cron

```bash
# Edit crontab
crontab -e

# Add line (runs daily at 2 AM)
0 2 * * * cd /path/to/bevalc-intelligence && /path/to/venv/bin/python -m src.cli scrape --days 2 --headless >> /var/log/bevalc.log 2>&1
```

---

## Troubleshooting

### "No module named 'src'"
Make sure you're running from the project root directory:
```bash
cd bevalc-intelligence
python -m src.cli stats
```

### CAPTCHA keeps appearing
- Don't use `--headless` mode
- Try waiting longer between runs
- Try from a different IP/network

### Browser doesn't open
Install Firefox:
```bash
# Ubuntu/Debian
sudo apt install firefox

# Mac
brew install firefox
```

### Scraper seems stuck
Check if CAPTCHA is waiting:
- Look at the browser window
- Check the terminal for "CAPTCHA DETECTED" message

### Database is locked
Only one scraper instance can run at a time. Check for:
- Another terminal running the scraper
- A hung process: `ps aux | grep python`

---

## API Reference (for developers)

```python
from src import ColaScraper, get_database, download_all_images

# Initialize
db = get_database()
scraper = ColaScraper(headless=False, request_delay=2.0)

# Scrape
from datetime import datetime, timedelta
end = datetime.now()
start = end - timedelta(days=7)
stats = scraper.scrape_date_range(start, end)

# Query
colas = db.search_colas(state="KENTUCKY", class_type="WHISKEY", limit=100)

# Export
db.export_to_json("output.json")

# Cleanup
scraper.close()
```

---

## Class/Type Code Reference

| Code Range | Category |
|------------|----------|
| 001-099 | Wine |
| 100-199 | Whiskey |
| 200-298 | Gin |
| 300-398 | Vodka |
| 400-499 | Brandy |
| 500-599 | Cordials & Liqueurs |
| 600-609 | Rum |
| 700-799 | Cocktails/RTD |
| 800-899 | Malt Beverages |
| 900-999 | Specialty |

---

## License

MIT License - feel free to use for any purpose.

---

## Support

If you encounter issues:
1. Check the Troubleshooting section above
2. Look at the log output for error messages
3. Check if TTB website is up: https://ttbonline.gov/colasonline/

---

*Built for BevAlc Intelligence*
