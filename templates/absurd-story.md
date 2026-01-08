# Absurd Story Template

---
**Meta:**
- Target length: 150-300 words
- Tone: Playful, witty, self-aware
- Required: Real filing data, disclaimer
---

## Story Types

### Type 1: The Naming Committee

**Structure:**
1. Set the scene (meeting room, time elapsed)
2. Introduce the deadlock
3. The failed suggestions
4. The breakthrough moment
5. Resolution + filing reference

**Example:**

---

**The Naming Committee**

The conference room at [Company] had been booked for a one-hour brainstorming session. That was [X] hours ago.

[Describe the absurd state of affairs - empty coffee cups, exhausted team members, failed whiteboards]

"What about [word 1]?" offered [Role 1], [description of their state].

"Too [adjective]," said the CEO, shaking their head for the [Xth] time.

"[Word 2]?" tried [Role 2].

"Too [adjective]."

Then [the intern/the janitor/someone unlikely] spoke up. "[Word 3]."

[Describe the moment of realization]

*[Brand Name] - approved by TTB [Date].*

---

### Type 2: The Label Artist

**Structure:**
1. The brief arrives
2. The impossible requirements
3. The creative struggle
4. The accidental inspiration
5. The approval

**Example:**

---

**The Brief**

The email from marketing said simply: "Make it premium, but approachable. Sophisticated, but fun. Traditional, but innovative. Due Friday."

[Name], senior designer at [Company], stared at the brief. It was Wednesday.

[Describe the creative process going wrong]

At 4:47 AM on Friday, [he/she/they] accidentally [did something that created the solution].

[Company]'s newest label was approved by TTB on [Date]. [Name] still doesn't fully understand what happened.

---

### Type 3: The Approval Officer

**Structure:**
1. Introduce the officer and their experience
2. The routine day
3. The application that made them pause
4. The internal debate
5. The stamp

**Example:**

---

**Application #[TTB ID]**

In [X] years at TTB, [Name] had seen [X,000] applications. Most blurred together. But application #[TTB ID] made [him/her/them] pause.

"[Brand Name]," [he/she/they] read aloud. "[Fanciful Name]."

[Describe the officer's reaction]

The form was correct. The ingredients list checked out. There was technically no reason to reject it.

[Internal monologue about the absurdity of the name]

[He/She/They] stamped "APPROVED" and moved to the next file. Some questions, [he/she/they] had learned, were not worth asking.

*Filed by [Company], approved [Date].*

---

### Type 4: The Origin Story

**Structure:**
1. The unlikely beginning
2. The pivotal moment
3. The decision
4. The result

---

### Type 5: The Press Release

**Structure:** Satirical press release format

---

## Mandatory Elements

### Every Story Must Include:
1. **Real brand name** from D1
2. **Real company name** from D1
3. **Real approval date** from D1
4. **TTB ID** (optional but good for credibility)
5. **Disclaimer** at the end

### Disclaimer Templates:

**Standard:**
*This is a fictional story inspired by a real TTB filing. No actual meetings were harmed in its creation.*

**Playful:**
*Pure fiction. The real story is probably equally absurd, we just don't know it.*

**Professional:**
*This story is fictional and meant for entertainment. [Brand Name] is a real TTB-approved label filed by [Company].*

## Off-Limits Topics

- Alcohol abuse or addiction
- Named real individuals (CEOs, etc.)
- Anything defamatory
- Cultural insensitivity
- Stereotypes
- Actual company internal information
- Crude humor

## Social Post Format

**Twitter (280 chars max):**
"[Hook connecting to story] [Brand Name] - now TTB approved. [Date] [emoji]"

**Example:**
"The naming committee at Random Kentucky Distillery: 47 hours, infinite coffee, one perfect bourbon name. Midnight Peacock Reserve - TTB approved Jan 8. 🦚🥃"

## Finding Story-Worthy Brands

Good candidates:
- Long fanciful names (40+ characters)
- Unusual word combinations
- Category/name mismatches
- Very literal names
- Very abstract names
- Pop culture references
- Overly pretentious language
- Multiple adjectives

SQL to find candidates:
```sql
SELECT brand_name, fanciful_name, company_name, approval_date
FROM colas
WHERE approval_date >= date('now', '-7 days')
  AND (
    LENGTH(fanciful_name) > 40
    OR brand_name LIKE '%thunder%'
    OR brand_name LIKE '%legend%'
    OR brand_name LIKE '%ancient%'
    OR brand_name LIKE '%mystic%'
  )
LIMIT 20
```
