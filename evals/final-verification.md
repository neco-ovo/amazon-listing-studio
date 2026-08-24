# Final verification

- Date: 2026-08-25
- Branch: `feat/two-speed-simplification`
- Execution mode: inline implementation; no live image generation or market browsing

## Automated evidence

- `npm test`: PASS, 162 tests passed, 0 failed.
- Focused finalization and unified-CLI tests: PASS, 7 passed, 0 failed.
- `node --check` over every JavaScript file in `scripts/` and `tests/`: PASS.
- `git diff --check`: PASS.
- Codex `skill-creator/scripts/quick_validate.py`: not runnable in the bundled Python because `PyYAML` is absent (`ModuleNotFoundError: yaml`). Equivalent frontmatter, routed-path, entrypoint, and structure checks pass in `tests/skill-structure.test.js`. This environment limitation is not recorded as a Skill failure.

## Two-speed behavior verified

- Fast operations cover one-field Listing edits, presentation-only image repairs, current gallery progression, candidate recording, approvals, and local knowledge lookup.
- A single-field Listing revision invokes only state load, draft patch, changed-scope validation, Markdown render, and transactional write. It does not call market research, rule refresh, image generation, or repository-wide tests.
- Full operations cover new projects, Product Master or identity scope changes, first Listing drafts, shared knowledge mutation, migration, and finalization.
- Rule snapshots are scoped by marketplace and product type. The default freshness window is 90 days; stale snapshots warn during grounded drafting and require refresh for current verification or upload-ready output.

## Integrity and migration verified

- Draft revisions do not increment formal Listing versions. Explicit approval freezes JSON and Markdown hashes and creates the next formal version.
- Final v2 delivery reads, hashes, and decodes every selected raster even when one has changed, then rejects any mismatch.
- Listing content changed after approval is rejected by its frozen hash.
- `rules_unverified` and `upload_ready:false` survive approved Listing rendering and ZIP packaging exactly.
- ZIP entries are re-read and compared with the delivery manifest before the staged directory is installed.
- Legacy migration copies into a new destination and leaves the complete source-tree hash map unchanged.

## Quality boundaries retained

- Current explicit user facts remain authoritative.
- Category research is reusable market observation; only approved seller-family or project facts support publishable claims.
- Product Master still requires a real inspected and approved main raster.
- Secondary images remain sequential and Product-Master-bound.
- Main-image canvas is not forced square, and 95% occupancy is scoped rather than global.
- Image prompts default to complete one-pass generation; deterministic typography is a targeted repair or traceability mode.
- Final approval remains bound to Product Master, selected images, Listing version, marketplace, product type, and rule status.
