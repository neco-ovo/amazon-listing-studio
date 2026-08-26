# Amazon Variation Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional, efficient Parent/Child Amazon Variation projects, including compound category-permitted themes, non-destructive single-product promotion, scoped images, complete Child Listings, and Family or Child delivery.

**Architecture:** Preserve the current schema-v2 single-product path and add a `variation_family` extension that is loaded only for Variation operations. Keep pure Variation rules in focused modules, use existing atomic project transactions for state changes, and materialize complete Child outputs only at approval and delivery boundaries.

**Tech Stack:** Node.js 20+ ESM, built-in `node:test`, `fflate`, `sharp`, JSON state, Markdown Skill references.

**Spec:** `docs/superpowers/specs/2026-08-27-amazon-variation-support-design.md`

## Global Constraints

- Existing single-product behavior and all 207 baseline tests must remain valid.
- Variation logic is optional and must not run for ordinary single-product operations.
- A Parent may contain only facts shared by every active Child.
- Each Child has an independent Product Master and exact variation tuple.
- Use only a Variation Theme permitted by the current category schema or user-provided category template; never invent a compound theme.
- Compound themes allow sparse real combinations and reject duplicate complete tuples.
- Approved legacy files are referenced in place during promotion; do not move, copy, overwrite, or rehash them merely for directory normalization.
- Secondary images reuse reviewed merchant layouts when compatible; rigid aluminum signs use the existing local reviewed seeds.
- Do not require precise physical-ratio analysis for every Child main image; reserve it for dimension graphics, explicit requests, or visible distortion.
- Use test-first RED-GREEN-REFACTOR for every production behavior.
- Keep normal edits scoped to the changed Child or direct dependency; reserve whole-family integrity checks for finalization.

---

### Task 1: Optional Variation State Model

**Files:**
- Create: `scripts/lib/variations.js`
- Modify: `scripts/lib/project-state.js`
- Create: `tests/unit/variations.test.js`
- Modify: `tests/unit/project-state.test.js`

**Interfaces:**
- Produces: `createVariationExtension({parentSku, dimensions, firstChildSku, firstChildFacts, now}) -> VariationExtension`
- Produces: `validateVariationExtension(variation) -> {valid, errors}`
- Produces: `variationTupleKey(dimensions, values) -> string`
- `validateProjectState(state)` continues to accept single-product state and validates `state.variation` only when present.

- [ ] **Step 1: Write failing tests for optional state and compound tuples**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {createVariationExtension, validateVariationExtension, variationTupleKey} from '../../scripts/lib/variations.js';

test('creates a sparse compound Variation without inventing combinations', () => {
  const variation = createVariationExtension({
    parentSku: 'SIGN-PARENT',
    dimensions: ['color_name', 'size_name'],
    firstChildSku: 'SIGN-DEER-12X16',
    firstChildFacts: {color_name: 'Deer Crossing', size_name: '12 x 16 in'},
    now: '2026-08-27T00:00:00.000Z'
  });
  assert.deepEqual(variation.theme.dimensions, ['color_name', 'size_name']);
  assert.deepEqual(Object.keys(variation.children), ['SIGN-DEER-12X16']);
  assert.equal(variationTupleKey(variation.theme.dimensions, variation.children['SIGN-DEER-12X16'].variation_values), 'deer crossing\u001f12 x 16 in');
  assert.equal(validateVariationExtension(variation).valid, true);
});

