# Amazon Listing Studio — Skill Design

**Date:** 2026-08-24  
**Status:** User-approved design, pending written-spec approval  
**Skill name:** `amazon-listing-studio`  
**Source directory:** `D:/Amazon/Amazon-listing-gen/`  
**Seed:** `seed.yaml` (`seed_d4711d0dfb4f`)

## 1. Purpose

Create one streamlined, Codex-primary Skill for an individual Amazon seller. The Skill turns user facts, product links, documents, and reference images into:

1. a generated and approved Amazon main image;
2. a locked, versioned Product Master;
3. generated and individually approved secondary images;
4. a conversion-oriented, fact-grounded Listing; and
5. a version-bound delivery bundle with integrity hashes.

The Skill generates, saves, presents, and reinspects real raster images. A prompt-only result is never successful image delivery.

## 2. Design principles

- Keep one user-facing Skill; use internal modules rather than multiple Skills.
- Prefer direct Codex capabilities over WebUI, servers, workers, and harness adapters.
- Treat explicit user facts as authoritative over extracted reference data.
- Never fabricate publishable facts, product structure, components, or claims.
- Lock the approved main image as Product Master before secondary generation.
- Generate and approve secondary images one at a time.
- Keep runtime state small, readable, versioned, and dependency-aware.
- Use deterministic scripts for checks, text overlays, hashes, and packaging.
- Treat marketplace rules as dated, verifiable inputs rather than timeless constants.
- Preserve rejected and superseded assets instead of overwriting history.

## 3. Scope

### In scope

- Text, local-file, reference-image, document, and public-link intake.
- Blocking-question handling and visible fact conflicts.
- Main-image generation, storage, inspection, QA, revision, and approval.
- Product Master locking, versioning, hashing, and scoped invalidation.
- Secondary storyboard planning and sequential image generation.
- Deterministic infographic text, measurement, and callout composition.
- Recursive local-font and ZIP discovery plus suitable network-font fallback.
- Curated e-commerce template snapshot with generated preview references.
- Amazon.com/en-US Listing generation by default.
- Title, optional Item Highlights, exactly five Bullets, Description, backend search terms, Special Features, and supported category attributes.
- Character, byte, claim, provenance, version, and package-integrity validation.

### Out of scope

- WebUI and frontend state.
- HTTP servers and browser download endpoints.
- Worker leases, heartbeats, queues, background monitoring, or task orchestration.
- Automatic Seller Central publication.
- Upload-ready category spreadsheets when the current schema is unavailable.
- Engineering CAD, production drawings, and automatic intellectual-property, regulatory, or Amazon clearance claims.
- Complex compatibility adapters for other harnesses.

## 4. Architecture decision

Use a **single orchestration Skill plus a small deterministic Node.js toolkit**.

```text
User / references
       |
       v
amazon-listing-studio (SKILL.md)
       |
       +-- workflow and fact references
       +-- image and Listing references
       +-- curated templates and preview images
       +-- deterministic Node.js utilities
       |
       v
Per-product workspace and delivery bundle
```

The Skill gives the agent the workflow, decision gates, and reference routing. Scripts solve deterministic operations. The active harness supplies conversational and visual capabilities.

## 5. Capability contract

The Skill checks these semantic capabilities before use:

- `ask_user`: ask a concise blocking question and receive an answer.
- `read_reference`: read supplied files, images, public links, and local rules.
- `generate_image`: create or edit a real raster image using the supplied references.
- `inspect_image`: visually inspect the saved raster file.
- `workspace_files`: create, read, hash, and organize project artifacts.

Codex is the implementation and test priority. Another harness may run the workflow when it supplies equivalent capabilities; the Skill does not maintain complex adapter code.

Image work stops with a named `CAPABILITY_FAILURE` when generation returns only a prompt, returns no usable raster, cannot save the file, creates a corrupt file, or cannot reinspect the saved artifact.

## 6. Runtime workflow

