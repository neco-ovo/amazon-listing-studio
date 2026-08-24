---
name: amazon-listing-studio
description: Generate, inspect, approve, and package real Amazon product images plus fact-grounded Listing copy from user facts, product links, documents, and reference images. Use for Amazon main images, Product Master locking, secondary galleries, Listing creation, revision, or delivery; not for automatic Seller Central publishing.
---

# Amazon Listing Studio

Create real image and Listing artifacts through a short, approval-driven workflow. Default to Amazon.com and en-US unless the user chooses another marketplace or language.

## Start or resume a product

1. Read `references/capability-contracts.md` and confirm `ask_user`, `read_reference`, `generate_image`, `inspect_image`, and workspace-file capabilities.
2. Run `scripts/studio.js init` or resume `project.md` and `state.json` in a per-product workspace outside this Skill directory.
3. Read `references/workflow.md` before changing phase, locking Product Master, generating an image, or approving delivery. Resume from recorded state; do not infer approval from existing files.

## Progressive-disclosure route

- Intake, fact priority, conflicts, missing information, Product Master, or invalidation: read `references/state-and-facts.md`.
- Image planning, generation, saved-file inspection, font strategy, repair, main-image lock, or secondary gallery work: read only `references/image-workflow.md`.
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
- Default to a complete one-pass image, including short copy. Use deterministic typography only for requested traceability or targeted repair, then reinspect the final composite.
- Generate exactly five Listing Bullets in `[HEADING] Body` format. Include Item Highlights, Description, Backend Search Terms, Special Features, and supported attributes. Conduct one consolidated Listing review after the selected images are approved.
- When the category Schema is unavailable, mark only affected fields `rules_unverified`, set `upload_ready=false`, and do not claim or produce an upload-ready spreadsheet.
- Require final approval bound to the current Product Master, selected image versions, Listing version, marketplace, product type, and Schema status. Deliver only that scope after integrity checks with `scripts/build-delivery.js`.

Existing work, ownership, or urgency never bypasses these gates. Six already-generated images do not authorize bulk approval or Product Master lock. User ownership does not replace inspection of the exact saved files. “Publish now” does not remove `rules_unverified` or make `upload_ready` true.

## Phase route

`intake -> main image -> Product Master -> secondary images -> Listing -> delivery`

At intake, ask one concise question whenever information blocking the current phase is missing or user confirmations conflict. During image work, keep rejected files without full approval provenance and attempt at most one unpresented automatic correction. During Listing work, use approved publishable facts only. Any fact or Product Master change makes only its explicit dependents stale.

## Image route

Read `references/image-workflow.md`, compile one compact brief, call `generate_image`, inspect the exact saved file, and use `scripts/studio.js record-candidate`. Present a passing candidate once. After explicit approval, use `scripts/studio.js approve`; its returned action either locks Product Master or continues to the next already-planned gallery item.

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
