# Final Review Fix Report

## Status

DONE — all five Important final-review findings addressed in one cohesive fix wave.

## Changes

1. **Public Variation CLI approval workflow**
   - Added `record-variation-candidate` for exact `child_main` and `shared_image` scopes.
   - Added `approve-variation` for `child_main`, `shared_image`, `parent_listing`, `child_listing`, and `variation_final`.
   - Candidate paths, Child ownership, scope-specific fields, saved-state mode, file inspection, and explicit `userAction: "approved"` are enforced.
   - A first approved main locks a new Child Product Master at version 1; existing locked Product Masters remain exact and cannot be substituted.
   - Legacy `record-candidate` and `approve` remain unchanged for single-product projects.
   - The public CLI E2E starts from a saved, locked Family checkpoint, runs `add-child`, records both Child mains plus a shared asset, approves all five scopes, and builds the real Family delivery without direct state mutation after the checkpoint.

2. **Current-state delivery gate**
   - Finalization now requires the current Parent and Parent Listing to remain approved.
   - Every selected Child must still have a locked Product Master, approved current Listing, and exact approved main/secondary bindings.
   - Relevant shared assets must remain approved with exact path, hash, approval, and factual-dependency bindings.
   - Family delivery rejects a revised Child even when its Product Master and Listing version numbers have not changed.
   - Exact-Child delivery remains scoped: an unaffected selected Child can still be delivered after a sibling-only revision when Parent/shared dependencies remain current.

3. **Immutable tuple facts during `revise-child`**
   - A `factPatch` that conflicts with a theme-dimension value is rejected with `BLOCKING_INPUT`, the exact field, and `required_operation: change_variation_tuple`.
   - Rejection occurs before cloning/mutation; regression coverage confirms input state is unchanged.

4. **Promotion source-fact binding**
   - Promotion compares the first Child's ordered tuple with corresponding confirmed project facts and locked Product Master facts when present.
   - A `12 x 16 in` source fact paired with an `8 x 12 in` tuple fails before any Family/Parent/Child directory or state mutation.

5. **Complete sibling residual extraction**
   - Residual extraction iteratively removes every protected target phrase, including compact multiplication forms such as `12x16` and optional inch-unit variants.
   - `HORSE CROSSING + 12x16 + KIDS AT PLAY` retains and blocks `KIDS AT PLAY`; `HORSE CROSSING + 12x16` alone remains allowed.

## TDD evidence

Initial focused RED run: 77 passed, 6 failed. The failures mapped directly to the five findings: missing public commands (two assertions), stale finalization accepted, tuple-fact drift accepted, promotion mismatch accepted, and multi-protected sibling residual lost.

An additional delivery-binding RED proved that changing a live shared asset's factual dependency while retaining its old approval was accepted. A selected-scope RED then protected the existing exact-Child efficiency contract before narrowing current-state checks to selected Children and relevant shared assets.

## Verification evidence

- Focused CLI/approvals/delivery/project/images/state suite: 130/130 passed.
- Full `npm test`: 361/361 passed.
- Official `quick_validate.py`: `Skill is valid!`.
- PyYAML was installed only into `.tmp-quick-validate` for the official validator and the verified absolute temporary directory was removed afterward; project dependencies were unchanged.

## Self-review

- **Finding 1:** all five Task 7 scopes are reachable through explicit public Variation commands; the legacy single-product route remains separate.
- **Finding 2:** immutable approval ancestry is still required, and live status/bindings now form an additional gate for the selected delivery scope.
- **Finding 3:** no automatic tuple reconciliation or hidden tuple rewrite was introduced.
- **Finding 4:** validation happens before supplemental directories and before the atomic state transaction.
- **Finding 5:** all protected phrases are exhausted before deciding whether a foreign residual exists.
- **Safety/compatibility:** project-relative candidate paths are scoped before mutation; output remains staged and verified; no upload spreadsheet or unrelated workflow was added.

## Concerns

None blocking.
