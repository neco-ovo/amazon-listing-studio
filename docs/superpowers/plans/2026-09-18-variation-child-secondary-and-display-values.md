# Variation Child Secondary and Display Values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Child-specific secondary-image approval and add a presentation-only Variation label update without invalidating Product Masters or images.

**Architecture:** Keep the existing Variation state and approval model. Centralize the three image scopes in the current CLI module, add the missing `child_secondary` approval beside `child_main`, and reuse the existing downstream finalization and delivery checks. Store sparse customer-facing overrides as `variation_display_values` on each Child; identity remains in `variation_values`, while Listing and upload projection consume effective display values.

**Tech Stack:** Node.js ESM, built-in `node:test`, JSON project state, existing atomic `updateProject` transactions.

**Spec:** `D:/Amazon/projects/speed-limit-sign/skill-error-report-current-variation-blockers.md`

## Global Constraints

- Do not add dependencies, a new state subsystem, or a second publication engine.
- Explicit approval remains required for image approval and display-value changes.
- Approved snapshots remain immutable; a display-value change marks affected Listings stale instead of rewriting approved Listing content.
- A display-only update must not stale Product Master or image assets.
- Every failed transaction leaves state and published files unchanged.
- Preserve current `shared_image` behavior for genuinely reusable Family or subset assets.

---

### Task 1: Complete the existing Child-secondary approval path

**Files:**
- Modify: `scripts/lib/variation-approvals.js`
- Modify: `scripts/studio.js`
- Test: `tests/unit/variation-approvals.test.js`
- Test: `tests/workflow/variation-public-approvals.test.js`

**Interfaces:**
- Produces: `child_secondary` registration, approval, and publication through the existing candidate and `updateProject` transaction paths.
- Reuses: existing downstream `asset_map.child_secondary`, finalization, delivery, cleanup, and Child history behavior.
- Preserves: existing `child_main` and `shared_image` inputs and outputs; adds no registry or second publication engine.

- [ ] **Step 1: Write the failing routing test**

Add a CLI test that records a valid candidate with:

```js
{
  scopeType: 'child_secondary',
  artifactId: 'speed-25-8x12-mounting-v2',
  childSku: 'SPEED-LIMIT-SIGN-25-8X12',
  kind: 'mounting_package',
  path: '.studio/work/secondary/speed-25-8x12-mounting-v2.png'
}
```

