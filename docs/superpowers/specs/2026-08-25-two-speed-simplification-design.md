# Amazon Listing Studio Two-Speed Simplification Design

**Date:** 2026-08-25
**Status:** User-approved design
**Supersedes:** The runtime, image, Listing, approval, and verification sections of `2026-08-24-amazon-listing-studio-design.md` where they conflict with this document.

## 1. Objective

Reduce time, token use, repeated research, and unnecessary image-generation calls while preserving the quality controls that materially protect product identity, factual accuracy, approval scope, and final delivery integrity.

The Skill remains named `amazon-listing-studio` and remains Codex-primary. It does not add a WebUI, HTTP server, worker system, or complex harness adapter.

## 2. Problems demonstrated by the real-product tes

The completed safety-sign project reached state version 35 and accumulated a 48 KB `assets.json`. One size card reached ten versions even though several corrections were local alignment changes. A single Listing sentence revision was processed like a full rewrite. The failures are architectural:

- every operation follows one high-ceremony path regardless of impact;
- category research is project-local and repeatedly rediscovered;
- market language and publishable facts lack a reusable permission boundary;
- planning, generation, inspection, hashing, approval, and state updates are split across too many turns and commands;
- exact typography repair became a default generation strategy instead of a fallback;
- rule verification is repeated even when a dated local snapshot remains applicable;
- working drafts become immutable versions too early;
- `project.md`, `facts.json`, and `assets.json` duplicate state and chronicle incidental attempts;
- tests sometimes assert documentation wording rather than observable workflow behavior;
- case-specific fixes accumulate instead of being generalized into reusable invariants.

SHA-256 computation is retained where it protects an approval or delivery. It is not the main latency source; manual orchestration and repeated validation are.

## 3. Non-negotiable quality boundaries

- Current explicit user facts override product-family defaults, source observations, market observations, and AI suggestions.
- Conflicting current user confirmations remain blocking.
- Product Master is locked only from an exact saved main image explicitly approved by the user.
- Secondary images use the current locked Product Master as their first identity reference.
- Images must not imply unconfirmed included components, accessories, certifications, performance, or construction.
- Publishable deterministic claims require a project fact or an applicable seller-family fact.
- Every presented final raster receives saved-file visual inspection.
- Final delivery recalculates all selected-file hashes and validates all dependencies.

Everything else is eligible for risk-scoped simplification.

## 4. Two-speed operation router

`classifyOperation()` selects a mode from observable change impact; the user does not choose a mode for routine work.

### Full mode

Use for a new project, first Product Master, product-identity changes, marketplace or product-type changes, first complete Listing draft, final delivery, state-schema migration, and Skill code or rule changes.

Full mode performs the complete relevant fact, identity, semantic, rule, dependency, and integrity checks.

### Fast mode

Use for a local copy edit, presentation-only image edit, next secondary from an approved gallery plan, approval registration, shared-library lookup, or another change whose dependencies are already current.

Fast mode validates only the changed artifact and its direct dependents. It must not silently invoke market research, network rule refresh, unrelated media work, a full Listing rewrite, or the complete repository test suite.

The router returns both `mode` and machine-readable `reasons` so tests and users can see why work was escalated.

## 5. Runtime project state

New projects use one machine source and one generated human view:

```tex
product-project/
├─ project.md
├─ state.json
├─ references/
├─ images/
├─ listing/
└─ delivery/
```

`state.json` schema version 2 contains current project identity, atomic facts, Product Master, gallery plan, current and approved image records, Listing working draft and approved snapshots, approvals, stale dependencies, delivery, and lightweight operation metrics.

`project.md` is rendered from `state.json`. It shows only current facts, Product Master, selected images, Listing status, open questions, warnings, and delivery status. It is not an append-only transcript.

Approved files and approved versions remain immutable. Rejected image files may remain on disk, but state retains only a compact record with ID, status, and reusable reason code. Incidental aesthetic history is not promoted into Skill guidance.

Writes are transactional: validate the next state, write a sibling temporary file, atomically rename it, then render `project.md`. Failure leaves the previous state intact.

## 6. Shared knowledge library

Learned data lives outside the installed Skill and outside individual product projects:

