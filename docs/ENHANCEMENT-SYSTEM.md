# On-Demand Enhancement System

## Overview

Replace manual brand enrichment with AI-powered on-demand company research. Users click "Enhance" on any filing to get a detailed tearsheet with website, contacts, news, and filing analytics.

## Business Model

### Pricing

| Tier | Enhancement Access |
|------|-------------------|
| Free | Purchase credit packs |
| Pro ($79/mo) | 15 included/month |

### Credit Packs (Free Users)

| Pack | Price | Per Credit | Stripe Fee | Net/Credit |
|------|-------|------------|------------|------------|
| 5 credits | $10 | $2.00 | 5.9% | $1.41 |
| 15 credits | $25 | $1.67 | 4.1% | $1.30 |

### Cost Per Enhancement

| Component | Est. Cost |
|-----------|-----------|
| Claude API (agent) | $0.05-0.15 |
| Apollo API (contacts) | $0.10-0.20 |
| Web searches | ~$0.01 |
| **Total** | **~$0.20-0.35** |

---

## User Flow

```
User clicks filing → Modal opens → "Enhance" button visible
    ↓
Click "Enhance" → Check credits/Pro status
    ↓
If no credits → Show credit purchase modal
    ↓
If has credits → Show "Researching [Company]..." (30-60 sec)
    ↓
Agent completes → Cache result → Display tearsheet → Decrement credits
    ↓
Future views of same company → Show cached tearsheet (free)
```

---

## Database Schema

### New Tables

```sql
-- Cached enhancement results (by normalized company_id)
CREATE TABLE company_enhancements (
    company_id INTEGER PRIMARY KEY,
    website_url TEXT,
    website_confidence TEXT,
    contacts TEXT,              -- JSON: [{name, title, email, linkedin}]
    social_links TEXT,          -- JSON: {linkedin, twitter, instagram}
    news TEXT,                  -- JSON: [{title, date, url, summary}]
    filing_stats TEXT,          -- JSON: {first_filing, total, last_12_mo, trend}
    distribution_states TEXT,   -- JSON: ["TN", "CA", ...]
    brand_portfolio TEXT,       -- JSON: ["Brand1", "Brand2", ...]
    category_breakdown TEXT,    -- JSON: {BWN: 45, DSS: 23, ...}
    summary TEXT,               -- AI-generated 2-3 sentence summary
    tearsheet_html TEXT,        -- Pre-rendered HTML for fast display
    enhanced_at TEXT,
    enhanced_by TEXT,           -- Email of user who triggered
    expires_at TEXT             -- Re-enhance after 90 days
);

-- Enhancement credit transactions
CREATE TABLE enhancement_credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    type TEXT NOT NULL,         -- 'purchase', 'monthly_grant', 'used', 'expired'
    amount INTEGER NOT NULL,    -- Positive for grants, negative for usage
    balance_after INTEGER,
    stripe_payment_id TEXT,     -- For purchases
    company_id INTEGER,         -- For usage (which company was enhanced)
    created_at TEXT DEFAULT (datetime('now'))
);

-- Index for fast balance lookups
CREATE INDEX idx_credits_email ON enhancement_credits(email);
```

### Alterations to Existing Tables

```sql
-- Add credit balance cache to user_preferences for fast reads
ALTER TABLE user_preferences ADD COLUMN enhancement_credits INTEGER DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN monthly_enhancements_used INTEGER DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN monthly_reset_date TEXT;
```

---

## API Endpoints

### POST /api/enhance

Trigger enhancement for a company.

**Request:**
```json
{
  "company_id": 12345,
  "company_name": "Sugarlands Distilling Company"
}
```

**Response (cached exists):**
```json
{
  "status": "complete",
  "cached": true,
  "tearsheet": { ... }
}
```

**Response (processing):**
```json
{
  "status": "processing",
  "job_id": "enh_abc123",
  "estimated_seconds": 45
}
```

**Response (no credits):**
```json
{
  "status": "payment_required",
  "credits_needed": 1,
  "user_credits": 0
}
```

### GET /api/enhance/:job_id

Poll for enhancement completion.

**Response:**
```json
{
  "status": "complete",
  "tearsheet": { ... }
}
```
or
```json
{
  "status": "processing",
  "progress": "Searching for contacts..."
}
```

### GET /api/credits

Get user's current credit balance.

**Response:**
```json
{
  "credits": 12,
  "is_pro": true,
  "monthly_used": 3,
  "monthly_limit": 15
}
```

### POST /api/credits/purchase

Create Stripe checkout for credit pack.

**Request:**
```json
{
  "pack": "5_credits"
}
```

**Response:**
```json
{
  "checkout_url": "https://checkout.stripe.com/..."
}
```

---

