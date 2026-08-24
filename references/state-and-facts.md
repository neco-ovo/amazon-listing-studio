# State, fact authority, and Product Master

## Three runtime files

- `project.md` is the readable dossier, current stage, open questions, approvals, and change summary.
- `facts.json` stores atomic facts, normalized values, authority status, sources, conflicts, publishability, and dependent IDs.
- `assets.json` stores Product Master, storyboard, image versions, QA, approvals, Listing reference, and bundle reference.

Listing documents are generated artifacts, not a fourth runtime state source.

## Fact statuses and authority

Use `user_confirmed`, `source_observed`, `ai_suggested`, `unknown`, `conflicted`, or `not_applicable`.

Current explicit user confirmation is authoritative. A conflicting link or document remains visible but cannot overwrite it. Conflicting user confirmations are blocking and require one concise question. AI suggestions never become publishable without confirmation.

Every publishable fact records its source IDs and dependent artifact IDs. Unknown or conflicting facts cannot support image labels, Listing claims, Special Features, or category attributes.

Ask one concise question when a missing or conflicting fact blocks the current phase. Do not stop the entire project for a field that affects only a later optional card or Schema-dependent attribute; record it as `unknown` and continue supported work.

## Product Master lock

Facts alone do not create a Product Master. Lock only after the main raster has been generated, saved, decoded, hashed, inspected at its saved path, presented, and explicitly approved.

Record product identity, confirmed physical dimensions and ratio, color, material when known, variant, count, confirmed visible components, canonical source hashes, approved-main hash/path, version, and dependencies.

## Scoped invalidation

An identity fact change increments Product Master when the identity lock is revised and marks only explicit dependent images and Listing fields stale. A presentation-only change such as crop, white-background correction, exposure, or shadow replaces only affected presentation assets.

Never erase the older file, rejection, approval, or version history.

The file-first orchestration helpers are `planImageCorrection`, `approveSecondaryImage`, `recordListingApproval`, and `recordFinalApproval` in `scripts/lib/state.js`. They enforce the two-correction stop, current Product Master binding, saved hashes, sequential image approval, validated Listing state, and exact final artifact scope without a server or global singleton.
