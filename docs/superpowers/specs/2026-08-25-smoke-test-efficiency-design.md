# Amazon Listing Studio Smoke-Test Efficiency Design

**Date:** 2026-08-25  
**Status:** User-approved design  
**Builds on:** `docs/superpowers/specs/2026-08-25-two-speed-simplification-design.md`

## 1. Objective

Correct the completed real-product smoke-test failures while reducing routine planning, validation, state work, rule refreshes, and repeated user confirmation. The operating principle is **light drafts, immutable approvals, strict delivery**.

The change preserves Product Master approval, saved-raster inspection, fact-conflict stops, explicit secondary approval, and final artifact rehashing. It does not add a WebUI, server, worker, generalized adapter layer, or repeated full-project analysis.

## 2. Efficiency contract

### Draft and candidate work

- An ordinary image uses one compact brief; the brief is not a separate approval artifact.
- A candidate is decoded and inspected once before presentation. Rejected candidates keep only a compact path/status/reason record and receive no approval hash.
- SHA-256 and immutable binding occur only on explicit artifact approval and final delivery.
- A micro Listing edit changes only requested fields and direct dependencies. It does not run market research, rule refresh, image work, full Listing regeneration, or repository-wide tests.
- Product-project operations run affected-scope checks. Repository-wide tests are reserved for Skill code, schema, or rule-logic changes.

### Approval and finalization

- One approval transaction validates the artifact, hashes it once, binds its scope, updates state, and renders the human view.
- System scope metadata is derived from project state; metadata-only corrections do not create a new consumer-copy Listing version or require reapproval of unchanged copy.
- Listing approval and finalization use one shared preflight contract.
- One finalization operation performs preflight, packages the archive, and verifies archive membership, lengths, hashes, image decoding, and Listing scope.

## 3. Reusable merchant layout seeds

The approved secondary images from the `slow-down-kids-pets-at-play-12x16` smoke test become merchant-owned layout seeds for matching rigid aluminum sign families. Reuse may be visually consistent across the seller's different brands; it is not required to redesign a proven layout merely for novelty.

Each seed records:

- layout role and stable region structure;
- fixed visual hierarchy, icon system, typography direction, and information positions;
- permitted adaptations for product ratio, copy length, claim count, and scene suitability;
- product prominence and thumbnail-readability requirements;
- reference preview path and provenance;
- applicable stable traits and exclusions;
- compact failure guards learned from rejected attempts.

Selection loads only the best matching seed for the current image role. It does not reopen or reanalyze the former product project. The seed is a layout reference; current Product Master identity, current facts, current copy, and current marketplace constraints replace source-product content.

The four initial seeds are durability, size/construction, front/back, and split application scenarios. Their fixed layouts may be reused when suitable. An incompatible product ratio, unsupported claim set, or different scene need triggers bounded adaptation, not automatic template abandonment.

## 4. Image quality with one-pass checks

### Identity versus design reference

The image brief separates:

- `identity_invariants`: construction, printed content, palette, quantity, front/back, mounting features, and defining motifs;
- `layout_seed`: optional merchant layout to reuse;
- `difference_requirements`: required only when adapting a third-party or competitor product design, not when intentionally reusing the seller's approved merchant layout.

For a third-party product design reference, the brief requires meaningful changes to region structure, typography proportions, pictogram posture, or negative-space distribution. For a merchant-owned approved seed, stable layout reuse is allowed.

### Compact visual QA

One saved-raster inspection checks only applicable dimensions:

- identity and exact required text;
- misleading included components or unsupported claims;
- product prominence at thumbnail scale;
- claim-to-visual correspondence;
- scene semantics (`use_environments` are distinct from `mounting_surfaces`);
- design differentiation only when the source role requires it;
- regional balance and geometry for relevant infographic types.

Small precision icons should use deterministic vector/icon composition when available. Exact deterministic typography remains a repair path or an explicit traceability request, not the default.

## 5. Knowledge and marketing expressions

Knowledge uses four explicit language classes:

1. `confirmed_fact`: publishable project or applicable seller-family fact.
2. `fact_preserving_retail_expression`: natural consumer wording derived without adding a claim.
3. `user_authorized_marketing_expression`: approved presentation language with an artifact/field/family scope and explicit non-derivable facts.
4. `market_observation`: reusable market context that cannot support a product claim.