```text
Intake
  -> fact extraction and blocking conflict questions
  -> main-image plan
  -> real main-image generation
  -> two-gate QA
  -> explicit main-image approval
  -> Product Master lock
  -> evidence-aware secondary storyboard
  -> one secondary image at a time
  -> per-image QA and approval
  -> complete Listing generation
  -> Listing and rule validation
  -> consolidated version-bound approval
  -> integrity-checked delivery bundle
```

The Skill asks only for information needed by the current step. Missing back-view evidence does not block an unrelated scene image. It does block a back-view image unless the user supplies evidence; the unsupported card may be replaced with a supported alternative.

## 7. Per-product workspace

By default, create the product workspace relative to the user's active workspace, not in the Skill's source or test directories:

```text
amazon-listing-projects/<product-slug>/
├── project.md
├── facts.json
├── assets.json
├── references/
├── images/
│   ├── main/
│   ├── secondary/
│   └── rejected/
├── listing/
└── delivery/
```

The user may choose another location.

## 8. State model

### `project.md`

Human-facing project dossier and progress record. It contains the product/marketplace summary, current stage, open questions, concise conflicts and warnings, current versions, approvals, and change history.

### `facts.json`

Structured facts with normalized values, status, publishability, sources, conflicts, and dependent artifact IDs.

Allowed fact statuses:

- `user_confirmed`
- `source_observed`
- `ai_suggested`
- `unknown`
- `conflicted`
- `not_applicable`

Authority order:

1. current explicit user input or confirmation;
2. earlier explicit user confirmation;
3. official or supplier data;
4. directly visible product evidence;
5. market/reference pages;
6. AI suggestions.

Later lower-authority evidence never silently replaces user-confirmed data. Conflicting user confirmations require a new question.

### `assets.json`

Structured Product Master and image state: versions, hashes, identity, geometry, plans, paths, references, selected template/font, QA, approvals, rejections, dependencies, Listing references, and bundle references.

The readable Listing document and `listing.json` are delivery artifacts, not additional runtime state.

## 9. Product Master

Explicit main-image approval locks a Product Master containing at least:

- product type and identifying characteristics;
- confirmed dimensions and physical proportions;
- color, material, and variant;
- count and confirmed visible components;
- known view/structure boundaries;
- canonical source and approved-main-image SHA-256 hashes;
- stable version and dependency links.

Every secondary image uses the current Product Master as the first authoritative product reference. Layout, style, and scene references may affect only environment, composition, camera, lighting, and information hierarchy.

### Change propagation

- `IDENTITY_CHANGE`: dimensions, proportions, color, material, quantity, product wording, structure, openings, or components change. Increment Product Master and invalidate only dependent outputs.
- `PRESENTATION_CHANGE`: crop, white background, shadow, exposure, or camera-position correction without identity change. Replace only affected presentation assets.

Old files and approvals remain in history. A requested change supersedes approval for affected versions.

## 10. Main-image design

The Skill applies current marketplace/category rules plus these stricter project requirements:

- pure-white background;
- only the confirmed product count and confirmed visible components;
- no price, promotion, badge, decorative border, watermark, or unrelated copy;
- full visibility without clipping, distortion, or convenience crop;
- physical product proportions independent of canvas proportions;
- product bounding box occupies at least 95% along the dominant canvas direction when geometry permits.

The 95% value is a project target, not represented as a universal Amazon rule. Current verified hard rules override it. If full visibility, true proportion, and 95% cannot coexist, the Skill explains the geometry conflict and asks the user.

For a 12W × 8L-inch product, the silhouette remains 3:2. An Amazon.com default canvas may remain 1:1; the product is maximized inside it without stretching. Explicit user or current category requirements can change output dimensions, resolution, orientation, aspect ratio, and format.

## 11. Secondary-image system

Default storyboard:

1. application scene A;
2. application scene B;
3. application scene C;
4. size/specification image;
5. material/process detail image;
6. back/structure/installation detail image.

The three application scenes must differ materially in credible environment, use context, view, support geometry, camera, lighting, or interaction.

Unsupported cards are replaced rather than fabricated. Alternatives include a supported feature callout, package/confirmed-components image, installation image, or grounded comparison. The user may change the final count.

