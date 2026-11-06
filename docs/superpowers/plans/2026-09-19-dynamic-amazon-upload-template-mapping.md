# Dynamic Amazon Upload Template Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select the real Amazon upload worksheet and locate product-type and image fields from the workbook's technical headers instead of assuming the first sheet or fixed columns.

**Architecture:** Extend the existing OOXML reader in `upload-workbooks.js`; do not add a spreadsheet dependency or a second parser. Resolve the unique upload sheet by technical field headers in row 5, then derive `item_type_keyword` and all available main/other image columns from those headers. Real and synthetic templates must expose these headers; never fall back to the first sheet or fixed seed columns. Keep `image_role_order` optional and project-scoped.

**Tech Stack:** Node.js, `fflate`, OOXML, `node:test`

**Spec:** `D:/Amazon/projects/speed-limit-sign/skill-error-report-upload-template-field-and-image-mapping.md`

## Global Constraints

- Do not assume the upload worksheet is first or named `模板`.
- Do not encode `M`, `T:AB`, nine image slots, or the current seven-role sequence as universal Amazon rules.
- When multiple or no upload worksheets match, stop with a specific error instead of guessing.
- When supplied image URLs exceed the discovered template slots, stop with a capacity error instead of omitting URLs.
- Preserve macros and every unrelated OOXML member.
- Do not add an approval or confirmation step.
- Reuse existing Variation/Delivery uniqueness validation.

---

### Task 1: Resolve the upload sheet and dynamic field columns

**Files:**
- Modify: `tests/helpers/upload-template.js`
- Modify: `tests/unit/upload-workbooks.test.js`
- Modify: `scripts/lib/upload-workbooks.js`
- Modify: `assets/rule-seeds/amazon-us-signage-upload-fields.json`

**Interfaces:**
- Consumes: workbook bytes and the existing SIGNAGE rule seed
- Produces: `inspectUploadTemplate(templateBytes, seed)` with the uniquely detected worksheet and header-derived `field_columns`

- [x] **Step 1: Write failing worksheet-selection and moved-column tests**

Add a synthetic instruction sheet before the upload sheet. Put technical headers in row 5 with `item_type_keyword[...]` in `N5`, the main image field in `V5`, and two other-image fields in `X5:Z5` with a gap. Assert that inspection selects the upload sheet and returns:

```js
assert.equal(inspection.worksheet.name, 'Upload Data');
assert.deepEqual(inspection.field_columns.item_type_keyword, ['N']);
assert.deepEqual(inspection.field_columns.main_and_other_image_urls, ['V', 'X', 'Z']);
```

Add one ambiguity test with two matching upload sheets and assert a clear failure rather than first-sheet selection. Update the shared synthetic template helper so its upload sheet always exposes real row-5 technical headers.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/unit/upload-workbooks.test.js
```

Expected: selection still returns the first sheet or fixed seed columns, and the ambiguity case does not fail correctly.

- [x] **Step 3: Add the minimum header resolver**

In `upload-workbooks.js`, parse row 5 cells with existing shared-string decoding. A candidate must contain `item_type_keyword[...]` and at least one `main_product_image_locator[...]` or `other_product_image_locator_N[...]` field. Require exactly one candidate.

Overlay only these header-derived mappings:

```js
item_type_keyword[...].value                 -> item_type_keyword
main_product_image_locator[...].media_location -> first image slot
other_product_image_locator_N[...].media_location -> remaining slots sorted by N
```

Do not use seed columns as a runtime fallback. Remove tests that assert fixed `M` or `T:AB` seed columns; test semantic discovery instead.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/unit/upload-workbooks.test.js tests/skill-structure.test.js
```

Expected: PASS.

---

### Task 2: Verify dynamic output and preserve optional gallery ordering

**Files:**
- Modify: `tests/workflow/upload-preparation.test.js`
- Modify: `scripts/lib/upload-workbooks.js`
- Modify: `references/delivery-and-compliance.md`
- Modify: `D:/Amazon/projects/speed-limit-sign/skill-error-report-upload-template-field-and-image-mapping.md`

**Interfaces:**
- Consumes: header-derived `inspection.field_columns`, optional `input.image_role_order`, and upload rows
- Produces: a workbook whose detected keyword/image cells match the projected rows, or a precise cell-level verification error

- [x] **Step 1: Write a failing end-to-end moved-column test**

Run `prepare-upload` against a template whose upload sheet is not first and whose keyword/image fields moved. Provide `item_type_keyword`, hosted URLs, and an optional role order. Assert the returned workbook writes the keyword and URLs into the discovered columns and preserves all non-upload sheets. Add a second case with more URLs than discovered image columns and assert `IMAGE_SLOT_CAPACITY_EXCEEDED` before any workbook is published.

- [x] **Step 2: Run the workflow test and verify RED**

Run:

```powershell
node --test tests/workflow/upload-preparation.test.js
```

Expected: FAIL until output verification uses the detected upload worksheet and dynamic columns.

- [x] **Step 3: Reuse dynamic columns in post-write verification**

Keep `verifyWrittenUploadFields()` narrow: compare only supplied `item_type_keyword` and image URL values using `inspection.worksheet.path` and `inspection.field_columns`. Before writing, reject an image array longer than the discovered image columns with `IMAGE_SLOT_CAPACITY_EXCEEDED`. Do not add a second workbook audit or fixed slot count. Keep `image_role_order` optional; without it, retain approved Gallery order.

- [x] **Step 4: Update concise guidance and resolution record**

Document that the template technical header controls field location and image capacity. Update the report resolution to replace fixed-column wording with dynamic worksheet/header discovery.

- [x] **Step 5: Run full verification**

Run:

```powershell
npm test
git diff --check
```

Expected: all tests pass and no whitespace errors.

- [x] **Step 6: Sync and verify the installed Skill**

Copy only changed Skill files to `D:/Codex/CodexHome/skills/amazon-listing-studio`, compare their SHA-256 values with source, then run `npm test` in the installed directory. Do not commit or push unless separately requested.
