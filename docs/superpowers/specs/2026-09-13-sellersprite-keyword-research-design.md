# SellerSprite keyword research design

Date: 2026-09-13

## Purpose

Replace model-led web keyword speculation with a small, data-backed workflow for individual Amazon sellers. SellerSprite Reverse ASIN and Keyword Mining exports become the preferred keyword source when supplied. The output improves Listing keyword placement and offers limited advertising suggestions without claiming to measure the full market.

## Scope

This change adds:

- read-only ingestion of SellerSprite `.xlsx` exports;
- normalized, deduplicated keyword grouping;
- a reusable keyword profile scoped by marketplace and purchase intent;
- direct use of those groups in the existing Listing brief;
- small advertising-start suggestions derived in the same pass.

It does not add a dashboard, database, advertising campaign manager, bid optimizer, sales forecast, market-size model, or automatic Amazon publishing. A Top 10 export must be labeled as a Top 10 sample, never as complete market analysis.

## Source roles

Source priority for keyword decisions is:

1. Current explicit user facts and product identity determine whether a phrase is applicable.
2. Current SellerSprite exports provide keyword demand, traffic, relevance, conversion, and competition signals.
3. A matching local keyword profile supplies reusable search language when no newer export is present.
4. Product links and web research provide market wording, common benefits, and context only.
5. Model suggestions fill small gaps and must not be presented as measured demand.

This priority applies only to keyword selection. It does not make competitor claims or SellerSprite phrases into product facts.

## Input detection

At intake, detect supported SellerSprite workbooks by their field structure rather than filename alone:

- Reverse ASIN: keyword plus ASIN traffic/ranking fields such as traffic share, organic rank, sponsored rank, monthly searches, purchases, purchase rate, SPR, title density, products, demand/supply, concentration, and PPC.
- Keyword Mining: keyword plus relevance and the shared demand/conversion/competition fields.

The parser reads values without modifying the source workbook. It records the source filename, marketplace, export date when available, detected report type, and imported row count. Garbled localized display labels must not corrupt English keyword values or numeric fields; unsupported or ambiguous layouts stop only spreadsheet ingestion and allow the ordinary low-confidence fallback.

## One-pass analysis

Normalize phrases for comparison by trimming, case folding, and collapsing whitespace. Preserve the original readable phrase for output. Merge duplicate phrases across reports and retain source-specific evidence rather than averaging unlike metrics.

Apply decisions in this order:

1. **Product fit:** reject phrases that conflict with the product identity, intended use, material, dimensions, claims, or compliance boundaries.
2. **Evidence strength:** use Reverse ASIN traffic share and ranking as evidence that a phrase actually drives exposure to the reference ASIN.
3. **Demand and buying signal:** compare monthly searches, purchases, and purchase rate.
4. **Opportunity tie-breakers:** use title density, SPR, products, demand/supply ratio, concentration, and PPC only to distinguish otherwise suitable phrases.

Do not calculate a universal opaque score. Missing metrics remain missing and do not become zero. Relevance is a relative Keyword Mining measure, so high relevance alone does not make a low-demand phrase a core term.

Each keyword receives one group:

- `core`: strongest product-fit and purchase-intent phrases for Title, Item Highlights, and priority Bullets;
- `supporting`: useful synonyms, use cases, and narrower phrases for remaining front-end copy;
- `backend`: relevant language that adds coverage after front-end deduplication;
- `excluded`: mismatched, unsupported, excessively broad, duplicative, or very weak phrases, with a short reason.

The analyzer produces a short decision summary, not a long market report.

## Listing integration

Extend the existing Listing brief with the four keyword groups and their evidence. Drafting keeps the current field priorities and applies these additions:

- Title uses the most important natural core phrase within the current character limit.
- Item Highlights and early Bullets use core purchase intent without repeating the Title mechanically.
- Remaining Bullets and Description use supporting terms only where they read naturally and match confirmed facts.
- Backend Search Terms use relevant uncovered terms after token-level front-end deduplication.
- Excluded terms cannot enter generated copy.

