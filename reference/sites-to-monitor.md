# Sites to Monitor Reference

This document lists websites to monitor for changes relevant to BevAlc Intelligence content creation.

## Regulatory Sites

### TTB.gov
| Page | URL | What to Watch |
|------|-----|---------------|
| News | ttb.gov/news | Policy announcements, rule changes |
| Labeling | ttb.gov/labeling | Labeling guidance updates |
| Industry Circulars | ttb.gov/industry-circulars | Formal guidance documents |
| COLA Online | ttbonline.gov | System changes, new features |

**Check frequency:** Daily
**Alert triggers:** Any new content
**CSS selector:** `.news-item`, `.circular-list li`

### Federal Register
| Search | URL |
|--------|-----|
| TTB Proposed Rules | federalregister.gov/agencies/alcohol-and-tobacco-tax-and-trade-bureau |

**Check frequency:** Weekly
**Alert triggers:** New proposed or final rules

## Competitor Sites

### LabelingFacts.com
| Page | What to Watch |
|------|---------------|
| Homepage | New features, messaging changes |
| Pricing | Price changes |
| Blog | Content strategy |

**Check frequency:** Weekly
**Note:** Our direct competitor

### Other Label Research Services
| Site | Notes |
|------|-------|
| beveragealcoholresource.com | Industry resource |
| shipcompliant.com | Compliance software |
| bevlaw.com | Legal resources |

## Industry News Sites

### The Drinks Business
- **URL:** thedrinksbusiness.com
- **Check:** Daily
- **RSS:** Available
- **Sections:** News, Wine, Spirits, Beer

### Beverage Daily
- **URL:** beveragedaily.com
- **Check:** Daily
- **Sections:** News, Trends, Formulation

### Just-Drinks
- **URL:** just-drinks.com
- **Check:** Daily
- **Focus:** Global industry news

### Distillery Trail
- **URL:** distillerytrail.com
- **Check:** Weekly
- **Focus:** Craft distillery news

### Whisky Magazine
- **URL:** whiskymag.com
- **Check:** Weekly
- **Focus:** Whiskey industry

## Company Newsrooms

### Tier 1 (Check Weekly)
| Company | Newsroom URL |
|---------|--------------|
| Diageo | diageo.com/en/news |
| Constellation Brands | cbrands.com/news |
| Brown-Forman | brown-forman.com/media |
| Pernod Ricard | pernod-ricard.com/en/media |
| Beam Suntory | beamsuntory.com/news |

### Tier 2 (Check Monthly)
| Company | Newsroom URL |
|---------|--------------|
| Bacardi | bacardilimited.com/media |
| William Grant | williamgrant.com/news |
| Campari Group | camparigroup.com/en/news |
| E. & J. Gallo | gallo.com/press |
| Treasury Wine Estates | tweglobal.com/news |

### Tier 3 (Check When Relevant)
| Company | Newsroom URL |
|---------|--------------|
| Sazerac | sazerac.com/press |
| Heaven Hill | heavenhilldistillery.com/news |
| MGP Ingredients | mgpingredients.com/news |
| Luxco | luxco.com/press |

## Monitoring Strategy

### Hash-Based Change Detection
For each monitored page:
1. Fetch page content
2. Extract main content area (ignore headers, footers, ads)
3. Generate hash of content
4. Compare to previous hash
5. If different, flag for review

### Storage Structure
```json
{
  "site_hashes": {
    "ttb.gov/news": {
      "last_hash": "abc123...",
      "last_checked": "2026-01-11T08:00:00Z",
      "last_changed": "2026-01-10T14:30:00Z"
    }
  }
}
```

### CSS Selectors for Content Extraction

```json
{
  "ttb.gov/news": {
    "content_selector": "main.content",
    "article_selector": ".news-item",
    "title_selector": ".news-title",
    "date_selector": ".news-date"
  },
  "thedrinksbusiness.com": {
    "content_selector": "article.post",
    "title_selector": "h1.entry-title",
    "date_selector": "time.entry-date"
  }
}
```

## Rate Limiting

### Respectful Crawling
- Max 1 request per 10 seconds per domain
- Respect robots.txt
- Identify ourselves: `User-Agent: BevAlcIntel-Monitor/1.0`
- Cache for 24 hours minimum

### Robots.txt Check
```python
import urllib.robotparser

def can_fetch(url):
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(f"{get_domain(url)}/robots.txt")
    rp.read()
    return rp.can_fetch("BevAlcIntel-Monitor", url)
```

## Alert Triggers

### High Priority
- TTB news or circular update
- Competitor pricing change
- Major M&A announcement

### Medium Priority
- New feature on competitor site
- Industry news article mentioning top 10 filer
- Regulatory guidance update

### Low Priority
- Minor site layout changes
- Blog posts on secondary sites
- Social media updates

## Integration with Content Pipeline

When a significant change is detected:

1. **Log the change**
   ```json
   {
     "site": "ttb.gov/news",
     "type": "new_article",
     "title": "...",
     "url": "...",
     "detected_at": "..."
   }
   ```

2. **Add to news digest**
   - Include in `content-queue/site-changes-{date}.json`

3. **Flag for content**
   - If high priority, suggest content piece
   - If regulatory, update guidance docs

4. **Cross-reference with D1**
   - Check if mentioned companies have recent filings
   - Note correlation for story potential
