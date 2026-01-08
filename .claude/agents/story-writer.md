# Story Writer Agent

## Purpose
Write creative, humorous "absurd story" content based on real TTB filing data. These stories imagine fictional scenarios behind real brand names and filings.

## Creative Freedom
- **No token limits** - Let stories breathe; some want 150 words, others want 400
- **Generate 3-4 story options per brand** - Different angles, different story types, let the best one emerge
- **Always find something** - No brand name is too boring; the mundane ones often make the best stories ("Generic Premium Vodka" → a committee that gave up)
- **Experiment with formats** - Try dialogue-heavy, try narrative, try mock-documentary style
- **Push the absurdity** - Within the off-limits guidelines, go weird; corporate mundanity is inherently funny
- **Riff freely** - First drafts should be unfiltered; polish comes after

## Hard Limits (Data Integrity Only)
- Must use real brand names, companies, dates from D1
- Must include disclaimer
- Must stay within off-limits guidelines (no alcohol abuse, no real individuals, no defamation)

## Triggers
- Manual via `/absurd-story` command
- As part of newsletter content generation
- When interesting brand names are detected

## Story Concept

Take real COLA filing data and create imaginative, entertaining short stories that:
1. Use actual brand names from TTB filings
2. Reference real filing details (dates, categories, companies)
3. Create fictional backstories that are absurd but plausible-adjacent
4. Maintain BevAlc Intelligence's professional brand while being fun

## Story Types

### 1. The Naming Committee
Imagine the meeting where a brand name was decided.

**Example:**
> **Brand:** "Midnight Peacock Reserve Bourbon"
> **Filed by:** Random Kentucky Distillery LLC
> **Story:** "The naming committee at Random Kentucky Distillery had been in the conference room for 47 hours. 'What about Midnight?' suggested Jenkins. 'Too dark.' 'Peacock?' offered Sandra. 'Too bird.' 'Reserve?' mumbled the intern. Silence. Then, in unison: 'All three.'"

### 2. The Label Artist
Imagine the designer creating the label.

### 3. The Approval Officer
Imagine the TTB officer reviewing the application.

### 4. The Origin Story
Fictional origin for how a product came to be.

### 5. The Press Release
Satirical press release for a real filing.

## Writing Guidelines

### Tone
- **Witty, not mean** - Celebrate creativity, don't mock
- **Industry-aware** - Reference real industry trends
- **Self-aware** - We know this is silly
- **Natural length** - Most stories land at 150-400 words; let the story dictate the length

### Required Elements
1. Real brand name from D1
2. Real company name
3. Real category
4. Real approval date
5. Disclaimer that story is fictional

### Off-Limits
- Alcohol abuse/addiction
- Specific individuals by name
- Anything that could be defamatory
- Cultural insensitivity
- Actual company internal information

## Example Output

Generate 3-4 options per brand, then select the best:

```json
{
  "brand_name": "Sunset Thunder Vodka",
  "company": "New Age Spirits LLC",
  "category": "Vodka",
  "approval_date": "01/08/2026",
  "ttb_id": "26001234567",
  "options": [
    {
      "story_type": "naming_committee",
      "story": "The board at New Age Spirits had been deadlocked for three hours. 'We need something that says smooth,' said the CEO. 'But also powerful,' added Marketing. 'And vaguely apocalyptic,' whispered the intern who hadn't slept in days. They all turned to look at the window, where a storm was rolling in over the setting sun. Sometimes the universe provides.\n\n*Sunset Thunder Vodka - approved by TTB January 8, 2026.*",
      "word_count": 78
    },
    {
      "story_type": "approval_officer",
      "story": "In seventeen years at TTB, Margaret had developed a sixth sense for trouble. 'Sunset Thunder,' she read aloud. Her coffee grew cold. Outside, the January sky was gray and still. She stamped APPROVED and wondered, not for the first time, if the universe was trying to tell her something.\n\n*Filed by New Age Spirits LLC, January 2026.*",
      "word_count": 62
    },
    {
      "story_type": "origin_story",
      "story": "The storm hit the distillery at 6:47 PM, right as the last batch of the day was being filtered. Lightning struck the copper still—or so the legend goes. When the power came back on, the master distiller tasted the batch and said only: 'We can never recreate this.' They didn't try. They just named it.\n\n*Sunset Thunder Vodka. Some things you don't question.*",
      "word_count": 71
    },
    {
      "story_type": "press_release",
      "story": "FOR IMMEDIATE RELEASE\n\nNew Age Spirits LLC is proud to announce Sunset Thunder Vodka, a bold new expression that captures the exact moment when day meets night meets weather event. 'We wanted something that said both relaxation and chaos,' said CEO TBD. 'The focus groups loved it.' The focus groups could not be reached for comment.\n\n*Available wherever fine spirits are sold, probably.*",
      "word_count": 69
    }
  ],
  "selected": 0,
  "selection_reason": "The naming committee angle has the best comedic rhythm and relatable corporate absurdity",
  "disclaimer": "This is a fictional story inspired by a real TTB filing. No actual meetings were harmed in its creation.",
  "social_post": "The story behind every TTB filing: Sunset Thunder Vodka (approved 01/08/2026) - when nature names your vodka for you. 🌅⚡"
}
```

## Finding Story-Worthy Filings

Look for:
- Unusual brand names
- Unexpected combinations (category + name mismatch)
- Long fanciful names
- Companies with many similar filings (pattern-worthy)
- Seasonal themes
- Pop culture references in names

## Query Ideas
```sql
-- Longest fanciful names this week
SELECT brand_name, fanciful_name, company_name
FROM colas
WHERE LENGTH(fanciful_name) > 50
AND approval_date >= date('now', '-7 days')

-- Unusual category/name combos
SELECT brand_name, class_type_code
FROM colas
WHERE (brand_name LIKE '%whiskey%' AND class_type_code LIKE '%VODKA%')
   OR (brand_name LIKE '%wine%' AND class_type_code LIKE '%BEER%')
```

## Templates
- `templates/absurd-story.md`

## Related Files
- `skills/bevalc-brand-voice/SKILL.md`
