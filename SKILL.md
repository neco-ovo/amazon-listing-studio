---
name: amazon-listing-studio
description: Generate, inspect, approve, and package real Amazon product images plus fact-grounded Listing copy from user facts, product links, documents, and reference images. Use for Amazon main images, Product Master locking, secondary galleries, Listing creation, revision, or delivery; not for automatic Seller Central publishing.
---

# Amazon Listing Studio

Create real image and Listing artifacts through a short, approval-driven workflow. Default to Amazon.com and en-US unless the user chooses another marketplace or language.

## Start or resume

1. Read `references/capability-contracts.md` and confirm `ask_user`, `read_reference`, `generate_image`, `inspect_image`, and workspace-file capabilities.
2. Create or resume `project.md`, `facts.json`, and `assets.json` in a per-product workspace outside this Skill directory.
3. Read `references/workflow.md` before changing phase, locking Product Master, generating an image, or approving delivery.

## Hard rules

- Treat current explicit user facts as authoritative over links, documents, market observations, and AI suggestions. Preserve conflicts visibly. Ask when two user confirmations conflict.
- Never invent dimensions, material, quantity, components, back construction, installation, compatibility, certification, performance, or other publishable claims.
- Call `generate_image` for every requested image. Save and present a real raster, then call `inspect_image` on the saved file.
- Treat a prompt-only response, missing path, corrupt file, unsaved output, or uninspectable file as `CAPABILITY_FAILURE`. Stop; never call it a completed image.
- Do not lock Product Master from facts or a plan alone. Lock only after a real main raster is saved, checked, presented, and explicitly approved.
- Do not generate secondary images before the current Product Master is locked. Use that master as the first authoritative product reference.
- Generate secondary images one at a time. Check and obtain explicit approval for each. Replace unsupported back/installation cards with supported alternatives.
- Do not trust generative text for critical infographic copy, dimensions, units, or callouts. Add them deterministically and reinspect the composite.
- Generate exactly five Listing Bullets. When the category Schema is unavailable, mark only affected fields `rules_unverified`, set `upload_ready=false`, and do not claim or produce an upload-ready spreadsheet.
- Deliver only the currently identified, version-bound image set and Listing after consolidated approval and integrity checks.

## Phase route

`intake -> main image -> Product Master -> secondary images -> Listing -> delivery`

At intake, ask only questions blocking the current phase. During image work, preserve rejected files as new historical versions and attempt at most two targeted automatic corrections. During Listing work, use approved publishable facts only. Any fact or Product Master change makes only its explicit dependents stale.

## Stop conditions

Stop and name the exact capability, field, file, or dependency when input is blocking, image capability fails, hard QA fails, or an artifact is stale. `rules_unverified` is a warning path: supported copy may continue after one concise user confirmation, but upload readiness remains false.
