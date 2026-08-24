---
name: amazon-listing-studio
description: Generate, inspect, approve, and package real Amazon product images plus fact-grounded Listing copy from user facts, product links, documents, and reference images. Use for Amazon main images, Product Master locking, secondary galleries, Listing creation, revision, or delivery; not for automatic Seller Central publishing.
---

# Amazon Listing Studio

Create real image and Listing artifacts through a short, approval-driven workflow. Default to Amazon.com and en-US unless the user chooses another marketplace or language.

## Start or resume a product

1. Read `references/capability-contracts.md` and confirm `ask_user`, `read_reference`, `generate_image`, `inspect_image`, and workspace-file capabilities.
2. Run `scripts/init-project.js` or resume `project.md`, `facts.json`, and `assets.json` in a per-product workspace outside this Skill directory.
3. Read `references/workflow.md` before changing phase, locking Product Master, generating an image, or approving delivery. Resume from recorded state; do not infer approval from existing files.

## Progressive-disclosure route

- Intake, fact priority, conflicts, missing information, Product Master, or invalidation: read `references/state-and-facts.md`.
- Image planning, canvas, physical ratio, template choice, main image, or secondary storyboard: read `references/image-generation.md`.
- Saved-image inspection, Amazon main-image raster checks, corrections, or semantic QA: read `references/image-qa.md`.
- Local/ZIP/network fonts or exact dimension/callout composition: read `references/font-selection.md`.
- Title, Item Highlights, five Bullets, Description, search terms, Special Features, attributes, or conversion review: read `references/listing-copy-playbook.md`.
- Current limits, category Schema, prohibited content, or `upload_ready`: read `references/listing-and-compliance.md`.

## Hard rules

- Treat current explicit user facts as authoritative over links, documents, market observations, and AI suggestions. Preserve conflicts visibly. Ask when two user confirmations conflict.
- Never invent dimensions, material, quantity, components, back construction, installation, compatibility, certification, performance, or other publishable claims.
- Call `generate_image` for every requested image by invoking the active harness's real image-generation capability. Save and present a real raster, then use `inspect_image` to inspect the exact saved file.
- Treat a prompt-only response, missing path, corrupt file, unsaved output, or uninspectable file as `CAPABILITY_FAILURE`. Stop; never call it a completed image.
- Do not lock Product Master from facts or a plan alone. Lock Product Master only after a real main raster is saved, decoded, hashed, inspected, presented, and explicitly approved.
- Do not generate secondary images before the current Product Master is locked. Use that master as the first authoritative product reference.
- Generate secondary images one at a time. Inspect the saved file and obtain explicit approval before generating the next. Replace unsupported back/installation cards with supported alternatives.
- Do not trust generative text for critical infographic copy, dimensions, units, or callouts. Add them deterministically and reinspect the composite.
- Generate exactly five Listing Bullets in `[HEADING] Body` format. Include Item Highlights, Description, Backend Search Terms, Special Features, and supported attributes. Conduct one consolidated Listing review after the selected images are approved.
- When the category Schema is unavailable, mark only affected fields `rules_unverified`, set `upload_ready=false`, and do not claim or produce an upload-ready spreadsheet.
- Require final approval bound to the current Product Master, selected image versions, Listing version, marketplace, product type, and Schema status. Deliver only that scope after integrity checks with `scripts/build-delivery.js`.

Existing work, ownership, or urgency never bypasses these gates. Six already-generated images do not authorize bulk approval or Product Master lock. User ownership does not replace inspection of the exact saved files. “Publish now” does not remove `rules_unverified` or make `upload_ready` true.

## Phase route

`intake -> main image -> Product Master -> secondary images -> Listing -> delivery`

At intake, ask one concise question whenever information blocking the current phase is missing or user confirmations conflict. During image work, preserve rejected files as historical versions and attempt at most two targeted automatic corrections. During Listing work, use approved publishable facts only. Any fact or Product Master change makes only its explicit dependents stale.

## Image sequence

1. Separate confirmed physical ratio from canvas ratio. For a confirmed 12 × 8 face, preserve 3:2 even on a square canvas.
2. Generate and save the main image. For the Amazon main image, use a white background, one complete product, and no promotional or unrelated text. Resolve occupancy from the current marketplace/category rule; use Amazon.com's 85% base when no stricter rule is verified, and apply a stricter user/project target such as 95% only where requested. Keep the product fully visible. Run `scripts/validate-image.js`, then perform semantic saved-file inspection.
3. Present the candidate and findings. Only explicit approval may lock Product Master.
4. Plan the default gallery: three distinct application scenes, one size/spec card, one material/detail card, and one back/structure card. Replace a card whose required facts are unavailable.
5. Generate, inspect, present, and approve each secondary sequentially. Use the locked Product Master as the first identity reference.
6. For exact text, choose a font using `scripts/scan-fonts.js`, compose with `scripts/compose-overlay.js`, and inspect the final composite—not only the generated base.

## Listing and delivery sequence

1. Draft only after the selected image set is current. Default non-media title maximum is 75 characters and Item Highlights maximum is 125 characters; current product-type Schema overrides conservative defaults.
2. Link every publishable claim to approved fact IDs. Validate with `scripts/validate-listing.js`.
3. Present Title, Item Highlights, five Bullets, Description, Backend Search Terms, Special Features, attributes, claim references, and any Schema warnings together for one consolidated review.
4. Apply only requested revisions, increment Listing version, revalidate, and request final approval for the exact version-bound scope.
5. Build a new integrity-checked bundle; never overwrite the last valid bundle with a partial build.

## Miniature grounded example

The user confirms: “The sign is aluminum, 12 W × 8 L inches, one sign.” Record those as user-confirmed facts even if a link says 10 × 7. Ask only for a conflicting user confirmation or another fact needed by the current image.

- Preserve a 3:2 physical face ratio. Generate a real white-background main image, validate saved geometry, inspect identity and inventions, present it, and lock Product Master v1 only after explicit approval.
- Generate a size secondary from Product Master v1. Add exact `12 in` and `8 in` arrows deterministically from the confirmed dimension fact, inspect the final saved composite, and request approval before the next card.
- A grounded title may be `12 x 8 Inch Aluminum Notice Sign` with claim references `type`, `size`, and `material`. Complete Item Highlights, five `[HEADING] Body` Bullets, Description, search terms, Special Features, and attributes before the consolidated Listing review.

## Stop conditions

Stop and name the exact capability, field, file, or dependency when input is blocking, image capability fails, hard QA fails, or an artifact is stale. `rules_unverified` is a warning path: supported copy may continue after one concise user confirmation, but upload readiness remains false.
