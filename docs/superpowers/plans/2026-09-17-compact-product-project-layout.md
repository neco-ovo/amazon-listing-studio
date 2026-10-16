# Compact Product Project Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the many-folder product workspace with a lazy compact layout and a validated `product.json` handoff for downstream skills.

**Architecture:** Centralize every project-relative path in one module, keep workflow state under `.studio/`, and materialize only current approved facts, images, Listings, and delivery files into the visible project surface. Existing projects use one atomic compaction command; ordinary runtime code supports only the compact layout.

**Tech Stack:** Node.js 20+, ES modules, `node:fs/promises`, `node:test`, existing `fflate` and `sharp` dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-compact-product-project-layout-design.md`

## Global Constraints

- Initialize only `project.md`, `product.json`, and `.studio/state.json`; create all directories lazily.
- Keep current formal artifacts in `assets/`, `listing/`, and `delivery/`; keep candidates and drafts in `.studio/work/`.
- `product.json` is the only downstream index and follows `references/amazon-product-project-input-v1.md`.
- Never automatically delete current approved artifacts, user sources, user-marked notes, or unknown files.
- Do not add dependencies, project-local scripts, `node_modules`, background cleanup, or permanent old-path fallback.
- Use targeted invalidation from `.studio/state.json`; missing legacy dependencies invalidate only the affected scope.
- Every destructive compaction step must have a tested restore path.

---

### Task 1: Project layout and Product Input v1 validator

**Files:**
- Create: `scripts/lib/project-layout.js`
- Create: `tests/unit/project-layout.test.js`

**Interfaces:**
- Produces: `projectPaths(projectDir)`, `assertProjectPath(projectDir, relativePath)`, `validateProductDocument(document, {projectDir, realpathFile})`, `buildProductDocument(state)`.
- Consumes: current schema-v2 state records; no filesystem mutation except path validation.

- [ ] **Step 1: Write failing tests for canonical paths and single-product projection**

```js
test('defines the compact project paths without creating directories', () => {
  const paths = projectPaths('D:/products/sign');
  assert.equal(paths.state, path.resolve('D:/products/sign/.studio/state.json'));
  assert.equal(paths.product, path.resolve('D:/products/sign/product.json'));
  assert.equal(paths.assets, path.resolve('D:/products/sign/assets'));
});

test('projects only confirmed publishable facts and approved artifacts', () => {
  const document = buildProductDocument(singleStateFixture());
  assert.deepEqual(document.facts, {material: 'Aluminum'});
  assert.equal(document.assets[0].path, 'assets/main.png');
  assert.equal(document.listing.product, 'listing/listing.json');
  assert.equal(JSON.stringify(document).includes('sha256'), false);
});
```

- [ ] **Step 2: Write failing boundary tests**

```js
test('rejects duplicate Children and invalid scope references', async () => {
  const document = variationDocumentFixture();
  document.variation.children.push(structuredClone(document.variation.children[0]));
  assert.throws(() => validateProductDocument(document), /duplicate Child SKU/i);
});

test('rejects indexed files whose real path escapes the project root', async () => {
  await assert.rejects(
    validateProductDocument(productDocumentFixture(), {
      projectDir: root,
      realpathFile: async () => path.resolve(root, '../outside.png')
    }),
    /outside the project root/i
  );
});
```

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test tests/unit/project-layout.test.js`

Expected: FAIL because `scripts/lib/project-layout.js` does not exist.

- [ ] **Step 4: Implement the minimal layout module**

```js
export function projectPaths(projectDir) {
  const root = path.resolve(projectDir);
  return {
    root,
    summary: path.join(root, 'project.md'),
    product: path.join(root, 'product.json'),
    studio: path.join(root, '.studio'),
    state: path.join(root, '.studio', 'state.json'),
    work: path.join(root, '.studio', 'work'),
    assets: path.join(root, 'assets'),
    listing: path.join(root, 'listing'),
    delivery: path.join(root, 'delivery')
  };
}
```

