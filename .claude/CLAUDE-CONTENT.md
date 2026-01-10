# CLAUDE-CONTENT.md

Content automation infrastructure for BevAlc Intelligence. This document describes the agents, commands, skills, and workflows for automated content generation.

## Overview

The content automation system enables Claude to:
1. Query D1 for weekly filing data
2. Scan industry news sources
3. Generate multiple content types (articles, social posts, newsletters)
4. Write engaging "absurd stories" from real filing data
5. Maintain consistent brand voice

## Directory Structure

```
bevalc-intelligence/
├── .claude/
│   ├── CLAUDE.md                    # Main project context
│   ├── CLAUDE-CONTENT.md            # This file - content automation
│   ├── agents/                      # Subagent definitions
│   │   ├── data-miner.md           # Query D1 for weekly data
│   │   ├── email-scanner.md        # Scan Zoho Mail for news
│   │   ├── site-monitor.md         # Monitor competitor sites
│   │   ├── content-writer.md       # Write structured content
│   │   ├── story-writer.md         # Write absurd stories
│   │   ├── newsletter-writer.md    # Assemble newsletters
│   │   └── seo-content.md          # Update SEO pages
│   └── commands/                    # Custom slash commands
│       ├── weekly-content.md       # Full weekly pipeline
│       ├── company-spotlight.md    # Company profile content
│       ├── trend-report.md         # Category trend analysis
│       ├── scan-news.md            # Run news scanners
│       ├── absurd-story.md         # Generate creative story
│       ├── brand-enricher.md       # Find single brand website
│       └── enrich-brands.md        # Batch enrich from weekly sync
├── skills/                          # Skill definitions
│   ├── bevalc-business-context/    # Industry knowledge
│   ├── bevalc-brand-voice/         # Writing style guide
│   ├── content-workflow/           # Process documentation
│   └── brand-enricher/             # Find brand websites
├── scripts/
│   ├── content-automation/         # PowerShell automation
│   │   ├── query-weekly-data.ps1   # Query D1
│   │   ├── generate-content-queue.ps1  # Pipeline orchestrator
│   │   ├── zoho-email-config.ps1   # Zoho Mail setup
│   │   └── schedule-task.ps1       # Windows Task Scheduler
│   └── content-queue/              # Generated content output
├── templates/                       # Content templates
│   ├── company-spotlight.md
│   ├── weekly-roundup.md
│   ├── trend-report.md
│   └── absurd-story.md
└── reference/                       # Reference documents
    ├── newsletter-sources.md       # News source list
    ├── sites-to-monitor.md         # Site monitoring config
    └── seo-best-practices.md       # SEO guidelines
```

## Quick Start

### Run Weekly Content Pipeline
```bash
# PowerShell
cd scripts/content-automation
.\generate-content-queue.ps1

# Or via Claude command
/weekly-content
```

### Generate Specific Content
```bash
# Company spotlight
/company-spotlight diageo

# Trend report
/trend-report tequila --period year

# Absurd story
/absurd-story --random
```

### Set Up Automation
```bash
# Configure Zoho Mail (one-time)
.\zoho-email-config.ps1

# Install weekly scheduled task
.\schedule-task.ps1 -Install
```

## Agents

### data-miner
**Purpose:** Query D1 for weekly filing statistics
**Output:** `content-queue/weekly-data-{date}.json`
**Data collected:**
- Total filings, new brands, new SKUs, new companies
- Top filing companies
- Category breakdown
- Notable new brands
- Story hooks

### email-scanner
**Purpose:** Scan Zoho Mail for industry news
**Output:** `content-queue/news-digest-{date}.json`
**Sources:** Shanken News Daily, Beverage Dynamics, Google Alerts, PR Newswire

### site-monitor
**Purpose:** Monitor competitor and regulatory sites
**Output:** `content-queue/site-changes-{date}.json`
**Sites:** TTB.gov, competitor sites, company newsrooms

### content-writer
**Purpose:** Write structured articles
**Content types:** Company spotlights, weekly roundups, trend reports

### story-writer
**Purpose:** Write creative "absurd stories" from filing data
**Story types:** Naming committee, label artist, approval officer, origin story

### newsletter-writer
**Purpose:** Assemble weekly newsletter content
**Output:** Newsletter JSON for email template, blog post, social posts

### seo-content
**Purpose:** Enhance SEO pages with descriptions and metadata
**Focus:** High-traffic company and brand pages

## Commands

### /weekly-content
Run the full Saturday content generation pipeline.
```
/weekly-content
/weekly-content --dry-run
/weekly-content --skip-news
```

