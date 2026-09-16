# Optional Upload Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `prepare-upload` command that projects an approved delivery into a preserved Amazon template workbook and reports whether it is `manual-prep` or `upload-ready`.

**Architecture:** Keep hosting outside the repository: the command derives stable object keys and, when URLs are absent, returns one `hosting_required` result for the active harness to satisfy. Projection code first runs the existing trusted delivery verifier, then reads Listing, Variation Matrix, and image members from the hash-checked `delivery.zip`; current `state.json` authenticates the approval but never supplies delivered product content. A small OOXML patcher edits only mapped worksheet cells inside a copied XLSX/XLSM ZIP so macros and unrelated workbook structures survive unchanged.

**Tech Stack:** Node.js 20, built-in `node:fs`/`node:path`, existing `fflate`, existing `node:test`; no new dependency or upload SDK.

**Spec:** `docs/superpowers/specs/2026-09-15-optional-upload-preparation-design.md`

## Global Constraints

- Run only when the user requests upload preparation; do not add a project stage or repeat research, generation, Listing, approval, or delivery.
- Require a current delivery manifest, a user-supplied Amazon template, and one compact JSON input for unresolved offer/account values and optional hosted URL mappings.
- Derive upload rows only from a delivery verified against the current immutable final approval; never merge delivered content with current mutable project facts.
- Never invent shipping-template, price, inventory, fulfillment, package, identifier, or product-type values.
- For every restricted field, write only an exact value resolved from the current template's applicable validation source; do not normalize a near match into acceptance.
- Keep Variation and package-content relationships separate; never self-reference a Child through `package_contains_sku`.
- Reuse hosted URLs only for the same delivery identity and exact proposed object keys; never download hosted images or add per-image hash verification.
- Preserve the supplied workbook package and edit mapped cells only; unsupported active workbook conditions keep readiness at `manual-prep`.
- Write a new versioned output directory and never overwrite an existing workbook.
- Do not add a Cloudflare client, formula engine, workbook framework, background uploader, new state machine, or Seller Central publisher.

---

### Task 1: Read verified delivery data and derive stable image keys

**Files:**
- Create: `scripts/lib/upload-preparation.js`
- Test: `tests/unit/upload-preparation.test.js`

**Interfaces:**
- Consumes: `deliveryDir`, current immutable `expectedScope`, existing `verifyDelivery`/`verifyVariationDelivery`, and `{account, offer, image_urls}` from the upload input JSON.
- Produces: `readVerifiedDelivery({deliveryDir, expectedScope, verifySingle, verifyVariation}) -> {delivery_identity, manifest, listings, matrix, image_slots}`; `projectUploadPreparation({delivery, input}) -> {delivery_identity, rows, proposed_images, findings}`; `validateRelationshipNamespaces(rows) -> findings`; and `attachHostedUrls(projection, mappings) -> projection`.

- [ ] **Step 1: Write failing projection tests**

