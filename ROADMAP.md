# BevAlc Intelligence - Roadmap

## Next Up

### People Data Labs Integration (Contacts)

**Goal:** Add contact enrichment to Enhancement tearsheets and Permits page.

**Why People Data Labs (not Apollo.io):**
- Developer/API-first (Apollo requires $119/mo Organization plan for API)
- Only charges for successful matches
- $0.20-0.28 per contact, drops with volume
- Built for embedding in products (our use case)

**API:**
```
GET https://api.peopledatalabs.com/v5/person/enrich
Headers: X-Api-Key: YOUR_API_KEY
Params: company, name, email, or LinkedIn URL
Returns: name, job_title, work_email, phone_numbers, linkedin_url, location
```

**Flow:**
```
Enhancement (existing)          Permits Page (new)
        │                              │
        ▼                              ▼
┌─────────────────┐           ┌─────────────────┐
│ Find website    │           │ User clicks     │
│ via Google CSE  │           │ "Get Contacts"  │
└────────┬────────┘           └────────┬────────┘
         │                             │
         ▼                             ▼
┌─────────────────────────────────────────────────┐
│        People Data Labs API                      │
│  Search by company name + domain                 │
│  Returns: name, title, email, phone, LinkedIn    │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ Cache in D1     │
│ (90-day TTL)    │
└─────────────────┘
```

**Credit System:**
| User Type | Contacts Included | Can Buy More |
|-----------|-------------------|--------------|
| Free      | 0                 | No           |
| Pro       | 5/month           | Yes (packs)  |
| Packs     | TBD pricing       | 10/$X, 25/$Y |

**Decisions Needed:**
- [ ] How many contacts per company lookup? (top 3? top 5?)
- [ ] Which titles to prioritize? (CEO, VP Sales, Marketing Director?)
- [ ] Credit pack pricing

**Prerequisites:**
- [ ] Sign up for People Data Labs (requires work email)
- [ ] Get API key
- [ ] Pro plan is $98/mo for 350 lookups

**Implementation:**
- [ ] Add `company_contacts` table to D1 schema
- [ ] Add People Data Labs API integration to worker.js
- [ ] Update Enhancement tearsheet to include contacts
- [ ] Add "Get Contacts" button to Permits page
- [ ] Add contact credits to user_preferences
- [ ] Add credit pack checkout flow

---

### Fix Google CSE Quota - DONE

**Problem:** 100 searches/day free tier limits Enhancement feature to ~50 companies/day.

**Solution:** Cache search results in D1 with 30-day TTL.

**Implementation (completed 2026-01-22):**
- [x] Add `search_cache` table to D1
- [x] Check cache before calling Google CSE
- [x] Store results with 30-day TTL
- [ ] (Later) Upgrade Google CSE plan if needed

---

## Backlog

### Infrastructure Improvements (Low Priority at <1K users)
- [ ] Add retry logic to GitHub Actions workflows
- [ ] Add token expiration to user_preferences
- [ ] Parallelize precompute_category_stats.py

### Future Features
- [ ] Real-time filing alerts (webhooks instead of daily email)
- [ ] Company comparison tool
- [ ] Trend analysis dashboard

---

## Completed

### Google CSE Caching (2026-01-22)
- Added `search_cache` table to D1
- Modified `googleSearch()` in worker.js to check cache first
- Results cached with 30-day TTL
- Repeat searches for same company = 0 API calls

