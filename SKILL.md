---
name: amazon-listing-studio
description: Generate, inspect, approve, and package real Amazon product images plus fact-grounded Listing copy from user facts, product links, documents, and reference images. Use for Amazon main images, Product Master locking, secondary galleries, Listing creation, revision, or delivery; not for automatic Seller Central publishing.
---

# Amazon Listing Studio

Create real Amazon image and Listing artifacts in a per-product workspace. Default to Amazon.com and en-US unless the user requests another marketplace or language. Run deterministic state work through `scripts/studio.js`; use the active harness for real image generation and inspection.

## Choose one mode

- **Fast mode:** one Listing field, presentation-only image repair, next approved gallery item, candidate recording, approval, or local knowledge lookup. Validate only the changed field or current artifact. Do not repeat market research, rule refresh, unrelated image work, or repository-wide tests.
- **Full mode:** new project, first Product Master, product identity/marketplace/product-type change, first Listing draft, migration, shared knowledge change, or final delivery. Validate the affected dependency scope.

## Read only the relevant reference

- Facts, missing information, conflicts, reusable category language, or seller-family claims: `references/knowledge-and-facts.md`.
- Main image, Product Master, gallery, fonts, image QA, or repairs: `references/image-workflow.md`.
- Listing drafting, conversion hierarchy, rule cache, keywords, or revisions: `references/listing-workflow.md`.
- Read `references/delivery-and-compliance.md` only when finalizing, verifying current upload rules, or packaging delivery.

Use at most one domain reference for ordinary work. Add the delivery reference only for finalization. Do not read every capability or workflow document at startup.

## Hard boundaries

- Treat current explicit user facts as authoritative over links, documents, market observations, and AI suggestions. Ask one concise question when a fact blocking the current step is missing or two user confirmations conflict.
- Never invent dimensions, material, quantity, components, back construction, installation, compatibility, certification, performance, or another publishable claim. Category observations guide market language; only current project or approved seller-family facts support claims.
- Match seller families by stable material and product-form traits rather than exact Amazon categories. Before formal image or Listing work, ask one consolidated question for process-dependent family claims whose applicability is still unknown; record the answer at project or manufacturing-family scope.
- Call `generate_image` for every requested image using the active harness. Save a real raster and call `inspect_image` on the exact saved file. A prompt-only response, missing path, corrupt file, or uninspectable file is `CAPABILITY_FAILURE`.
- Lock Product Master only after the exact main raster is saved, decoded, inspected, presented, and explicitly approved. Generate secondary images one at a time from the locked master and obtain explicit approval before the next.
- Default to a complete one-pass image with short copy. Use deterministic typography for requested traceability or targeted repair, then inspect the final composite again.
- Treat scene props and visible fasteners as product claims when they could imply included package contents. Keep unconfirmed screws, hooks, brackets, tools, and accessories out of the composition.
- Anchor repaired dimension lines to measured product bounds, not isolated canvas coordinates. Check regional visual balance so an empty corridor cannot pass merely because every element remains in-canvas.
- Build Listing copy from publishable facts. Generate Title, Item Highlights, exactly five benefit-led Bullets, Description, Backend Search Terms, Special Features, and supported product details. Hold one consolidated Listing review.
- A micro revision changes only requested fields and direct dependents. It increments the mutable draft revision, not the formal Listing version. Formal version and hashes are created only on explicit Listing approval.
- When only category Schema fields are unverified, preserve supported copy, mark affected fields `rules_unverified`, set `upload_ready=false`, and do not claim upload readiness.
- Require final approval bound to the current Product Master, selected images, Listing version, marketplace, product type, and rule status. Finalization rehashes every selected artifact.

## Phase route

`intake -> main image -> Product Master -> secondary images -> Listing -> delivery`

Resume from `project.md` and `state.json`; do not infer approval from files. During image work, allow at most one unpresented automatic correction. During Listing work, apply only requested revisions. A fact or Product Master change invalidates only explicit dependents.

## Stop conditions

Stop and name the exact missing field, conflict, failed capability, hard QA defect, or stale dependency. A stale rule snapshot does not block a grounded draft; it warns. Current verification and upload-ready finalization require an applicable fresh snapshot.