```js
test('reads hash-checked delivered listings rather than newer mutable state', async () => {
  const delivery = await readVerifiedDelivery({
    deliveryDir, expectedScope: finalApproval, verifySingle, verifyVariation
  });
  assert.equal(delivery.listings.children['RWB-8X12'].title, 'Delivered title');
  assert.equal(delivery.delivery_identity, 'variation:final-v2:2');
});

test('projects repeated gallery roles with stable unique keys', () => {
  const result = projectUploadPreparation({delivery: verifiedVariationDelivery(), input: baseInput()});
  assert.deepEqual(result.proposed_images.map(item => item.object_key), [
    'skp-rwb-8x12-main.png',
    'skp-rwb-8x12-scene-1.png',
    'skp-rwb-8x12-scene-2.png'
  ]);
  assert.deepEqual(result.rows[1].gallery_slots, ['main', 'scene-1', 'scene-2']);
});

test('projects one sellable row for a single-product delivery', () => {
  const result = projectUploadPreparation({delivery: verifiedSingleDelivery({listing_version: 3}), input: baseInput()});
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].relationship, undefined);
  assert.equal(result.delivery_identity, 'single:final-3:3');
});

test('rejects stale, missing, and extra URL mappings and accepts the exact current set', () => {
  const projected = projectUploadPreparation({delivery: verifiedSingleDelivery({listing_version: 3}), input: baseInput()});
  assert.throws(() => attachHostedUrls(projected, {
    delivery_identity: 'single:final-2:2', images: exactUrls()
  }), /delivery identity/i);
  assert.throws(() => attachHostedUrls(projected, {delivery_identity: projected.delivery_identity, images: {}}), /exact proposed object keys/i);
  assert.throws(() => attachHostedUrls(projected, {delivery_identity: projected.delivery_identity, images: {...exactUrls(), 'extra.png': 'https://img.example/extra.png'}}), /exact proposed object keys/i);
  assert.equal(attachHostedUrls(projected, {delivery_identity: projected.delivery_identity, images: exactUrls()}).proposed_images[0].url, 'https://img.example/main.png');
});

test('rejects package fields on a Variation row but permits a distinct bundle row', () => {
  assert.equal(validateRelationshipNamespaces([{
    seller_sku: 'CHILD-8X12', parentage_level: 'Child', package_contains_sku: 'CHILD-8X12'
  }])[0].code, 'RELATIONSHIP_CONFLICT');
  assert.deepEqual(validateRelationshipNamespaces([{
    seller_sku: 'BUNDLE-1', package_contains_sku: 'CHILD-8X12'
  }]), []);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/unit/upload-preparation.test.js`

Expected: FAIL because `scripts/lib/upload-preparation.js` does not exist.

- [ ] **Step 3: Implement the pure projection module**

```js
export async function readVerifiedDelivery({deliveryDir, expectedScope, verifySingle, verifyVariation}) {
  const manifest = JSON.parse(await readFile(path.join(deliveryDir, 'delivery-manifest.json'), 'utf8'));
  const verified = manifest.delivery_kind === 'variation'
    ? await verifyVariation({deliveryDir, expectedScope})
    : await verifySingle({deliveryDir, expectedScope});
  const archive = unzipSync(await readFile(path.join(deliveryDir, 'delivery.zip')));
  return parseVerifiedMembers({manifest: verified.manifest, matrix: verified.matrix, archive});
}

export function projectUploadPreparation({delivery, input}) {
  const rows = delivery.manifest.delivery_kind === 'variation'
    ? variationRows(delivery, input)
    : [singleRow(delivery, input)];
  const proposedImages = imageSlots(rows).map(({projectCode, variantCode, size, role, ordinal, source}) => ({
    source,
    slot_id: ordinal > 1 ? `${role}-${ordinal}` : role,
    object_key: objectKey({projectCode, variantCode, size, role, ordinal})
  }));
  return {delivery_identity: delivery.delivery_identity, rows, proposed_images: proposedImages, findings: []};
}

export function attachHostedUrls(projection, mapping) {
  if (mapping.delivery_identity !== projection.delivery_identity) throw invalid('URL_MAPPING_STALE', 'Hosted URL mapping uses another delivery identity.');
  const expected = new Set(projection.proposed_images.map(item => item.object_key));
  if (Object.keys(mapping.images).some(key => !expected.has(key)) || [...expected].some(key => !mapping.images[key])) {
    throw invalid('URL_MAPPING_MISMATCH', 'Hosted URL mapping must contain the exact proposed object keys.');
  }
  return {...projection, proposed_images: projection.proposed_images.map(item => ({...item, url: mapping.images[item.object_key]}))};
}

export function validateRelationshipNamespaces(rows) {
  return rows.flatMap(row => row.parentage_level && row.package_contains_sku
    ? [finding('RELATIONSHIP_CONFLICT', row.seller_sku, 'Variation row also contains package relationship fields')]
    : row.seller_sku === row.package_contains_sku
      ? [finding('RELATIONSHIP_CONFLICT', row.seller_sku, 'Row contains its own SKU')]
      : []);
}
```

