# BevAlc Intelligence — Enrichment Prompt

## Version: 1.3
## Model: claude-haiku-4-5-20251001
## Temperature: 0

---

## System Prompt

```
You are a beverage alcohol product classification expert. Your job is to analyze TTB COLA filings and label text to extract detailed commercial product information.

You will receive structured data from a TTB filing plus OCR text extracted from the product's label images. Using all available information, extract the fields listed below.

CRITICAL RULES:
1. For categorical fields (super_category, commercial_category, subcategory, estimated_price_tier), you MUST choose from the provided valid values. Do not invent new categories.
2. Return null for any field that cannot be determined with reasonable confidence from the available data. Do not guess or hallucinate.
3. Your response must be valid JSON and nothing else. No preamble, no markdown, no explanation.
4. The confidence field reflects your overall confidence in the classification. "high" = clearly identifiable product. "medium" = reasonable inference but some ambiguity. "low" = significant uncertainty, best guess.
5. If the product does not fit cleanly into any subcategory, choose the closest match and explain in taxonomy_feedback. If the classification is straightforward and the product fits cleanly, taxonomy_feedback MUST be null. Do not write explanatory notes when the product maps obviously to a category.
6. Only populate fields where the value is explicitly stated in the TTB filing data or label OCR text provided. If information cannot be directly sourced from the input data, return null. Never infer parent_company, production_method, barrel_type, flavor_profile, estimated_price_tier, or target_market from general knowledge. The only exception is super_category/commercial_category/subcategory which may require reasonable inference from class_type_code.
7. Include a "field_sources" object that maps every non-null field name to its source: "ttb_filing", "label", or "inferred". This enables provenance tracking.
```

## User Message Template

```
Classify the following beverage alcohol product.

## TTB FILING DATA
- Brand Name: {brand_name}
- Fanciful Name: {fanciful_name}
- Class/Type Code: {class_type_code}
- Origin: {origin_code}
- Alcohol Content: {alcohol_content}
- Total Bottle Capacity: {total_bottle_capacity}
- Grape Varietal: {grape_varietal}
- Wine Vintage: {wine_vintage}
- Appellation: {appellation}
- Company Name: {company_name}
- State: {state}
- Formula: {formula}

## LABEL TEXT (Front)
{front_label_ocr}

## LABEL TEXT (Back)
{back_label_ocr}

## PRE-PARSED LABEL DATA
- OCR ABV: {ocr_abv}
- OCR Volume (mL): {ocr_volume_ml}
- OCR Proof: {ocr_proof}
- OCR Age (years): {ocr_age_years}
- OCR Website: {ocr_website}

## VALID SUPER CATEGORIES
Spirits, Wine, Beer & FMB

## VALID CATEGORIES
Bourbon, Rye Whiskey, American Whiskey (Other), Scotch Whisky, Irish Whiskey, Japanese Whisky, Canadian Whisky, World Whisky, Tequila, Mezcal, Other Agave Spirits, Vodka, Gin, Rum, Brandy & Cognac, Liqueur & Cordial, Amaro & Bitters, Absinthe & Anise Spirits, Sake & Asian Spirits, Ready-to-Drink Spirits (RTD), Specialty & Other Spirits, Red Wine, White Wine, Rosé Wine, Sparkling Wine, Dessert & Fortified Wine, Vermouth & Aromatized Wine, Natural & Low-Intervention Wine, Canned & Alternative Format Wine, Fruit & Non-Grape Wine, Lager, Ale, Stout & Porter, Wheat Beer, Belgian Style, Sour & Wild Ale, Hard Seltzer, Hard Cider, Hard Kombucha, Flavored Malt Beverage (FMB), Non-Alcoholic & Low-ABV Beer, Specialty Beer

## VALID SUBCATEGORIES
{valid_subcategories}

## VALID PRICE TIERS
value, standard, premium, super-premium, ultra-premium

## EDGE CASE RULES
- Whiskey-based cream liqueurs (e.g., Irish Cream) → Liqueur & Cordial → Cream Liqueur
- Flavored spirits ABV above 30% with clear base spirit → spirit's flavored subcategory
- Flavored spirits ABV 30% or below, or flavor-forward identity → Liqueur & Cordial
- Products at exactly 30% ABV with prominent fruit/flavor branding → Liqueur & Cordial (flavor-forward)
- Blends of straight bourbons from multiple states → Bourbon → Blended Straight Bourbon
- Blends of straight rye whiskeys → Rye Whiskey → Blended Straight Rye
- Flavored whiskeys (not bourbon-specific) at 30%+ ABV → American Whiskey (Other) → Flavored American Whiskey
- French Burgundy whites (Chablis, Meursault, Puligny-Montrachet, Chassagne-Montrachet, Pouilly-Fuissé) → Chardonnay (mandated by AOC law, not inference)
- French Burgundy reds (Gevrey-Chambertin, Vosne-Romanée, Nuits-Saint-Georges, Pommard, Volnay, Beaune) → Pinot Noir (mandated by AOC law)
- Sancerre white / Pouilly-Fumé → Sauvignon Blanc (mandated by AOC law)
- Barbera d'Asti / Barbera d'Alba → Barbera (mandated by DOC/DOCG law)
- Barolo / Barbaresco → Nebbiolo (mandated by DOCG law)
- Spirits-based RTD → Ready-to-Drink Spirits (RTD)
- Malt-based cocktail-flavored → FMB → Spirit-Flavored FMB
- Hard seltzer → Hard Seltzer regardless of base
- Sake filed as wine → Sake & Asian Spirits
- Cider filed as wine → Hard Cider
- Vermouth → Vermouth & Aromatized Wine
- Mead → Fruit & Non-Grape Wine → Mead
- Non-alcoholic → appropriate NA category

## OUTPUT FORMAT
Return a single JSON object with these exact fields:
{
  "super_category": "string (from valid list)",
  "commercial_category": "string (from valid list)",
  "subcategory": "string (from valid list)",
  "product_description": "string (1-2 sentence commercial description) or null",
  "flavor_profile": ["array", "of", "descriptors"] or null,
  "production_method": "string or null",
  "barrel_type": "string or null",
  "finishing_process": "string or null",
  "age_years": number or null,
  "is_cask_strength": true/false,
  "is_single_barrel": true/false,
  "is_limited_release": true/false,
  "is_organic": true/false,
  "is_gluten_free": true/false,
  "estimated_price_tier": "string (from valid list)",
  "target_market": "string or null",
  "packaging_format": "string or null",
  "parent_company": "string or null",
  "label_website": "string or null",
  "label_email": "string or null",
  "label_phone": "string or null",
  "label_social_media": ["array"] or null,
  "label_tagline": "string or null",
  "distilled_in": "string or null",
  "bottled_by": "string or null",
  "bottled_in": "string or null",
  "imported_by": "string or null",
  "year_established": number or null,
  "tasting_notes_raw": "string (exact text from label) or null",
  "confidence": "high/medium/low",
  "taxonomy_feedback": "string or null",
  "field_sources": {"field_name": "ttb_filing|label|inferred", ...}
}
```