### /company-spotlight
Generate comprehensive content for a specific company.
```
/company-spotlight diageo
/company-spotlight "E. & J. Gallo" --format blog
```

### /trend-report
Generate trend analysis for a category or phenomenon.
```
/trend-report tequila
/trend-report "RTD cocktails" --period year
/trend-report --category whiskey --compare vodka
```

### /scan-news
Run email and site scanning for industry news.
```
/scan-news
/scan-news --email-only
/scan-news --days 3
```

### /absurd-story
Generate a creative story from real filing data.
```
/absurd-story
/absurd-story "Sunset Thunder Vodka"
/absurd-story --type naming-committee
/absurd-story --random --count 3
```

### /brand-enricher
Find official websites for beverage alcohol brands.
```
/brand-enricher "Wonky Ear"
/brand-enricher "Carroll Noir" --save
```

**How it works:**
1. Queries D1 to get company name and category for the brand
2. Searches web with brand + company + category together
3. Scores results (prefers official sites, skips retailers)
4. Verifies top candidate with WebFetch
5. Reports result with confidence level

**Key insight:** Including company name from D1 dramatically improves accuracy. "Wonky Ear" alone = poor results. "Wonky Ear Sideshow Spirits whiskey" = finds distillery immediately.

## Skills

### bevalc-business-context
Comprehensive knowledge about:
- TTB and COLA process
- Industry structure and major players
- Market trends (RTD, premium, tequila growth)
- What COLA data reveals (and doesn't)

### bevalc-brand-voice
Writing style guidelines:
- Professional but accessible tone
- Data-driven (always cite numbers)
- No marketing hyperbole
- Link to SEO pages
- Acknowledge data limitations

### content-workflow
Process documentation:
- Weekly content cycle timeline
- Content creation workflows
- Publishing checklists
- Quality standards

### brand-enricher
Find official brand websites:
- Query D1 for company + category context
- Web search with all three pieces (brand + company + category)
- Score and verify results
- Skip retailers, prefer official sites

**Trigger phrases:** "find the website for", "look up website", "enrich brand"

## Content Queue

Generated content is stored in `scripts/content-queue/`:

| File Pattern | Contents |
|--------------|----------|
| `weekly-data-{date}.json` | D1 query results |
| `news-digest-{date}.json` | Email/site scan results |
| `stories-{date}.json` | Generated absurd stories |
| `articles-{date}.json` | Written articles |
| `newsletter-{date}.json` | Assembled newsletter |
| `spotlight-{company}-{date}.json` | Company spotlight |
| `trend-{topic}-{date}.json` | Trend report |

## Weekly Schedule

| Day/Time | Activity |
|----------|----------|
| Friday 9pm ET | Weekly Update runs (GitHub Action) |
| Saturday 2am ET | Weekly Update completes |
| Saturday 9am ET | Weekly Report emails sent |
| Saturday 10am ET | `/weekly-content` pipeline runs |
| Saturday 12pm ET | Content review and editing |
| Monday 9am | Blog post published |
| Monday 10am | Social posts scheduled |

## Environment Variables

For content automation:
```
# D1 Queries (required)
CLOUDFLARE_ACCOUNT_ID=xxx
CLOUDFLARE_D1_DATABASE_ID=xxx
CLOUDFLARE_API_TOKEN=xxx

# Email Scanning (optional)
ZOHO_CLIENT_ID=xxx
ZOHO_CLIENT_SECRET=xxx
ZOHO_REFRESH_TOKEN=xxx
ZOHO_ACCOUNT_ID=xxx
```

## Templates

Templates in `/templates/` provide structure for:
- Company spotlights (800-1200 words)
- Weekly roundups (500-800 words)
- Trend reports (800-1500 words)
- Absurd stories (150-300 words)

Each template includes:
- Required sections
- Data point requirements
- SEO considerations
- Voice/tone guidelines

## Integration with Existing System

The content automation system integrates with:

1. **D1 Database** - All data queries use the same D1 API as other scripts
2. **SEO Pages** - Generated content links to `/company/[slug]` and `/brand/[slug]`
3. **Email Templates** - Newsletter content can be used with existing React Email templates
4. **Weekly Report** - Runs after `weekly_update.py` and before `send_weekly_report.py`

## Next Steps to Implement

1. **Zoho Mail Integration** - Set up API access for email scanning
2. **Site Monitoring Script** - Implement hash-based change detection
3. **Story Generation** - Train on example absurd stories
4. **Newsletter Template** - Create React Email template for newsletter format
5. **Blog CMS** - Integrate with publishing platform
