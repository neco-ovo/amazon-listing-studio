# Task 9 Report — Skill Routing, Behavioral Matrix, and Full Verification

## Status

DONE

## Commit scope

- Kept `SKILL.md` compact with one optional route to `references/variation-workflow.md`; ordinary single-product work does not load Variation detail.
- Added the focused Variation reference covering activation, ordered category-permitted compound themes, sparse tuples, non-destructive promotion, Parent/Child copy, scoped images, direct-dependency revisions, immutable approvals, and Family/exact-Child delivery.
- Added narrow Variation handoffs to the image, Listing, and delivery references without duplicating their workflows.
- Completed public `add-child` CLI wiring so a successful new Child receives `children/<sku>/assets` and `children/<sku>/listing` directories.
- Added Skill structure, required-matrix, and public-CLI end-to-end coverage.

## TDD evidence

Initial RED command:

```text
node --test tests/skill-structure.test.js tests/workflow/required-matrix.test.js tests/workflow/variation-end-to-end.test.js
```

Observed expected failures:

- Structure and required-matrix tests failed with `ENOENT` because `references/variation-workflow.md` did not exist.
- After correcting one fixture expectation, the public CLI E2E failed at `children/SIGN-HORSE-16/assets`, proving `add-child` persisted the record but did not supplement its scoped directories.

Minimal GREEN changes created the focused reference, optional routes, and the two new-Child directories. The focused route/matrix/E2E plus existing CLI/operations regression run then passed 55/55.

## Implemented behavior

- Parent means common product identity; Child means the exact purchasable SKU and complete ordered tuple.
- Compound themes require current category or user-template permission and may represent sparse real combinations without a Cartesian product.
- Small-category differences are observations, not automatic rejection criteria.
- Promotion preserves approved legacy files, hashes, approvals, and deliveries in place while adding Parent/Child structure.
- Parent copy uses common facts; approved and delivered Child copy is complete and exact.
- Every Child main is independently scoped and approved. Shared secondary images are reusable records with explicit dependencies and Child mappings, not a Family gallery.
- Fast changes invalidate direct dependents only; common-fact changes additionally affect Parent intersection and relevant shared mappings.
- Approval scopes are immutable and non-substitutable; delivery supports a full Family or one exact Child.
- Variation delivery verification requires trusted saved project approval scope and cannot downgrade to the legacy verifier.
- Rigid-aluminum layout guidance names local reviewed metadata/previews as portable provenance derived from task `01a03541-aca1-7572-8ee5-1b6444353559`; runtime never depends on task access.

## Verification evidence

```text
node --test tests/skill-structure.test.js tests/workflow/required-matrix.test.js tests/workflow/variation-end-to-end.test.js tests/workflow/variation-operations.test.js tests/workflow/studio-cli.test.js
npm test -- --test-reporter=dot
node --test --test-reporter=tap
node --check scripts/studio.js
node --check tests/skill-structure.test.js
node --check tests/workflow/required-matrix.test.js
node --check tests/workflow/variation-end-to-end.test.js
python quick_validate.py <worktree-skill-root>
git diff --check
```

Fresh results before this report:

- focused structure/matrix/E2E and CLI regression: 55/55 passed;
- full suite: 348/348 passed, 0 failed;
- official Skill validator: `Skill is valid!`;
- all changed-JS syntax checks and `git diff --check`: exited 0.

The official validator required `PyYAML`, which was installed only in a temporary worktree directory and deleted immediately after validation; no project dependency changed.

## Self-review

- Scope: only Task 9 routes, reference guidance, tests, and necessary `add-child` directory wiring changed.
- Optionality: the new detailed reference is conditionally routed and `SKILL.md` remains 55 lines.
- Compatibility: the single-product path and prior Variation commands are unchanged; the full pre-existing suite remains green.
- Safety: promotion E2E confirms legacy bytes remain unchanged; new Child directories are supplemental and created recursively.
- Coverage: every behavior named in the Task 9 brief appears in the matrix and focused reference; the E2E uses only public CLI operations plus a saved approval-complete project fixture.

## Concerns

None blocking. The E2E intentionally stops at prepared scoped outputs rather than reconstructing Task 7 approval fixtures through private APIs; immutable approval and Family/Child delivery behavior remain covered by their dedicated public-routing, unit, and workflow suites.
