# Two-Speed Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build state schema v2, shared knowledge permissions, automatic operation routing, transactional approvals, scoped validation, and safe legacy migration.

**Architecture:** Add focused v2 modules beside the existing implementation, expose them through one `studio.js` CLI, and retain old scripts as compatibility surfaces until all three simplification plans pass. `state.json` is authoritative and `project.md` is generated.

**Tech Stack:** Node.js >=20 ESM, `node:test`, filesystem atomic rename, JSON/Markdown.

**Spec:** `docs/superpowers/specs/2026-08-25-two-speed-simplification-design.md`

## Global Constraints

- Preserve all pre-existing dirty worktree changes and stage only files named by the current task.
- Use `apply_patch` for source and document edits.
- Follow RED -> GREEN -> REFACTOR for every behavior.
- Do not modify the completed product project; migration tests use a temporary copy.
- Do not add a server, database, UI, background worker, or new runtime dependency.
- Category observations never support deterministic product claims by themselves.
- Project facts override seller-family defaults.
- Failed transactions leave the previous `state.json` byte-for-byte unchanged.

---

### Task 1: Define state v2 and render the readable project summary

**Files:**
- Create: `scripts/lib/project-state.js`
- Create: `tests/unit/project-state.test.js`
- Modify: `assets/project-templates/project.md`

**Interfaces:**
- Produces: `createProjectState(input)`, `validateProjectState(state)`, `renderProjectSummary(state)`.
- `createProjectState({projectId, marketplace, language, productType}) -> StateV2`.

- [ ] **Step 1: Write the failing state and summary tests**

```js
test('creates one v2 state source and renders only current status', () => {
  const state = createProjectState({projectId: 'sign-1', marketplace: 'amazon.com', language: 'en-US', productType: 'METAL_SIGN'});
  assert.equal(state.schema_version, 2);
  assert.deepEqual(Object.keys(state.facts), []);
  assert.match(renderProjectSummary(state), /Current stage: intake/);
  assert.doesNotMatch(renderProjectSummary(state), /Change history/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/project-state.test.js`
Expected: FAIL because `project-state.js` does not exist.

- [ ] **Step 3: Implement the minimal schema, validator, and pure renderer**

Define top-level keys exactly as `schema_version`, `project`, `facts`, `product_master`, `gallery`, `listing`, `approvals`, `stale_dependencies`, `delivery`, and `metrics`. Reject unknown schema versions and missing project identity.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/project-state.test.js`
Expected: PASS.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add scripts/lib/project-state.js tests/unit/project-state.test.js assets/project-templates/project.md
git commit -m "feat: add compact project state v2"
```

### Task 2: Implement knowledge authority and reusable scopes

**Files:**
- Create: `scripts/lib/knowledge.js`
- Create: `tests/unit/knowledge.test.js`
- Create: `tests/fixtures/knowledge/categories/amazon.com/safety-signs.json`
- Create: `tests/fixtures/knowledge/seller-families/aluminum-signs.json`

**Interfaces:**
- Produces: `loadKnowledge({libraryDir, marketplace, categoryId, familyId})` and `mergeKnowledge({category, family, projectFacts})`.
- Each merged item exposes `authority`, `publishable`, `value`, and `source_ids`.

- [ ] **Step 1: Write failing permission tests**

```js
test('category claims remain observations while family facts are publishable', async () => {
  const loaded = await loadKnowledge({libraryDir: fixtureRoot, marketplace: 'amazon.com', categoryId: 'safety-signs', familyId: 'aluminum-signs'});
  const merged = mergeKnowledge({category: loaded.category, family: loaded.family, projectFacts: {reflective: {value: false, status: 'user_confirmed'}}});
  assert.equal(merged.weatherproof.publishable, false);
  assert.equal(merged.rust_resistant.publishable, true);
  assert.equal(merged.reflective.value, false);
  assert.equal(merged.reflective.authority, 'project');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/knowledge.test.js`
Expected: FAIL because the knowledge API is missing.

- [ ] **Step 3: Implement strict three-layer merging**

Use authority order `project > seller_family > category`. Force category entries to `publishable:false`; require `confirmed_at`, `confirmed_by:user`, and nonempty `scope` before a family entry can be publishable.

- [ ] **Step 4: Verify GREEN and malformed-scope rejection**