Assert that registration succeeds, stores the candidate under the exact Child asset collection, and records `inspection_binding.scope_type === 'child_secondary'` plus the exact `child_sku`. Accept new candidates only from `.studio/work/`; a published Child path is an output, never a second candidate lifecycle. Add sibling-SKU, published-path-as-input, and unsupported bundled-accessory/package-claim cases; each rejection must leave the state file byte-identical.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/workflow/variation-public-approvals.test.js
```

Expected: FAIL because `child_secondary` is not a supported public candidate scope.

- [ ] **Step 3: Write the failing approval test**

Create a locked Child Product Master and a passing `child_secondary` candidate. Approve it with the exact Child SKU and assert:

```js
assert.equal(approval.scope_type, 'child_secondary');
assert.equal(approval.child_sku, child.sku);
assert.equal(approval.product_master_version, child.product_master.version);
assert.deepEqual(approval.variation_values, child.variation_values);
assert.equal(asset.status, 'approved');
```

Add table cases for another Child SKU, stale Product Master, changed bytes, failed inspection, and a non-Child path. Each rejection must leave the input state unchanged.

- [ ] **Step 4: Run the approval test and verify RED**

Run:

```powershell
node --test tests/unit/variation-approvals.test.js
```

Expected: FAIL because `ARTIFACT_SCOPES` and approval dispatch exclude `child_secondary`.

- [ ] **Step 5: Implement the minimum shared routing and Child-secondary approval**

In `scripts/studio.js`, add only the two small shared predicates needed to stop scope lists drifting:

```js
const VARIATION_IMAGE_SCOPES = new Set(['child_main', 'child_secondary', 'shared_image']);
const isChildImageScope = scopeType => scopeType === 'child_main' || scopeType === 'child_secondary';
```

Use them in existing registration, approval dispatch, publication, cleanup, and batch cleanup branches. Do not introduce a registry, asset-location abstraction, or configuration file.

Add `child_secondary` to `ARTIFACT_SCOPES`. Implement one function beside `approveChildMain` that:

1. Resolves the active Child and candidate from the Child asset collection.
2. Requires a locked, positive Product Master version.
3. Rejects `kind: 'main'`, wrong Child ownership, a source outside `.studio/work/`, and noncanonical scope.
4. Reuses `hashApprovalFile`, `assertInspectedCandidate`, `approvalId`, and immutable approval history.
5. Stores the current `variation_values` and Product Master version without changing Product Master.

Dispatch `approveVariationArtifact` to this function; do not generalize the main-image mutation logic.

- [ ] **Step 6: Publish through the existing transaction**

In `publishVariationApproval`, route `child_secondary` through `publishedAssetPath({scope: 'child', childSku, role: asset.id, sourcePath})`. Update only the newly approved asset and approval paths. Keep the existing `updateProject` publication transaction so failed publication cannot persist state.

Assert the workflow result publishes to:

```text
assets/children/<child-sku>/<artifact-id>.<ext>
```

and that final approval includes it under `asset_map.child_secondary[childSku]` using the already-existing final and delivery validators. Reuse the existing inspected-candidate/fact checks; the regression from Step 1 must prove an unconfirmed accessory/package claim cannot pass merely because the image bytes are valid.

- [ ] **Step 7: Run focused approval, finalization, and delivery tests**

Run:

```powershell
node --test tests/unit/variation-approvals.test.js tests/unit/variation-bundle.test.js tests/workflow/variation-public-approvals.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add scripts/lib/variation-approvals.js scripts/studio.js tests/unit/variation-approvals.test.js tests/workflow/variation-public-approvals.test.js
git commit -m "feat: approve child-specific secondary images"
```

---

### Task 2: Add presentation-only Variation display values

**Files:**
- Modify: `scripts/lib/variations.js`
- Modify: `scripts/lib/variation-project.js`
- Modify: `scripts/lib/variation-listing.js`
- Modify: `scripts/lib/project-layout.js`
- Modify: `scripts/lib/variation-approvals.js`
- Modify: `scripts/lib/variation-bundle.js`
- Modify: `scripts/studio.js`
- Test: `tests/workflow/variation-operations.test.js`
- Test: `tests/unit/variation-listing.test.js`
- Test: `tests/unit/upload-preparation.test.js`
- Test: `tests/unit/variation-approvals.test.js`
- Test: `tests/unit/variation-bundle.test.js`

**Interfaces:**
- Produces from `scripts/lib/variations.js`: `effectiveVariationValues(child)`, returning `{...child.variation_values, ...child.variation_display_values}`.
- Produces: `setVariationDisplayValues(state, input)`.
- Final approval keeps `child_variations[].variation_values` canonical and adds `display_values` for the effective customer-facing tuple.
- CLI input:

```json
{
  "userAction": "approved",
  "dimension": "size_name",
  "from": "8 x 12 Inches",
  "to": "12 x 8 Inches",
  "childSkus": ["SPEED-LIMIT-SIGN-5-8X12"],
  "now": "2026-09-18T00:00:00.000Z"
}
```

- [ ] **Step 1: Write failing transaction tests**

Test one batch containing all affected 8×12 Children. Assert:

- every named active Child currently resolves `dimension` to `from`;
- the new effective tuples remain unique;
- `variation_display_values.size_name` becomes `12 x 8 Inches`;
- `variation_values`, facts, orientation, Product Master, and assets remain byte-identical;
- only affected Listings become stale;
- one entry is appended to the existing `child.history`, and the existing `recordOperation` records the transaction;
- the current approved Variation version becomes stale with `VARIATION_DISPLAY_VALUES_CHANGED`, while its approval record remains immutable;
- an old delivery/finalization attempt is rejected after the change;
- any missing Child, wrong `from`, unsupported dimension, collision, or absent `userAction: approved` rejects the whole transaction without mutation.

- [ ] **Step 2: Run the transaction test and verify RED**

Run:

```powershell
node --test tests/workflow/variation-operations.test.js
```

Expected: FAIL because no display-value transaction exists.

- [ ] **Step 3: Implement the display-value transaction**

Add the pure `effectiveVariationValues(child)` helper to `scripts/lib/variations.js`. Add `setVariationDisplayValues` to `scripts/lib/variation-project.js`; it validates all inputs before cloning state, applies sparse overrides, marks only affected Listings and the current approved Variation version stale with `VARIATION_DISPLAY_VALUES_CHANGED`, appends to the existing Child history, calls the existing `recordOperation`, and updates timestamps. Do not mutate immutable approval records.

Do not recompute Product Master or image applicability: the physical facts and image dependencies did not change.

- [ ] **Step 4: Add the public command**

Route `set-variation-display-values --project-dir <dir> --input <json>` through the existing `updateProject` transaction and operation classifier. Do not add a project-specific script.

- [ ] **Step 5: Make customer-facing consumers use effective values**

Write failing tests first, then use `effectiveVariationValues(child)` only where values are presented externally:

- Child Listing materialization and tuple audit
- delivery/upload-template Child rows
- portable `product.json` projection
- final approval snapshot and delivery verification

Keep internal Family identity, Product Master, image binding, and Child identity on canonical `variation_values`. Validate effective tuple uniqueness before committing the override. In final approval, retain canonical `child_variations[].variation_values` and add explicit `display_values`; delivery validation compares both. Build the delivery matrix from effective values, so `upload-preparation.js` continues copying the matrix unchanged and needs no production edit.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/workflow/variation-operations.test.js tests/unit/variation-listing.test.js tests/unit/upload-preparation.test.js tests/unit/variation-approvals.test.js tests/unit/variation-bundle.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add scripts/lib/variations.js scripts/lib/variation-project.js scripts/lib/variation-listing.js scripts/lib/project-layout.js scripts/lib/variation-approvals.js scripts/lib/variation-bundle.js scripts/studio.js tests/workflow/variation-operations.test.js tests/unit/variation-listing.test.js tests/unit/upload-preparation.test.js tests/unit/variation-approvals.test.js tests/unit/variation-bundle.test.js
git commit -m "feat: support variation display value overrides"
```

