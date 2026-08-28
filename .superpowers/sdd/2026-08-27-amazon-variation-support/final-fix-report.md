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

## Fix Round 2

### Approval integrity changes

1. **Inspected bytes are bound to approval**
   - `record-variation-candidate` now stores the deterministic SHA-256 of the exact inspected file plus immutable inspection-role metadata.
   - `approve-variation` rehashes the current file and compares both the hash and role binding before any state change.
   - Child-main and shared-image approvals freeze those inspection bindings, so replacing a recorded file or changing its intended role is rejected with `BLOCKING_INPUT`.
   - Regression coverage overwrites a recorded valid image with different bytes and confirms approval rejects it without changing saved state for both scopes.

2. **Delivery validates the complete immutable approval identity**
   - Child main-image checks now include approval type/scope, Child SKU ownership, Product Master version, exact ordered variation tuple, and the approved-main path/hash frozen in the Product Master.
   - Child secondary-image checks now include Child ownership and Product Master binding in addition to the immutable path/hash/approval identity.
   - Shared-image checks now include approval type/scope, immutable asset scope, declared and applicable Child membership, factual dependencies, artifact path/hash, approval identity, and the current final-delivery scope.
   - Adversarial tests mutate stored approval identity while retaining IDs, paths, and hashes and confirm delivery rejects changed Child ownership, Product Master binding, shared scope, shared membership, and approval type.

### Round 2 TDD evidence

- Initial focused RED: 8 failures established missing recorded candidate hashes and acceptance of mutated identity.
- Additional focused RED: 5 failures established that approval records did not freeze inspection bindings and that shared current membership/type mutations were accepted.
- Focused GREEN: 140/140 passed.
- Full GREEN: 371/371 passed.
- Official `quick_validate.py`: `Skill is valid!`.
- All changed JavaScript files passed `node --check`; `git diff --check` passed.
- PyYAML was installed only into `.tmp-quick-validate` for the official validator and the verified absolute temporary directory was removed afterward; project dependencies were unchanged.

### Round 2 self-review

- Approval remains an explicit user action; candidate recording alone never approves or locks a Product Master.
- Hash and role checks run before any approval-state mutation.
- Approval records and delivery compare exact ordered tuples and exact scope membership; no cross-Child or cross-scope substitution is permitted.
- Legacy single-product CLI behavior remains unchanged.

### Round 2 concerns

None blocking.

## Fix Round 3

### Approval integrity changes

1. **Candidate inspection and hashing share one byte snapshot**
   - Variation candidate recording reads the scoped file once and computes its SHA-256 from that immutable snapshot.
   - Decode, deterministic image validation, and saved-file inspection receive snapshot-backed buffers rather than reopening the mutable path.
   - Approval still rehashes the live path and rejects bytes changed after recording.
   - A deterministic test replaces the path from inside the inspection callback and proves the recorded hash remains the hash of the inspected bytes.
   - The legacy single-product candidate path retains its existing file-path defaults.

2. **Shared final scope freezes its declaration**
   - Every final shared entry now includes immutable `asset_scope` and `declared_child_skus` fields.
   - Delivery compares the stored shared approval and the live shared asset independently against those frozen values.
   - A coordinated approval-plus-live mutation with unchanged applicable Children is rejected.

3. **Child-secondary scope identity is immutable**
   - New scoped Child secondaries use `scope_type: "child_secondary"` with scope version 1, exact Child SKU, and exact Product Master version.
   - Final scope entries freeze normalized approval scope, Child owner, and Product Master binding.
   - Delivery rejects substitutions to both `child_main` and `shared_image` scopes while IDs, paths, and hashes remain unchanged.

4. **Promoted legacy secondaries remain coherent**
   - An unscoped image approval is accepted only when the Child's preserved legacy references name that artifact.
   - Missing legacy Child/PM fields are normalized into the final scope from the current Child and locked Product Master.
   - Any present mismatched legacy Child or Product Master value is rejected.
   - A fixture-level end-to-end test performs final approval and real delivery with a promoted legacy secondary.

### Round 3 TDD evidence

- Candidate snapshot RED: the injected decoder received no snapshot bytes; after the implementation, an in-inspection path replacement no longer changes the recorded hash.
- Shared-scope RED: two failures showed missing frozen declaration fields and accepted coordinated mutation.
- Child-secondary RED: a valid explicit `child_secondary` approval was rejected before the normalized contract was implemented.
- Promoted-legacy RED: valid legacy final approval failed under the explicit-only contract; the minimal compatibility branch made finalization and delivery agree.
- Legacy file-path regression RED: the shared default decoder attempted to open an undefined source until the single-product fallback was restored.

### Round 3 self-review

- Candidate bytes are read once; all Variation inspection stages derive from copies of the same snapshot and no post-inspection path hash is used.
- Shared approval and live scope can no longer be changed together to bypass the final snapshot.
- Explicit Child-secondary and promoted-legacy contracts are disjoint; other scoped approvals are rejected.
- Legacy omissions are normalized only in the final snapshot, without mutating historical approval records.

### Round 3 verification evidence

- Focused CLI/approvals/delivery/project/images/state/candidate suite: 149/149 passed.
- Full `npm test`: 380/380 passed.
- Official `quick_validate.py`: `Skill is valid!`.
- All changed JavaScript files passed `node --check`; `git diff --check` passed.
- PyYAML was installed only into `.tmp-quick-validate` for the official validator and the verified absolute temporary directory was removed afterward; project dependencies were unchanged.

### Round 3 concerns

None blocking.
