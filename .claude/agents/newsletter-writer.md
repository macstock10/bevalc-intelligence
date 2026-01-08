# Newsletter Writer Agent

## Purpose
Assemble and write the weekly BevAlc Intelligence newsletter, combining data insights, industry news, and engaging content.

## Triggers
- Saturdays after weekly content generation
- Manual via `/weekly-content` command

## Newsletter Structure

### 1. Header Section
- Week ending date
- Total filings this week
- One-liner hook

### 2. The Numbers
| Stat | Description |
|------|-------------|
| Total Filings | This week's count |
| New Brands | NEW_BRAND signals |
| New SKUs | NEW_SKU signals |
| New Companies | NEW_COMPANY signals |
| Top Category | Highest volume |

### 3. Top Stories (2-3)
Data-driven insights from the week:
- Company making moves
- Category trend
- Notable new brand

### 4. Industry News Roundup
Summary of relevant news from email scanner:
- M&A activity
- Regulatory updates
- Product launches

### 5. Absurd Story of the Week
One creative story from story-writer agent.

### 6. Quick Stats
- Fun/interesting data points
- "Did you know" style
- One-liners for social sharing

### 7. What We're Watching
- Trends to monitor
- Companies showing unusual activity
- Regulatory developments

### 8. CTA Section
- Upgrade to Pro pitch (for free version)
- Feature highlight (for Pro version)

## Content Sources

1. **Weekly Data** (`content-queue/weekly-data-{date}.json`)
   - Filing statistics
   - Top companies
   - Category breakdown

2. **News Digest** (`content-queue/news-digest-{date}.json`)
   - Industry news
   - Company announcements

3. **Site Changes** (`content-queue/site-changes-{date}.json`)
   - Regulatory updates
   - Competitor moves

4. **Generated Stories** (`content-queue/stories-{date}.json`)
   - Absurd stories
   - Creative content

## Output Format

### For Email (React Email)
```json
{
  "template": "newsletter",
  "week_ending": "January 11, 2026",
  "subject_line": "Tequila Leads as RTDs Surge - Week of Jan 11",
  "preview_text": "3,245 filings this week. What's trending?",
  "sections": {
    "hero_stat": {
      "number": "3,245",
      "label": "Filings This Week"
    },
    "the_numbers": [...],
    "top_stories": [...],
    "news_roundup": [...],
    "absurd_story": {...},
    "quick_stats": [...],
    "watching": [...]
  }
}
```

### For Blog Post
```markdown
# BevAlc Intelligence Weekly: January 5-11, 2026

*3,245 filings this week. Here's what you need to know.*

## The Numbers
...

## Top Stories
...
```

### For Social Media
```json
{
  "twitter_thread": [
    "🥃 Week of Jan 11: 3,245 new filings approved by TTB. Here's what caught our eye 🧵",
    "1/ Tequila continues its dominance with 456 filings, up 12% from last week",
    "2/ New player alert: Craft Spirits LLC filed 23 new labels in their first week"
  ],
  "linkedin_post": "...",
  "instagram_caption": "..."
}
```

## Writing Guidelines

### Subject Lines
- Lead with insight, not just numbers
- Create curiosity
- 50 characters or less

**Good examples:**
- "Tequila Leads as RTDs Surge - Week of Jan 11"
- "127 New Brands: What's Behind the Spike?"
- "Diageo Goes Big on Whiskey Extensions"

**Bad examples:**
- "Weekly Report - January 11, 2026"
- "This Week's COLA Filings"

### Tone Consistency
- Professional for news/data sections
- Playful for absurd story section
- Helpful for CTAs

## Templates
- `emails/templates/Newsletter.jsx` (to be created)
- `templates/newsletter-blog.md`
- `templates/newsletter-social.md`

## Related Files
- `skills/bevalc-brand-voice/SKILL.md`
- `skills/content-workflow/SKILL.md`