Each asset is generated and approved separately. Rejected files move to or remain indexed under `images/rejected/`; a replacement receives a new immutable version. The Skill may attempt at most two automatic targeted corrections before asking the user.

## 12. Image QA

### Gate 1 — deterministic file checks

- file exists and is decodable;
- type, dimensions, orientation, and size are plausible;
- SHA-256 is recorded;
- main-image white background and occupancy satisfy configured tolerances;
- deterministic copy exactly matches the plan and remains in bounds;
- dependencies reference current Product Master and facts.

### Gate 2 — visual and factual checks

- identity, color, count, structure, and proportions match;
- no invented accessory, hole, back, material, or use method;
- scene scale, support, contact, and perspective are credible;
- no watermark, competitor branding, or unsupported claim;
- composition, legibility, and commerce quality pass;
- applicable marketplace/category rules pass.

Only an asset passing both gates may be offered for approval.

## 13. Deterministic typography

Do not trust generative rendering for dimensions, units, headlines, selling points, leader lines, or critical labels.

1. Generate a base image without critical overlay copy.
2. Compose exact typography and callouts with Node.js, SVG, and `sharp`.
3. Save a new composite.
4. Validate exact text, facts, bounds, contrast, and legibility.
5. Reinspect the saved composite visually.

Intrinsic text already printed on the Product Master must remain part of product identity. No additional promotional copy is added to the main image.

## 14. Font design

Use a hybrid font model:

- recursively scan directories and ZIP archives;
- deduplicate by metadata, source directory, format, hashes, and normalized aliases;
- classify family, variant, language coverage, visual style, and source label;
- do not perform additional item-by-item license verification;
- permit a suitable network font based on user request, product style, AI judgment, and runtime availability;
- cache only the selected font when necessary;
- record the resolved file/source/hash and disclose fallback.

Latest observed local baseline on 2026-08-24:

- 32 directories and 132 files;
- 14 ZIP archives containing 28 font entries;
- 41 extracted fonts: 26 OTF, 12 TTF, 2 WOFF, and 1 WOFF2;
- 41 distinct extracted-file content hashes;
- 38 readable OTF/TTF internal name tables producing 29 raw family names;
- 3 webfont files requiring catalog-level merging.

Counts are observations, not constants. Tests must scan the actual fixture tree. Raw family names require alias normalization, so no approximate final family count is hard-coded.

## 15. Curated e-commerce template library

Maintain 8–12 local templates covering:

- Amazon white-background hero;
- distinct application scenes;
- size/specification;
- material/macro detail;
- back/structure;
- installation/use;
- feature callouts;
- packaging/confirmed components;
- grounded comparison;
- detail-page-style information structure.

Templates may be derived from upstream prompts, cases, and pitfalls in `freestylefly/awesome-gpt-image-2`, but must be rewritten for Amazon constraints, factual grounding, and Product Master isolation.

Each template records applicability, prohibitions, required facts, view/composition, scene/camera/material/lighting, generative content, deterministic overlays, typography guidance, QA, upstream case IDs/links/version, and local adaptation notes.

Each template receives one newly generated, unbranded reference image and at most two when a meaningful variant is necessary. Upstream prompts and cases may inspire the new preview. The preview uses a fictional generic product and is tagged only as `LAYOUT_REFERENCE` or `STYLE_REFERENCE`; it cannot define real product facts or identity.

Do not bundle upstream community case images. Preserve source links and provenance.

### Maintainer sync

Runtime uses a stable reviewed snapshot. A manual sync script fetches upstream metadata and writes a reviewable report of added, changed, and removed candidates. It never overwrites templates or previews. A maintainer selects and adapts changes, updates provenance, regenerates previews when needed, and reruns tests before a snapshot version changes.

Relevant upstream sources:

- https://github.com/freestylefly/awesome-gpt-image-2
- https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/templates.md
- https://github.com/freestylefly/awesome-gpt-image-2/blob/main/data/style-library.json

The upstream repository is MIT-licensed, but its disclaimer says third-party community material is not guaranteed for commercial reuse. Local derived templates retain license/provenance notices while avoiding copied case images.

## 16. Listing output

