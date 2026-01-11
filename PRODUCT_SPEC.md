# BevAlc Intelligence - Product Specification

*Last updated: January 2026*

---

## Executive Summary

BevAlc Intelligence is a B2B SaaS product providing competitive intelligence on beverage alcohol label approvals (TTB COLA filings). The primary value proposition is **early detection of new market entrants** for lead generation, competitive intelligence, and market trend analysis.

**Business Model:** Lifestyle business targeting $10-50k MRR
**Pricing:** $79/month (Category Pro), $149/month (Premier)
**Target Market:** Craft beverage producers and industry service providers
**Go-to-Market:** SEO-driven organic growth + bourbon broker referral partnership

---

## Current State

### What Works
- 2M+ COLA records in searchable database
- Weekly email reports (well-designed, the product's UI strength)
- Watchlist alerts for tracked brands/companies
- CSV export for Pro users
- SEO pages for companies and brands (partially indexed)
- Daily data sync from TTB

### Critical Issues to Resolve
1. **Daily sync reliability** - Has failed the last two runs; root cause unclear
2. **Signal classification accuracy** - NEW_COMPANY/NEW_BRAND/NEW_SKU signals must be trustworthy
3. **Sitemap issues** - Some sitemaps working, some aren't (blocking SEO growth)

### Known Weaknesses
- Mobile UI is functional but not polished
- Value proposition not clearly articulated to prospects
- No direct user research conducted yet
- SEO analytics not being tracked

---

## Target Users

### Primary ICP: Industry Service Providers
- **Bourbon brokers** - Finding new distilleries to work with
- **Label designers** - Prospecting new brands needing design work
- **Compliance consultants** - Identifying companies needing help
- **Distributors** - Discovering new products to carry

### Secondary ICP: Craft Producers
- **Small distilleries/wineries/breweries** - Monitoring competitors
- **Brand managers** - Tracking their own and competitor filings

### Go-to-Market Strategy
1. **SEO pages** drive organic discovery via brand/company name searches
2. **Bourbon broker partnership** provides warm referrals (free access in exchange for referrals)
3. **Weekly email** nurtures leads and demonstrates ongoing value

---

## Jobs to Be Done

### Primary JTBD: Lead Generation
> "When a new distillery files their first COLA, I want to know immediately so I can reach out before my competitors do."

**Key Signal:** NEW_COMPANY
**Required Data:** Company name, brand name, category, location
**User Action:** Google the company, add to CRM, initiate outreach

### Secondary JTBD: Competitive Intelligence
> "When my competitor launches a new product line, I want to know what they're doing so I can plan my response."

**Key Signal:** NEW_BRAND from known company
**Required Data:** Brand name, fanciful name, category, approval date
**User Action:** Add to watchlist for ongoing tracking

### Tertiary JTBD: Market Trend Analysis
> "I want to understand which categories are heating up so I can position my services accordingly."

**Key Signal:** Category-level volume trends
**Required Data:** Weekly/monthly filing counts by category
**User Action:** Adjust business strategy

---

## Feature Requirements

### Must-Have (MVP)

#### 1. Reliable Daily Data Sync
- **Requirement:** Sync runs every day without manual intervention
- **Acceptance Criteria:**
  - Zero failures for 30 consecutive days
  - Automatic retry on transient errors
  - Clear error logging when failures occur
  - Email notification to admin on failure

#### 2. Accurate Signal Classification
- **Requirement:** Every new filing receives an accurate signal
- **Signal Definitions:**
  - `NEW_COMPANY` - First filing from a normalized company entity
  - `NEW_BRAND` - First filing of a brand from an existing company
  - `NEW_SKU` - First filing of a specific product variant
  - `REFILE` - Subsequent filing of an existing SKU
- **Acceptance Criteria:**
  - Classification runs immediately after sync completes
  - Company normalization handles common variations (Inc vs Inc., LLC variations)
  - No NULL signals in production data

#### 3. Weekly Email Reports
- **Requirement:** Pro users receive weekly summary with actionable intelligence
- **Content:**
  - New market entrants in their selected categories
  - Watchlist matches
  - Filing volume trends
  - Top filers in their categories
- **Acceptance Criteria:**
  - Emails deliver reliably (no spam folder issues)
  - Mobile-friendly design
  - Clear CTAs to drive site engagement

#### 4. Watchlist & Alerts
- **Requirement:** Pro users can track specific brands/companies and receive alerts
- **Acceptance Criteria:**
  - Alerts send within 24 hours of matching filing
  - Email includes filing details and link to database
  - Easy to add/remove watchlist items

#### 5. Search & Export
- **Requirement:** Users can search the database and export results
- **Acceptance Criteria:**
  - Filters: category, date range, origin, signal type
  - Results display key fields (brand, company, date, signal)
  - CSV export available for Pro users (up to 10,000 records)

### Nice-to-Have (Post-MVP)

#### 6. Contact Enrichment (Premium Upsell)
- **Requirement:** Enrich company records with external data
- **Data Sources:** LinkedIn, company websites, industry databases
- **Fields:** Email, phone, LinkedIn profiles, website URL
- **Monetization:** Additional fee on top of base subscription

#### 7. Company Deep-Dive Pages
- **Requirement:** Detailed analytics for individual companies
- **Content:** Filing history, brand portfolio, category mix, trend over time
- **Challenge:** 25K+ companies makes this computationally expensive

#### 8. Trend Dashboards
- **Requirement:** Visual charts showing market trends
- **Content:** Category growth, new entrant velocity, seasonal patterns
- **Format:** Embeddable charts in weekly email and on-site dashboard

---

## Technical Requirements

### Reliability Requirements

#### Data Pipeline
- Daily sync must complete successfully 99%+ of the time
- Maximum data latency: 24 hours from TTB publication
- Automatic retry with exponential backoff on failure
- Failure notification within 5 minutes of error

#### Monitoring (Post-Revenue)
- Pipeline health dashboard
- Error rate alerting
- Data freshness monitoring
- Cost tracking for Cloudflare usage

### Performance Requirements
- Search results under 2 seconds
- Email send completion within 5 minutes of trigger
- CSV export generation under 30 seconds (10K records)

### Security Requirements
- All endpoints require authentication for sensitive data
- Stripe webhook signature verification (implemented)
- CORS restricted to bevalcintel.com (implemented)
- Rate limiting on all API endpoints (implemented)

---

## Architecture Decisions

### Current Stack (Working Well)
- **Frontend:** Static HTML/JS hosted on Netlify
- **API:** Cloudflare Worker (worker.js)
- **Database:** Cloudflare D1 (SQLite-compatible)
- **Email:** Resend API + React Email templates
- **Payments:** Stripe subscriptions
- **Scraping:** Python + Selenium (GitHub Actions)

### Technical Debt to Address
- 416K historical records with NULL signals (need backfill)
- Scraper runs slowly due to TTB site performance
- Company normalization may have gaps (not fully audited)

### Risk Mitigation
- **TTB blocking scraping:**
  - Respect rate limits
  - Use residential-style request patterns
  - Have backup approach (manual monitoring) if blocked
- **Cloudflare limits:**
  - Monitor D1 row limits and query performance
  - Plan migration path if limits hit (Turso, Supabase)

---

## Pricing & Monetization

### Current Tiers
| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | Search database, limited results |
| Category Pro | $79/mo | Full search, weekly reports, watchlist, export (single category) |
| Premier | $149/mo | All categories, priority support |

### Pricing Rationale
- Value-based pricing (intuition, not validated)
- Positioned below enterprise solutions
- Room to increase as value proven

### Future Monetization
- Contact enrichment add-on ($X per enriched record)
- API access for power users
- Annual discount (2 months free)

---

## Success Metrics

### Launch Metrics (Q1 2026)
- [ ] First paying customer acquired
- [ ] 30 days of zero sync failures
- [ ] 100 organic visitors/month to SEO pages
- [ ] Broker partner confirms product is useful

### Growth Metrics (Post-Launch)
- MRR target: $1,000 by end of Q2 2026
- Churn target: <5% monthly
- NPS target: >40

---

## Open Questions

1. **Value articulation:** How do we clearly communicate ROI to prospects?
2. **User research:** What would users actually do with new market entrant info?
3. **Pricing validation:** Is $79 too high, too low, or about right?
4. **SEO strategy:** Which keywords should we target for organic growth?
5. **Enrichment scope:** What external data sources are worth integrating?

---

## Immediate Priorities (Next 2 Weeks)

### P0: Reliability
1. Investigate and fix daily sync failures
2. Ensure signal classification runs on every sync
3. Add better error logging and failure notifications

### P1: SEO
1. Fix broken sitemaps
2. Verify all SEO pages are indexed
3. Set up basic analytics (Google Search Console)

### P2: Polish
1. Test full user journey end-to-end
2. Fix any obvious mobile issues
3. Ensure weekly email delivers correctly

---

## Notes from Founder

- **Time constraint:** Working nights/weekends only (<10h/week)
- **Personal motivation:** "I so badly want side income it's nearly painful"
- **Risk tolerance:** Willing to invest in monitoring tools once revenue starts
- **Technical reliance:** Depending on Claude for debugging and technical decisions
- **Biggest fear:** TTB blocks scraping and data source is lost