## Enhancement Agent Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     ENHANCEMENT AGENT                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  INPUT:                                                           │
│    - company_id (normalized)                                      │
│    - company_name                                                 │
│    - existing filings from D1                                     │
│                                                                   │
│  STEP 1: Parallel Web Searches                                    │
│    ├─► "[Company] official website beverage alcohol"              │
│    ├─► "[Company] wine/spirits/beer news 2026"                    │
│    └─► "[Company] linkedin company page"                          │
│                                                                   │
│  STEP 2: Contact Enrichment (Apollo API)                          │
│    └─► Domain lookup → Find decision makers                       │
│        - CEO, President, Owner                                    │
│        - VP Sales, Sales Director                                 │
│        - VP Marketing, Brand Manager                              │
│                                                                   │
│  STEP 3: D1 Analytics (parallel queries)                          │
│    ├─► First filing date, total filing count                      │
│    ├─► Last 12 months filing count + trend                        │
│    ├─► States filed in (from state column)                        │
│    ├─► Categories filed in (class_type_code breakdown)            │
│    └─► Brand portfolio (distinct brand_names)                     │
│                                                                   │
│  STEP 4: AI Synthesis                                             │
│    └─► Generate 2-3 sentence company summary                      │
│    └─► Identify business focus (domestic/import, categories)      │
│    └─► Flag notable patterns (rapid growth, new entrant, etc.)    │
│                                                                   │
│  OUTPUT: Structured JSON + Pre-rendered HTML tearsheet            │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Tearsheet Schema

```json
{
  "company_id": 12345,
  "company_name": "Sugarlands Distilling Company",
  "enhanced_at": "2026-01-11T20:30:00Z",

  "website": {
    "url": "https://sugarlands.com",
    "confidence": "high"
  },

  "summary": "Tennessee-based craft distillery founded in 2014, specializing in moonshine and flavored whiskeys. Rapid growth with 247 total filings, expanding distribution to 12 states.",

  "contacts": [
    {
      "name": "Ned Vickers",
      "title": "CEO & Co-Founder",
      "email": "ned@sugarlands.com",
      "linkedin": "https://linkedin.com/in/nedvickers",
      "source": "apollo"
    },
    {
      "name": "John Smith",
      "title": "VP National Sales",
      "email": "john.smith@sugarlands.com",
      "linkedin": null,
      "source": "apollo"
    }
  ],

  "social": {
    "linkedin": "https://linkedin.com/company/sugarlands-distilling",
    "instagram": "https://instagram.com/sugarlands",
    "twitter": null,
    "facebook": "https://facebook.com/sugarlandsdistilling"
  },

  "filing_stats": {
    "first_filing": "2014-03-15",
    "total_filings": 247,
    "last_12_months": 34,
    "last_month": 3,
    "trend": "stable",
    "trend_detail": "+5% vs prior 12 months"
  },

  "distribution": {
    "states": ["TN", "GA", "FL", "TX", "CA", "NY", "IL", "NC", "SC", "KY", "VA", "OH"],
    "primary_state": "TN",
    "national_reach": false
  },

  "brands": [
    {"name": "SUGARLANDS SHINE", "filings": 89},
    {"name": "ROAMING MAN", "filings": 45},
    {"name": "HIGH WIRE", "filings": 23},
    {"name": "APPALACHIAN SIPPIN CREAM", "filings": 67}
  ],

  "categories": {
    "DSS": {"name": "Distilled Spirits Specialty", "count": 156, "pct": 63},
    "WHL": {"name": "Whisky", "count": 67, "pct": 27},
    "RUM": {"name": "Rum", "count": 24, "pct": 10}
  },

  "news": [
    {
      "title": "Sugarlands Distilling Expands to West Coast Markets",
      "source": "Beverage Industry News",
      "date": "2026-01-05",
      "url": "https://...",
      "summary": "Tennessee distillery announces distribution partnerships in California and Oregon."
    }
  ],

  "insights": [
    "High filing velocity suggests active product development",
    "Strong regional presence in Southeast, expanding nationally",
    "Focus on flavored spirits and specialty categories"
  ]
}
```

---

## Frontend Components

### Enhance Button (in modal)

```html
<div class="enhance-section">
  <!-- Before enhancement -->
  <button onclick="enhanceCompany(companyId)" class="enhance-btn">
    <span class="enhance-icon">&#9733;</span>
    Enhance Company
    <span class="enhance-cost">(1 credit)</span>
  </button>

  <!-- During enhancement -->
  <div class="enhance-loading" style="display:none">
    <div class="spinner"></div>
    <p>Researching Sugarlands Distilling...</p>
    <p class="enhance-substatus">Finding website...</p>
  </div>

  <!-- After enhancement -->
  <div class="tearsheet" style="display:none">
    <!-- Rendered tearsheet HTML -->
  </div>
</div>
```

### Credit Purchase Modal