Family matching continues to use stable material and product-form traits rather than exact Amazon categories. At intake, the Skill loads matching family knowledge and asks one consolidated question for unconfirmed process-dependent claims and related marketing expressions. A confirmation may be stored at project or manufacturing-family scope. A refusal or uncertain answer leaves the item as market observation and does not block unrelated work.

Marketing expressions may be considered for image copy and Listing consumer fields. They do not automatically become Product Master facts, certifications, attributes, guarantees, lifetime claims, material grades, or manufacturing specifications. Structured fields use fact-near language. Listing self-check decides whether an authorized expression is natural and suitable for the current field.

## 6. Listing generation and one-pass self-check

Title and Item Highlights are one optimization unit with separate character budgets and information roles. The first Listing draft creates all required fields once from current facts, applicable family facts, approved marketing language, category shopper vocabulary, and cached rules.

The same drafting operation performs one compact self-check for:

- natural, direct US retail language;
- concrete benefits rather than raw specification headings;
- obvious AI-like abstraction or professional-sounding detours;
- unsupported absolutes, excessive promotion, or unnecessary compliance implications;
- leakage of internal QA wording such as `empty holes` or `confirmed performance`;
- separation of material performance, use environment, and mounting surface;
- core search language aligned with buyer intent and actual attributes;
- front/back keyword usefulness rather than novelty or byte filling;
- canonical terminology across fields;
- marketing strength appropriate to the field type.

The self-check may repair only clearly flagged sentences once. It must not recursively polish, rewrite compliant fields, or optimize merely to sound more professional. A later user micro revision runs only changed-field validation plus direct fact, terminology, and keyword dependencies.

## 7. Shared Listing approval and delivery contract

System scope is derived from the current project state and current draft at approval time:

- project ID;
- Product Master version;
- marketplace, language, and product type;
- rule status, `rules_unverified`, and `upload_ready`;
- selected approved artifact IDs;
- Listing content revision and immutable content hash.

Listing approval rejects a draft that cannot pass the same scope preflight used by finalization. `rules_unverified` is allowed when `upload_ready=false`; it must not block a grounded non-upload-ready delivery.

Relative `finalize --output` paths resolve from `--project-dir`. Absolute output paths must remain inside the product root. The manifest marks archive members with `container: delivery.zip` and archive-relative paths.

Finalization writes a new output directory containing `delivery-manifest.json` and `delivery.zip`, then verifies the ZIP directly. A public `verify-delivery` command can repeat that same verification without requiring manual extraction.

## 8. Error timing

Errors must surface at the earliest responsible boundary:

- anti-copy or prominence failures before image presentation;
- field length and role failures before first Listing review;
- approval/finalizer scope mismatch at Listing approval;
- output-path ambiguity before packaging;
- archive membership or hash mismatch before finalization reports success.

Unknown facts and conflicting current user facts remain blocking. A stale rule cache warns for grounded drafts and refreshes only for current verification or upload-ready delivery.

## 9. Testing strategy

Use RED-GREEN-REFACTOR. Automated tests use existing rasters, copied smoke-test previews, synthetic fixtures, and fake capabilities; they do not purchase new image generations.

Required regression coverage:

- merchant-owned seeds may retain fixed layouts while third-party references require differentiation;
- only one matching layout seed is loaded;
- process claims and marketing expressions produce one consolidated confirmation decision;
- unconfirmed competitor language remains observation-only;
- Listing self-check flags internal QA language, abstract phrasing, unsupported absolutes, weak buyer intent, and terminology drift without recursively rewriting clean copy;
- approval derives required scope metadata and shares finalization preflight;
- metadata-only state correction does not create a new Listing copy version;
- relative delivery output resolves under the product root;
- manifest paths identify ZIP containment;
- direct delivery verification checks members, sizes, hashes, image decoding, and Listing scope;
- existing Product Master, image inspection, approval, rule status, and final rehash invariants remain green.

## 10. Acceptance criteria

- Routine image work uses one short brief, one generation call, one relevant inspection, and one approval transaction unless a real defect requires repair.
- Matching sign-family projects can reuse the four approved merchant secondary layouts without reanalyzing the original project.
- Unknown process claims and marketing expressions are asked once; confirmed family knowledge is not asked again.
- A complete Listing receives one bounded self-check, and micro edits never trigger a full rewrite.
- Formal Listing versions represent consumer-copy approvals, not metadata-only changes.
- Anything accepted by Listing approval can proceed through the shared finalization preflight when other selected artifacts are current.
- Product-root-relative delivery output succeeds and the produced ZIP is verified without manual extraction.
- The full automated suite passes without new paid image generation.
