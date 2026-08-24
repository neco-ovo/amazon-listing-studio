# Final verification

- Date: 2026-08-24
- Base branch: `main`
- Reviewed implementation commit: `12cd691`
- Execution mode: inline implementation with two final-evaluation subagents

## Automated verification

- `npm test`: PASS, 105 tests passed, 0 failed
- Codex `skill-creator/scripts/quick_validate.py`: `Skill is valid!`
- `node --check` over every JavaScript file in `scripts/` and `tests/`: PASS
- `git diff --check`: PASS

The suite covers Skill discovery, file-first state, fact precedence and conflicts, image capability failures, raster decoding, Amazon main-image geometry, fonts and deterministic overlays, the reviewed commerce-template snapshot, Listing limits and claim grounding, scoped Schema authorization, explicit per-image approvals, complete workflow behavior, and integrity-checked delivery bundles.

## Independent forward evaluation

An evaluator received only the built Skill and a new 20 oz matte-navy food-jar scenario containing a conflicting 24 oz supplier observation and an unsupported spoon accessory. Verdict: PASS.

The Skill correctly:

- kept the user's confirmed 20 oz size and no-spoon configuration authoritative;
- retained the supplier values as conflicts instead of publishing them;
- proceeded to real main-image generation without unnecessary intake blocking;
- required inspection and explicit approval of the exact saved main raster before Product Master lock;
- generated secondary images sequentially and replaced an unsupported back-detail card;
- delayed Listing generation until image approval and included the complete conversion-oriented output fields.

## Final code review

The independent reviewer reported no critical findings and eight important observations. Seven were fixed and covered by regression tests:

1. Schema-unverified delivery now requires current authorization bound to project, marketplace, product type, Product Master version, and Listing version.
2. Required Listing outputs must be nonempty.
3. Listing and final approvals are bound to marketplace, product type, Schema state, readiness, and project.
4. Main and secondary approvals require explicit approval ID, action flag, and timestamp.
5. Generated rasters must decode successfully, not merely match a file signature.
6. Deterministic overlay copy must contain the referenced fact value and unit.
7. Resume validation now checks fact, image, Product Master, and approved-Listing records deeply.

The eighth observation assumed a global 95% main-image threshold from the earlier Seed. The current product decision supersedes that assumption: the Skill uses Amazon.com's dated 85% general baseline when no stricter current rule is available, while a verified category requirement or explicit user/project target such as 95% raises the threshold only for that scope. Tests cover both values.

## Live Codex smoke workflow

The Git-ignored smoke artifacts were regenerated after the final fixes. File-first state validation, main-image QA, Listing validation, and delivery construction all passed.

- Main raster: 1254 × 1254, dominant occupancy 91.866%, 3:2 ratio error 0.518%, SHA-256 `9ab146eb431de772cdb5dfd7f5bd41fc864692493715e57e9f0672f32ff2e00f`
- Approved secondary raster SHA-256: `54c0d3ff05c3b310fc1335a337c153752ea93451aad3e2e60e9eed6a377c0996`
- Listing result: `PASS_WITH_WARNINGS`, `upload_ready: false` because the fixture product-type Schema remains unverified
- Delivery manifest SHA-256: `83cb08c9014bce0bbf8f368b5dbe59d277ed222d7796780181f71718092c772c`
- Delivery ZIP SHA-256: `174f535fd9613cfb5300bda8102651b2573d69d9d69cacdc1125dd0a081c2b33`

The committed narrative and approved prompts are in `evals/live-smoke/report.md`; large generated artifacts remain intentionally Git-ignored.

## Known boundary

When the current product-type Schema cannot be verified, the Skill may continue only with a scoped user authorization, marks only affected fields as unverified, and keeps `upload_ready: false`. It does not represent that bundle as directly uploadable.