```html
<div class="credit-modal">
  <h3>Purchase Enhancement Credits</h3>
  <p>Get detailed company tearsheets with contacts, news, and analytics.</p>

  <div class="credit-options">
    <button onclick="purchaseCredits('5_credits')" class="credit-option">
      <span class="credits">5 credits</span>
      <span class="price">$10</span>
      <span class="per-credit">$2.00 each</span>
    </button>

    <button onclick="purchaseCredits('15_credits')" class="credit-option popular">
      <span class="badge">Best Value</span>
      <span class="credits">15 credits</span>
      <span class="price">$25</span>
      <span class="per-credit">$1.67 each</span>
    </button>
  </div>

  <p class="pro-upsell">
    Or upgrade to <a href="/pricing">Pro ($79/mo)</a> for 15 credits/month included
  </p>
</div>
```

### Tearsheet Display

```html
<div class="tearsheet">
  <div class="tearsheet-header">
    <h3>Sugarlands Distilling Company</h3>
    <a href="https://sugarlands.com" target="_blank">sugarlands.com</a>
    <div class="social-links">
      <a href="..." class="social-linkedin">LinkedIn</a>
      <a href="..." class="social-instagram">Instagram</a>
    </div>
  </div>

  <p class="tearsheet-summary">
    Tennessee-based craft distillery founded in 2014...
  </p>

  <div class="tearsheet-section contacts">
    <h4>Key Contacts</h4>
    <div class="contact">
      <strong>Ned Vickers</strong> - CEO & Co-Founder
      <a href="mailto:ned@sugarlands.com">ned@sugarlands.com</a>
    </div>
    ...
  </div>

  <div class="tearsheet-section stats">
    <h4>Filing Activity</h4>
    <div class="stat-grid">
      <div class="stat">
        <span class="stat-value">247</span>
        <span class="stat-label">Total Filings</span>
      </div>
      <div class="stat">
        <span class="stat-value">34</span>
        <span class="stat-label">Last 12 Months</span>
      </div>
      <div class="stat">
        <span class="stat-value trend-up">+5%</span>
        <span class="stat-label">Trend</span>
      </div>
    </div>
  </div>

  <div class="tearsheet-section distribution">
    <h4>Distribution</h4>
    <div class="state-map">TN, GA, FL, TX, CA, NY...</div>
  </div>

  <div class="tearsheet-section news">
    <h4>Recent News</h4>
    <div class="news-item">
      <a href="...">Sugarlands Expands to West Coast</a>
      <span class="news-date">Jan 5, 2026</span>
    </div>
  </div>
</div>
```

---

## Implementation Phases

### Phase 1: Core MVP (Week 1)

**Goal:** Working enhancement with website + filing stats only

- [ ] Create `company_enhancements` table
- [ ] Create `enhancement_credits` table
- [ ] Add credit columns to `user_preferences`
- [ ] Build `/api/enhance` endpoint (sync, no queue)
- [ ] Build basic enhancement agent (website search + D1 stats)
- [ ] Add Enhance button to modal
- [ ] Display basic tearsheet
- [ ] Pro users only, 5 free/month (no payment yet)

### Phase 2: Contact Enrichment (Week 2)

**Goal:** Add Apollo API integration for contacts

- [ ] Set up Apollo API account
- [ ] Add contact lookup to enhancement agent
- [ ] Display contacts in tearsheet
- [ ] Handle missing/incomplete contact data gracefully

### Phase 3: News & Social (Week 3)

**Goal:** Complete tearsheet with news and social links

- [ ] Add news search to agent
- [ ] Add social link discovery
- [ ] AI-generated summary and insights
- [ ] Polish tearsheet UI

### Phase 4: Payment Integration (Week 4)

**Goal:** Credit purchase system for free users

- [ ] Create Stripe products for credit packs
- [ ] Build `/api/credits/purchase` endpoint
- [ ] Handle Stripe webhook for successful purchase
- [ ] Build credit purchase modal
- [ ] Track credit usage and balance

### Phase 5: Polish & Scale

- [ ] Add job queue for async processing (if needed)
- [ ] Implement 90-day cache expiry + re-enhancement
- [ ] Add enhancement analytics dashboard
- [ ] Rate limiting and abuse prevention

---

## Stripe Products to Create

| Product | Price ID | Amount |
|---------|----------|--------|
| 5 Enhancement Credits | price_5credits | $10.00 |
| 15 Enhancement Credits | price_15credits | $25.00 |

---

## Environment Variables to Add

```
APOLLO_API_KEY=           # For contact enrichment
```

---

## Success Metrics

- Enhancement completion rate (target: >95%)
- Average enhancement time (target: <60 sec)
- Credit purchase conversion rate
- Pro upgrade rate from credit purchasers
- Cache hit rate (enhancements served from cache)

---

## Deprecation of Manual Enrichment

Once Phase 1 is live:
1. Stop running `/enrich-brands` manually
2. Keep existing `brand_websites` data (will be migrated to `company_enhancements`)
3. Remove enrichment progress tracking files

The on-demand system replaces all manual enrichment work.