---

### Task 3: Document the simpler approval and display flows

**Files:**
- Modify: `references/variation-workflow.md`
- Modify: `tests/skill-structure.test.js`

**Interfaces:**
- Documents: `child_main`, `child_secondary`, `shared_image`, and presentation-only display updates.

- [ ] **Step 1: Add failing documentation assertions**

Require the guide to state:

- Child main and Child secondary are exact-Child scopes.
- `shared_image` is only for reusable Family/subset assets.
- approved gallery plans may batch-register and batch-approve Child secondaries.
- display overrides affect Listing/upload presentation but not physical facts, Product Master, or images.

- [ ] **Step 2: Run the documentation test and verify RED**

```powershell
node --test tests/skill-structure.test.js
```

- [ ] **Step 3: Add concise guidance without exceeding the existing word budget**

Replace overlapping wording rather than appending another long section.

- [ ] **Step 4: Run full verification**

```powershell
node --test tests/skill-structure.test.js
npm test
git diff --check
```

Expected: all tests pass and `git diff --check` exits 0.

- [ ] **Step 5: Commit**

```powershell
git add references/variation-workflow.md tests/skill-structure.test.js
git commit -m "docs: clarify variation image and display scopes"
```

---

### Task 4: Project-level smoke test without bypasses

**Files:**
- Read: `D:/Amazon/projects/speed-limit-sign/.studio/state.json`
- Create temporarily under project: `.studio/work/` JSON inputs only
- Do not edit state directly.

**Interfaces:**
- Consumes: the public commands completed in Tasks 1–3.
- Produces: evidence that the original two blockers are removed.

- [ ] **Step 1: Copy the project to a temporary test directory**

Use a disposable copy; do not mutate the real completed work during smoke testing.

- [ ] **Step 2: Approve one staged `child_secondary`**

Register, approve, and verify one `SPEED-LIMIT-SIGN-25-8X12` secondary. Confirm its published Child path, approval scope, Product Master binding, and final asset-map membership.

- [ ] **Step 3: Apply the five-Child display update**

Run one `set-variation-display-values` transaction for the five 8×12 Child SKUs. Confirm effective size wording is `12 x 8 Inches`, canonical values and Product Masters are unchanged, and only their Listings/final approval are stale.

- [ ] **Step 4: Verify atomic rejection**

Repeat each operation once with a wrong Child or wrong expected `from`; compare the state file before/after and confirm no published output was created.

- [ ] **Step 5: Record results and remove only the disposable copy**

Do not add project-specific fixtures or helper scripts to the Skill repository.
