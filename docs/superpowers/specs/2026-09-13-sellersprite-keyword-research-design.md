# SellerSprite keyword research design

Date: 2026-09-13

## Purpose

Replace model-led web keyword speculation with a small, data-backed workflow for individual Amazon sellers. SellerSprite Reverse ASIN and Keyword Mining exports become the preferred keyword source when supplied. The output improves Listing keyword placement and offers limited advertising suggestions without claiming to measure the full market.

## Scope

This change adds:

- read-only ingestion of SellerSprite `.xlsx` exports;
- normalized, deduplicated keyword grouping;
- a reusable keyword profile scoped by marketplace, locale, product type, and purchase intent;
- direct use of those groups in the existing Listing brief;
- small advertising-start suggestions derived in the same pass.

It does not add a dashboard, database, advertising campaign manager, bid optimizer, sales forecast, market-size model, or automatic Amazon publishing. A Top 10 export must be labeled as a Top 10 sample, never as complete market analysis.

## Source roles

Source priority for keyword decisions is:

1. Current explicit user facts and product identity determine whether a phrase is applicable.
2. Current SellerSprite exports provide vendor-reported or estimated keyword demand, association, relevance, purchase, and competition signals for their recorded export context.
3. A matching local keyword profile supplies reusable search language when no newer export is present.
4. Product links and web research provide market wording, common benefits, and context only.
5. Model suggestions fill small gaps and must not be presented as measured demand.

This priority applies only to keyword selection. It does not make competitor claims or SellerSprite phrases into product facts.

## Input detection

At intake, detect the two supported SellerSprite workbook types by mandatory field signatures rather than filename alone. The first version supports the supplied English-keyword exports and known Chinese/English display-label aliases; it is not a generic spreadsheet or multilingual import system.

- Reverse ASIN requires keyword, traffic share, organic or sponsored rank, and monthly searches; it may additionally read purchases, purchase rate, SPR, title density, products, demand/supply, concentration, and PPC.
- Keyword Mining requires keyword, relevance, and monthly searches; it may additionally read purchases, purchase rate, SPR, title density, products, demand/supply, concentration, and PPC.

Use the first visible data sheet whose normalized headers satisfy exactly one report signature. Reordered known columns are acceptable. Duplicate mandatory headers, ambiguous report signatures, or unsupported labels make that workbook unsupported. Skip a row whose mandatory numeric values are malformed, formulas lack cached values, or mandatory cells contain errors, and record the skipped-row count. Optional malformed fields remain null. The workbook becomes unsupported only when its signature is invalid or it contains no valid data rows. Parse numeric values, percentages, currency, and thousands separators without changing their units.

The parser reads values without modifying the source workbook. Intake may provide one explicit `sample_scope` for the import batch. Record the sanitized source basename, marketplace, export date when available, detected report type, imported and skipped row counts, sample scope, and scope provenance. Also store `reference_asin` for Reverse ASIN and `seed_query` for Keyword Mining when the workbook or intake supplies them. Garbled localized display labels must not corrupt English keyword values or numeric fields; unsupported or ambiguous layouts stop only spreadsheet ingestion and allow the ordinary low-confidence fallback.

## One-pass analysis

Normalize phrases for comparison by trimming, case folding, and collapsing whitespace. Preserve the original readable phrase for output. Merge duplicate phrases across reports and retain source-specific evidence rather than averaging unlike metrics.

Apply decisions in this order:

1. **Product fit:** reject phrases that conflict with the product identity, intended use, material, dimensions, claims, or compliance boundaries.
2. **Evidence strength:** use Reverse ASIN traffic share and ranking as SellerSprite-reported association signals for the referenced ASIN, not proof that the phrase caused traffic or sales.
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

The existing single bounded Listing self-check also verifies keyword naturalness, product fit, and front/back-end duplication. Normalize casing, whitespace, punctuation, and hyphens for comparison while preserving useful phrases; do not apply aggressive stemming or fragment phrases merely to remove partial overlap. Existing UTF-8 byte limits still apply. The check repairs only affected fields once and does not start a separate keyword-review or recursive polishing loop.

## Advertising suggestions

Advertising guidance is an optional by-product of the same analysis, limited to:

- `exact_candidates`: high-fit, high-intent core phrases;
- `phrase_candidates`: relevant phrases that can reasonably cover nearby searches;
- `cautious_tests`: broader, more competitive, expensive, or weaker-evidence phrases;
- `negative_candidates`: clearly mismatched meanings or unsupported product attributes.

