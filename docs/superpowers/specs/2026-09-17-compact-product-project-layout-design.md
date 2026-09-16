# Compact Product Project Layout Design

**Date:** 2026-09-17
**Status:** Approved design

## Goal

Reduce visible project clutter and disk usage while exposing a stable product-fact, image, and Listing interface for future skills such as Amazon A+ generation. New projects use one compact layout; old projects receive a one-time compaction path rather than permanent dual-layout support.

## Project contract

```text
<product-root>/
├─ project.md
├─ product.json
├─ assets/
├─ listing/
├─ delivery/
└─ .studio/
```

Only `project.md` and `.studio/state.json` are created at initialization. Every other directory is created when first needed.

- `project.md`: readable current-stage summary.
- `product.json`: canonical publishable product facts and current artifact index.
- `assets/`: current approved product images and retained user references.
- `listing/`: current approved single, Parent, and Child Listing content.
- `delivery/`: current verified package and optional upload workbook.
- `.studio/`: workflow state, work files, sources, bounded history, and notes.

Product projects never contain `node_modules` or project-specific transaction scripts. Tools and dependencies remain in the Skill installation.

## Formal and internal data

`product.json`, `assets/`, and `listing/` are the reusable input surface. `.studio/` is private workflow state and must not be required by downstream content skills.

`product.json` contains only confirmed publishable facts, approved claims, excluded claims, current Variation relationships, and relative paths to current approved assets and Listings. Market observations, unresolved conflicts, approvals, hashes, candidate status, logs, and raw keyword evidence remain under `.studio/`.

Parent-common facts are stored once. A Child stores its exact variation values and genuine overrides only. A single-product project omits the `variation` member.

The standalone consumer specification is `references/amazon-product-project-input-v1.md`.

## Asset and Listing layout

Single-product projects may place current images directly under `assets/` and current Listing files directly under `listing/`.

Variation projects use:

```text
assets/
├─ shared/
└─ children/<sku>/

listing/
├─ parent/
└─ children/<sku>/
```

Artifact paths in `product.json` are project-root-relative POSIX paths. The index, not directory scanning, determines which files are current inputs.

## Work and retention

```text
.studio/
├─ state.json
├─ work/images/
├─ work/listing/
├─ sources/market/
├─ sources/documents/
├─ history/
└─ notes/
```

Cleanup happens at successful lifecycle transitions without another approval step:

- Image approval removes rejected and superseded unapproved candidates for that role.
- Listing approval removes obsolete drafts.
- A newly verified delivery atomically replaces the previous delivery.
- ZIP extraction copies, spreadsheet lock files, inspection logs, and generated previews are removed after successful validation.
- Empty directories are removed.

Never automatically delete current approved artifacts, `product.json`, the current delivery, user-supplied source files, or user-marked notes. Retain at most one prior approved image per role and one prior approved Listing in `.studio/history/`. Retain delivery metadata, not old delivery binaries.

## Fact changes and invalidation

`product.json` is the formal fact source. `.studio/state.json` stores workflow state and unresolved evidence, not a second publishable fact ledger.

A fact edit updates only that fact and invalidates artifacts that explicitly depend on it. Unrelated images, Listings, and Children remain current. Before replacing formal facts, retain one previous `product.json` under `.studio/history/`.

## Delivery

`delivery/` contains only the latest verified `delivery.zip`, its manifest, and the latest requested upload workbook or URL mapping. Manual verification directories, extracted archives, dated output trees, and workbook preview images are temporary.

## Old-project compaction

Provide one command:

```text
studio compact-project --project-dir <old-project>
```

It first produces a dry-run report, then stages the compact layout, validates every indexed formal artifact, and swaps layouts only after validation succeeds. It preserves user inputs and current approved artifacts while removing project-local dependencies, temporary scripts, rejected candidates, extracted deliveries, previews, lock files, and empty directories.

The new runtime does not maintain two ordinary path systems. Old-layout support exists only inside this one-time compactor.

## Implementation scope

Implement:

- lazy project initialization;
- `product.json` creation, validation, and targeted updates;
- compact single-product and Variation paths;
- lifecycle cleanup;
- compact delivery replacement;
- one-time old-project compaction;
- the reusable v1 input contract;
- regression tests for initialization, facts, assets, Listings, Variation scope, cleanup safety, compaction atomicity, and downstream discovery.

Do not implement A+ generation, Seller Central publishing, cloud asset management, a general version-control system, or permanent old-path compatibility.

## Acceptance criteria

- A new project begins with two files and no empty business directories.
- A completed project has no more than four visible business directories plus `.studio/`.
- No project contains `node_modules` or generated transaction scripts.
- A consumer can locate all current facts, approved images, and approved Listings from `product.json` without reading `.studio/` or scanning candidates.
- Cleanup cannot remove user sources or current approved artifacts.
- Compaction either completes with a valid v1 project or leaves the old project unchanged.
