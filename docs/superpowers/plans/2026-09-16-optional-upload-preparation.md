# Optional Upload Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `prepare-upload` command that projects an approved delivery into a preserved Amazon template workbook and reports whether it is `manual-prep` or `upload-ready`.

**Architecture:** Keep hosting outside the repository: the command derives stable object keys and, when URLs are absent, returns one `hosting_required` result for the active harness to satisfy. Pure projection code reads the immutable delivery manifest and compact user input; a small OOXML patcher edits only mapped worksheet cells inside a copied XLSX/XLSM ZIP so macros and unrelated workbook structures survive unchanged.

**Tech Stack:** Node.js 20, built-in `node:fs`/`node:path`, existing `fflate`, existing `node:test`; no new dependency or upload SDK.

**Spec:** `docs/superpowers/specs/2026-09-15-optional-upload-preparation-design.md`

## Global Constraints

- Run only when the user requests upload preparation; do not add a project stage or repeat research, generation, Listing, approval, or delivery.
- Require a current delivery manifest, a user-supplied Amazon template, and one compact JSON input for unresolved offer/account values and optional hosted URL mappings.
- Never invent shipping-template, price, inventory, fulfillment, package, identifier, or product-type values.
- Reuse hosted URLs only for the same delivery version and exact proposed object keys; never download hosted images or add per-image hash verification.
- Preserve the supplied workbook package and edit mapped cells only; unsupported active workbook conditions keep readiness at `manual-prep`.
- Write a new versioned output directory and never overwrite an existing workbook.
- Do not add a Cloudflare client, formula engine, workbook framework, background uploader, new state machine, or Seller Central publisher.

---

### Task 1: Project delivery data and stable image keys

**Files:**
- Create: `scripts/lib/upload-preparation.js`
- Test: `tests/unit/upload-preparation.test.js`

**Interfaces:**
- Consumes: parsed `delivery-manifest.json`, parsed `state.json`, and `{account, offer, image_urls}` from the upload input JSON.
- Produces: `projectUploadPreparation({manifest, state, input}) -> {delivery_version, rows, proposed_images, findings}` and `attachHostedUrls(projection, mappings) -> projection`.

- [ ] **Step 1: Write failing projection tests**

```js
test('projects repeated gallery roles with stable unique keys', () => {
  const result = projectUploadPreparation({manifest: variationManifest(), state: variationState(), input: baseInput()});
  assert.deepEqual(result.proposed_images.map(item => item.object_key), [
    'skp-rwb-8x12-main.png',
    'skp-rwb-8x12-scene-1.png',
    'skp-rwb-8x12-scene-2.png'
  ]);
  assert.deepEqual(result.rows[1].gallery_slots, ['main', 'scene-1', 'scene-2']);
});

test('projects one sellable row for a single-product delivery', () => {
  const result = projectUploadPreparation({manifest: singleManifest(), state: singleState(), input: baseInput()});
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].relationship, undefined);
});

test('accepts URL mappings only for the current delivery version and exact keys', () => {
  const projected = projectUploadPreparation({manifest: singleManifest(), state: singleState(), input: baseInput()});
  assert.throws(() => attachHostedUrls(projected, {
    delivery_version: 'old', images: {'skp-8x12-main.png': 'https://img.example/main.png'}
  }), /delivery version/i);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/unit/upload-preparation.test.js`

Expected: FAIL because `scripts/lib/upload-preparation.js` does not exist.

- [ ] **Step 3: Implement the pure projection module**