`parseVerifiedMembers` must parse `listing/listing.json` for a single delivery, or `parent/listing.json`, `variation-matrix.json`, and every `children/<sku>/listing.json` for a Variation delivery. Build immutable identity as `single:<approval_id>:<listing_version>` or `variation:<approval_id>:<variation_version>`. Reuse the short project/variant naming logic already used by `scripts/lib/variation-bundle.js`; move only the smallest shared name helper if direct reuse is impossible. Treat each Matrix row's ordered `asset_paths` and its verified approval mapping as the gallery source. Reject duplicate generated keys and non-HTTPS mapped URLs. Add findings rather than guesses for absent offer/account values.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test tests/unit/upload-preparation.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the projection**

```powershell
git add scripts/lib/upload-preparation.js tests/unit/upload-preparation.test.js
git commit -m "feat: project upload preparation data"
```

---

### Task 2: Inspect and patch the supplied OOXML template

**Files:**
- Create: `scripts/lib/upload-workbooks.js`
- Create: `tests/helpers/upload-template.js`
- Test: `tests/unit/upload-workbooks.test.js`

**Interfaces:**
- Consumes: `inspectUploadTemplate(templateBytes, seed)`, where `seed.upload_field_map` is the existing SIGNAGE field seed.
- Produces: `inspectUploadTemplate(...) -> {worksheet, columns, validations, active_requirements, unsupported_conditions, unsupported_validations}`; `validateRestrictedValues({inspection, rows}) -> findings`; and `writeUploadWorkbook({templateBytes, inspection, rows}) -> Buffer`.

- [ ] **Step 1: Write failing preservation and requiredness tests**

```js
test('patches mapped cells while preserving every unrelated OOXML member', () => {
  const template = uploadTemplate({
    macro: true, hiddenSheet: true, namedRange: true, validation: true,
    conditionalFormula: '$FO6="AMAZON_NA"', preservedFormula: true
  });
  const before = unzipSync(template);
  const inspection = inspectUploadTemplate(template, signageSeed);
  const output = writeUploadWorkbook({templateBytes: template, inspection, rows: [fbaChild()]});
  const after = unzipSync(output);
  for (const member of Object.keys(before)) {
    if (member !== inspection.worksheet.path) assert.deepEqual(after[member], before[member], member);
  }
  const sheet = strFromU8(after[inspection.worksheet.path]);
  assert.match(sheet, /dataValidations/);
  assert.match(sheet, /conditionalFormatting/);
  assert.match(sheet, /<f>/);
  assert.match(sheet, /s="[0-9]+"/);
});

test('activates package fields for supported FBA condition but not FBM', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({conditionalFormula: '$FO6="AMAZON_NA"'}), signageSeed);
  assert.deepEqual(requiredForRow(inspection, fbaChild()).sort(), ['GZ', 'HA', 'HB', 'HC', 'HD', 'HE', 'HF', 'HG']);
  assert.deepEqual(requiredForRow(inspection, fbmChild()), []);
});

test('reports an unsupported active expression instead of claiming upload ready', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({conditionalFormula: 'INDIRECT("FO"&ROW())="AMAZON_NA"'}), signageSeed);
  assert.deepEqual(inspection.unsupported_conditions.map(item => item.cells), ['GZ6:HG6']);
});

test('does not trust cached formula values affected by patched cells', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({conditionalFormula: '$FO6="AMAZON_NA"', cachedValue: 0}), signageSeed);
  assert.deepEqual(requiredForRow(inspection, fbaChild()).sort(), ['GZ', 'HA', 'HB', 'HC', 'HD', 'HE', 'HF', 'HG']);
});

test('requires exact current dropdown values for record action, theme, and shipping template', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({
    recordActions: ['Create or Replace (Full Update)', 'Edit (Partial Update)', 'Delete'],
    themes: ['COLOR/SIZE'], shippingTemplates: ['Migrated Template']
  }), signageSeed);
  assert.deepEqual(validateRestrictedValues({inspection, rows: [{
    record_action: '(Default) Create or Replace', variation_theme: 'Size/Color', shipping_template: 'Default'
  }]}).map(item => item.field), ['record_action', 'variation_theme', 'shipping_template']);
  assert.deepEqual(validateRestrictedValues({inspection, rows: [{
    record_action: 'Create or Replace (Full Update)', variation_theme: 'COLOR/SIZE', shipping_template: 'Migrated Template'
  }]}), []);
});

test('resolves a defined name to hidden-sheet cells and defers dynamic validation sources', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({
    definedName: {name: 'record_action', target: "'Dropdown Lists'!$C$4:$C$6"},
    hiddenValues: ['Create or Replace (Full Update)', 'Edit (Partial Update)', 'Delete'],
    dynamicValidation: 'INDIRECT($B7&"variation_theme1.name")'
  }), signageSeed);
  assert.deepEqual(inspection.validations.record_action.values, ['Create or Replace (Full Update)', 'Edit (Partial Update)', 'Delete']);
  assert.equal(inspection.unsupported_validations[0].formula, 'INDIRECT($B7&"variation_theme1.name")');
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/unit/upload-workbooks.test.js`

