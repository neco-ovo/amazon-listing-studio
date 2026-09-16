# Listing workflow

Read this reference only for Listing drafting, review, keywords, or revisions.

## Draft once for conversion

After the selected image set is current, compile a brief with `compileListingBrief`. Use only publishable project and seller-family facts. Draft Title, Item Highlights, five Bullets, Description, Backend Search Terms, Special Features, and supported product details together.

Field priorities:

- Title: product identity, purchase intent, differentiator, then size or variant.
- Item Highlights: purchase intent and primary buyer benefit before material detail or mounting surfaces.
- Bullets: benefit-led heading, supported fact, then a concrete use or buyer outcome. Do not use a raw size label as the entire heading when a meaningful benefit is available.
- Description: naturally connect material/performance, suitable environment, and mounting surface instead of stacking facts or mixing those logical dimensions.
- Backend Search Terms: complement front-end language. Prefer relevant uncovered phrases such as jobsite, construction site, PPE, head protection, industrial, or work area; do not repeat front-end tokens merely to fill bytes.

Combine confirmed facts into plain consumer language. Avoid empty conservative phrases such as “supports exposed settings,” “provides versatile use,” or “supports straightforward placement.” Do not globally ban `supports` or `provides`; a sentence with a concrete object and outcome can be natural.

## Data-backed keyword placement

When the product’s references/keyword-profile.json exists and exactly matches marketplace, locale, product type, and purchase intent, pass it to `compileListingBrief`. Use its four groups without turning search terms into facts:

- `core`: strongest exact/high-fit phrases for the Title and primary purchase-intent copy.
- `supporting`: natural secondary wording for Bullets and Description.
- `backend`: relevant uncovered phrases for Backend Search Terms.
- `excluded`: validation context only; never publish these phrases.

Preserve complete backend phrases and remove one only when all its meaningful tokens already appear on the front end. Never fragment a phrase to fill the byte limit. If no compatible profile exists, retain category `market_language` as the fallback.

Create only four bounded advertising starting lists from the same pass: `exact_candidates` from core, `phrase_candidates` from supporting, `cautious_tests` from backend, and `negative_candidates` only for product mismatches or unsupported attributes. These are optional suggestions for a small seller: no bids, budgets, forecasts, dashboard, or opaque score.

Run one bounded self-check in the same drafting operation. Check natural direct US retail language, buyer-intent alignment, internal QA leakage, unsupported absolutes or compliance implications, environment-versus-mounting logic, useful backend terms, canonical terminology, and field-appropriate marketing strength. Repair only clearly flagged sentences once. Do not recursively polish, rewrite clean fields, or make wording more elaborate merely to sound professional.

## Rules and validation

Resolve dated marketplace/product-type rules with `resolveRules`. The default freshness window is 90 days. A fresh matching cache needs no network check. A stale cache warns but does not block an ordinary grounded draft. Refresh when the user asks for current verification, the marketplace or product type changes, or upload-ready output uses a stale or missing applicable snapshot.

The bundled fallback is `assets/rule-seeds/amazon-us-defaults.json`. Current verified product-type Schema overrides it. If only some fields cannot be verified, mark those fields `rules_unverified`, keep supported copy, and set `upload_ready=false`.

When filling an Amazon.com `SIGNAGE` upload template, load the dated field seed at `assets/rule-seeds/amazon-us-signage-upload-fields.json`. Apply its reusable defaults only when their stated conditions match, and ask once for unresolved account or product conditions. Do not load this seed for ordinary copy drafting. Never allow price fields to inherit across products; use the current Child's confirmed `list_price` and `standard_price`.

Audit the actual populated workbook against its current data-definition sheet and conditional rules. Report empty cells in exactly four groups: **upload-blocking missing**, **autofill from confirmed facts**, **user confirmation required**, and **correctly blank or not applicable**. A red or conditionally-required template marker is not by itself proof that a field is missing; evaluate its trigger for the exact Parent or Child row. Do not describe correctly blank fields as omissions.

For a Variation Parent, offer, inventory, package measurement, and image cells are normally correctly blank unless the exact template says otherwise. For each sellable Child, check current price, package length/width/height with units, package weight with unit, inventory, shipping template, and required relationship fields. Autofill attributes such as metal type, shape, unit count/type, or pack count only when current confirmed facts support the exact value. Keep product net weight separate from package weight. Restricted fields such as Mounting Type and Recommended Uses require one allowed value per cell; ask once when existing facts do not determine the mapping. Battery-dependent fields remain blank for a product with no battery when the allowed list has no `No` value.

Use a successful uploaded workbook only as a regression reference for field presence, Parent/Child scope, and known accepted blanks; never copy its product or account values into another project. The SIGNAGE seed's `upload_field_map` connects common upload columns to their required fact sources. Package measurements are conditional: treat an empty Child package field as blocking only when the current template condition or Seller Central feedback activates that requirement.

For optional upload preparation, use the exact current template validation values for record action, Variation Theme, and shipping template; never translate or approximate a dropdown label. A shipping template may be reused only when it matches the current marketplace and seller account. Unsupported validation sources or conditional formulas keep the result at `manual-prep`. Variation Child rows never populate `package_contains_sku`; a separately confirmed bundle row may reference a SKU that is also sold as a Variation Child. Keep fields unavailable to the current Product Type blank. When Amazon returns a processing summary, identify the earliest restricted-value or relationship failure as the root cause and group later cascade errors beneath it.

## Review and revision

Present one consolidated Listing review. A small requested change uses `scripts/studio.js revise-listing --project-dir <dir> --patch <patch.json>` and validates only changed paths plus direct fact/keyword dependencies. Do not repeat market research, rule refresh, image generation, or repository tests.

A micro revision does not refresh or reanalyze keyword research. It reuses the saved profile and changes only the requested field plus direct dependencies.

System scope fields come from current project state at approval, not from consumer-copy revision requests. Approval must pass the same Listing scope preflight used by finalization before it freezes JSON/Markdown hashes. Filling or normalizing metadata alone does not create another consumer-copy Listing version.

Draft revisions are mutable. Preserve every unselected field byte-for-byte. Reject a stale expected draft revision or unknown path. Render Markdown from JSON; never maintain independent prose copies. On explicit approval, run `scripts/studio.js approve --project-dir <dir> --type listing`; only then create the next formal Listing version and its JSON/Markdown hashes.

For Parent baselines, exact Child overrides, compound tuples, or Variation Listing approval, add `references/variation-workflow.md` only for a Variation Family.
