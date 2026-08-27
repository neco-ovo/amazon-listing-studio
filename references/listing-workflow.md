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

Run one bounded self-check in the same drafting operation. Check natural direct US retail language, buyer-intent alignment, internal QA leakage, unsupported absolutes or compliance implications, environment-versus-mounting logic, useful backend terms, canonical terminology, and field-appropriate marketing strength. Repair only clearly flagged sentences once. Do not recursively polish, rewrite clean fields, or make wording more elaborate merely to sound professional.

## Rules and validation

Resolve dated marketplace/product-type rules with `resolveRules`. The default freshness window is 90 days. A fresh matching cache needs no network check. A stale cache warns but does not block an ordinary grounded draft. Refresh when the user asks for current verification, the marketplace or product type changes, or upload-ready output uses a stale or missing applicable snapshot.

The bundled fallback is `assets/rule-seeds/amazon-us-defaults.json`. Current verified product-type Schema overrides it. If only some fields cannot be verified, mark those fields `rules_unverified`, keep supported copy, and set `upload_ready=false`.

## Review and revision

Present one consolidated Listing review. A small requested change uses `scripts/studio.js revise-listing --project-dir <dir> --patch <patch.json>` and validates only changed paths plus direct fact/keyword dependencies. Do not repeat market research, rule refresh, image generation, or repository tests.

System scope fields come from current project state at approval, not from consumer-copy revision requests. Approval must pass the same Listing scope preflight used by finalization before it freezes JSON/Markdown hashes. Filling or normalizing metadata alone does not create another consumer-copy Listing version.

Draft revisions are mutable. Preserve every unselected field byte-for-byte. Reject a stale expected draft revision or unknown path. Render Markdown from JSON; never maintain independent prose copies. On explicit approval, run `scripts/studio.js approve --project-dir <dir> --type listing`; only then create the next formal Listing version and its JSON/Markdown hashes.

For Parent baselines, exact Child overrides, compound tuples, or Variation Listing approval, add `references/variation-workflow.md` only for a Variation Family.
