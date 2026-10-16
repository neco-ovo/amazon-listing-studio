---
name: amazon-listing-studio
description: Generate, inspect, approve, and package real Amazon product images plus fact-grounded Listing copy from user facts, product links, documents, and reference images. Use for Amazon main images, Product Master locking, secondary galleries, Listing creation, revision, or delivery; not for automatic Seller Central publishing.
---

# Amazon Listing Studio

Select one portable `<projects-root>/<product-slug>` root before design or artifact work. Default to Amazon.com and en-US. Keep all design, image, Listing, state, and delivery files inside that product root; never use another product directory. Create only `project.md`, `product.json`, and `.studio/state.json` on init; create `assets/`, `listing/`, and `delivery/` only when needed. Do not install project-local dependencies or create project-local helper scripts.

Use **light drafts, immutable approvals, strict delivery**. Run state work through `scripts/studio.js`; use the harness for generation and inspection.

## Route narrowly

- **Fast mode:** one field, Child-local fact, presentation repair, planned image, approval, or lookup. Check only the artifact and direct dependents; do not repeat research, rules, unrelated generation, or repository tests.
- **Dependency mode:** a fact currently common to a Family. Recalculate Parent/common facts and affected shared mappings, not unrelated Children.
- **Full mode:** new project or Product Master, scope/identity change, first Listing, migration, shared knowledge change, or delivery.

Read only what this step needs:

- Facts, conflicts, SellerSprite XLSX, keyword profiles: `references/knowledge-and-facts.md`.
- Images, Product Master, gallery, fonts, QA: `references/image-workflow.md`.
- Listing, rules, keywords, revisions: `references/listing-workflow.md`.
- Parent/Child work only: `references/variation-workflow.md`; single-product work does not load it.
- Finalization, current-rule verification, packaging: `references/delivery-and-compliance.md`.
- Amazon A+ handoff: give it the root and `references/amazon-product-project-input-v1.md`; do not restate the contract.

Use one domain reference; add delivery guidance only when needed.

## Invariants

- Explicit user facts are authoritative over links, observations, and AI suggestions. Ask once only for a blocking or conflicting fact.
- Never invent attributes, components, performance, compatibility, certification, or claims. Unknown Schema fields may remain `rules_unverified` with `upload_ready=false`; they do not block a grounded draft.
- Call `generate_image` for every image, save a real raster, and call `inspect_image` on the exact saved file. Prompt-only or uninspectable output fails. Use deterministic repair only for localized defects.
- Lock Product Master only after the exact main raster is decoded, inspected, presented, and explicitly approved. Once the gallery plan and layout are approved, generate all planned secondary images for one consolidated review; revise only affected images.
- Reuse a matching seller-owned layout seed without reopening its source project. Remove scene props or fasteners that could imply included package contents. Repair dimension lines against measured product bounds and check regional visual balance.
- Build Title, Item Highlights, five benefit-led Bullets, Description, Backend Search Terms, Special Features, and supported details from publishable facts. Hold one consolidated Listing review and one bounded natural-language self-check.
- When SellerSprite exports are supplied, analyze them once into the product’s private sources; reuse an exact compatible profile and keep web keyword research as fallback.
- A micro revision changes only requested fields and direct dependents. Formal versions and hashes are created only on explicit approval. Approval must derive system scope from current state and use the shared finalization preflight.
- Require final approval bound to the current Product Master, selected images, Listing version, marketplace, product type, and rule status. Finalization rehashes selected artifacts and verifies the new package once.
- Run `scripts/studio.js prepare-upload` only for a requested upload workbook. On `hosting_required`, ask once about hosting and unresolved account/offer values; after exact URL mapping, report `upload-ready` or `manual-prep`. Never claim publication.

Route `intake -> main image -> Product Master -> secondary images -> Listing -> delivery`. Resume from `project.md` and `.studio/state.json`; never infer approval from files. For an old sprawling project, run `scripts/studio.js compact-project --project-dir <dir>` first; it defaults to dry-run preview, and only `--apply` changes files. Stop only for the exact blocking fact, conflict, capability failure, hard QA defect, or stale dependency. A stale rule snapshot warns during drafting and blocks only current upload-ready verification.
