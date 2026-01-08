# /absurd-story

Generate a creative, humorous story based on real TTB filing data.

## Description
Creates entertaining short fiction inspired by actual brand names and COLA filings. The stories imagine fictional scenarios behind real filing data while maintaining a playful, industry-aware tone.

## Usage
```
/absurd-story
/absurd-story "Sunset Thunder Vodka"
/absurd-story --type naming-committee
/absurd-story --random --count 3
```

## Arguments
| Argument | Description |
|----------|-------------|
| `brand-name` | Specific brand to write about (optional) |

## Options
| Flag | Description |
|------|-------------|
| `--type` | Story type (see types below) |
| `--random` | Pick random interesting brand from D1 |
| `--count N` | Generate N stories (default: 1) |
| `--week` | Only use brands from this week's filings |

## Story Types

### 1. `naming-committee`
Imagine the meeting where the brand name was decided.
> "The conference room had been booked for an hour. It was now hour 47..."

### 2. `label-artist`
Imagine the designer creating the label artwork.
> "The brief said 'premium but approachable.' Sarah stared at her screen..."

### 3. `approval-officer`
Imagine the TTB officer reviewing the application.
> "Dave had seen 47,000 applications in his career. This one made him pause..."

### 4. `origin-story`
Fictional origin for how the product came to be.
> "It started with a bet at a family reunion..."

### 5. `press-release`
Satirical press release for the filing.
> "FOR IMMEDIATE RELEASE: Industry disrupted by bold naming choice..."

## Finding Story-Worthy Filings

The story-writer agent looks for:

### Unusual Names
```sql
SELECT brand_name, fanciful_name, company_name
FROM colas
WHERE approval_date >= date('now', '-7 days')
AND (
  LENGTH(fanciful_name) > 40
  OR brand_name LIKE '%thunder%'
  OR brand_name LIKE '%midnight%'
  OR brand_name LIKE '%legend%'
)
```

### Unexpected Combinations
```sql
SELECT brand_name, class_type_code
FROM colas
WHERE (brand_name LIKE '%wine%' AND class_type_code LIKE '%BEER%')
   OR (brand_name LIKE '%bourbon%' AND class_type_code LIKE '%VODKA%')
```

### Long Fanciful Names
```sql
SELECT brand_name, fanciful_name
FROM colas
WHERE LENGTH(fanciful_name) > 50
ORDER BY LENGTH(fanciful_name) DESC
LIMIT 10
```

## Output Format

```json
{
  "story_id": "story-2026-01-11-001",
  "story_type": "naming_committee",
  "source_filing": {
    "ttb_id": "26001234567",
    "brand_name": "Sunset Thunder Vodka",
    "fanciful_name": "Ultra Premium Reserve Expression",
    "company_name": "New Age Spirits LLC",
    "class_type_code": "VODKA",
    "approval_date": "01/08/2026"
  },
  "story": {
    "title": "The Perfect Storm",
    "body": "The board at New Age Spirits had been deadlocked for three hours...\n\n[Full story text]",
    "word_count": 287
  },
  "disclaimer": "This is a fictional story inspired by a real TTB filing. No actual meetings were harmed in its creation.",
  "social_posts": {
    "twitter": "The story behind every TTB filing: Sunset Thunder Vodka (approved 01/08/2026) - when nature names your vodka for you. 🌅⚡",
    "linkedin": null
  },
  "seo_link": "/brand/sunset-thunder-vodka"
}
```

## Example Session

```
User: /absurd-story --random

Claude: Finding an interesting brand from recent filings...

**Found:** Midnight Peacock Reserve Bourbon
**Filed by:** Random Kentucky Distillery LLC
**Approved:** January 8, 2026

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**The Naming Committee**

The conference room at Random Kentucky Distillery had been booked
for a one-hour brainstorming session. That was 47 hours ago.

Empty coffee cups formed a skyline on the table. Jenkins from
Marketing had stopped blinking sometime around hour 23. Sandra
from Brand Strategy was now communicating exclusively through
hand gestures.

"What about... Midnight?" offered Jenkins, his voice hoarse.

"Too dark," said the CEO, shaking his head for the 200th time.

"Peacock?" tried Sandra, miming feathers.

"Too... bird." The CEO frowned.

The intern, who had been silent for 31 hours, suddenly spoke up.
"Reserve?"

Silence fell. Everyone turned to look at each other.

Then, in perfect unison: "All three."

*Midnight Peacock Reserve Bourbon - approved by TTB January 8, 2026.*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Disclaimer:** This is a fictional story inspired by a real TTB
filing. No actual meetings were harmed in its creation.

📱 **Social Post:**
"The naming committee at Random Kentucky Distillery: 47 hours,
infinite coffee, one perfect bourbon name. Midnight Peacock Reserve -
now TTB approved. 🦚🥃"

→ View filing: /brand/midnight-peacock-reserve-bourbon
→ Saved to: content-queue/stories-2026-01-11.json
```

## Guidelines

### What's OK
- Playful imagination of meetings, processes
- Light industry satire
- Celebrating creative naming
- Self-aware humor

### Off-Limits
- Alcohol abuse/addiction references
- Named individuals
- Anything defamatory
- Cultural insensitivity
- Actual company internal information

## Related Commands
- `/weekly-content` - Includes story generation
- `/company-spotlight` - More serious company content
