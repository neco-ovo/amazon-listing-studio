# Two-Speed Listing and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rule caching and conversion-aware Listing drafts, make micro revisions truly local, finish the unified Skill routing, and verify migration and final delivery end to end.

**Architecture:** Treat JSON as the only Listing content source, render Markdown deterministically, freeze versions only on approval, and inject rule refresh and external research as explicit dependencies so fast-path tests prove they were not called.

**Tech Stack:** Node.js >=20 ESM, `node:test`, existing Listing and bundle utilities, Markdown Skill instructions.

**Spec:** `docs/superpowers/specs/2026-08-25-two-speed-simplification-design.md`

## Global Constraints

- Complete the foundation and image plans first.
- Preserve unrelated and pre-existing worktree changes.
- Project content edits do not run the repository-wide test suite.
- Default rule-cache freshness is 90 days.
- A stale rule snapshot does not block an ordinary grounded draft.
- Only approved family/project facts support deterministic claims.
- A micro revision changes only requested fields and direct dependencies.
- Approved Listing snapshots are immutable; working drafts are mutable.
- Final delivery always rehashes all selected artifacts.

---

### Task 1: Implement rule-cache decisions

**Files:**
- Create: `scripts/lib/rule-cache.js`
- Create: `tests/unit/rule-cache.test.js`
- Move: `assets/rules/amazon-us-defaults.json` to `assets/rule-seeds/amazon-us-defaults.json`

**Interfaces:**
- Produces: `resolveRules({libraryDir, marketplace, productType, now, purpose})`.
- Returns `{rules, status:'fresh'|'stale'|'missing', refresh_required, warnings}`.

- [ ] **Step 1: Write failing freshness and purpose tests**

```js
test('reuses a snapshot within 90 days without refresh', async () => {
  const result = await resolveRules({...input, now:'2026-10-01T00:00:00Z', purpose:'draft'});
  assert.equal(result.status, 'fresh');
  assert.equal(result.refresh_required, false);
});
test('stale snapshot warns for draft but refreshes for upload-ready output', async () => {
  assert.equal((await resolveRules({...input, now:'2027-01-01T00:00:00Z', purpose:'draft'})).refresh_required, false);
  assert.equal((await resolveRules({...input, now:'2027-01-01T00:00:00Z', purpose:'upload_ready'})).refresh_required, true);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/rule-cache.test.js`
Expected: FAIL because the resolver is missing.

- [ ] **Step 3: Implement scoped lookup and date arithmetic**