Expected: FAIL because the helper and workbook module do not exist.

- [ ] **Step 3: Implement the minimum OOXML reader/writer**

```js
export function inspectUploadTemplate(templateBytes, seed) {
  const archive = unzipSync(templateBytes);
  const worksheet = locateTemplateWorksheet(archive);
  const columns = mapHeaders(archive, worksheet, seed.upload_field_map);
  const conditions = readRelevantConditions(archive, worksheet, columns);
  return {
    worksheet,
    columns,
    ...resolveValidationSources(archive, worksheet, columns),
    active_requirements: conditions.supported,
    unsupported_conditions: conditions.unsupported
  };
}

export function validateRestrictedValues({inspection, rows}) {
  return restrictedValueFindings(inspection.validations, rows, {exact: true});
}

export function writeUploadWorkbook({templateBytes, inspection, rows}) {
  const archive = unzipSync(templateBytes);
  archive[inspection.worksheet.path] = strToU8(patchMappedCells(
    strFromU8(archive[inspection.worksheet.path]), inspection.columns, rows
  ));
  return Buffer.from(zipSync(archive, {level: 6}));
}
```

Resolve only three bounded validation-source forms: an inline list, a direct worksheet range, or a defined name whose target is a direct worksheet range. Resolve the current Product Type's source only when it reduces to one of those forms. Put `OFFSET`, `INDIRECT`, dynamic formulas, and external references into `unsupported_validations`, which keeps readiness at `manual-prep`; do not evaluate them. Compare resolved strings exactly and do not accept case-folded, reordered, translated, or display-label approximations. Support only the comparison/`IF` patterns actually found in the supplied Amazon template. Evaluate supported expressions against the values that will be written, never cached formula results. Any other relevant expression must retain the workbook but enter `unsupported_conditions`; do not build a general formula evaluator. Patch only mapped cell value/type nodes in the target worksheet XML, preserving formulas, styles, validations, and conditional-formatting nodes; leave every other ZIP member byte-identical, including content types, relationships, workbook metadata, named ranges, hidden sheets, and VBA. Use inline strings for inserted text so the shared-string table need not be rebuilt.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test tests/unit/upload-workbooks.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the workbook layer**

```powershell
git add scripts/lib/upload-workbooks.js tests/helpers/upload-template.js tests/unit/upload-workbooks.test.js
git commit -m "feat: preserve Amazon upload templates"
```

---

### Task 3: Add the optional `prepare-upload` command

**Files:**
- Modify: `scripts/studio.js`
- Test: `tests/workflow/upload-preparation.test.js`