Implement strict object/array/string/integer checks, exact active Child references, canonical scope rules, POSIX relative paths, and resolved-path containment. `buildProductDocument` omits unknown/conflicted facts, approvals, hashes, candidates, and empty optional sections.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/unit/project-layout.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/project-layout.js tests/unit/project-layout.test.js
git commit -m "feat: define compact product project contract"
```

---

### Task 2: Lazy initialization and centralized state I/O

**Files:**
- Modify: `scripts/studio.js`
- Modify: `scripts/lib/transactions.js`
- Modify: `scripts/lib/bundle.js`
- Modify: `scripts/lib/variation-bundle.js`
- Modify: `scripts/lib/variation-project.js`
- Modify: `tests/workflow/studio-cli.test.js`
- Modify: `tests/unit/transactions.test.js`
- Modify: `tests/workflow/variation-project.test.js`

**Interfaces:**
- Consumes: `projectPaths()` and `buildProductDocument()` from Task 1.
- Produces: `readProjectState(projectDir)` and `writeProjectSnapshot(projectDir, state)` in `scripts/lib/project-layout.js`.

- [ ] **Step 1: Change initialization expectations first**

```js
test('init creates only the compact project core', async () => {
  const result = await runCli(initArgs(root));
  assert.deepEqual(result.result.created.sort(), ['.studio/state.json', 'product.json', 'project.md'].sort());
  assert.equal(await exists(path.join(result.result.project_dir, 'assets')), false);
  assert.equal(await exists(path.join(result.result.project_dir, 'listing')), false);
  assert.equal(await exists(path.join(result.result.project_dir, 'delivery')), false);
});
```

Update state transaction tests to read `.studio/state.json` and assert that `product.json` and `project.md` are refreshed in the same transaction.

- [ ] **Step 2: Run the changed tests and verify RED**

Run: `node --test tests/workflow/studio-cli.test.js tests/unit/transactions.test.js tests/workflow/variation-project.test.js`

Expected: FAIL on root `state.json` and eager directory creation.

- [ ] **Step 3: Add centralized readers and an atomic snapshot writer**

```js
export async function readProjectState(projectDir) {
  return JSON.parse(await readFile(projectPaths(projectDir).state, 'utf8'));
}

export async function writeProjectSnapshot(projectDir, state) {
  const paths = projectPaths(projectDir);
  await mkdir(paths.studio, {recursive: true});
  await writeAtomic(paths.state, `${JSON.stringify(state, null, 2)}\n`);
  await writeAtomic(paths.product, `${JSON.stringify(buildProductDocument(state), null, 2)}\n`);
  await writeAtomic(paths.summary, renderProjectSummary(state));
}
```

`writeAtomic` writes a sibling temporary file, closes it, and renames it over the destination. Replace direct root-state reads and writes in the listed runtime files; do not retain a root fallback.

- [ ] **Step 4: Make `initProject` lazy**

Create the product root and `.studio/`, then call `writeProjectSnapshot`. Remove the eager directory loop and return the three created relative paths.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test tests/workflow/studio-cli.test.js tests/unit/transactions.test.js tests/workflow/variation-project.test.js`

Run: `npm test`

Expected: all tests PASS after fixtures use the compact state path.

- [ ] **Step 6: Commit**

```bash
git add scripts tests
git commit -m "refactor: centralize compact project state paths"
```

---

### Task 3: Publish approved images and Listings to the visible surface

**Files:**
- Modify: `scripts/lib/project-layout.js`
- Modify: `scripts/studio.js`
- Modify: `scripts/lib/transactions.js`
- Modify: `scripts/lib/variation-approvals.js`
- Modify: `tests/workflow/image-fast-path.test.js`
- Modify: `tests/workflow/listing-fast-path.test.js`
- Modify: `tests/workflow/variation-public-approvals.test.js`

**Interfaces:**
- Produces: `publishedAssetPath({scope, childSku, role, sourcePath})`, `publishApprovedFile(projectDir, sourceRelativePath, destinationRelativePath)`.
- Consumes: snapshot writer from Task 2.

- [ ] **Step 1: Write failing publication tests**

