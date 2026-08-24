# Two-Speed Image Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile compact differentiated image briefs, select the cheapest valid repair path, and reduce candidate and approval overhead without weakening Product Master or saved-file QA.

**Architecture:** Keep image generation in the active harness. Add deterministic brief and repair-policy modules that the Skill invokes, then route only exact saved candidates through relevant checks and transactional approval.

**Tech Stack:** Node.js >=20 ESM, `node:test`, existing `sharp` image utilities, Markdown Skill instructions.

**Spec:** `docs/superpowers/specs/2026-08-25-two-speed-simplification-design.md`

## Global Constraints

- Complete the foundation plan first.
- Preserve existing dirty worktree changes and stage only task files.
- Default to one-pass complete images; deterministic text composition is a fallback.
- Product identity is preserved unless the user explicitly authorizes a redesign.
- A redesign after Product Master lock requires a new Product Master.
- Generate secondaries sequentially, but do not request redundant concept approval for an approved gallery plan.
- At most one unpresented automatic correction is allowed.
- Do not make paid/live generation calls in automated tests.

---

### Task 1: Compile compact image briefs with coherent differentiation

**Files:**
- Create: `scripts/lib/image-briefs.js`
- Create: `tests/unit/image-briefs.test.js`

**Interfaces:**
- Produces: `compileImageBrief({kind, master, userRequest, references, claims, galleryItem})`.
- Result keys: `identity`, `goal`, `source_roles`, `permitted_claims`, `difference_plan`, `text_strategy`, `exclusions`, `output`.

- [ ] **Step 1: Write failing brief tests**

```js
test('portrait adaptation creates two presentation differences without changing identity', () => {
  const brief = compileImageBrief(fixtureInput);
  assert.deepEqual(brief.identity.printed_copy, fixtureInput.master.printed_copy);
  assert.ok(brief.difference_plan.length >= 2);
  assert.equal(brief.text_strategy, 'one_pass_complete');
  assert.equal(brief.source_roles.competitor_links, 'market_data_only');
});
test('explicit redesign authority marks locked master replacement', () => {
  const brief = compileImageBrief({...fixtureInput, userRequest:{allow_identity_redesign:true, change_palette:true}});
  assert.equal(brief.output.requires_new_product_master, true);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/image-briefs.test.js`
Expected: FAIL because the compiler is missing.

- [ ] **Step 3: Implement a data-only compiler**

Select differences from orientation-aware hierarchy, emphasis typography, line spacing, region proportions, and visual-mass placement. Reject a difference that changes an invariant without explicit redesign authority. Never include competitor-link images as identity references.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/image-briefs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/image-briefs.js tests/unit/image-briefs.test.js
git commit -m "feat: compile compact differentiated image briefs"
```

### Task 2: Implement the cheapest-valid repair policy

**Files:**
- Create: `scripts/lib/image-repairs.js`
- Create: `tests/unit/image-repairs.test.js`

**Interfaces:**
- Produces: `selectRepair({defectCodes, candidate, automaticAttempts}) -> {action, reason}`.
- Actions: `deterministic_edit`, `targeted_ai_edit`, `regenerate`, `ask_user`.

- [ ] **Step 1: Write the failing repair matrix**

```js
test('centering and dimension geometry choose deterministic repair', () => {
  assert.equal(selectRepair({defectCodes:['OFF_CENTER'], automaticAttempts:0}).action, 'deterministic_edit');
  assert.equal(selectRepair({defectCodes:['DIMENSION_ANCHOR'], automaticAttempts:0}).action, 'deterministic_edit');
});
test('a second hidden correction stops for user review', () => {
  assert.equal(selectRepair({defectCodes:['SCENE_IDENTITY'], automaticAttempts:1}).action, 'ask_user');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/image-repairs.test.js`
Expected: FAIL for missing policy.

- [ ] **Step 3: Implement a stable defect-to-action table**

Map placement, centering, text size, dimension anchors, and safe crop to deterministic edit. Map localized pixels or typography that cannot be composed to targeted AI edit. Use regeneration only for whole-composition or identity failure when no accepted base remains.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/image-repairs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/image-repairs.js tests/unit/image-repairs.test.js
git commit -m "feat: choose low-cost image repairs"
```

### Task 3: Scope candidate checks and defer hashes until approval

**Files:**
- Create: `tests/workflow/image-fast-path.test.js`
- Modify: `scripts/lib/operations.js`
- Modify: `scripts/lib/transactions.js`
- Modify: `scripts/studio.js`

**Interfaces:**
- `record-candidate` stores path, dimensions, inspection result, master version, fact IDs, and automatic-attempt count without SHA-256.
- `approve --type image` calculates SHA-256 and returns the next gallery action.

- [ ] **Step 1: Write failing workflow assertions**

```js
test('rejected candidate is inspected but not hashed or fully registered', async () => {
  const result = await runRecordCandidate({inspection:'fail'});
  assert.equal(result.candidate.sha256, undefined);
  assert.deepEqual(calls, ['decode','relevant-image-checks','saved-file-inspection']);
});
test('approval hashes once and advances the gallery plan', async () => {
  const result = await runApprove(candidateId);
  assert.equal(hashCalls, 1);
  assert.equal(result.next_action.kind, 'generate_gallery_item');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/workflow/image-fast-path.test.js`
Expected: FAIL because candidate and approval commands do not implement the contract.

- [ ] **Step 3: Implement scoped candidate and approval commands**

Use dependency injection for decoder, checker, inspector, and hasher so tests assert real orchestration without a live image call. Product Master approval remains an artifact transaction and records the approved hash.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/workflow/image-fast-path.test.js tests/unit/transactions.test.js tests/unit/images.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/workflow/image-fast-path.test.js scripts/lib/operations.js scripts/lib/transactions.js scripts/studio.js
git commit -m "feat: reduce image candidate overhead"
```

### Task 4: Replace heavy image instructions with the approved route

**Files:**
- Modify: `SKILL.md`
- Create: `references/image-workflow.md`
- Modify: `tests/skill-structure.test.js`
- Create: `evals/scenarios/image-fast-repair.json`

**Interfaces:**
- `SKILL.md` routes image work only to `image-workflow.md` and the unified CLI.
- The reference states the positive recipe: brief -> generate complete candidate -> inspect -> present -> approve/repair.

- [ ] **Step 1: Write a failing behavioral structure test**

```js
test('image route is compact and defaults to complete one-pass generation', () => {
  assert.match(skill, /references\/image-workflow\.md/);
  assert.match(imageWorkflow, /one-pass complete image/i);
  assert.doesNotMatch(imageWorkflow, /generate a text-free base first/i);
  assert.match(imageWorkflow, /deterministic edit.*targeted AI edit.*regenerate/is);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/skill-structure.test.js`
Expected: FAIL because the new route and reference do not exist.

- [ ] **Step 3: Write the minimal Skill route and image reference**

Keep hard identity, saved-file inspection, misleading-component, and Product Master rules. Remove duplicated case narratives and separate planning approval. Reference `studio.js` rather than listing several scripts.

- [ ] **Step 4: Verify GREEN and image regression**

Run: `node --test tests/skill-structure.test.js tests/unit/image-briefs.test.js tests/unit/image-repairs.test.js tests/workflow/image-fast-path.test.js tests/contract/image-capabilities.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add SKILL.md references/image-workflow.md tests/skill-structure.test.js evals/scenarios/image-fast-repair.json
git commit -m "docs: route image work through the fast workflow"
```