Default marketplace/language: Amazon.com/en-US.

Deliver:

- Title;
- optional Item Highlights when supported;
- exactly five Bullet Points;
- plain-text Description;
- Backend Search Terms;
- Special Features;
- supported category-relevant attributes;
- field-level fact references and validation.

Write `listing/listing.md` for people and `listing/listing.json` for structured traceability.

### Current defaults

- non-media Amazon.com Title: at most 75 characters including spaces;
- Item Highlights: at most 125 characters;
- Bullets: exactly five, internal target at most 200 characters each and 1000 combined;
- Description: default at most 2000 characters;
- Backend Search Terms: default at most 250 UTF-8 bytes.

The 75/125 limits reflect Amazon's 2026-07-27 non-media title and Item Highlights update. Bullet targets are Skill readability/compatibility targets, not falsely presented as universal hard limits. Current marketplace/category rules and schemas can impose lower or different limits.

Over-limit copy is condensed once. A remaining hard-limit failure blocks approval.

## 17. Listing copy playbook

Keep a separate `listing-copy-playbook.md` to standardize conversion-oriented writing and reduce repeated revision.

- Establish complete product identity before keyword optimization.
- Prioritize selection-defining message/theme/variant, count, and precise product type.
- Avoid comma-separated keyword fragments and near-synonym stacks.
- Use exactly five distinct purchase-decision roles.
- Format Bullets as `[2–5 WORD UPPERCASE HEADING] Body`.
- Express verified customer value in natural retail language without inflating claims.
- Use Description for coherent context and remaining verified details, not repetition.
- Deduplicate backend terms and exclude competitor brands, promotions, and irrelevant traffic.
- Keep Special Features and attributes schema-first and fact-grounded.
- Avoid instruction-manual, legal-memo, disclaimer, and internal-prompt language.

Generate one recommended complete draft by default. Generate alternatives only on request.

The Skill optimizes clarity, purchase motivation, decision support, keyword relevance, naturalness, and cross-channel consistency. It never guarantees rank, traffic, conversion, or sales.

## 18. Dynamic marketplace rules

Rule authority:

1. verifiable current official marketplace/category rule or field schema;
2. current category template supplied by the user;
3. dated local rule snapshot with source;
4. conservative Skill default.

The Skill attempts verification itself and does not demand Case IDs, full notifications, or complex proof from the user.

If a category schema is unavailable, the Skill asks once whether to continue. It marks only schema-dependent fields `rules_unverified`, keeps supported copy moving, sets `listing.json` `upload_ready: false`, produces no upload-ready spreadsheet, and makes no compliance-clearance claim.

This does not make the Listing unusable; it means the seller must verify current Seller Central field names, required fields, enumerations, and upload formatting. Authorization to continue is bound to the current product, marketplace, product type, Product Master version, and Listing version. It cannot override unknown facts, conflicts, or hard blockers.

## 19. Approval and delivery

Each image requires explicit approval. Listing fields are reviewed as one set rather than requiring field-by-field confirmation.

Before delivery, one unambiguous consolidated approval covers the identified current versions of:

- main and selected secondary images;
- Listing and backend search terms;
- Special Features and supported attributes;
- marketplace and product type;
- Product Master and schema status.

A change request invalidates affected approval, revises scoped dependents, creates a new bundle version and change summary, and requires updated approval.

The final bundle contains an artifact manifest with current versions, relative paths, media types, byte sizes, and SHA-256 hashes. Missing, corrupt, stale, or unapproved files block delivery.

## 20. Error model

- `BLOCKING_INPUT`: the current step lacks a required fact, or user confirmations conflict.
- `CAPABILITY_FAILURE`: an image cannot be generated, saved, decoded, or reinspected.
- `HARD_QA_FAILURE`: identity mismatch, invention, incorrect geometry, clipping, stale master, corrupt asset, unsupported claim, or applicable hard-rule violation.
- `RULES_UNVERIFIED`: content may continue, but specific category upload fields are unverified.
- `STALE_DEPENDENCY`: a fact or master change made a dependent artifact non-current.