```js
export function projectUploadPreparation({manifest, state, input}) {
  const deliveryVersion = manifest.variation_version ?? manifest.listing?.version ?? manifest.schema_version;
  const rows = manifest.delivery_kind === 'variation'
    ? variationRows(manifest, state, input)
    : [singleRow(manifest, state, input)];
  const proposedImages = imageSlots(rows).map(({projectCode, variantCode, size, role, ordinal, source}) => ({
    source,
    slot_id: ordinal > 1 ? `${role}-${ordinal}` : role,
    object_key: objectKey({projectCode, variantCode, size, role, ordinal})
  }));
  return {delivery_version: String(deliveryVersion), rows, proposed_images: proposedImages, findings: []};
}

export function attachHostedUrls(projection, mapping) {
  if (mapping.delivery_version !== projection.delivery_version) throw invalid('URL_MAPPING_STALE', 'Hosted URL mapping uses another delivery version.');
  const expected = new Set(projection.proposed_images.map(item => item.object_key));
  if (Object.keys(mapping.images).some(key => !expected.has(key)) || [...expected].some(key => !mapping.images[key])) {
    throw invalid('URL_MAPPING_MISMATCH', 'Hosted URL mapping must contain the exact proposed object keys.');
  }
  return {...projection, proposed_images: projection.proposed_images.map(item => ({...item, url: mapping.images[item.object_key]}))};
}
```

Reuse the short project/variant naming logic already used by `scripts/lib/variation-bundle.js`; move only the smallest shared name helper if direct reuse is impossible. Treat the gallery order in the delivery scope as authoritative. Add findings rather than guesses for absent offer/account values.

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
- Produces: `inspectUploadTemplate(...) -> {worksheet, columns, active_requirements, unsupported_conditions}` and `writeUploadWorkbook({templateBytes, inspection, rows}) -> Buffer`.

- [ ] **Step 1: Write failing preservation and requiredness tests**

```js
test('patches mapped cells while preserving every unrelated OOXML member', () => {
  const template = uploadTemplate({macro: true, hiddenSheet: true, conditionalFormula: '$FO6="AMAZON_NA"'});
  const before = unzipSync(template);
  const inspection = inspectUploadTemplate(template, signageSeed);
  const output = writeUploadWorkbook({templateBytes: template, inspection, rows: [fbaChild()]});
  const after = unzipSync(output);
  assert.deepEqual(after['xl/vbaProject.bin'], before['xl/vbaProject.bin']);
  assert.deepEqual(after['xl/workbook.xml'], before['xl/workbook.xml']);
  assert.match(strFromU8(after[inspection.worksheet.path]), /AMAZON_NA/);
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
    active_requirements: conditions.supported,
    unsupported_conditions: conditions.unsupported
  };
}

export function writeUploadWorkbook({templateBytes, inspection, rows}) {
  const archive = unzipSync(templateBytes);
  archive[inspection.worksheet.path] = strToU8(patchMappedCells(
    strFromU8(archive[inspection.worksheet.path]), inspection.columns, rows
  ));
  return Buffer.from(zipSync(archive, {level: 6}));
}
```

Support only the comparison/`IF` patterns actually found in the supplied Amazon template. Any other relevant expression must retain the workbook but enter `unsupported_conditions`; do not build a general formula evaluator. Patch worksheet cell XML only, leaving all other ZIP members byte-identical. Use inline strings for inserted text so the shared-string table need not be rebuilt.

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
- Consumes: `prepare-upload --project-dir <dir> --delivery-dir <dir> --template <file> --input <json> --output <name>`.
- Produces: either `{status:'hosting_required', delivery_version, proposed_images, unresolved}` without writing a workbook, or `{status:'manual-prep'|'upload-ready', workbook_path, manifest_path, findings}` in a new output directory.

- [ ] **Step 1: Write failing CLI workflow tests**

