# Content Workflow Skill

## Overview
This skill defines the end-to-end process for creating BevAlc Intelligence content. It covers the weekly content cycle, individual content creation, and publishing workflows.

## Weekly Content Cycle

### Timeline (All times ET)

| Day | Time | Activity |
|-----|------|----------|
| Friday | 2:00 PM | Weekly Report emails sent (GitHub Action) |
| Saturday | - | Content planning for next week |
| Saturday | 10:00 AM | /weekly-content pipeline runs |
| Saturday | 10:00 AM | `/weekly-content` pipeline runs |
| Saturday | 12:00 PM | Content review and editing |
| Sunday | - | Buffer for additional content if needed |
| Monday | 9:00 AM | Blog post published (if applicable) |
| Monday | 10:00 AM | Social posts scheduled |

### Saturday Content Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    SATURDAY CONTENT WORKFLOW                     │
│                         (10 AM - 12 PM ET)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  10:00 AM │ Run /weekly-content                                 │
│           │                                                      │
│           ├──► [1] Data Mining                                  │
│           │    Query D1 for weekly stats, top filers,           │
│           │    notable brands, category trends                   │
│           │    → weekly-data-{date}.json                         │
│           │                                                      │
│           ├──► [2] News Aggregation                             │
│           │    Scan Zoho Mail, check competitor sites            │
│           │    → news-digest-{date}.json                         │
│           │                                                      │
│           ├──► [3] Story Generation                             │
│           │    Find interesting brands, write absurd stories     │
│           │    → stories-{date}.json                             │
│           │                                                      │
│           ├──► [4] Content Writing                              │
│           │    Write roundup, spotlights, social posts          │
│           │    → articles-{date}.json                            │
│           │                                                      │
│           └──► [5] Newsletter Assembly                          │
│                Combine into newsletter format                    │
│                → newsletter-{date}.json                          │
│                                                                  │
│  11:00 AM │ Review generated content                            │
│           │ - Check data accuracy                                │
│           │ - Edit for voice/tone                                │
│           │ - Approve or revise                                  │
│                                                                  │
│  12:00 PM │ Finalize and queue                                  │
│           │ - Save final versions                                │
│           │ - Schedule social posts                              │
│           │ - Queue blog post for Monday                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Content Creation Process

### 1. Company Spotlight Workflow

```
Trigger: Unusual company activity detected OR manual request

Step 1: Data Collection
├── Query D1 for company metrics
├── Get recent filing counts
├── Get brand portfolio
├── Get category breakdown
└── Get historical trend

Step 2: Cross-Reference
├── Check news-digest for recent mentions
├── Check site-changes for competitor moves
└── Note any M&A activity

Step 3: Content Generation
├── Run content-writer agent
├── Generate blog post (800-1200 words)
├── Generate social posts (5-10)
└── Generate newsletter section

Step 4: Review & Edit
├── Verify data accuracy
├── Check brand voice compliance
├── Ensure links work
└── Proofread

Step 5: Publish
├── Add to blog CMS
├── Schedule social posts
└── Include in next newsletter
```

### 2. Trend Report Workflow

```
Trigger: Category trend detected OR manual request

Step 1: Define Scope
├── Identify category or phenomenon
├── Set time period
├── Identify comparison baseline
└── List specific questions to answer

Step 2: Data Analysis
├── Query D1 for time series data
├── Calculate growth rates
├── Identify top filers
├── Find new entrants
└── Note subcategory patterns

Step 3: Content Generation
├── Run content-writer agent
├── Generate report (800-1500 words)
├── Generate data visualizations
└── Generate social summary

Step 4: Review & Publish
├── Verify data accuracy
├── Check calculations
├── Finalize visualizations
└── Publish across channels
```

### 3. Absurd Story Workflow

```
Trigger: Interesting brand name found OR manual request

Step 1: Find Story-Worthy Filing
├── Query D1 for unusual names
├── Look for long fanciful names
├── Check for unexpected category/name combos
└── Prioritize recent filings

Step 2: Generate Story
├── Run story-writer agent
├── Select story type (naming-committee, etc.)
├── Generate 150-300 word story
└── Add disclaimer

Step 3: Create Social Post
├── Write 280-char tweet
├── Include filing details
└── Link to brand SEO page

Step 4: Include in Newsletter
├── Add to "Absurd Story of the Week" section
└── Keep story and social versions
```

## File Management

