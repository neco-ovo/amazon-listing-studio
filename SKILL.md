---
name: amazon-listing-studio
description: Generate, inspect, approve, and package real Amazon product images plus fact-grounded Listing copy from user facts, product links, documents, and reference images. Use for Amazon main images, Product Master locking, secondary galleries, Listing creation, revision, or delivery; not for automatic Seller Central publishing.
---

# Amazon Listing Studio

Select the product root before design or artifact work: one portable `<projects-root>/<product-slug>` directory. Default to Amazon.com and en-US. Preserve existing design documents; never use the projects root, Skill repository, or another product directory. Keep all design, image, Listing, state, and delivery files inside that product root.

Use **light drafts, immutable approvals, strict delivery**. Run deterministic state work through `scripts/studio.js`; use the active harness for generation and inspection.

## Route narrowly

- **Fast mode:** one Listing field, Child-local fact, presentation-only repair, planned gallery item, candidate, approval, or knowledge lookup. Check only the changed artifact and direct dependents; do not repeat research, rule refresh, unrelated generation, or repository tests.
- **Dependency mode:** a fact currently common to a Family. Recalculate Parent/common facts and affected shared mappings, not unrelated Children.
- **Full mode:** new project or Product Master, identity/theme/marketplace/product-type change, first Listing, migration, shared knowledge change, or final delivery.

Read only what the current step needs:

- Facts, conflicts, category language: `references/knowledge-and-facts.md`.
- Images, Product Master, gallery, fonts, QA: `references/image-workflow.md`.
- Listing, rules, keywords, revisions: `references/listing-workflow.md`.
- Parent/Child Variation work only: `references/variation-workflow.md`; the ordinary single-product path does not load it.
- Finalization, current-rule verification, packaging: `references/delivery-and-compliance.md`.

Use at most one domain reference for ordinary work; add delivery guidance only when needed.

## Invariants

- Current explicit user facts are authoritative over links, observations, and AI suggestions. Ask one concise question only for a fact blocking the current step or conflicting user confirmations.
- Never invent product attributes, components, performance, compatibility, certification, or publishable claims. Unknown category Schema fields may remain `rules_unverified` with `upload_ready=false`; they do not block a grounded draft.
- Call `generate_image` for every requested image. Save a real raster and call `inspect_image` on the exact saved file; prompt-only, corrupt, missing, or uninspectable output is a capability failure. Use deterministic repair only for localized defects.
- Lock Product Master only after the exact main raster is decoded, inspected, presented, and explicitly approved. The first secondary is approved separately to establish the visual system; follow the bounded batch policy in the image reference.
- Reuse a matching seller-owned layout seed without reopening its source project. Remove scene props or fasteners that could imply included package contents. Repair dimension lines against measured product bounds and check regional visual balance.
- Build Title, Item Highlights, five benefit-led Bullets, Description, Backend Search Terms, Special Features, and supported details from publishable facts. Hold one consolidated Listing review and one bounded natural-language self-check.
- A micro revision changes only requested fields and direct dependents. Formal versions and hashes are created only on explicit approval. Approval must derive system scope from current state and use the shared finalization preflight.
- Require final approval bound to the current Product Master, selected images, Listing version, marketplace, product type, and rule status. Finalization rehashes selected artifacts and verifies the new package once.

Route `intake -> main image -> Product Master -> secondary images -> Listing -> delivery`. Resume from `project.md` and `state.json`; never infer approval from files. Stop only for the exact blocking fact, conflict, capability failure, hard QA defect, or stale dependency. A stale rule snapshot warns during drafting and blocks only current upload-ready verification.