```js
test('returns one hosting request before writing a URL-required workbook', async () => {
  const result = await runCli(prepareArgs({input: inputWithoutUrls()}));
  assert.equal(result.ok, true);
  assert.equal(result.result.status, 'hosting_required');
  assert.equal(await exists(outputDir), false);
});

test('writes a versioned workbook and compact manifest after exact URLs arrive', async () => {
  const result = await runCli(prepareArgs({input: inputWithExactUrls()}));
  assert.equal(result.ok, true);
  assert.equal(result.result.status, 'upload-ready');
  await access(result.result.workbook_path);
  const saved = JSON.parse(await readFile(result.result.manifest_path, 'utf8'));
  assert.deepEqual(Object.keys(saved.image_urls), proposedKeys);
  assert.deepEqual(Object.keys(saved).sort(), ['delivery_version', 'findings', 'image_urls', 'marketplace', 'seller_account', 'status', 'template']);
});

test('keeps unsupported conditions manual and never overwrites output', async () => {
  const first = await runCli(prepareArgs({template: unsupportedTemplate(), input: inputWithExactUrls()}));
  assert.equal(first.result.status, 'manual-prep');
  const second = await runCli(prepareArgs({template: unsupportedTemplate(), input: inputWithExactUrls()}));
  assert.equal(second.ok, false);
  assert.equal(second.code, 'OUTPUT_EXISTS');
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/workflow/upload-preparation.test.js`

Expected: FAIL with `UNKNOWN_COMMAND` for `prepare-upload`.

- [ ] **Step 3: Add one orchestration function and CLI branch**

```js
export async function prepareUpload({projectDir, deliveryDir, templatePath, inputPath, outputDir}) {
  const [state, manifest, input, seed, templateBytes] = await Promise.all([
    readJson(path.join(projectDir, 'state.json')),
    readJson(path.join(deliveryDir, 'delivery-manifest.json')),
    readJson(inputPath),
    readJson(signageSeedPath),
    readFile(templatePath)
  ]);
  const projection = projectUploadPreparation({manifest, state, input});
  if (!input.image_urls) return {status: 'hosting_required', delivery_version: projection.delivery_version, proposed_images: projection.proposed_images, unresolved: projection.findings};
  const hosted = attachHostedUrls(projection, input.image_urls);
  const inspection = inspectUploadTemplate(templateBytes, seed);
  return writeUploadOutput({outputDir, templatePath, templateBytes, inspection, projection: hosted, input});
}
```

Add `prepare-upload` to `operationFor` as a fast, optional delivery operation. Resolve the output with the existing `projectOutputPath` containment guard. Copy the template extension (`.xlsx` or `.xlsm`), stage writes, reopen the saved ZIP, reject formula-error cells, and rename the stage only after verification. Shipping-template precedence is: matching workbook value, matching saved marketplace/account input, otherwise one `user_confirmation_required` finding; disagreement between the first two is also one finding.

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
assert.match(delivery, /same delivery version.+exact object keys/is);
assert.match(delivery, /do not.+download.+hash/is);
assert.match(listingWorkflow, /shipping template.+marketplace.+seller account/is);
assert.match(listingWorkflow, /unsupported.+manual-prep/is);
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run: `node --test tests/skill-structure.test.js`

Expected: FAIL on the new upload-preparation assertions.

- [ ] **Step 3: Add concise workflow instructions**

Add one optional paragraph to `SKILL.md`: after approved delivery, invoke `prepare-upload` only when requested. If it returns `hosting_required`, ask once for Cloudflare R2, another host, or stop, together with only the unresolved account/offer values. Use the harness to check every proposed key for collision, upload only after confirmation, and rerun with the exact URL mapping. Present the readiness label and findings; never claim Seller Central publication.

In the two existing references, describe only field/source rules that the agent must apply. Link to the command rather than duplicating workbook internals or adding another checklist.

- [ ] **Step 4: Run contract and full tests**

Run: `npm test`

Expected: all tests PASS with zero failures.

Run: `npm audit --omit=dev`

Expected: 0 known production dependency vulnerabilities.

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

First pass: invoke `prepare-upload` without URL mappings and confirm `hosting_required` with no workbook output. Second pass: use fake HTTPS URLs for the exact proposed keys and confirm a new workbook plus upload-preparation manifest is written and reopens. Delete only the disposable smoke-test directory after confirming its resolved path is inside the test workspace.

- [ ] **Step 5: Confirm installation did not alter repository state**

Run: `git status --short`

Expected: installation adds no new repository changes; do not create an empty installation commit.
