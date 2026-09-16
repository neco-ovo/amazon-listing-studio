# Narrow Invalidation and Visual Tolerance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce repeat generation, keyword reanalysis, template blocking, and approval friction by invalidating only the directly affected scope while preserving factual and delivery integrity.

**Architecture:** Keep the current workflows and data formats. Narrow four existing decision points in place: image findings, keyword-profile compatibility, upload-template relevance, and equivalent/batch approvals. Do not add a new state machine, dependency graph, formula engine, or approval layer.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing JSON state and OOXML helpers.

**Spec:** Approved conversation requirements from 2026-09-16; this is a bounded change with no separate design specification.

## Global Constraints

- A wrong Child, wrong size, wrong printed wording, invented component, or misleading included accessory remains a hard image failure.
- Minor scale, shadow, spacing, placement, perspective, and other non-semantic visual differences are review findings, not automatic regeneration triggers.
- Read package contents from the existing confirmed `included_components` fact. Normalize it for the brief as `accessory_status: 'confirmed-present'|'confirmed-absent'|'unknown'` plus `included_accessories: string[]`; do not add persistent question state. If accessories are confirmed absent, keep accessory-like product props out. If exact included accessories are confirmed, only those named items may appear. If unknown and the gallery plan actually needs them, include that item in the one consolidated pre-generation question; if it remains unresolved, omit the accessories and continue.
- Do not weaken Listing fact grounding, keyword exclusions, final approval scope, saved-file decoding, final rehash, ZIP verification, path containment, or non-overwrite behavior.
- Unknown workbook logic blocks `upload-ready` only when it affects a mapped field and actual output row; unrelated workbook decoration remains diagnostic.

---

### Task 1: Make image rejection semantic rather than cosmetic

**Files:**
- Modify: `references/image-workflow.md`
- Modify: `references/knowledge-and-facts.md`
- Modify: `scripts/lib/image-briefs.js`
- Modify: `scripts/lib/variation-images.js`
- Test: `tests/skill-structure.test.js`
- Test: `tests/unit/variation-images.test.js`

**Interfaces:**
- Consumes: the existing confirmed `included_components` fact plus saved-image inspection findings.
- Produces: an image brief with `accessory_status: 'confirmed-present'|'confirmed-absent'|'unknown'`, `included_accessories: string[]` copied only from confirmed `included_components`, and the unchanged `{ok, failures}` validation result. The brief may contribute one item to the existing consolidated pre-generation question; the validator never asks questions.

- [ ] **Step 1: Write failing tests for the three accessory states and visual tolerance**

Add cases proving: confirmed-absent accessories remain forbidden; confirmed-present exact accessories are allowed; confirmation of screws does not allow brackets or tools; unknown accessories contribute one consolidated-question item only when the planned scene needs them and otherwise default to omission; a minor non-semantic proportion/layout finding does not produce `VISIBLE_DISTORTION`; wrong Child wording and explicit semantic distortion still fail.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test tests/unit/variation-images.test.js tests/skill-structure.test.js`

Expected: FAIL because the accessory decision and minor-deviation distinction are not yet represented.

- [ ] **Step 3: Implement the minimum decision change**

Normalize only confirmed `included_components` into status plus an exact allowed-item list in the image brief. Presence of one item never authorizes another item. Use the existing gallery-plan intake to combine the unknown case with other blocking questions; do not persist `question_asked`, create a new state machine, or ask from the validator. Treat only explicit identity/semantic inspection codes as failures; document that ordinary visual variance is presented for review without regeneration.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `node --test tests/unit/variation-images.test.js tests/skill-structure.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add references/image-workflow.md references/knowledge-and-facts.md scripts/lib/image-briefs.js scripts/lib/variation-images.js tests/skill-structure.test.js tests/unit/variation-images.test.js
git commit -m "fix: limit image rejection to semantic defects"
```

---

### Task 2: Stop unrelated facts from invalidating keyword work

**Files:**
- Modify: `scripts/studio.js`
- Test: `tests/unit/keyword-profiles.test.js`
- Test: `tests/workflow/studio-cli.test.js`

**Interfaces:**
- Consumes: saved keyword profile and current project facts.
- Produces: the existing compatibility result. A local `keywordIdentityFacts(profile, facts)` projection uses `profile.keyword_fact_fields` when present, otherwise `purpose`, `warning_semantics`, `pattern`, and `core_function`; marketplace, locale, product type, and purchase intent remain identity checks.

- [ ] **Step 1: Write failing compatibility tests**

Add one case where weight or mounting holes change and a micro Listing revision still reuses the profile. Add a package-content case where `keyword_fact_fields: ['included_components']` correctly invalidates the profile. Add cases where `purpose`, `warning_semantics`, `pattern`, or `core_function` changes and reanalysis remains required. Cover all three existing paths: micro revision/approval, existing project-profile reuse, and shared-cache reuse. Keep exclusion enforcement tests unchanged.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test tests/unit/keyword-profiles.test.js tests/workflow/studio-cli.test.js`

Expected: FAIL because `assertCurrentKeywordProfile` currently compares every publishable fact.

