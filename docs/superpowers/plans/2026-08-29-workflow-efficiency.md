# Workflow Efficiency Implementation Plan

1. Add failing tests for entry/reference word budgets, batched secondary guidance, non-repeated verification, atomic Variation batch approval, and three-level Child fact routing.
2. Compress `SKILL.md` and `references/variation-workflow.md`; update image and delivery references with the approved defaults.
3. Add `approve-variation-batch` using the existing approval functions in one `updateProject` transaction. Preserve independent immutable records and fail atomically.
4. Classify Child fact patches against theme dimensions, core identity fields, and current Family-common facts before reporting the route.
5. Run focused tests, full `npm test`, official `quick_validate.py`, syntax checks, `git diff --check`, and independent review before creating a PR.