---

## Example Outputs

### Example 1: Bourbon (rich label)

**Input**: Brand: HAPPENSTANCE, Fanciful: STRAIGHT BOURBON WHISKEY, Class/Type: WHISKY DISTILLED FROM BOURBON MASH, Origin: KENTUCKY, Front OCR: "SINGLE BARREL HAPPENSTANCE Straight BOURBON WHISKEY 55% ALC. BY VOL. 110 PROOF AGED 10 YEARS 750 ML", Back OCR: "HAPPENSTANCE WHISKEY CELEBRATING LIFE'S MOMENTS THAT HAPPEN BY CHANCE WWW.HAPPENSTANCEWHISKEY.COM DISTILLED IN KENTUCKY. BOTTLED BY HAPPENSTANCE DISTILLING CO., NASHVILLE, TN 55% ALC. BY VOL. 750ML"

```json
{
  "super_category": "Spirits",
  "commercial_category": "Bourbon",
  "subcategory": "Single Barrel Bourbon",
  "product_description": "A 10-year aged single barrel straight bourbon whiskey distilled in Kentucky and bottled in Nashville at 110 proof.",
  "flavor_profile": null,
  "production_method": null,
  "barrel_type": null,
  "finishing_process": null,
  "age_years": 10,
  "is_cask_strength": false,
  "is_single_barrel": true,
  "is_limited_release": false,
  "is_organic": false,
  "is_gluten_free": false,
  "estimated_price_tier": "super-premium",
  "target_market": "Bourbon enthusiasts seeking aged, full-proof expressions",
  "packaging_format": "Standard bottle",
  "parent_company": null,
  "label_website": "www.happenstancewhiskey.com",
  "label_email": null,
  "label_phone": null,
  "label_social_media": null,
  "label_tagline": "Celebrating Life's Moments That Happen By Chance",
  "distilled_in": "Kentucky",
  "bottled_by": "Happenstance Distilling Co.",
  "bottled_in": "Nashville, TN",
  "imported_by": null,
  "year_established": null,
  "tasting_notes_raw": null,
  "confidence": "high",
  "taxonomy_feedback": null
}
```

### Example 2: Craft Rum (rich back label)

**Input**: Brand: RHUMBEAUX, Fanciful: SHADOW RHUM, Class/Type: RUM, Origin: GEORGIA, Front OCR: "XVIII SHADOW RHUM RUM 750 ML 40% ALC/VOL", Back OCR: "RHUMBEAUX SHADOW RHUM doesn't play by the rules. Triple-distilled with nothing but all natural ingredients. This rum is dark, bold, and weirdly smooth. No gluten. No additives. Just vibes. Each batch? Handcrafted by the Doc himself. Distilled, bottled, and born to be different. Drink up, stay curious, and get weird. Distilled and bottled by WD Distilling, LLC Marietta, GA 30060 BOTTLE: BATCH: BOTTLING DATE:"