Match marketplace and product type before age. Marketplace/product-type changes, explicit `verify_current`, and upload-ready purpose with stale/missing rules require refresh. Ordinary drafts return a concise warning.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/rule-cache.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A scripts/lib/rule-cache.js tests/unit/rule-cache.test.js assets/rule-seeds/amazon-us-defaults.json assets/rules/amazon-us-defaults.json
git commit -m "feat: cache marketplace listing rules"
```

### Task 2: Add mutable drafts and approval-only versions

**Files:**
- Create: `scripts/lib/listing-drafts.js`
- Create: `tests/unit/listing-drafts.test.js`
- Modify: `scripts/lib/transactions.js`

**Interfaces:**
- Produces: `createDraft(state, listing)`, `reviseDraft(state, patch)`, `renderListing(draft)`, `approveDraft(state, approval)`.
- Patch shape: `{fields:{'bullets.3.body':'new text'}, expectedDraftRevision:number}`.

- [ ] **Step 1: Write failing draft lifecycle tests**

```js
test('micro revision preserves all unselected content', () => {
  const before = structuredClone(state.listing.draft.content);
  const next = reviseDraft(state, {fields:{'bullets.3.body':'Clear replacement.'}, expectedDraftRevision:1});
  assert.equal(next.listing.draft.revision, 2);
  assert.equal(next.listing.draft.content.title, before.title);
  assert.deepEqual(next.listing.draft.content.bullets.slice(0,3), before.bullets.slice(0,3));
});
test('formal version increments only on approval', () => {
  const revised = reviseDraft(state, patch);
  assert.equal(revised.listing.approved.length, 0);
  assert.equal(approveDraft(revised, approval).listing.approved[0].version, 1);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/listing-drafts.test.js`
Expected: FAIL for missing lifecycle functions.

- [ ] **Step 3: Implement immutable path patching and deterministic Markdown render**

Reject unknown paths and stale `expectedDraftRevision`. Freeze JSON and Markdown hashes only during `approveDraft`; an approved snapshot is never edited in place.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/listing-drafts.test.js tests/unit/transactions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/listing-drafts.js tests/unit/listing-drafts.test.js scripts/lib/transactions.js
git commit -m "feat: freeze listing versions only on approval"
```

### Task 3: Enforce conversion hierarchy and complementary keywords behaviorally

**Files:**
- Create: `scripts/lib/listing-briefs.js`
- Create: `tests/unit/listing-briefs.test.js`
- Modify: `scripts/lib/listing.js`
- Modify: `tests/unit/listing.test.js`

**Interfaces:**
- Produces: `compileListingBrief({facts, marketLanguage, rules})`.
- Produces: `findFrontBackDuplicates(listing)` and `findEmptyBenefitPhrases(listing)`.

- [ ] **Step 1: Write failing intent and duplication tests**

```js
test('brief assigns purchase intent before mounting surfaces', () => {
  const brief = compileListingBrief(fixture);
  assert.equal(brief.fields.item_highlights.priority[0], 'purchase_intent');
  assert.equal(brief.fields.backend_search_terms.strategy, 'complement_frontend');
});
test('detects fully covered backend tokens and empty benefit phrasing', () => {
  assert.deepEqual(findFrontBackDuplicates(listing), ['aluminum','waterproof']);
  assert.deepEqual(findEmptyBenefitPhrases({bullets:[{body:'Supports exposed settings.'}]}), ['bullets.0.body']);
  assert.deepEqual(findEmptyBenefitPhrases({bullets:[{body:'Provides a clear warning display in a compact size.'}]}), []);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/listing-briefs.test.js tests/unit/listing.test.js`
Expected: FAIL for missing brief and semantic helpers.

- [ ] **Step 3: Implement the positive field recipe and narrow semantic checks**

Normalize tokens for duplicate analysis but do not reject necessary product identity words solely because they appear twice. Flag empty phrases only when the clause lacks a concrete object or consequence; do not ban verbs globally.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/listing-briefs.test.js tests/unit/listing.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/listing-briefs.js tests/unit/listing-briefs.test.js scripts/lib/listing.js tests/unit/listing.test.js
git commit -m "feat: guide conversion-focused listing copy"
```

### Task 4: Prove the micro-revision fast path has no expansive calls

**Files:**
- Create: `tests/workflow/listing-fast-path.test.js`
- Modify: `scripts/studio.js`
- Modify: `scripts/lib/operations.js`

**Interfaces:**
- CLI adds `revise-listing` and Listing form of `approve`.
- `runListingRevision(input, deps)` accepts injected `marketResearch`, `ruleRefresh`, `imageGeneration`, and `repositoryTests` dependencies.

- [ ] **Step 1: Write the failing call-boundary test**

```js
test('single-field revision calls only patch, changed validation, and render', async () => {
  const calls = [];
  await runListingRevision(input, recordingDependencies(calls));
  assert.deepEqual(calls, ['load-state','patch-draft','validate-changed','render-markdown','write-transaction']);
  assert.ok(!calls.includes('market-research'));
  assert.ok(!calls.includes('rule-refresh'));
  assert.ok(!calls.includes('image-generation'));
  assert.ok(!calls.includes('repository-tests'));
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/workflow/listing-fast-path.test.js`
Expected: FAIL because the fast runner is missing.

- [ ] **Step 3: Implement the exact fast orchestration path**

Use `classifyOperation`, `reviseDraft`, changed-scope Listing validation, Markdown render, and `updateProject`. Do not instantiate or invoke the expansive dependencies.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/workflow/listing-fast-path.test.js tests/unit/listing-drafts.test.js tests/unit/operations.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/workflow/listing-fast-path.test.js scripts/studio.js scripts/lib/operations.js
git commit -m "feat: add isolated listing micro revisions"
```

### Task 5: Consolidate Skill references and compatibility wrappers

**Files:**
- Modify: `SKILL.md`
- Create: `references/knowledge-and-facts.md`
- Create: `references/listing-workflow.md`
- Create: `references/delivery-and-compliance.md`
- Modify: `scripts/init-project.js`
- Modify: `scripts/validate-state.js`
- Modify: `scripts/validate-listing.js`
- Modify: `scripts/build-delivery.js`
- Modify: `tests/skill-structure.test.js`

**Interfaces:**
- Old CLI files become thin compatibility wrappers around `studio.js` or v2 libraries.
- `SKILL.md` routes a task to at most one domain reference plus delivery reference only when finalizing.

- [ ] **Step 1: Write failing structure and wrapper tests**

```js
test('entrypoint describes two modes and four focused references', () => {
  assert.match(skill, /fast mode/i);
  assert.match(skill, /full mode/i);
  for (const name of ['knowledge-and-facts.md','image-workflow.md','listing-workflow.md','delivery-and-compliance.md']) assert.match(skill, new RegExp(name));
  assert.doesNotMatch(skill, /read capability-contracts.*before every/i);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/skill-structure.test.js tests/workflow/studio-cli.test.js`
Expected: FAIL because old routing remains.

- [ ] **Step 3: Write the concise router, references, and wrappers**

Retain only real quality boundaries in `SKILL.md`. Move conditional detail to the four references. Compatibility wrappers print a deprecation warning to stderr and delegate without duplicating logic.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/skill-structure.test.js tests/workflow/studio-cli.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add SKILL.md references/knowledge-and-facts.md references/listing-workflow.md references/delivery-and-compliance.md scripts/init-project.js scripts/validate-state.js scripts/validate-listing.js scripts/build-delivery.js tests/skill-structure.test.js
git commit -m "refactor: simplify listing studio routing"
```

### Task 6: Verify migration, final integrity, and deployment readiness

**Files:**
- Modify: `tests/workflow/end-to-end.test.js`
- Create: `tests/workflow/two-speed-end-to-end.test.js`
- Modify: `scripts/lib/bundle.js`
- Modify: `evals/final-verification.md`

**Interfaces:**
- End-to-end fixture covers library merge -> Product Master -> approved gallery -> Listing draft/revision/approval -> final bundle.
- Finalization always decodes and rehashes every selected file regardless of earlier hashes.

- [ ] **Step 1: Write a failing final rehash and workflow test**

```js
test('finalize rehashes every selected artifact and rejects post-approval mutation', async () => {
  const project = await buildApprovedFixture();
  await mutateSelectedImage(project);
  await assert.rejects(finalize(project), /hash mismatch/);
  assert.equal(hashCalls, selectedArtifactCount);
});
test('completed legacy fixture migrates without changing its source tree', async () => {
  const before = await hashTree(legacySource);
  await migrateLegacyProject({sourceDir:legacySource, destinationDir:out});
  assert.deepEqual(await hashTree(legacySource), before);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/workflow/two-speed-end-to-end.test.js`
Expected: FAIL until finalization uses v2 state and forced rehashing.

- [ ] **Step 3: Implement minimal v2 bundle integration**

Read only approved selected paths from v2 state, decode each raster, recalculate hashes, compare approval bindings, render Listing snapshot, create manifest, and verify ZIP entries. Preserve `rules_unverified` and `upload_ready:false` exactly.

- [ ] **Step 4: Run focused then full verification**

Run: `node --test tests/workflow/two-speed-end-to-end.test.js tests/workflow/migration.test.js tests/unit/bundle.test.js`
Expected: PASS.
Run: `npm test`
Expected: all tests PASS with no unexpected warnings.

- [ ] **Step 5: Run Skill validation and record evidence**

Run: `python D:/Codex/CodexHome/skills/.system/skill-creator/scripts/quick_validate.py D:/Amazon/Amazon-listing-gen`
Expected: valid Skill. Update `evals/final-verification.md` with commands, counts, migration-fixture result, and confirmation that no live image generation was used.

- [ ] **Step 6: Commit final integration**

```bash
git add tests/workflow/end-to-end.test.js tests/workflow/two-speed-end-to-end.test.js scripts/lib/bundle.js evals/final-verification.md
git commit -m "test: verify two-speed listing studio delivery"
```