```js
test('approving a single-product main publishes it and indexes only the formal path', async () => {
  const result = await runApprove({projectDir, artifactId: 'main-v1', userAction: 'approved'});
  const product = await readJson(path.join(projectDir, 'product.json'));
  assert.equal(product.assets[0].path, 'assets/main.png');
  assert.equal(await exists(path.join(projectDir, 'assets/main.png')), true);
  assert.equal(product.assets.some(item => item.path.includes('.studio/work')), false);
});
```

Add cases for a shared Variation image, a Child main image, a Parent Listing, and a Child Listing.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/workflow/image-fast-path.test.js tests/workflow/listing-fast-path.test.js tests/workflow/variation-public-approvals.test.js`

Expected: FAIL because approved records still point to candidate and legacy paths.

- [ ] **Step 3: Implement deterministic published paths**

```js
export function publishedAssetPath({scope, childSku, role, sourcePath}) {
  const extension = path.extname(sourcePath).toLowerCase() || '.png';
  if (scope === 'product') return `assets/${role}${extension}`;
  if (scope === 'shared') return `assets/shared/${role}${extension}`;
  return `assets/children/${childSku}/${role}${extension}`;
}
```

Listings publish to `listing/listing.json`, `listing/parent/listing.json`, or `listing/children/<sku>/listing.json`, with matching Markdown beside the JSON.

- [ ] **Step 4: Publish before committing state**

Copy to a temporary file beside the destination, decode/inspect images or parse Listing JSON, rename into place, then write state and `product.json`. If state writing fails, remove only the newly staged file; never overwrite the last approved file before validation.

- [ ] **Step 5: Run focused and full tests**

Run the three focused files, then `npm test`.

Expected: PASS; `product.json` contains only formal paths.

- [ ] **Step 6: Commit**

```bash
git add scripts tests
git commit -m "feat: publish approved project artifacts"
```

---

### Task 4: Canonical single and Variation product projection

**Files:**
- Modify: `scripts/lib/project-layout.js`
- Modify: `scripts/lib/variation-project.js`
- Modify: `scripts/lib/variation-images.js`
- Modify: `tests/unit/project-layout.test.js`
- Modify: `tests/workflow/variation-operations.test.js`

**Interfaces:**
- Consumes: approved artifact records and fact dependency metadata.
- Produces: canonical `variation`, `assets`, and `listing` members in `product.json`.

- [ ] **Step 1: Add failing sparse Variation tests**

```js
test('projects only active Children without inventing sparse combinations', () => {
  const product = buildProductDocument(sparseCompoundState());
  assert.deepEqual(product.variation.children.map(item => item.sku), ['YELLOW-8X12', 'RED-12X16']);
  assert.equal(product.variation.children.length, 2);
});