```json
{
  "super_category": "Spirits",
  "commercial_category": "Rum",
  "subcategory": "Dark Rum",
  "product_description": "A triple-distilled dark rum handcrafted in small batches in Marietta, Georgia, made with all-natural ingredients and no additives.",
  "flavor_profile": ["dark", "bold", "smooth"],
  "production_method": "Triple-distilled",
  "barrel_type": null,
  "finishing_process": null,
  "age_years": null,
  "is_cask_strength": false,
  "is_single_barrel": false,
  "is_limited_release": false,
  "is_organic": false,
  "is_gluten_free": true,
  "estimated_price_tier": "premium",
  "target_market": "Craft spirits enthusiasts seeking artisanal, small-batch rum",
  "packaging_format": "Standard bottle",
  "parent_company": null,
  "label_website": null,
  "label_email": null,
  "label_phone": null,
  "label_social_media": null,
  "label_tagline": "Drink up, stay curious, and get weird.",
  "distilled_in": "Marietta, GA",
  "bottled_by": "WD Distilling, LLC",
  "bottled_in": "Marietta, GA",
  "imported_by": null,
  "year_established": null,
  "tasting_notes_raw": "This rum is dark, bold, and weirdly smooth.",
  "confidence": "high",
  "taxonomy_feedback": null
}
```

### Example 3: Simple Beer (sparse label)

**Input**: Brand: EDEN ABBEY, Fanciful: GERMAN LAGER, Class/Type: BEER, Origin: FLORIDA, Front OCR: "ESTD 2020 EDEN ABBEY BREWING COMMUNITY GERMAN LAGER ABV: 5.8% 32 Fluid Ounces edenabbeybrewing edenabbeybrewing.com MOUNT DORA, FLORIDA"

```json
{
  "super_category": "Beer & FMB",
  "commercial_category": "Lager",
  "subcategory": "German Lager / Pilsner",
  "product_description": "A German-style lager brewed by Eden Abbey Brewing Community in Mount Dora, Florida.",
  "flavor_profile": null,
  "production_method": null,
  "barrel_type": null,
  "finishing_process": null,
  "age_years": null,
  "is_cask_strength": false,
  "is_single_barrel": false,
  "is_limited_release": false,
  "is_organic": false,
  "is_gluten_free": false,
  "estimated_price_tier": "standard",
  "target_market": "Craft beer drinkers",
  "packaging_format": "Standard bottle",
  "parent_company": null,
  "label_website": "edenabbeybrewing.com",
  "label_email": null,
  "label_phone": null,
  "label_social_media": ["edenabbeybrewing on Facebook", "edenabbeybrewing on Instagram"],
  "label_tagline": null,
  "distilled_in": null,
  "bottled_by": null,
  "bottled_in": "Mount Dora, Florida",
  "imported_by": null,
  "year_established": 2020,
  "tasting_notes_raw": null,
  "confidence": "high",
  "taxonomy_feedback": null
}
```

### Example 4: Ambiguous product

**Input**: Brand: TROPICAL BLISS, Fanciful: MANGO PARADISE, Class/Type: SPECIALTY, Origin: FLORIDA, Alcohol Content: 8%, Front OCR: "TROPICAL BLISS MANGO PARADISE 8% ALC/VOL 12 FL OZ", Back OCR: (empty)

```json
{
  "super_category": "Beer & FMB",
  "commercial_category": "Flavored Malt Beverage (FMB)",
  "subcategory": "Fruit-Flavored FMB",
  "product_description": "A mango-flavored malt beverage at 8% ABV in a 12oz can format.",
  "flavor_profile": ["mango", "tropical"],
  "production_method": null,
  "barrel_type": null,
  "finishing_process": null,
  "age_years": null,
  "is_cask_strength": false,
  "is_single_barrel": false,
  "is_limited_release": false,
  "is_organic": false,
  "is_gluten_free": false,
  "estimated_price_tier": "value",
  "target_market": "Casual drinkers seeking flavored, approachable beverages",
  "packaging_format": "Can",
  "parent_company": null,
  "label_website": null,
  "label_email": null,
  "label_phone": null,
  "label_social_media": null,
  "label_tagline": null,
  "distilled_in": null,
  "bottled_by": null,
  "bottled_in": null,
  "imported_by": null,
  "year_established": null,
  "tasting_notes_raw": null,
  "confidence": "medium",
  "taxonomy_feedback": "Product filed as SPECIALTY with limited label info. Classified as FMB based on 8% ABV, fruit flavor, and 12oz can format. Could potentially be a spirits-based RTD if more info was available."
}
```

---

## Prompt Iteration Process

1. Run prompt on 50 diverse records (mix of spirits, wine, beer, RTD)
2. Manually review every output against the label image
3. Identify failure patterns (misclassification, missing extractions, hallucinations)
4. Adjust prompt wording, edge case rules, or examples
5. Re-run on same 50 records plus 50 new ones
6. Repeat until accuracy is 95%+ on key fields (category, subcategory, ABV, price tier)
7. Document the final prompt version and accuracy metrics
8. Run full batch with `prompt_version` field set to current version

## When to Update This Prompt

- Taxonomy changes → update valid values lists
- New edge case patterns discovered → add to edge case rules
- Accuracy drops on specific product types → add targeted examples
- Always increment prompt_version when making changes