The existing single bounded Listing self-check also verifies keyword naturalness, product fit, and front/back-end duplication. It repairs only affected fields once and does not start a separate keyword-review or recursive polishing loop.

## Advertising suggestions

Advertising guidance is an optional by-product of the same analysis, limited to:

- `exact_candidates`: high-fit, high-intent core phrases;
- `phrase_candidates`: relevant phrases that can reasonably cover nearby searches;
- `cautious_tests`: broader, more competitive, expensive, or weaker-evidence phrases;
- `negative_candidates`: clearly mismatched meanings or unsupported product attributes.

Do not prescribe bids, budgets, campaign structure, expected sales, or profitability from a Top 10 sample. PPC, SPR, search volume, purchases, and purchase rate may explain placement, but every suggestion is labeled as a starting point based on the supplied sample.

## Storage and reuse

Keep source workbooks inside the product project's market-input area when the user wants them copied; otherwise record only their filenames and import metadata, not machine-specific absolute paths. Store the derived project result as `keyword-profile.json`.

A reusable copy lives under `library/keyword-profiles/<marketplace>/<intent-slug>.json`. This scope is deliberately separate from seller-family facts:

- seller family answers what the product is made from and which shared claims apply;
- keyword intent answers what shoppers call this particular product or use case.

For example, aluminum safety signs may share a seller family, while `slow-kids-at-play`, `hard-hat-required`, and `horse-crossing` remain different keyword intents.

The profile contains:

- schema version, marketplace, intent ID, source dates, report types, and row counts;
- `analysis_scope`, including `top_10_sample` when applicable;
- `market_size_complete: false` for partial exports;
- grouped keywords with original phrase, selected metrics, sources, and concise reason;
- compact advertising suggestions;
- generated and refreshed timestamps.

Reuse a profile when marketplace and purchase intent match and current product facts do not conflict. A newer supplied export refreshes the derived profile. No per-keyword user confirmation is required. Ask one question only when a potentially valuable phrase conflicts with ambiguous product identity or implies an unconfirmed attribute.

## Simplified runtime flow

1. Check for supplied SellerSprite exports.
2. If present, parse and analyze once.
3. Otherwise load a matching local keyword profile.
4. If neither exists, use links and web observations as a clearly lower-confidence fallback.
5. Pass one keyword profile into the existing Listing brief.
6. Draft the complete Listing and advertising-start suggestions together.
7. Run the existing one-pass Listing self-check and consolidated review.

Do not repeat web keyword research before Listing drafting, refresh data merely because a new draft was created, or ask the user to approve every keyword. Small Listing revisions reuse the current profile and validate only the changed field plus direct keyword dependencies.

## Failure behavior

- Missing workbook: continue with a matching profile or low-confidence fallback.
- Unsupported workbook layout: report the exact unsupported source and continue without claiming data-backed analysis.
- Missing metric: preserve null and use the remaining evidence.
- Conflicting duplicate metrics: retain both source observations and prefer the newer same-report export when dates are known.
- Product mismatch: exclude the keyword; do not weaken product facts to retain it.
- Stale profile: warn during drafting, but refresh only when the user supplies data or explicitly requests current research.

Keyword-analysis failure must not block image generation, Product Master work, or a fact-grounded Listing draft. It only prevents describing the keyword choices as SellerSprite-data-backed.

## Compatibility

Existing projects with only `market_language` remain valid. The Listing brief treats that list as low-confidence supporting/backend candidates until a keyword profile is available. No migration, reapproval, image rehash, or delivery rebuild occurs solely because this feature is installed.

## Verification

Use the two supplied Top 10 exports as fixtures or sanitized test inputs. Tests cover:

- report-type detection by columns;
- typed extraction of keywords and numeric metrics;
- deduplication across Reverse ASIN and Keyword Mining;
- product-fit exclusion before metric ranking;
- core/supporting/backend/excluded grouping without an opaque score;
- front-end/backend deduplication in the Listing brief;
- Top 10 and incomplete-market labels;
- bounded advertising groups without bids or forecasts;
- profile reuse by marketplace and intent, separate from seller-family matching;
- graceful fallback for missing or unsupported workbooks;
- unchanged behavior for existing `market_language` projects.