**Interfaces:**
- Consumes: `prepare-upload --project-dir <dir> --delivery-dir <dir> --template <file> --input <json> --output <name> --rules-library <dir>`.
- Produces: either `{status:'hosting_required', delivery_identity, proposed_images, unresolved}` after delivery, template, rule, and row inspection but without writing a workbook, or `{status:'manual-prep'|'upload-ready', workbook_path, manifest_path, findings}` in a new output directory.

- [ ] **Step 1: Write failing CLI workflow tests**

```js
test('returns one hosting request before writing a URL-required workbook', async () => {
  const result = await runCli(prepareArgs({input: inputWithoutUrls()}));
  assert.equal(result.ok, true);
  assert.equal(result.result.status, 'hosting_required');
  assert.deepEqual(result.result.unresolved.map(item => item.field), ['shipping_template', 'package_length']);
  assert.equal(await exists(outputDir), false);
});

test('writes a versioned workbook and compact manifest after exact URLs arrive', async () => {
  const result = await runCli(prepareArgs({input: inputWithExactUrls()}));
  assert.equal(result.ok, true);
  assert.equal(result.result.status, 'upload-ready');
  await access(result.result.workbook_path);
  const saved = JSON.parse(await readFile(result.result.manifest_path, 'utf8'));
  assert.deepEqual(Object.keys(saved.image_urls), proposedKeys);
  assert.deepEqual(Object.keys(saved).sort(), ['delivery_identity', 'findings', 'image_urls', 'marketplace', 'seller_account', 'status', 'template']);
});

test('keeps unsupported conditions manual and never overwrites output', async () => {
  const first = await runCli(prepareArgs({template: unsupportedTemplate(), input: inputWithExactUrls()}));
  assert.equal(first.result.status, 'manual-prep');
  const second = await runCli(prepareArgs({template: unsupportedTemplate(), input: inputWithExactUrls()}));
  assert.equal(second.ok, false);
  assert.equal(second.code, 'OUTPUT_EXISTS');
});

test('keeps stale rules and unsupported affected formulas manual', async () => {
  const result = await runCli(prepareArgs({rulesLibrary: staleRules(), template: unsupportedTemplate(), input: inputWithExactUrls()}));
  assert.equal(result.ok, true);
  assert.equal(result.result.status, 'manual-prep');
  assert.deepEqual(result.result.findings.map(item => item.code).sort(), ['RULES_STALE', 'UNSUPPORTED_TEMPLATE_CONDITION']);
});

test('omits non-canonical restricted values and writes exact allowed values', async () => {
  const bad = await runCli(prepareArgs({output: 'upload-bad', input: inputWithExactUrls({
    record_action: '(Default) Create or Replace', variation_theme: 'Size/Color', shipping_template: 'Default'
  })}));
  assert.equal(bad.result.status, 'manual-prep');
  assert.deepEqual(await readPatchedCells(bad.result.workbook_path, ['C7', 'F7', 'GS8']), [null, null, null]);

  const good = await runCli(prepareArgs({output: 'upload-good', input: inputWithExactUrls({
    record_action: 'Create or Replace (Full Update)', variation_theme: 'COLOR/SIZE', shipping_template: 'Migrated Template'
  })}));
  assert.equal(good.result.status, 'upload-ready');
  assert.deepEqual(await readPatchedCells(good.result.workbook_path, ['C7', 'F7', 'GS8']), [
    'Create or Replace (Full Update)', 'COLOR/SIZE', 'Migrated Template'
  ]);
});

test('uses explicit compatible template type without mutating project identity', async () => {
  const input = {...inputWithExactUrls(), compatible_product_types: ['SIGNAGE']};
  const result = await runCli(prepareArgs({projectType: 'METAL_SIGN', templateType: 'SIGNAGE', input}));
  assert.equal(result.ok, true);
  assert.equal(result.result.status, 'upload-ready');
  assert.equal((await readState()).project.product_type, 'METAL_SIGN');
});

test('derives field applicability from the current Product Type', async () => {
  const rejected = await runCli(prepareArgs({output: 'upload-rejected', template: templateWithoutNumberOfPieces(), input: inputWithExactUrls({number_of_pieces: 1})}));
  assert.equal(rejected.result.rows[1].number_of_pieces, undefined);
  const accepted = await runCli(prepareArgs({output: 'upload-accepted', template: templateWithNumberOfPieces(), input: inputWithExactUrls({number_of_pieces: 1})}));
  assert.equal(accepted.result.rows[1].number_of_pieces, 1);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/workflow/upload-preparation.test.js`