- [ ] **Step 3: Compare only a short explicit identity set**

Add one local projection helper in `scripts/studio.js` and use it in the three existing compatibility checks: micro revision/approval, existing project-profile reuse, and shared-cache reuse. Use `profile.keyword_fact_fields` when present; otherwise compare `purpose`, `warning_semantics`, `pattern`, and `core_function`. Continue using marketplace, locale, product type, and normalized intent. Do not introduce a generic dependency graph or rerun SellerSprite analysis for unrelated specification edits.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `node --test tests/unit/keyword-profiles.test.js tests/workflow/studio-cli.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/studio.js tests/unit/keyword-profiles.test.js tests/workflow/studio-cli.test.js
git commit -m "fix: narrow keyword profile invalidation"
```

---

### Task 3: Limit upload blocking to affected cells and defer rule refresh

**Files:**
- Modify: `scripts/lib/upload-workbooks.js`
- Modify: `scripts/studio.js`
- Test: `tests/unit/upload-workbooks.test.js`
- Test: `tests/workflow/upload-preparation.test.js`

**Interfaces:**
- Consumes: template inspection, mapped columns, projected rows, and optional hosted URLs.
- Produces: the existing `manual-prep` or `upload-ready` result plus non-blocking diagnostics for unrelated template formulas.

- [ ] **Step 1: Write failing relevance tests**

Add an unrelated unsupported conditional-format formula outside mapped columns/actual rows and prove it does not change readiness. Add the same unsupported formula on an actual mapped output cell and prove it still forces `manual-prep`. Add a case proving stale rules are reported without a refresh attempt while hosting or required local inputs remain unresolved.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test tests/unit/upload-workbooks.test.js tests/workflow/upload-preparation.test.js`

Expected: FAIL because every unsupported condition currently becomes a blocking finding and rules are resolved before local blockers are known.

- [ ] **Step 3: Filter by affected columns and rows**

Return unrelated unsupported formulas under `diagnostics`; keep only affected formulas under `unsupported_conditions` or `unsupported_validations`. Inspect delivery, template, rows, URLs, and required local fields before requesting current-rule refresh. A stale cached rule remains a finding; only a path otherwise capable of `upload-ready` performs refresh/current verification.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `node --test tests/unit/upload-workbooks.test.js tests/workflow/upload-preparation.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/lib/upload-workbooks.js scripts/studio.js tests/unit/upload-workbooks.test.js tests/workflow/upload-preparation.test.js
git commit -m "fix: scope upload checks to affected cells"
```

---

### Task 4: Collapse equivalent and batch approval repetition

**Files:**
- Modify: `scripts/studio.js`
- Test: `tests/workflow/studio-cli.test.js`
- Test: `tests/workflow/variation-public-approvals.test.js`

**Interfaces:**
- Consumes: current final approvals or one approved batch request.
- Produces: the same immutable approval records; equivalent final scopes select the newest record, and batch items inherit one top-level explicit approval action.

- [ ] **Step 1: Write failing approval tests**

Add a case where two final approvals have identical Product Master version, Listing version, sorted artifact IDs, marketplace, product type, and rule scope, and the latest is selected. Record ID, timestamp, and audit metadata must not affect equivalence. Keep a case where any listed scope field differs and ambiguity still blocks. Add a batch case with top-level `userAction: "approved"` and item-level scope data only; retain atomic rollback and final-last assertions.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test tests/workflow/studio-cli.test.js tests/workflow/variation-public-approvals.test.js`

Expected: FAIL because duplicate records and inherited batch approval are not yet supported.

- [ ] **Step 3: Implement scope deduplication and one batch action**

Deduplicate final approvals only when Product Master version, Listing version, sorted artifact IDs, marketplace, product type, and rule scope match; ignore record ID, timestamp, and audit metadata, then select the latest. Accept one top-level batch approval action and copy it into each internal operation before existing per-item preflight. Do not weaken scope validation or transaction atomicity.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/workflow/studio-cli.test.js tests/workflow/variation-public-approvals.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/studio.js tests/workflow/studio-cli.test.js tests/workflow/variation-public-approvals.test.js
git commit -m "fix: remove redundant approval blockers"
```

---

### Task 5: Verify once and sync

**Files:**
- Modify: installed copy at `D:\Codex\CodexHome\skills\amazon-listing-studio` through the existing tracked-file sync.

**Interfaces:**
- Consumes: repository commits from Tasks 1–4.
- Produces: a byte-matching installed Skill after one full repository verification.

- [ ] **Step 1: Run repository validation**

Run: `npm test`

Expected: all tests pass with zero failures. This is the only full-suite run in the plan.

- [ ] **Step 2: Sync tracked files and compare hashes**

Use the existing tracked-file installation procedure. Expected: zero missing or mismatched files; do not copy `node_modules` manually.

- [ ] **Step 3: Report only measured behavior**

Report test counts, installed-copy match, and retained safety blockers. The focused tests already exercise minor visual differences, keyword reuse, workbook-condition relevance, and real conflict blocking; do not add a duplicate smoke harness or claim token savings without measured before/after evidence.