```tex
amazon-listing-library/
├─ categories/<marketplace>/<category-id>.json
├─ seller-families/<family-id>.json
└─ rules/<marketplace>/<rule-set>.json
```

### Category observations

Store purchase intents, shopper vocabulary, typical application scenes, gallery structures, candidate selling points, source links, observation dates, and confidence. They may be reused automatically for scene planning, market positioning, natural language, and keyword expansion. They cannot alone support a deterministic product claim.

### Seller-family defaults

Store facts the user has explicitly confirmed as applicable to a named product family. Match families from stable material and product-form traits rather than requiring the same Amazon category, so rigid aluminum yard, store, and safety signs may share one family. Category labels remain hints. Structural family claims may support matching projects without repeated confirmation. Process-dependent claims such as fade resistance, reflectivity, or waterproofing require matching process evidence or one consolidated user confirmation before formal image and Listing work. Record that answer at project scope or, when the manufacturing series shares the process, at seller-family scope. Scope, confirmation date, and source action are required.

### Project facts

Store current-product facts. They have highest authority and can override a family default. A conflict between a project fact and category observation is not blocking; the project fact wins and the observation remains market context.

The safety-sign research from the completed test may seed a category observation. Confirmed facts from that single product are not automatically promoted to a seller-family scope.

## 7. Image workflow

### Compact prompt compilation

Each image has one compact generation brief containing Product Master invariants, image goal, permitted claims, source roles, exclusions, layout requirements, text strategy, and a difference plan. The difference plan is part of the generation brief, not a separate approval artifact.

Ask a question only when missing information can change product identity, a publishable claim, or the requested concept.

### Reference adaptation

By default preserve product structure, printed copy, palette, warning semantics, and defining motifs. The user may explicitly authorize changes to those elements. If Product Master is already locked, an authorized identity change creates a new Product Master.

Without a more specific user request, typography, type scale, line breaks, region heights, visual center, spacing, negative space, and local composition may be changed or extended. New visual or information modules must use permitted facts.

To avoid copying, the default difference plan makes at least two coherent presentation adaptations while retaining recognizable product identity. Suitable adaptations include orientation-aware hierarchy, emphasis typography, line spacing, region proportions, and visual-mass placement. Novelty for its own sake is rejected.

### Text strategy

Default to speed-first, one-pass generation of the complete image including short copy. Local fonts and Google Fonts may guide visual style without claiming exact font embedding. Use deterministic font composition only when the user requests traceability or when an otherwise accepted image has a localized exact-text failure. Do not default to a text-free base.

### Gallery execution

Create the gallery plan once after Product Master lock. Generate secondaries one at a time. Do not request a separate concept approval for each already-planned card. When the user approves a card, register it and continue to the next supported plan item in the same turn.

### Repair ladder

1. Use a deterministic local edit for centering, placement, crop bounds, label size, dimension-line geometry, or another presentation-only correction.
2. Use one targeted AI edit based on the existing image when pixels must be regenerated.
3. Regenerate the complete image only when the first two methods cannot solve the defect.

Permit at most one unpresented automatic correction. If it fails, show the diagnosed issue and proposed next action before consuming another generation call.

### Candidate checks and hashing

Before presentation, decode the file, run only relevant geometry/file checks, and inspect the exact saved raster once. Compute SHA-256 when an image is approved, when Product Master is locked, and during final delivery. A rejected ordinary candidate does not need final-grade provenance work.

## 8. Listing workflow

### Complete draf

The first draft merges project facts, applicable seller-family facts, and category market language. It generates Title, Item Highlights, five Bullets, Description, Backend Search Terms, Special Features, supported attributes, and claim references in one pass.

Field intent is explicit:

- Title identifies the product and selection-defining details.
- Item Highlights uses the highest-value purchase intent or benefit not already carried by the Title.
- Bullets use benefit-led headings followed by verified features and practical consequences.
- Description resolves remaining purchase questions without replaying all Bullets.
- Backend Search Terms add relevant alternate shopper language not already adequately covered on the front end.
- Attributes express structured facts rather than marketing filler.