Expected: FAIL with `UNKNOWN_COMMAND` for `prepare-upload`.

- [ ] **Step 3: Add one orchestration function and CLI branch**

```js
export async function prepareUpload({projectDir, deliveryDir, templatePath, inputPath, outputDir}) {
  const [state, input, seed, templateBytes] = await Promise.all([
    readJson(path.join(projectDir, 'state.json')),
    readJson(inputPath),
    readJson(signageSeedPath),
    readFile(templatePath)
  ]);
  const expectedScope = currentFinalApproval(state);
  const delivery = await readVerifiedDelivery({deliveryDir, expectedScope, verifySingle, verifyVariation});
  const inspection = inspectUploadTemplate(templateBytes, seed);
  const rules = await resolveRules({
    libraryDir: rulesLibrary, marketplace: delivery.manifest.marketplace ?? delivery.manifest.approval_scope.marketplace,
    productType: delivery.manifest.product_type ?? delivery.manifest.approval_scope.product_type,
    compatibleProductTypes: input.compatible_product_types ?? [], purpose: 'upload_ready', now
  });
  const baseProjection = projectUploadPreparation({delivery, input});
  const projection = applyTemplateAndRuleFindings(baseProjection, {
    inspection, rules, input,
    restrictedFindings: validateRestrictedValues({inspection, rows: baseProjection.rows}),
    relationshipFindings: validateRelationshipNamespaces(baseProjection.rows)
  });
  if (!input.image_urls) return {status: 'hosting_required', delivery_identity: projection.delivery_identity, proposed_images: projection.proposed_images, unresolved: projection.findings};
  const hosted = attachHostedUrls(projection, input.image_urls);
  return writeUploadOutput({outputDir, templatePath, templateBytes, inspection, projection: hosted, input});
}
```

Inject the existing `verifyDelivery`, `verifyVariationDelivery`, and `resolveRules` functions into `prepareUpload` through `runCli` so tests use the same seams as the existing finalize/verify commands. Add `prepare-upload` to `operationFor` as a fast, optional delivery operation. Resolve the output with the existing `projectOutputPath` containment guard. Copy the template extension (`.xlsx` or `.xlsm`), stage writes, reopen the saved ZIP to verify package readability and preserved members, and rename the stage only after verification. Do not use cached formula values as a readiness check: every relevant formula affected by written values must be evaluated by Task 2's supported-expression logic or add an `UNSUPPORTED_TEMPLATE_CONDITION` finding. Any non-exact restricted value is omitted, adds one `user_confirmation_required` finding, and prevents the write from being labeled `upload-ready`. A missing, stale, refresh-required, or product-type-inapplicable rule result adds a manual-prep finding. Shipping-template precedence is: matching workbook value, matching saved marketplace/account input, otherwise one `user_confirmation_required` finding; disagreement between the first two is also one finding. Derive field applicability from the current Product Type/template mapping: omit rejected fields but retain accepted fields with confirmed values. Before workbook output, add `RELATIONSHIP_CONFLICT` only when one projected Variation row also populates package-relationship fields or self-references its seller SKU; do not reject a distinct confirmed bundle row merely because it contains a SKU sold elsewhere as a Variation Child.

- [ ] **Step 4: Run focused and adjacent workflow tests**

