---
name: amazon-listing-studio
description: Generate, inspect, approve, and package real Amazon product images plus fact-grounded Listing copy from user facts, product links, documents, and reference images. Use for Amazon main images, Product Master locking, secondary galleries, Listing creation, revision, or delivery; also audit existing Amazon listings from ASINs or URLs; not for automatic Seller Central publishing.
---

# Amazon Listing Studio

Select one portable `<projects-root>/<product-slug>` root before design or artifact work. Default to Amazon.com and en-US. Keep all design, image, Listing, state, and delivery files inside that product root; never use another product directory. Create only `project.md`, `product.json`, and `.studio/state.json` on init; create `assets/`, `listing/`, and `delivery/` only when needed. Do not install project-local dependencies or create project-local helper scripts.

Use **light drafts, immutable approvals, strict delivery**. Run state work through `scripts/studio.js`; use the harness for generation and inspection.

Use the existing project state for current assets and versions. At delivery, follow the file closeout rules in `references/delivery-and-compliance.md`; reuse the workspace's artifact rules without adding a parallel manifest.

## Artifact placement

Before writing an artifact, choose its concrete stage directory as well as its role. Keep the project root for core entry/fact/state files and tool-required paths. Put auxiliary proposals, preview HTML, prompts, inspection/approval inputs, revision notes, and checks under `.studio/work/<stage>/` (for example `main`, `gallery`, `listing`, or `upload`); add subdirectories only when needed. Keep formal assets in `assets/`, current Listing files in `listing/`, and upload/delivery files at their existing contracted locations. Existing state, immutable approvals/history, and other tool-required paths take precedence over this auxiliary layout.

Reuse an existing README/project/stage record as the current entry; identify parallel alternatives there. For this task's newly created auxiliary previews/drafts, move superseded, unreferenced versions into that stage's `history/`, rather than adding root-level revision files. Keep reference versions inside one topic location. Preserve approval/source evidence even when stored under work. Before ending a stage, check root clutter, delivery/intermediate separation, and the current entry; do not migrate existing project history under this rule.

## Route narrowly

- **Fast mode:** one field, Child-local fact, presentation repair, planned image, approval, or lookup. Check only the artifact and direct dependents; do not repeat research, rules, unrelated generation, or repository tests.
- **Dependency mode:** a fact currently common to a Family. Recalculate Parent/common facts and affected shared mappings, not unrelated Children.
- **Full mode:** new project or Product Master, scope/identity change, first Listing, migration, shared knowledge change, or delivery.

Read only what this step needs:

- Facts, conflicts, SellerSprite XLSX, keyword profiles: `references/knowledge-and-facts.md`.
- Images, Product Master, gallery, fonts, QA: `references/image-workflow.md`.
- Listing, rules, keywords, revisions: `references/listing-workflow.md`.
- Standalone published-ASIN/URL audit, or completed Listing content before upload preparation: `references/listing-audit.md`. An audit does not require initializing a Product Master or regenerating images.
- Parent/Child work only: `references/variation-workflow.md`; single-product work does not load it.
- Finalization, current-rule verification, packaging: `references/delivery-and-compliance.md`.
- Amazon A+ handoff: give it the root and `references/amazon-product-project-input-v1.md`; do not restate the contract.

Use one domain reference; add delivery guidance only when needed.

## Listing audit entry

For requests to inspect a published Listing, read `references/listing-audit.md` and use its online mode. For completed Listing content before upload-template preparation, use its pre-upload mode on the current copy and actual selected images. Reuse the existing bounded review, facts and validators; do not add a score-based approval or silently enter revisions.

## Main-image design selection

Before complete main-image generation, follow the design-selection gate in `references/image-workflow.md`, including optional element previews after layout selection. Generate complete mains only for the selected design and Child scope; selection is separate from Product Master approval.

## Invariants

- Explicit user facts are authoritative over links, observations, and AI suggestions. Ask once only for a blocking or conflicting fact.
- Never invent attributes, components, performance, compatibility, certification, or claims. Unknown Schema fields may remain `rules_unverified` with `upload_ready=false`; they do not block a grounded draft.
- For new image generation, call `generate_image`, save a real raster, and call `inspect_image` on the exact saved file. Existing local assets may be displayed or reused without regeneration. Image edits follow active tool instructions and require inspection of the saved result. Prompt-only or uninspectable production output fails. Use deterministic repair only for localized defects when the active tool instructions permit that method; skill guidance never overrides them.
- Lock Product Master only after the exact main raster is decoded, inspected, presented, and explicitly approved. Once the gallery plan and layout are approved, generate all planned secondary images for the current Child (or current product without variations) for one consolidated review; revise only affected images. For multiple Children, follow the representative-gallery sequence in `references/image-workflow.md` and `references/variation-workflow.md`; do not interleave same-role cards across Children.
- Reuse a matching seller-owned layout seed without reopening its source project. Remove scene props or fasteners that could imply included package contents. Repair dimension lines against measured product bounds and check regional visual balance.
- Build Title, Item Highlights, five benefit-led Bullets, Description, Backend Search Terms, Special Features, and supported details from publishable facts. Hold one consolidated Listing review and one bounded natural-language self-check.
- When SellerSprite exports are supplied, analyze them once into the product’s private sources; reuse an exact compatible profile and keep web keyword research as fallback.
- A micro revision changes only requested fields and direct dependents. Formal versions and hashes are created only on explicit approval. Approval must derive system scope from current state and use the shared finalization preflight.
- Require final approval bound to the current Product Master, selected images, Listing version, marketplace, product type, and rule status. Finalization rehashes selected artifacts and verifies the new package once.
- Run `prepare-upload` only when requested. Default to its image ZIP for manual hosting, then map the supplied R2 prefix. Use `host-images-r2` only when local Wrangler is ready. Never claim publication.

Route `intake -> main image -> Product Master -> secondary images -> Listing -> pre-upload audit (when upload delivery is in scope) -> delivery`. After final Listing approval with selected images complete, follow the audit handoff in `references/listing-audit.md` before declaring the project ready for upload-template preparation. Resume from `project.md` and `.studio/state.json`; never infer approval from files. For an old sprawling project, run `scripts/studio.js compact-project --project-dir <dir>` first; it defaults to dry-run preview, and only `--apply` changes files. Pause the affected step for a required design selection or approval under its existing workflow, an exact blocking fact, conflict, capability failure, hard QA defect, or stale dependency. Continue independent authorized work; do not repeat an existing selection or approval. A stale rule snapshot warns during drafting and blocks only current upload-ready verification.