Combine related facts into natural US consumer language. Separate material performance, use environment, and mounting surface into logical clauses. Avoid empty `supports`, `provides`, and `suits` constructions; these verbs remain acceptable when followed by a concrete result. Avoid mechanical stacks of repeated `-resistant` forms.

### Working draft lifecycle

`listing/draft.json` is the mutable working draft and `listing/draft.md` is rendered from it. Review edits update only requested fields. Formal versions are created only on approval: `listing/v1.json`, `listing/v1.md`, then a future `v2-draft` that freezes as v2 when approved.

A micro revision preserves all unselected content, updates fact references only where affected, and performs only relevant length, fact, prohibited-content, and cross-field keyword checks. It never invokes market research, image generation, or network rule refresh.

### Rule cache

Use dated local rule snapshots. The default refresh interval is 90 days. Drafting continues with a stale warning when a refresh is not required for the requested outcome. Refresh when the marketplace or product type changes, a known conflict appears, the user explicitly requests current verification, or upload-ready output is requested with an expired or missing applicable snapshot.

Unavailable product-type schema keeps affected fields `rules_unverified` and `upload_ready=false`; it does not force repeated confirmation on every copy edit.

## 9. Approval and validation

One `studio.js` command surface replaces manual orchestration. Public subcommands are `init`, `learn-category`, `record-candidate`, `approve`, `revise-listing`, `validate`, `finalize`, and `migrate`.

Approval is one transaction: identify the exact presented artifact, calculate its hash, bind Product Master and facts, update state, run artifact validation, and render `project.md`. A final approval never overwrites the artifact-specific approval ID.

Validation scopes are:

- `changed`: the changed field or presentation artifact and direct dependents;
- `artifact`: one approvable image or Listing plus its required bindings;
- `final`: every selected artifact, hash, approval, dependency, and bundle member.

Repository-wide tests run only when Skill code, rule logic, or schema changes. Product-project content changes use the relevant runtime scope.

## 10. Skill structure

```tex
amazon-listing-studio/
├─ SKILL.md
├─ references/
│  ├─ knowledge-and-facts.md
│  ├─ image-workflow.md
│  ├─ listing-workflow.md
│  └─ delivery-and-compliance.md
├─ scripts/
│  ├─ studio.js
│  └─ lib/
├─ assets/
│  ├─ templates/
│  └─ rule-seeds/
└─ tests/
   ├─ unit/
   ├─ workflow/
   └─ fixtures/
```

`SKILL.md` is a short mode router and quality-boundary document. A task reads only the relevant reference. Existing specialized CLI filenames may remain temporarily as compatibility wrappers, but new orchestration uses `studio.js`.

## 11. Testing and migration

Apply RED-GREEN-REFACTOR to production code and Skill behavior. Tests assert effects and forbidden calls, not merely documentation phrases.

Required behavior tests cover authority merging, fast/full routing, transactional writes, validation scopes, micro-copy isolation, rule-cache decisions, compact prompt compilation, repair selection, approval hashing, final rehashing, and legacy migration.

Migrate a copy of the completed safety-sign project. Preserve its Product Master, selected approved images, Listing v3, final approval, and delivery reference. Do not mutate the original project automatically.

Use existing rasters and fake capabilities for implementation tests. Do not regenerate a gallery merely to validate orchestration.

## 12. Acceptance criteria

- A new project uses `project.md` and `state.json` as its only runtime state files.
- Category observations cannot become product claims without family or project authority.
- An applicable seller-family fact is reusable without repeated confirmation and is overridden by a current project fact.
- A micro-copy revision changes only selected fields and makes no network, market-research, or image call.
- A presentation-only image correction selects the cheapest valid repair route.
- Prompt compilation includes coherent anti-copy adaptations and respects explicit user redesign authority.
- Candidate processing does not hash ordinary rejected files.
- One approval command hashes, binds, validates, updates, and renders atomically.
- A successful approval can return the next gallery action without another continue prompt.
- Rule snapshots are reused within the refresh interval.
- Listing versions freeze only on approval.
- Final delivery rehashes and validates every selected artifact.
- Legacy-project migration passes on a copy of the completed test project.
- The complete automated suite passes without requiring a new paid image generation.