Run: `node --test tests/workflow/upload-preparation.test.js tests/workflow/variation-delivery.test.js tests/workflow/studio-cli.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the command**

```powershell
git add scripts/studio.js tests/workflow/upload-preparation.test.js
git commit -m "feat: prepare Amazon upload workbooks"
```

---

### Task 4: Teach the Skill the single-question handoff

**Files:**
- Modify: `SKILL.md`
- Modify: `references/delivery-and-compliance.md`
- Modify: `references/listing-workflow.md`
- Test: `tests/skill-structure.test.js`

**Interfaces:**
- Consumes: user request for an upload workbook after delivery.
- Produces: one consolidated question for hosting plus unresolved account/offer inputs, then one `prepare-upload` invocation; no automatic publishing.

- [ ] **Step 1: Add failing contract assertions**

```js
assert.match(skill, /prepare-upload/);
assert.match(delivery, /hosting_required.+one consolidated question/is);
assert.match(delivery, /same delivery identity.+exact object keys/is);
assert.match(delivery, /do not.+download.+hash/is);
assert.match(listingWorkflow, /shipping template.+marketplace.+seller account/is);
assert.match(listingWorkflow, /unsupported.+manual-prep/is);
assert.match(delivery, /verified delivery\.zip.+current final approval/is);
assert.match(listingWorkflow, /exact.+validation.+record action.+Variation Theme.+shipping template/is);
assert.match(listingWorkflow, /package_contains_sku.+Variation Child/is);
assert.match(listingWorkflow, /root cause.+consequential|cascade/is);
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run: `node --test tests/skill-structure.test.js`

Expected: FAIL on the new upload-preparation assertions.

- [ ] **Step 3: Add concise workflow instructions**

Add one optional paragraph to `SKILL.md`: after approved delivery, invoke `prepare-upload` only when requested. If it returns `hosting_required`, ask once for Cloudflare R2, another host, or stop, together with only the unresolved account/offer values. Use the harness to check every proposed key for collision, upload only after confirmation, and rerun with the exact URL mapping. Present the readiness label and findings; never claim Seller Central publication.

In the two existing references, describe only field/source rules that the agent must apply. State that restricted fields use exact values from the current template's validation source, Variation fields never populate `package_contains_sku`, and inapplicable Product Type fields remain blank. When the user supplies an Amazon processing summary, report the earliest restricted-value or relationship failure as the root cause and group resulting offer/catalog messages beneath it. Link to the command rather than duplicating workbook internals or adding another checklist.

- [ ] **Step 4: Run contract and full tests**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 5: Commit the Skill guidance**

```powershell
git add SKILL.md references/delivery-and-compliance.md references/listing-workflow.md tests/skill-structure.test.js
git commit -m "docs: add optional upload preparation workflow"
```

---

### Task 5: Install and smoke-test the completed Skill

**Files:**
- Modify: local installed copy at `D:\Codex\CodexHome\skills\amazon-listing-studio` using the repository's existing installation/sync procedure.

**Interfaces:**
- Consumes: repository HEAD after Tasks 1–4.
- Produces: matching installed Skill and one disposable smoke-test upload output.

- [ ] **Step 1: Run repository validation before installation**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 2: Sync through the existing installer path**

Use the repository's current documented sync command; do not manually maintain a second implementation or copy `node_modules` by hand.

- [ ] **Step 3: Verify repository and installed tracked files match**

Run the existing installed-copy comparison used by prior releases.

Expected: zero missing or mismatched tracked Skill files.

- [ ] **Step 4: Run one disposable two-pass smoke test**

First pass: invoke `prepare-upload` without URL mappings and confirm it verifies the delivery, inspects the template and rules, then returns `hosting_required` with all unresolved fields and no workbook output. Second pass: use fake HTTPS URLs for the exact proposed keys and confirm a new workbook plus upload-preparation manifest is written and reopens. Delete only the disposable smoke-test directory after confirming its resolved path is inside the test workspace.

- [ ] **Step 5: Confirm installation did not alter repository state**

Run: `git status --short`

Expected: installation adds no new repository changes; do not create an empty installation commit.