test('uses exactly one canonical asset scope representation', () => {
  const product = buildProductDocument(variationState());
  assert.equal(product.assets.some(item => item.scope === 'shared' && item.child_skus), false);
  assert.equal(product.assets.find(item => item.child_skus)?.scope, 'subset');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/unit/project-layout.test.js tests/workflow/variation-operations.test.js`

- [ ] **Step 3: Implement projection rules**

Top-level facts contain confirmed publishable common facts. Child entries contain exact ordered Variation values plus confirmed overrides only. Active Children are the complete set. Omit absent Parent or Child Listings instead of synthesizing paths. Emit `shared` for all active Children, `subset` for a non-empty strict subset, and `child` for one Child.

- [ ] **Step 4: Verify targeted invalidation**

Add a test that changes one Child fact with dependency metadata and confirms only matching indexed artifacts disappear. Add a legacy no-metadata test that invalidates the affected Child scope but leaves siblings indexed.

- [ ] **Step 5: Run focused and full tests**

Run focused tests, then `npm test`.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/project-layout.js scripts/lib/variation-project.js scripts/lib/variation-images.js tests
git commit -m "feat: materialize canonical variation product input"
```

---

### Task 5: Bounded lifecycle cleanup

**Files:**
- Create: `scripts/lib/project-cleanup.js`
- Create: `tests/unit/project-cleanup.test.js`
- Modify: `scripts/studio.js`
- Modify: `scripts/lib/transactions.js`

**Interfaces:**
- Produces: `cleanupAfterApproval(projectDir, {kind, scope, role, childSku, keepPath})`, `cleanupAfterDelivery(projectDir, keepNames)`.
- Consumes: state ownership records; deletes only registered generated files and known temporary suffixes.

- [ ] **Step 1: Write failing safety and retention tests**

```js
test('removes rejected generated candidates but preserves user and unknown files', async () => {
  const result = await cleanupAfterApproval(projectDir, eventFixture());
  assert.equal(await exists(rejectedCandidate), false);
  assert.equal(await exists(userReference), true);
  assert.equal(await exists(unknownScript), true);
  assert.deepEqual(result.preserved_unknown, ['.studio/work/custom.mjs']);
});

test('retains one prior approved artifact per Child and role', async () => {
  await cleanupAfterApproval(projectDir, {kind: 'image', scope: 'child', childSku: 'SKU-A', role: 'main', keepPath: current});
  assert.equal((await historyFor('SKU-A', 'main')).length, 1);
  assert.equal((await historyFor('SKU-B', 'main')).length, 1);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/unit/project-cleanup.test.js`

- [ ] **Step 3: Implement allowlist cleanup**

Recognize generated candidates through state registration, spreadsheet lock prefix `~$`, `.inspect.ndjson`, generated preview records, extracted delivery records, and empty directories. Never infer ownership from a generic `.js`, `.mjs`, `.ps1`, image, or document extension.

- [ ] **Step 4: Attach cleanup only after successful writes**

Approval and delivery commands call cleanup after the new formal file, state, and `product.json` are committed. Cleanup failure returns a warning and leaves formal success intact; it never rolls back a valid approval.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test tests/unit/project-cleanup.test.js`

Run: `npm test`

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/project-cleanup.js scripts/studio.js scripts/lib/transactions.js tests/unit/project-cleanup.test.js
git commit -m "feat: clean bounded project work artifacts"
```

---

### Task 6: Replace dated delivery trees with one current delivery

**Files:**
- Modify: `scripts/lib/bundle.js`
- Modify: `scripts/lib/variation-bundle.js`
- Modify: `scripts/lib/upload-preparation.js`
- Modify: `scripts/studio.js`
- Modify: `tests/workflow/two-speed-end-to-end.test.js`
- Modify: `tests/workflow/variation-delivery.test.js`
- Modify: `tests/workflow/upload-preparation.test.js`

**Interfaces:**
- Consumes: `projectPaths(projectDir).delivery` and cleanup from Task 5.
- Produces: current `delivery/delivery.zip`, `delivery/delivery-manifest.json`, and optional `delivery/upload-template.<ext>`.

- [ ] **Step 1: Write failing replacement tests**

Assert that successful finalization replaces the current delivery atomically, leaves no extracted verification directory, and retains the prior delivery until the new ZIP has passed verification. Assert upload preparation replaces only the current workbook and removes lock/previews after validation.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/workflow/two-speed-end-to-end.test.js tests/workflow/variation-delivery.test.js tests/workflow/upload-preparation.test.js`

- [ ] **Step 3: Stage and promote delivery**

Build under `.studio/work/delivery-next/`, run the existing verifier there, rename current `delivery/` to `.studio/work/delivery-previous/`, promote the verified directory, and restore the previous directory if promotion fails. Remove the previous binary only after success and retain delivery metadata in state.

- [ ] **Step 4: Keep upload workbook names stable**

Use `delivery/upload-template.xlsx` or the source template extension. Do not create dated output folders or store rendered previews in `delivery/`.

- [ ] **Step 5: Run focused and full tests**

Run focused tests, then `npm test`.

- [ ] **Step 6: Commit**

```bash
git add scripts tests
git commit -m "refactor: keep one verified delivery surface"
```

---

### Task 7: One-time atomic old-project compactor

**Files:**
- Create: `scripts/lib/project-compactor.js`
- Create: `tests/unit/project-compactor.test.js`
- Modify: `scripts/studio.js`
- Modify: `tests/workflow/studio-cli.test.js`

**Interfaces:**
- Produces: `planProjectCompaction(projectDir)`, `compactProject(projectDir, {apply})`.
- Consumes: validator and snapshot writer from Tasks 1–2.

- [ ] **Step 1: Write failing dry-run and preservation tests**

```js
test('dry-run reports moves and deletions without changing bytes', async () => {
  const before = await snapshotTree(projectDir);
  const report = await compactProject(projectDir, {apply: false});
  assert.equal(report.applied, false);
  assert.deepEqual(await snapshotTree(projectDir), before);
});

test('preserves unknown files under .studio/legacy', async () => {
  await writeFile(path.join(projectDir, 'custom-tool.mjs'), 'user code');
  await compactProject(projectDir, {apply: true});
  assert.equal(await readFile(path.join(projectDir, '.studio/legacy/custom-tool.mjs'), 'utf8'), 'user code');
});
```

- [ ] **Step 2: Write failing rollback tests**

Inject filesystem operations so promotion fails after the original is renamed. Assert the original path and every original byte are restored and the sibling backup is not deleted.

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test tests/unit/project-compactor.test.js tests/workflow/studio-cli.test.js`

- [ ] **Step 4: Implement plan, staging, validation, and swap**

Build `<project>.compact-staging`, validate its `product.json`, indexed files, and state, rename the original to `<project>.compact-backup`, then promote staging. On promotion failure, restore the backup. Delete the backup only after the promoted project passes a final open-and-validate check.

Deletion is limited to the explicit generated-artifact allowlist. Move every unrecognized file to `.studio/legacy/` while retaining its relative path.

- [ ] **Step 5: Add CLI routing**

```text
node scripts/studio.js compact-project --project-dir <path>
node scripts/studio.js compact-project --project-dir <path> --apply
```

The default is dry-run. `--apply` performs the staged migration; no extra confirmation is embedded in the command.

- [ ] **Step 6: Run focused and full tests**

Run focused tests, then `npm test`.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/project-compactor.js scripts/studio.js tests
git commit -m "feat: compact legacy product projects atomically"
```

---

### Task 8: Skill routing, contract verification, and installed copy

**Files:**
- Modify: `SKILL.md`
- Modify: `references/knowledge-and-facts.md`
- Modify: `references/image-workflow.md`
- Modify: `references/listing-workflow.md`
- Modify: `references/delivery-and-compliance.md`
- Modify: `references/variation-workflow.md`
- Modify: `tests/skill-structure.test.js`
- Modify: `tests/workflow/required-matrix.test.js`

**Interfaces:**
- Consumes: completed compact runtime and `references/amazon-product-project-input-v1.md`.
- Produces: concise agent routing that uses compact paths without loading the contract unless a downstream handoff or compaction task needs it.

- [ ] **Step 1: Add failing contract tests**

Assert that `SKILL.md` requires lazy compact initialization, routes A+ handoff to the v1 input contract, forbids project-local dependencies and scripts, and routes old projects only through `compact-project`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/skill-structure.test.js tests/workflow/required-matrix.test.js`

- [ ] **Step 3: Make the smallest documentation edits**

Replace old path examples; do not duplicate the full input contract in `SKILL.md`. Add one route to `references/amazon-product-project-input-v1.md` for downstream handoff and one sentence pointing legacy projects to the compactor.

- [ ] **Step 4: Run all verification**

Run: `node --test tests/skill-structure.test.js tests/workflow/required-matrix.test.js`

Run: `npm test`

Run: `git diff --check`

Expected: all tests pass and the worktree is clean after commit.

- [ ] **Step 5: Commit**

```bash
git add SKILL.md references tests
git commit -m "docs: route compact Amazon product projects"
```

- [ ] **Step 6: Sync installed Skill after review**

Copy only repository-tracked Skill files to `D:/Codex/CodexHome/skills/amazon-listing-studio`, compare file hashes, and report the mismatch count. Do not copy `node_modules`, `.git`, `.worktrees`, or project data.
