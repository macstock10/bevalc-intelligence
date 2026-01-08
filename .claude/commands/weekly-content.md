# /weekly-content

Run the full weekly content generation pipeline.

## Description
Generates all weekly content including data mining, news aggregation, content writing, and newsletter assembly. This is the main command to run after the Saturday weekly update completes.

## Usage
```
/weekly-content
/weekly-content --dry-run
/weekly-content --skip-news
```

## Options
| Flag | Description |
|------|-------------|
| `--dry-run` | Preview what would be generated without writing files |
| `--skip-news` | Skip email and site scanning (use cached) |
| `--date YYYY-MM-DD` | Generate for specific week ending date |

## Pipeline Steps

### 1. Data Mining
**Agent:** `data-miner`
**Output:** `scripts/content-queue/weekly-data-{date}.json`

Query D1 for:
- This week's filing statistics
- Top filing companies
- Notable new brands
- Category trends
- Story hooks

### 2. News Aggregation
**Agent:** `email-scanner` + `site-monitor`
**Output:** `scripts/content-queue/news-digest-{date}.json`

Gather from:
- Industry newsletters (Zoho Mail)
- Competitor site changes
- Regulatory updates

### 3. Story Generation
**Agent:** `story-writer`
**Output:** `scripts/content-queue/stories-{date}.json`

Create 3-5 absurd stories from interesting filings.

### 4. Content Writing
**Agent:** `content-writer`
**Output:** `scripts/content-queue/articles-{date}.json`

Write:
- Weekly roundup article
- 1-2 company spotlights
- Social media posts

### 5. Newsletter Assembly
**Agent:** `newsletter-writer`
**Output:** `scripts/content-queue/newsletter-{date}.json`

Combine all content into:
- Email newsletter (free version)
- Email newsletter (pro version)
- Blog post version
- Social thread

## Output Files

After running `/weekly-content`, the `scripts/content-queue/` folder will contain:

```
content-queue/
├── weekly-data-2026-01-11.json
├── news-digest-2026-01-11.json
├── site-changes-2026-01-11.json
├── stories-2026-01-11.json
├── articles-2026-01-11.json
└── newsletter-2026-01-11.json
```

## Automation

To run automatically, add to Windows Task Scheduler:
```powershell
# Run every Saturday at 10am (after weekly update at 9pm Friday)
schtasks /create /tn "BevAlc Weekly Content" /tr "powershell -File C:\path\to\schedule-task.ps1" /sc weekly /d SAT /st 10:00
```

## Environment Requirements
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `ZOHO_CLIENT_ID` (optional, for email scanning)
- `ZOHO_CLIENT_SECRET` (optional)

## Error Handling
- If D1 query fails, abort pipeline
- If email scanning fails, continue with warning
- If story generation fails, use fallback content
- Always generate newsletter even with partial data

## Example Session

```
User: /weekly-content

Claude: Starting weekly content pipeline for week ending January 11, 2026...

[1/5] Data Mining
  ✓ Queried D1: 3,245 filings this week
  ✓ Identified 12 top filers
  ✓ Found 127 new brands
  → Saved to content-queue/weekly-data-2026-01-11.json

[2/5] News Aggregation
  ✓ Scanned 23 emails from Zoho
  ✓ Monitored 8 sites for changes
  ✓ Found 5 relevant news items
  → Saved to content-queue/news-digest-2026-01-11.json

[3/5] Story Generation
  ✓ Found 15 interesting brand names
  ✓ Generated 4 absurd stories
  → Saved to content-queue/stories-2026-01-11.json

[4/5] Content Writing
  ✓ Wrote weekly roundup (892 words)
  ✓ Wrote Diageo spotlight (654 words)
  ✓ Generated 5 social posts
  → Saved to content-queue/articles-2026-01-11.json

[5/5] Newsletter Assembly
  ✓ Assembled free newsletter
  ✓ Assembled pro newsletter
  ✓ Created blog post version
  → Saved to content-queue/newsletter-2026-01-11.json

Pipeline complete! Content ready for review.
```

## Post-Pipeline Steps

After `/weekly-content` completes:

1. **Review** - Check generated content in content-queue/
2. **Edit** - Modify as needed before publishing
3. **Publish** - Use `send_weekly_report.py` for emails
4. **Post** - Copy social content to Buffer/Hootsuite
5. **Blog** - Copy blog post to CMS