Run: `node --test tests/unit/knowledge.test.js`
Expected: PASS, including a test that an unscoped family fact is rejected.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/knowledge.js tests/unit/knowledge.test.js tests/fixtures/knowledge
git commit -m "feat: add reusable listing knowledge authority"
```

### Task 3: Add automatic full/fast routing and validation scopes

**Files:**
- Create: `scripts/lib/operations.js`
- Create: `tests/unit/operations.test.js`

**Interfaces:**
- Produces: `classifyOperation(change) -> {mode:'fast'|'full', reasons:string[]}`.
- Produces: `validationPlan({operation, changedPaths}) -> {scope:'changed'|'artifact'|'final', checks:string[]}`.

- [ ] **Step 1: Write a failing routing matrix**

```js
for (const [kind, mode] of [['listing_field_edit','fast'], ['image_presentation_edit','fast'], ['approve_asset','fast'], ['product_identity_change','full'], ['marketplace_change','full'], ['finalize','full']]) {
  test(`${kind} routes to ${mode}`, () => assert.equal(classifyOperation({kind}).mode, mode));
}
test('micro copy validation excludes network, image, and repository checks', () => {
  const plan = validationPlan({operation:{kind:'listing_field_edit'}, changedPaths:['bullets.3.body']});
  assert.deepEqual(plan.checks, ['listing.changed-field','listing.fact-links','listing.affected-keywords']);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/operations.test.js`
Expected: FAIL for missing functions.

- [ ] **Step 3: Implement a table-driven router and explicit check plans**

Unknown operations fail closed with `full` and reason `UNKNOWN_OPERATION`; do not infer fast mode from a vague natural-language label.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/operations.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/operations.js tests/unit/operations.test.js
git commit -m "feat: route listing studio operations by impact"
```

### Task 4: Make approval and state writes transactional

**Files:**
- Create: `scripts/lib/transactions.js`
- Create: `tests/unit/transactions.test.js`
- Modify: `scripts/lib/project-state.js`

**Interfaces:**
- Produces: `updateProject(projectDir, mutator, {clock})`; `mutator` returns either a next state or `{state, ...operationResult}`, and the transaction returns the same shape after persistence.
- Produces: `approveArtifact(state, {artifactId, artifactType, path, userAction, now})`.
- Approval returns `{state, approval, next_action}` and calculates SHA-256 exactly once.

- [ ] **Step 1: Write failing success and rollback tests**

```js
test('approval hashes and binds the exact artifact in one transaction', async () => {
  const result = await updateProject(dir, state => approveArtifact(state, approvalInput));
  assert.match(result.approval.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.state.gallery.assets.hero.status, 'approved');
  assert.equal(result.next_action.kind, 'generate_gallery_item');
});
test('validation failure preserves prior state bytes', async () => {
  const before = await readFile(join(dir, 'state.json'));
  await assert.rejects(updateProject(dir, () => ({schema_version: 99})));
  assert.deepEqual(await readFile(join(dir, 'state.json')), before);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/transactions.test.js`
Expected: FAIL because transaction APIs are missing.

- [ ] **Step 3: Implement temp-write, validation, atomic rename, and summary render**

Write `<state>.tmp-<pid>`, validate it, rename to `state.json`, then render `project.md`. On any error remove only that explicit temporary path. Never mutate an existing approval ID during final approval.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/transactions.test.js tests/unit/project-state.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/transactions.js scripts/lib/project-state.js tests/unit/transactions.test.js
git commit -m "feat: record approvals transactionally"
```

### Task 5: Add safe legacy migration and the unified CLI

**Files:**
- Create: `scripts/lib/migration.js`
- Create: `scripts/studio.js`
- Create: `tests/workflow/migration.test.js`
- Create: `tests/workflow/studio-cli.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `migrateLegacyProject({sourceDir, destinationDir})` with no in-place mode.
- CLI supports `init`, `learn-category`, `record-candidate`, `approve`, `validate`, and `migrate` in this phase.

- [ ] **Step 1: Write failing migration and CLI tests**

```js
test('migration preserves master, selected assets, listing approval, and delivery', async () => {
  const state = await migrateLegacyProject({sourceDir: legacyFixture, destinationDir: out});
  assert.equal(state.product_master.version, 1);
  assert.equal(state.gallery.selected.length, 7);
  assert.equal(state.listing.approved.at(-1).version, 3);
  assert.equal(state.delivery.status, 'built');
});
test('migrate refuses identical source and destination', async () => {
  await assert.rejects(migrateLegacyProject({sourceDir: legacyFixture, destinationDir: legacyFixture}), /destination/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/workflow/migration.test.js tests/workflow/studio-cli.test.js`
Expected: FAIL for missing migration and CLI.

- [ ] **Step 3: Implement migration and JSON CLI responses**

Copy fixtures into test temp directories. Map legacy facts/assets into v2 without changing source files. CLI success output contains `ok`, `operation`, `mode`, `duration_ms`, and `result`; errors contain `ok:false`, stable `code`, and `message`.

- [ ] **Step 4: Verify GREEN and foundation regression**

Run: `node --test tests/unit/project-state.test.js tests/unit/knowledge.test.js tests/unit/operations.test.js tests/unit/transactions.test.js tests/workflow/migration.test.js tests/workflow/studio-cli.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/migration.js scripts/studio.js tests/workflow/migration.test.js tests/workflow/studio-cli.test.js package.json
git commit -m "feat: expose two-speed project foundation"
```
