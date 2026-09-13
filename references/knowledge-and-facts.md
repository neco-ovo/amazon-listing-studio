# Knowledge and facts

Read this reference only for intake, fact conflicts, reusable market knowledge, or Product Master invalidation.

## Authority order

1. Current explicit user confirmation for this product.
2. Approved seller-family facts whose scope applies to this product.
3. Product documents and reference links.
4. Category observations and competitor patterns.
5. AI suggestions.

A higher source overrides a lower one. Preserve source IDs and the losing value when a conflict matters. Ask one concise question only when a missing or conflicting fact blocks the current artifact.

## Three knowledge scopes

- Project facts live in `state.json`. A user-confirmed project fact is publishable and overrides reusable knowledge.
- Seller-family facts live under `library/seller-families/`. Match the family from stable construction traits such as material and product form, not an exact Amazon category. A rigid aluminum yard sign, store sign, and safety sign may share one family; corrugated plastic, vinyl decals, and digital signs do not. Category names are hints, not hard boundaries.
- Category observations live under `library/categories/<marketplace>/`. Store recurring benefits, shopper language, visual patterns, and source dates here. They may guide briefs and keywords but are not automatically product claims.

## Keyword-intent profiles

Keyword profiles are separate from product facts, seller-family facts, and category observations. When supplied, prefer SellerSprite Reverse ASIN or Keyword Mining XLSX data, then an exact compatible cached keyword profile; use web keyword observations only as a lower-confidence fallback. A keyword is buyer language, not proof of a product attribute.

Run `scripts/studio.js analyze-keywords --project-dir <dir> --input <manifest.json> [--library-dir <dir>]`. It reads each workbook once and writes the portable copy to the product’s references/keyword-profile.json; the optional seller-library cache is keyed by marketplace, locale, product type, and normalized purchase intent. Use one analysis pass and no per-keyword approval. Ask one consolidated question only when a valuable phrase implies an ambiguous or unconfirmed product attribute.

Record explicit sample scope. `top_10_sample` means a limited Top 10 sample and is not complete market analysis; absent scope defaults to `unknown_partial`. Put each report's `export_date` explicitly in the import manifest; never infer it from the filename. A profile older than 180 days remains usable for drafts with a stale warning. Refresh only for newer supplied evidence or an explicit current-research request, never merely because another Listing draft was created.

If XLSX parsing or keyword analysis fails, omit the profile and report the failure; it must not block image generation or Product Master work. Existing category `market_language` remains the legacy fallback for Listing language.

Use `scripts/studio.js learn-category` to merge market observations. Promote a common performance point to a seller-family fact only after the user confirms it applies to that family. This preserves the requested reuse without turning competitor language into unsupported product facts.

Separate family membership from claim applicability. Structural claims such as rust resistance may inherit with the confirmed aluminum construction. Process-dependent claims such as fade resistance, reflectivity, or waterproofing require matching finish/process evidence. When that evidence is absent, ask one consolidated question before formal image and Listing work. Record a confirmation for only the current project or, when the user says the manufacturing series shares the process, for the seller family so later matching projects do not ask again. A negative or uncertain answer omits only those claims and does not block the workflow.

Include related marketing expressions in that same consolidated question. Keep them in a separate expression collection with allowed image/Listing scopes and facts they cannot imply. Confirmation permits the wording within its scope; it does not convert the wording into a Product Master fact, certification, material grade, lifetime, process specification, or guarantee. A declined or uncertain expression remains a market observation. Listing self-check decides whether an authorized expression is natural and suitable for a particular consumer field.

## Product identity and invalidation

Product identity includes construction, dimensions and orientation, count, front/back appearance, printed copy, defining colors, mounting features, and included components. A user-authorized redesign may change specified identity fields. After Product Master lock, an identity change creates a new Product Master and stales dependent secondary images and Listing claims; a presentation-only change does not.

Do not treat visible screws, hooks, props, tools, brackets, or scene accessories as included unless confirmed. Do not infer reflective, certified, compliant, lifespan, thickness, or performance claims from category prevalence alone.