Do not prescribe bids, budgets, campaign structure, expected sales, or profitability from a Top 10 sample. PPC, SPR, search volume, purchases, and purchase rate may explain placement, but every suggestion is labeled as a starting point based on the supplied sample.

## Storage and reuse

Keep source workbooks inside the product project's market-input area when the user wants them copied; otherwise record only sanitized basenames and import metadata, not machine-specific absolute paths. Store the portable derived project result as `keyword-profile.json` inside the product root.

A reusable copy may live under the configured seller-owned library at `keyword-profiles/<marketplace>/<locale>/<product-type>/<intent-slug>.json`. Never write reusable data into the installed Skill. If the library is absent or unwritable, keep the project profile and continue without reusable caching. This scope is deliberately separate from seller-family facts:

- seller family answers what the product is made from and which shared claims apply;
- keyword intent answers what shoppers call this particular product or use case.

For example, aluminum safety signs may share a seller family, while `slow-kids-at-play`, `hard-hat-required`, and `horse-crossing` remain different keyword intents.

The profile contains:

- schema version, marketplace, locale, product type, normalized intent ID, source dates, report types, and row counts;
- `analysis_scope` plus `scope_provenance`: accept scope once through intake/project metadata; use `top_10_sample` with `user_declared` for the currently supplied files, use export metadata when explicit, and otherwise default to `unknown_partial`; never infer scope from filename or row count;
- report identity: `reference_asin` for Reverse ASIN and `seed_query` for Keyword Mining when available;
- `market_size_complete: false` for partial exports;
- grouped keywords with original phrase, selected metrics, sources, and concise reason;
- compact advertising suggestions;
- generated and refreshed timestamps.

Reuse a profile only when marketplace, locale, product type, and normalized purchase intent match and current product facts do not conflict. An intent slug is derived from the canonical intent phrase and must resolve to only one profile; a collision is not an automatic match. Treat a profile older than 180 days as stale: it remains usable for a draft with a warning and is refreshed only when the user supplies new data or asks for current research. No per-keyword user confirmation is required. Ask one question only when a potentially valuable phrase conflicts with ambiguous product identity or implies an unconfirmed attribute.

Refresh evidence by report identity. A newer Reverse ASIN export replaces older Reverse ASIN evidence for the same marketplace, reference ASIN, and report type; a newer Keyword Mining export does the same for the same marketplace, seed query, and report type. Complementary report types remain together. Missing `reference_asin` or `seed_query` prevents automatic replacement. When identity is missing, or dates are equal or unknown and values conflict, retain the current profile and report the unresolved import rather than silently combining or overwriting it.

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
- Conflicting duplicate metrics: apply the report-identity refresh rule; do not average or silently combine them.
- Product mismatch: exclude the keyword; do not weaken product facts to retain it.
- Stale profile: warn during drafting, but refresh only when the user supplies data or explicitly requests current research.

Keyword-analysis failure must not block image generation, Product Master work, or a fact-grounded Listing draft. It only prevents describing the keyword choices as SellerSprite-data-backed.

## Compatibility

Existing projects with only `market_language` remain valid. The Listing brief treats that list as low-confidence supporting/backend candidates until a keyword profile is available. No migration, reapproval, image rehash, or delivery rebuild occurs solely because this feature is installed.

## Verification

Use the two supplied Top 10 exports as fixtures or sanitized test inputs. Tests cover:

- report-type detection by columns;
- fail-closed header/signature detection for reordered columns, duplicate headers, and ambiguous/non-SellerSprite sheets;
- row-level rejection and skipped-row counts for malformed mandatory numerics, error cells, and missing cached formula values, with whole-workbook fallback only when no valid rows remain;
- typed extraction of keywords and numeric metrics;
- deduplication across Reverse ASIN and Keyword Mining;
- product-fit exclusion before metric ranking;
- core/supporting/backend/excluded grouping without an opaque score;
- front-end/backend deduplication in the Listing brief;
- Top 10 and incomplete-market labels;
- explicit sample-scope provenance without inferring Top 10 from row count;
- explicit intake of batch sample scope, defaulting to `unknown_partial`;
- bounded advertising groups without bids or forecasts;
- profile reuse by marketplace, locale, product type, and intent, separate from seller-family matching, with near-match, stale, and slug-collision rejection;
- same-report replacement while preserving complementary report evidence;
- replacement refusal when `reference_asin` or `seed_query` is unavailable;
- graceful fallback for missing or unsupported workbooks;
- unchanged behavior for existing `market_language` projects;
- one analysis pass, no web research when usable SellerSprite data exists, no refresh for a micro revision, no separate keyword approval, and no image or unrelated approval invalidation.