An error names the file/field, reason, automatic-repair availability, minimum user input needed, and unaffected work that remains current.

## 21. Source layout

```text
D:/Amazon/Amazon-listing-gen/
├── SKILL.md
├── seed.yaml
├── package.json
├── agents/openai.yaml
├── references/
│   ├── capability-contracts.md
│   ├── workflow.md
│   ├── state-and-facts.md
│   ├── image-generation.md
│   ├── image-qa.md
│   ├── font-selection.md
│   ├── listing-copy-playbook.md
│   └── listing-and-compliance.md
├── assets/
│   ├── templates/
│   ├── template-previews/
│   └── provenance.json
├── scripts/
│   ├── init-project.js
│   ├── scan-fonts.js
│   ├── validate-state.js
│   ├── validate-image.js
│   ├── compose-overlay.js
│   ├── validate-listing.js
│   ├── sync-style-library.js
│   └── build-delivery.js
├── tests/
│   ├── fixtures/
│   ├── unit/
│   ├── contract/
│   └── workflow/
├── evals/
└── docs/superpowers/
    ├── specs/
    └── plans/
```

`SKILL.md` stays concise and routes the agent to relevant references. Scripts perform deterministic operations only; they do not run a server or maintain a remote-model queue.

## 22. TDD and evaluation strategy

### RED — behavior baseline without the Skill

Run independent-agent pressure scenarios and record exact failures/rationalizations, including prompt-only image success, incorrect fact precedence, premature secondary generation, skipped image reinspection, template identity leakage, invented back/material/accessories, character/byte confusion, and false upload-ready claims.

### GREEN — minimal Skill

Create only enough Skill instructions and references to correct observed baseline failures, then rerun the same scenarios.

### REFACTOR — close loopholes

Add explicit rules only for observed ambiguities and rationalizations, and rerun both original and adversarial variants.

### Node.js tests

Use Node.js >=20 ESM, `node:test`, and production code only after a failing test. Cover:

- state initialization and validation;
- fact authority and conflict retention;
- Product Master hash/version/dependencies;
- dependency-scoped invalidation;
- 12×8 -> 3:2 physical silhouette;
- canvas/occupancy/full-visibility separation;
- deterministic overlays and font resolution;
- recursive directory/ZIP/webfont discovery and family normalization;
- Listing character and UTF-8 byte limits;
- exactly five Bullets;
- unavailable schema behavior;
- rejected-image version preservation and two-correction limit;
- sync diff without snapshot overwrite;
- manifest integrity and stale/missing-file rejection.

### Capability contract tests

Use fakes for valid raster, prompt-only response, missing file, corrupt file, unsaved file, uninspectable file, stale Product Master, and identity-failure inspection. Fakes cannot satisfy the final live-image acceptance criterion.

### Codex live smoke test

After automated tests pass, create an isolated fixture product, generate and inspect one real main image, lock a test Product Master, generate and inspect at least one real secondary image, generate a test Listing, and build a delivery bundle.

## 23. Version control

Initialize an independent local Git repository in `D:/Amazon/Amazon-listing-gen/`. Do not add a remote or push automatically. Commit approved design, implementation plan, RED tests/baseline, minimal Skill, deterministic utilities, templates/previews, and final verification in reviewable stages.

## 24. Acceptance summary

The implementation is complete only when it:

- runs without importing or starting old UI/server/worker code;
- asks only blocking questions and preserves fact conflicts;
- generates, saves, reinspects, and presents real raster images;
- refuses prompt-only or corrupt image success;
- locks a hashed Product Master before secondary generation;
- generates supported secondary images one at a time with per-image approval;
- preserves true physical geometry and configured main-image occupancy;
- deterministically composes and verifies critical typography;
- creates a complete grounded Listing with extended upload fields;
- labels unavailable category schema without blocking supported copy;
- preserves rejected/superseded versions and scoped invalidation;
- maintains a reviewed template snapshot and non-overwriting sync report;
- scans the actual font tree and ZIPs without fixed-count assumptions;
- produces only a version-approved, integrity-checked final bundle;
- passes automated, pressure, and live Codex tests.