test('rejects duplicate Child tuples', () => {
  const variation = createVariationExtension({
    parentSku: 'SIGN-PARENT', dimensions: ['size_name'], firstChildSku: 'SKU-A',
    firstChildFacts: {size_name: '12 x 16 in'}
  });
  variation.children['SKU-B'] = structuredClone(variation.children['SKU-A']);
  variation.children['SKU-B'].sku = 'SKU-B';
  assert.match(validateVariationExtension(variation).errors.join('\n'), /duplicate variation tuple/i);
});
```

```js
test('single-product state stays free of Variation overhead', () => {
  const state = createProjectState({projectId: 'single', productType: 'METAL_SIGN'});
  assert.equal(Object.hasOwn(state, 'variation'), false);
  assert.equal(validateProjectState(state).valid, true);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/unit/variations.test.js tests/unit/project-state.test.js`

Expected: FAIL because `scripts/lib/variations.js` and its exports do not exist.

- [ ] **Step 3: Implement the minimal Variation extension and conditional validator**

Use this stored shape:

```js
{
  schema_version: 1,
  mode: 'variation_family',
  family_identity: {version: 0, status: 'draft', facts: {}, non_merge_boundaries: []},
  theme: {dimensions: ['color_name', 'size_name'], source: null, verification_status: 'unverified'},
  parent: {sku: 'SIGN-PARENT', version: 0, status: 'draft', listing: {draft: null, approved: []}},
  children: {
    'SIGN-DEER-12X16': {
      sku: 'SIGN-DEER-12X16', active: true,
      variation_values: {color_name: 'Deer Crossing', size_name: '12 x 16 in'},
      facts: {}, product_master: null, listing: {draft: null, approved: []}, legacy_refs: {}
    }
  },
  shared_assets: {},
  versions: [],
  updated_at: '2026-08-27T00:00:00.000Z'
}
```

Normalize tuple keys by trimming and lowercasing string values in declared dimension order. Validation must reject missing Parent SKU, empty or repeated dimensions, unsafe or duplicate Child SKUs, missing dimension values, duplicate complete tuples, malformed collections, and a mode other than `variation_family`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/unit/variations.test.js tests/unit/project-state.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/variations.js scripts/lib/project-state.js tests/unit/variations.test.js tests/unit/project-state.test.js
git commit -m "feat: add optional variation state model"
```

---

### Task 2: Category-Permitted Theme Selection and Difference Classification

**Files:**
- Modify: `scripts/lib/variations.js`
- Modify: `tests/unit/variations.test.js`

**Interfaces:**
- Produces: `selectVariationTheme({allowedThemes, requestedDimensions}) -> {dimensions, source, verification_status}`
- Produces: `computeCommonFacts(children) -> {common, child_only, conflicts}`
- Produces: `classifyChildDifferences({children, identityFields, override}) -> {mode, reasons}`

- [ ] **Step 1: Write failing tests for permitted themes, sparse combinations, and two modes**

```js
test('selects only an exact category-permitted compound theme', () => {
  assert.deepEqual(selectVariationTheme({
    allowedThemes: [['size_name'], ['color_name', 'size_name']],
    requestedDimensions: ['color_name', 'size_name']
  }).dimensions, ['color_name', 'size_name']);
  assert.throws(() => selectVariationTheme({
    allowedThemes: [['size_name']], requestedDimensions: ['color_name', 'size_name']
  }), error => error.code === 'BLOCKING_INPUT');
});

test('classifies size-only Children as light difference', () => {
  const result = classifyChildDifferences({children: [
    {facts: {material: 'aluminum', purpose: 'safety sign', size_name: '8 x 12 in'}},
    {facts: {material: 'aluminum', purpose: 'safety sign', size_name: '12 x 16 in'}}
  ], identityFields: ['material', 'purpose']});
  assert.equal(result.mode, 'light');
});

test('classifies different warning meaning as large difference and honors override', () => {
  const children = [
    {facts: {material: 'aluminum', warning_semantics: 'horse crossing'}},
    {facts: {material: 'aluminum', warning_semantics: 'kids at play'}}
  ];
  assert.equal(classifyChildDifferences({children, identityFields: ['material']}).mode, 'large');
  assert.equal(classifyChildDifferences({children, identityFields: ['material'], override: 'light'}).mode, 'light');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/unit/variations.test.js`

Expected: FAIL because the three new functions are missing.

- [ ] **Step 3: Implement exact theme matching and fact comparison**

Treat dimension order as significant after normalizing field names. `computeCommonFacts` compares only active Children and returns a common value only when all supported Child facts match. The classifier treats Size, Color, Pattern, Style, and Pack Count as standard variation fields; different warning semantics, core purpose, buyer object, product form, or core function produce `large`. An explicit `light` or `large` override wins and is returned in `reasons`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/unit/variations.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/variations.js tests/unit/variations.test.js
git commit -m "feat: classify category-permitted variations"
```

---

### Task 3: Non-Destructive Project Promotion and Directory Supplementation

**Files:**
- Create: `scripts/lib/variation-project.js`
- Modify: `scripts/studio.js`
- Create: `tests/workflow/variation-project.test.js`
- Modify: `tests/workflow/studio-cli.test.js`

**Interfaces:**
- Consumes: `createVariationExtension(...)`, `validateVariationExtension(...)`, existing `updateProject(projectDir, mutator)`.
- Produces: `promoteToVariation({projectDir, parentSku, childSku, theme, themeSource, now}) -> {state, created, resumed}`
- Produces CLI: `studio.js promote-variation --project-dir <dir> --parent-sku <sku> --child-sku <sku> --theme <json-file>`.

- [ ] **Step 1: Write failing workflow tests**

```js
test('promotes a completed project without moving approved legacy files', async () => {
  const before = await readFile(path.join(projectDir, 'images/main/main-v1.png'));
  const result = await promoteToVariation({
    projectDir, parentSku: 'PARENT-1', childSku: 'CHILD-1',
    theme: {dimensions: ['size_name'], values: {size_name: '12 x 16 in'}},
    themeSource: {kind: 'category_schema', id: 'METAL_SIGN'}, now
  });
  assert.equal(result.state.project.mode, 'variation_family');
  assert.equal(result.state.variation.children['CHILD-1'].legacy_refs.main_image, 'images/main/main-v1.png');
  assert.deepEqual(await readFile(path.join(projectDir, 'images/main/main-v1.png')), before);
  for (const relative of ['family/shared-assets', 'parent/listing', 'children/CHILD-1/assets', 'children/CHILD-1/listing']) {
    assert.equal((await stat(path.join(projectDir, relative))).isDirectory(), true);
  }
});

test('promotion resumes idempotently after directory creation', async () => {
  await promoteToVariation(input);
  const resumed = await promoteToVariation(input);
  assert.equal(resumed.resumed, true);
  assert.deepEqual(resumed.created, []);
});
```

```js
test('promote-variation returns stable full-mode CLI output', async () => {
  const output = await runCli([
    'promote-variation', '--project-dir', projectDir, '--parent-sku', 'PARENT-1',
    '--child-sku', 'CHILD-1', '--theme', themePath
  ]);
  assert.equal(output.ok, true);
  assert.equal(output.operation, 'promote-variation');
  assert.equal(output.mode, 'full');
  assert.equal(output.result.state.project.mode, 'variation_family');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/workflow/variation-project.test.js tests/workflow/studio-cli.test.js`

Expected: FAIL because promotion and its CLI route do not exist.

- [ ] **Step 3: Implement promotion**

Read current state first. Require an existing Child SKU and a theme file containing `dimensions`, `values`, and a verified source. Create directories with recursive `mkdir`, then atomically add `project.mode`, `state.variation`, and legacy references. Preserve current `facts`, `product_master`, `gallery`, `listing`, approvals, hashes, and `delivery`; clone their identifiers into the first Child references rather than relocating files. If the same completed promotion is called again, validate and return `resumed: true`. A different Parent SKU, first Child SKU, or theme on an existing Variation is `STALE_DEPENDENCY`.

- [ ] **Step 4: Run focused and legacy init tests**

Run: `node --test tests/workflow/variation-project.test.js tests/workflow/studio-cli.test.js tests/unit/project-state.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/variation-project.js scripts/studio.js tests/workflow/variation-project.test.js tests/workflow/studio-cli.test.js
git commit -m "feat: promote projects to variation families"
```

---

### Task 4: Parent Baseline, Child Overrides, and Variation Listing Audit

**Files:**
- Create: `scripts/lib/variation-listing.js`
- Modify: `scripts/lib/listing-audit.js`
- Create: `tests/unit/variation-listing.test.js`
- Modify: `tests/unit/listing-audit.test.js`

**Interfaces:**
- Consumes: `computeCommonFacts(children)` and existing `auditListing(content, context)`.
- Produces: `materializeChildListing({parentContent, childOverrides, child, dimensions}) -> ListingContent`
- Produces: `auditVariationListings({parentContent, childContents, variation}) -> {ok, findings, affectedSkus}`
- Produces: `buildChildTitle({coreTerms, identity, attributes, variationValues, limit}) -> string`

- [ ] **Step 1: Write failing tests for Parent leakage, complete Child output, and title budget**

```js
test('materializes complete Child content from a shared Parent baseline', () => {
  const child = materializeChildListing({
    parentContent: validParentListing,
    childOverrides: {title: 'Hard Hat Required Aluminum Sign 12 x 16 Inch'},
    child: {sku: 'SKU-12X16', variation_values: {size_name: '12 x 16 in'}},
    dimensions: ['size_name']
  });
  assert.equal(child.title, 'Hard Hat Required Aluminum Sign 12 x 16 Inch');
  assert.deepEqual(child.bullets, validParentListing.bullets);
  assert.equal(child.child_sku, 'SKU-12X16');
});

test('flags a Parent title containing one Child size', () => {
  const result = auditVariationListings({
    parentContent: {...validParentListing, title: 'Aluminum Safety Sign 12 x 16 Inch'},
    childContents: validChildren,
    variation
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(item => item.code === 'PARENT_CHILD_ONLY_ATTRIBUTE'));
});

test('Child title keeps core search identity before variation values', () => {
  const title = buildChildTitle({
    coreTerms: ['hard hat required sign'], identity: ['aluminum'], attributes: ['weather resistant'],
    variationValues: ['12 x 16 inch'], limit: 75
  });
  assert.ok(title.length <= 75);
  assert.match(title, /^Hard Hat Required Sign/i);
  assert.match(title, /12 x 16 inch/i);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/unit/variation-listing.test.js tests/unit/listing-audit.test.js`

Expected: FAIL because Variation Listing functions do not exist.

- [ ] **Step 3: Implement deterministic merge and bounded audit**

Deep-clone Parent arrays and objects before applying known Child override paths. Add system-owned `parent_sku`, `child_sku`, `variation_theme`, and `variation_values` to materialized Child content. The audit compares Parent strings and attributes against every Child variation value and child-only fact, verifies every Child tuple, checks title values against that Child, then delegates normal retail-language checks to `auditListing`. Title construction must stop at the limit rather than truncate words; required variation values must displace lower-priority optional attributes.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/unit/variation-listing.test.js tests/unit/listing-audit.test.js tests/unit/listing.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/variation-listing.js scripts/lib/listing-audit.js tests/unit/variation-listing.test.js tests/unit/listing-audit.test.js
git commit -m "feat: generate parent and child listings"
```

---

### Task 5: Scoped Variation Images and Cross-Child Contamination Checks

**Files:**
- Create: `scripts/lib/variation-images.js`
- Modify: `scripts/lib/image-briefs.js`
- Create: `tests/unit/variation-images.test.js`
- Modify: `tests/unit/image-briefs.test.js`

**Interfaces:**
- Produces: `compileVariationImageBrief({scope, child, family, master, layoutSeed, userRequest, claims}) -> ImageBrief`
- Produces: `validateVariationImageObservation({brief, observation}) -> {ok, failures}`
- Produces: `evaluateSharedAssetApplicability({asset, child, commonFacts}) -> {applicable, reasons}`

- [ ] **Step 1: Write failing tests for Child binding and shared-layout reuse**

```js
test('binds a Child main brief to exact visible attributes', () => {
  const brief = compileVariationImageBrief({
    scope: {type: 'child_specific', child_skus: ['HORSE-12X16']},
    child: {sku: 'HORSE-12X16', variation_values: {size_name: '12 x 16 in', pattern_name: 'Horse Crossing'}},
    family, master, layoutSeed: null, userRequest: {}, claims: {}
  });
  assert.equal(brief.variation_binding.child_sku, 'HORSE-12X16');
  assert.equal(brief.variation_binding.required_visible.pattern_name, 'Horse Crossing');
});

test('rejects another Child pattern in the saved-image observation', () => {
  const result = validateVariationImageObservation({
    brief: horseBrief,
    observation: {visible_text: ['KIDS AT PLAY'], pattern_name: 'Kids at Play', size_name: '12 x 16 in'}
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(item => item.code === 'CROSS_CHILD_CONTAMINATION'));
});

test('reuses a rigid-aluminum merchant layout without requiring a new family image', () => {
  const result = evaluateSharedAssetApplicability({
    asset: {scope: 'shared_asset', fact_dependencies: {material: 'aluminum'}},
    child: {facts: {material: 'aluminum'}}, commonFacts: {material: 'aluminum'}
  });
  assert.equal(result.applicable, true);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/unit/variation-images.test.js tests/unit/image-briefs.test.js`

Expected: FAIL because scoped Variation image functions are absent.

- [ ] **Step 3: Implement scope contracts and observation checks**

Allow only `child_specific`, `shared_asset`, `subset_shared`, `family_range_asset`, and `parent_asset`. Require exactly one Child for `child_specific`; require a non-empty explicit SKU set for `subset_shared`; do not create `parent_asset` or `family_range_asset` implicitly. Wrap existing `compileImageBrief` and append immutable `variation_binding` data. Compare normalized observed Size, Color, Pattern, Style, Pack Count, orientation, and core printed wording with required values. Do not add mandatory pixel-ratio measurement; emit `VISIBLE_DISTORTION` only from an explicit inspection finding.

- [ ] **Step 4: Run image tests and verify GREEN**

Run: `node --test tests/unit/variation-images.test.js tests/unit/image-briefs.test.js tests/unit/images.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/variation-images.js scripts/lib/image-briefs.js tests/unit/variation-images.test.js tests/unit/image-briefs.test.js
git commit -m "feat: scope images to variation children"
```

---

### Task 6: Incremental Child Operations and Direct-Dependency Invalidation

**Files:**
- Modify: `scripts/lib/variation-project.js`
- Modify: `scripts/lib/operations.js`
- Modify: `scripts/studio.js`
- Create: `tests/workflow/variation-operations.test.js`
- Modify: `tests/unit/operations.test.js`

**Interfaces:**
- Produces: `addVariationChild(state, input) -> state`
- Produces: `reviseVariationChild(state, {sku, factPatch, listingPatch, now}) -> state`
- Produces: `removeVariationChild(state, {sku, now}) -> state`
- Adds CLI commands `add-child`, `revise-child`, and `remove-child` using JSON input files.

- [ ] **Step 1: Write failing tests for local invalidation**

```js
test('adding a light-difference Child preserves unrelated approvals', () => {
  const next = addVariationChild(state, {
    sku: 'SKU-8X12', variation_values: {size_name: '8 x 12 in'}, facts: sharedFacts, now
  });
  assert.equal(next.variation.children['SKU-12X16'].product_master.status, 'locked');
  assert.equal(next.variation.parent.status, 'stale');
  assert.deepEqual(next.variation.children['SKU-8X12'].listing.approved, []);
});

test('revising one Child title does not stale another Child', () => {
  const next = reviseVariationChild(state, {
    sku: 'SKU-8X12', listingPatch: {title: 'Updated Child Title'}, now
  });
  assert.equal(next.variation.children['SKU-8X12'].listing.status, 'draft');
  assert.equal(next.variation.children['SKU-12X16'].listing.status, 'approved');
});
```

```js
test('routes local Child changes without widening the workflow', () => {
  for (const kind of ['add_child', 'child_listing_field_edit', 'remove_child']) {
    assert.equal(classifyOperation({kind}).mode, 'fast');
  }
  assert.equal(classifyOperation({kind: 'variation_theme_change'}).mode, 'full');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/workflow/variation-operations.test.js tests/unit/operations.test.js`

Expected: FAIL because operations and routes are missing.

- [ ] **Step 3: Implement minimal incremental operations**

Validate unique SKU and tuple on add. Recompute the Parent common-fact intersection and mark Parent stale only when its effective common facts or active Child set changes. A Child Listing patch touches only that Child unless it changes a field promoted into Parent content. Removal sets `active: false`, preserves the record and history, and recalculates shared applicability. Store explicit stale reasons and affected IDs.

- [ ] **Step 4: Run workflow tests and verify GREEN**

Run: `node --test tests/workflow/variation-operations.test.js tests/unit/operations.test.js tests/workflow/listing-fast-path.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/variation-project.js scripts/lib/operations.js scripts/studio.js tests/workflow/variation-operations.test.js tests/unit/operations.test.js
git commit -m "feat: add incremental variation operations"
```

---

### Task 7: Parent, Child, and Shared-Asset Approval Contracts

**Files:**
- Create: `scripts/lib/variation-approvals.js`
- Modify: `scripts/lib/transactions.js`
- Create: `tests/unit/variation-approvals.test.js`

**Interfaces:**
- Produces: `approveVariationArtifact(state, input, {hashFile}) -> state`
- Produces: `approveVariationListing(state, input) -> state`
- Produces: `approveVariationVersion(state, input) -> state`

- [ ] **Step 1: Write failing tests for non-substitutable and scoped approvals**

```js
test('Child main approval cannot approve another Child', async () => {
  await assert.rejects(
    approveVariationArtifact(state, {
      artifactId: 'horse-main', artifactType: 'child_main', childSku: 'KIDS-12X16',
      path: 'children/HORSE-12X16/assets/main.png', userAction: 'approved', now
    }, {hashFile}),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('shared approval freezes dependencies and applicable Children', async () => {
  const next = await approveVariationArtifact(state, {
    artifactId: 'material-v1', artifactType: 'shared_image',
    childSkus: ['HORSE-12X16', 'KIDS-12X16'], factDependencies: {material: 'aluminum'},
    path: 'family/shared-assets/material.png', userAction: 'approved', now
  }, {hashFile});
  assert.deepEqual(next.variation.shared_assets['material-v1'].applicable_child_skus, ['HORSE-12X16', 'KIDS-12X16']);
});
```

```js
test('Parent approval rejects a Child-only size token', () => {
  assert.throws(() => approveVariationListing(state, {
    scopeType: 'parent_listing', content: {...parentContent, title: 'Safety Sign 12 x 16 Inch'},
    userAction: 'approved', now
  }), error => error.code === 'BLOCKING_INPUT');
});

test('final approval freezes the complete Variation scope', () => {
  const next = approveVariationVersion(fullyApprovedState, {userAction: 'approved', now});
  const approval = next.approvals.at(-1);
  assert.equal(approval.scope_type, 'variation_final');
  assert.deepEqual(approval.theme_dimensions, ['color_name', 'size_name']);
  assert.deepEqual(approval.child_skus, ['HORSE-12X16', 'KIDS-12X16']);
  assert.equal(approval.marketplace, 'amazon.com');
  assert.equal(approval.rule_status, 'verified');
  assert.ok(approval.child_versions.every(item => item.product_master_version > 0 && item.listing_version > 0));
  assert.ok(Object.keys(approval.asset_map).length > 0);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/unit/variation-approvals.test.js`

Expected: FAIL because Variation approval functions are missing.

- [ ] **Step 3: Implement approval records**

Reuse existing hash and explicit-user-action rules. Give each approval an immutable `scope_version: 1` and `scope_type` of `parent_listing`, `child_listing`, `child_main`, `shared_image`, or `variation_final`. Shared approval records factual dependencies plus the exact currently applicable Child set. New compatible Children may reference the shared approval through a new mapping record; they must not mutate the old approval record.

- [ ] **Step 4: Run approval and transaction tests**

Run: `node --test tests/unit/variation-approvals.test.js tests/unit/transactions.test.js tests/unit/listing-drafts.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/variation-approvals.js scripts/lib/transactions.js tests/unit/variation-approvals.test.js
git commit -m "feat: bind variation approval scopes"
```

---

### Task 8: Family and Single-Child Delivery

**Files:**
- Create: `scripts/lib/variation-bundle.js`
- Modify: `scripts/lib/bundle.js`
- Modify: `scripts/studio.js`
- Create: `tests/unit/variation-bundle.test.js`
- Create: `tests/workflow/variation-delivery.test.js`

**Interfaces:**
- Produces: `buildVariationDelivery({projectDir, outputDir, finalApproval, childSkus = null}) -> DeliveryResult`
- Produces: `verifyVariationDelivery({deliveryDir, expectedScope = null}) -> VerificationResult`
- CLI `finalize --project-dir ... --output ... --approval ... [--child-sku <sku>]` dispatches to Variation delivery only when project mode requires it.

- [ ] **Step 1: Write failing tests for Family contents and Child-only output**

```js
test('builds one Family archive with one physical shared image', async () => {
  const result = await buildVariationDelivery({projectDir, outputDir, finalApproval});
  const archive = unzipSync(await readFile(result.zip_path));
  assert.ok(archive['parent/listing.json']);
  assert.ok(archive['children/HORSE-12X16/listing.json']);
  assert.ok(archive['children/KIDS-12X16/listing.json']);
  assert.ok(archive['shared/material.png']);
  assert.ok(archive['variation-matrix.json']);
  assert.equal(Object.keys(archive).filter(name => name.endsWith('/material.png')).length, 1);
});

test('Child delivery excludes unrelated Child artifacts', async () => {
  const result = await buildVariationDelivery({projectDir, outputDir, finalApproval, childSkus: ['HORSE-12X16']});
  const archive = unzipSync(await readFile(result.zip_path));
  assert.ok(archive['children/HORSE-12X16/listing.json']);
  assert.equal(archive['children/KIDS-12X16/listing.json'], undefined);
});
```

```js
test('verification rejects incomplete or stale Variation archives', async t => {
  const cases = [
    ['duplicate tuple', archive => archive.matrix.children.push(structuredClone(archive.matrix.children[0])), 'DUPLICATE_VARIATION_TUPLE'],
    ['missing Child main', archive => delete archive.files['children/HORSE-12X16/main.png'], 'MISSING_FILE'],
    ['stale Child Listing', archive => { archive.matrix.children[0].listing_version -= 1; }, 'APPROVAL_SCOPE_MISMATCH'],
    ['changed shared asset', archive => { archive.files['shared/material.png'] = Buffer.from('changed'); }, 'HASH_MISMATCH'],
    ['missing matrix', archive => delete archive.files['variation-matrix.json'], 'MANIFEST_INVALID'],
    ['absent mapped member', archive => { archive.matrix.children[0].asset_paths.push('children/HORSE-12X16/missing.png'); }, 'MISSING_FILE']
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, async () => {
      const deliveryDir = await rewriteVariationPackage(validPackage, mutate);
      await assert.rejects(verifyVariationDelivery({deliveryDir}), error => error.code === code);
    });
  }
});
```

Define `rewriteVariationPackage` inside `tests/unit/variation-bundle.test.js`; it reads the valid fixture ZIP and manifest, exposes `{files, matrix, manifest}` to the supplied mutation, then writes a new isolated test package without calling production verification code.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/unit/variation-bundle.test.js tests/workflow/variation-delivery.test.js`

Expected: FAIL because Variation delivery functions are missing.

- [ ] **Step 3: Implement materialized delivery and verification**

Materialize Parent and complete effective Child Listing JSON/Markdown, Child main and applicable secondary-image entries, one copy of every selected shared asset, `variation-matrix.json`, and a manifest. Matrix rows contain Parent SKU, Child SKU, ordered theme dimensions, exact values, Listing version, Product Master version, and asset IDs. Reuse safe archive-path, decoding, hashing, and scope checks from `bundle.js`; do not create an upload spreadsheet. Child-only delivery still includes Parent identity, the selected Child row, and only that Child's applicable shared assets.

- [ ] **Step 4: Run delivery and legacy bundle tests**

Run: `node --test tests/unit/variation-bundle.test.js tests/workflow/variation-delivery.test.js tests/unit/bundle.test.js tests/workflow/two-speed-end-to-end.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/variation-bundle.js scripts/lib/bundle.js scripts/studio.js tests/unit/variation-bundle.test.js tests/workflow/variation-delivery.test.js
git commit -m "feat: package variation family deliveries"
```

---

### Task 9: Skill Routing, Behavioral Matrix, and Full Verification

**Files:**
- Modify: `SKILL.md`
- Create: `references/variation-workflow.md`
- Modify: `references/image-workflow.md`
- Modify: `references/listing-workflow.md`
- Modify: `references/delivery-and-compliance.md`
- Modify: `tests/skill-structure.test.js`
- Modify: `tests/workflow/required-matrix.test.js`
- Create: `tests/workflow/variation-end-to-end.test.js`

**Interfaces:**
- `SKILL.md` routes Parent/Child, compound-theme, promotion, and Variation delivery tasks to `references/variation-workflow.md`.
- End-to-end behavior uses only public CLI commands and saved project state.

- [ ] **Step 1: Write failing structure and end-to-end tests**

```js
test('Skill routes optional Variation work to one focused reference', async () => {
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  const reference = await readFile(path.join(root, 'references/variation-workflow.md'), 'utf8');
  assert.match(skill, /Parent|Child/);
  assert.match(skill, /references\/variation-workflow\.md/);
  assert.match(skill, /single-product.+does not load|only when.+Variation/is);
  for (const phrase of ['common product identity', 'purchasable SKU', 'category-permitted', 'shared secondary', 'direct dependents']) {
    assert.match(reference, new RegExp(phrase, 'i'));
  }
});
```

Add this end-to-end sequence:

```js
test('promotes one product, adds a compound-theme Child, and prepares scoped outputs', async () => {
  const promoted = await runCli(['promote-variation', '--project-dir', projectDir, '--parent-sku', 'SIGN-P', '--child-sku', 'SIGN-DEER-12', '--theme', themePath]);
  assert.equal(promoted.ok, true);
  const added = await runCli(['add-child', '--project-dir', projectDir, '--input', childPath]);
  assert.equal(added.ok, true);
  const state = JSON.parse(await readFile(path.join(projectDir, 'state.json'), 'utf8'));
  assert.deepEqual(state.variation.theme.dimensions, ['color_name', 'size_name']);
  assert.deepEqual(Object.keys(state.variation.children).sort(), ['SIGN-DEER-12', 'SIGN-HORSE-16']);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/skill-structure.test.js tests/workflow/required-matrix.test.js tests/workflow/variation-end-to-end.test.js`

Expected: FAIL because the Skill does not yet route Variation work and the end-to-end behavior is incomplete.

- [ ] **Step 3: Write concise Variation guidance and finish CLI wiring**

Keep shared rules in `SKILL.md`; put detailed state, Parent/Child copy, image scopes, migration, approval, and delivery procedures in `references/variation-workflow.md`. Explicitly state that rigid-aluminum layouts come from local reviewed seeds derived from task `01a03541-aca1-7572-8ee5-1b6444353559`, while runtime never depends on task access. Document that category differences are not hard rejection criteria and that compound themes require actual category permission.

- [ ] **Step 4: Run the complete test suite**

Run: `npm test`

Expected: all baseline and new tests pass with zero failures.

- [ ] **Step 5: Run official Skill validation and clean-tree checks**

Run the bundled `quick_validate.py` against the worktree Skill root, then run:

```bash
git diff --check
git status --short
```

Expected: `Skill is valid!`, no whitespace errors, and only intended files before the final commit.

- [ ] **Step 6: Commit**

```bash
git add SKILL.md references/variation-workflow.md references/image-workflow.md references/listing-workflow.md references/delivery-and-compliance.md tests/skill-structure.test.js tests/workflow/required-matrix.test.js tests/workflow/variation-end-to-end.test.js scripts/studio.js
git commit -m "docs: route Amazon variation workflow"
```

- [ ] **Step 7: Request final code review and resolve only verified findings**

Use `superpowers:requesting-code-review` against the spec and the complete branch diff. For every valid issue, reproduce it with a failing test before changing production code. Re-run `npm test` and official Skill validation after the review fixes.