### Content Queue Structure

```
scripts/content-queue/
├── weekly-data-2026-01-11.json      # Raw data from D1
├── news-digest-2026-01-11.json      # News aggregation
├── site-changes-2026-01-11.json     # Site monitoring
├── stories-2026-01-11.json          # Generated stories
├── articles-2026-01-11.json         # Written content
├── newsletter-2026-01-11.json       # Assembled newsletter
├── spotlight-diageo-2026-01-11.json # Company spotlight
└── trend-tequila-2026-01-11.json    # Trend report
```

### File Naming Convention
- Format: `{content-type}-{subject}-{YYYY-MM-DD}.json`
- Subject should be lowercase, hyphenated
- Date is the week ending date (Saturday)

### Retention
- Keep 4 weeks of content queue files
- Archive older files to `content-queue/archive/`
- Delete files older than 12 weeks

## Publishing Checklist

### Before Publishing Any Content

**Data Accuracy**
- [ ] All numbers verified against D1 queries
- [ ] Company names spell-checked
- [ ] Dates are correct
- [ ] Percentages calculated correctly

**Brand Voice**
- [ ] Follows tone guidelines
- [ ] No marketing hyperbole
- [ ] Data-forward approach
- [ ] Appropriate length for format

**Links & SEO**
- [ ] Company links go to correct SEO pages
- [ ] Brand links go to correct SEO pages
- [ ] No broken links
- [ ] Meta description under 155 chars
- [ ] Title under 60 chars

**Legal**
- [ ] No defamatory statements
- [ ] Absurd stories have disclaimer
- [ ] No confidential information
- [ ] No trademark issues

### Platform-Specific Checklists

**Blog Post**
- [ ] Featured image selected
- [ ] Categories/tags applied
- [ ] SEO meta configured
- [ ] Internal links included
- [ ] CTA to product included

**Email Newsletter**
- [ ] Subject line tested
- [ ] Preview text set
- [ ] All links clickable
- [ ] Unsubscribe link works
- [ ] Mobile rendering checked

**Social Media**
- [ ] Character count verified
- [ ] Hashtags appropriate
- [ ] Mentions correct
- [ ] Link previews work
- [ ] Scheduled at optimal time

## Quality Standards

### Content Requirements

| Content Type | Min Words | Max Words | Required Elements |
|--------------|-----------|-----------|-------------------|
| Weekly Roundup | 500 | 800 | 5+ data points, category breakdown |
| Company Spotlight | 800 | 1200 | Company metrics, brand list, trend |
| Trend Report | 800 | 1500 | Time series, comparisons, insights |
| Absurd Story | 150 | 300 | Real filing data, disclaimer |
| Social Post | N/A | 280 | Data point, link |

### Data Requirements

Every piece of content must include:
1. At least 3 specific data points from D1
2. Date/timeframe context
3. Comparison to baseline (last week, YoY, etc.)
4. At least 1 link to SEO page

### Review Levels

| Content Type | Review Required |
|--------------|-----------------|
| Weekly Newsletter | Self-review |
| Blog Post | Peer review preferred |
| Trend Report | Peer review required |
| Press-facing content | Management review |

## Automation Scripts

### Daily Tasks
```powershell
# 8 AM - Scan for news
.\scripts\content-automation\scan-news.ps1

# Output: news-digest-{date}.json
```

### Weekly Tasks
```powershell
# Saturday 10 AM - Full content pipeline
.\scripts\content-automation\weekly-content.ps1

# Creates: All content-queue files for the week
```

### Ad-Hoc Tasks
```powershell
# Company spotlight
.\scripts\content-automation\company-spotlight.ps1 -Company "Diageo"

# Trend report
.\scripts\content-automation\trend-report.ps1 -Category "Tequila" -Period "Year"
```

## Error Handling

### Pipeline Failures

| Failure Point | Recovery Action |
|---------------|-----------------|
| D1 query fails | Abort pipeline, alert operator |
| Email scan fails | Continue with warning, use previous |
| Story generation fails | Use fallback content |
| Content generation fails | Retry once, then manual |
| Newsletter assembly fails | Generate from raw data |

### Content Issues

| Issue | Action |
|-------|--------|
| Data discrepancy found | Re-query D1, verify, correct |
| Brand voice violation | Edit before publish |
| Broken link | Fix link, delay if needed |
| Factual error after publish | Issue correction, update post |
