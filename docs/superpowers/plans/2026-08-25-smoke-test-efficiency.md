# Amazon Listing Studio Smoke-Test Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the completed smoke-test failures and shorten routine image, Listing, approval, and delivery work without weakening Product Master, fact, inspection, approval, or final-integrity controls.

**Architecture:** Keep the existing v2 two-speed state and command surface. Add a separate merchant layout-seed library, extend seller-family knowledge with scoped marketing expressions, add a bounded Listing self-audit and shared approval/finalization preflight, and make delivery paths plus archive verification explicit. Existing candidate deferral and micro-revision paths remain authoritative.

**Tech Stack:** Node.js ESM, built-in `node:test`, Sharp, fflate, JSON/Markdown Skill resources.

**Spec:** `docs/superpowers/specs/2026-08-25-smoke-test-efficiency-design.md`

## Global Constraints

- Current explicit user facts remain the highest authority; conflicting current confirmations remain blocking.
- Product Master still requires an exact saved, inspected, explicitly approved main raster.
- Secondary images still use the locked Product Master and require explicit approval one at a time.
- Rejected candidates are not hashed; approved artifacts hash once; final delivery rehashes all selected artifacts.
- Drafting may use cached rules; `upload_ready=true` still requires applicable current verification.
- Do not call paid image generation in automated tests.
- Do not reintroduce WebUI, HTTP server, workers, or a generalized harness adapter.

---

### Task 1: Merchant layout seed library

**Files:**
- Create: `scripts/lib/merchant-layouts.js`
- Create: `assets/merchant-layouts/rigid-aluminum-signs.json`
- Create: `assets/merchant-layout-previews/durability.webp`
- Create: `assets/merchant-layout-previews/size-construction.webp`
- Create: `assets/merchant-layout-previews/front-back.webp`
- Create: `assets/merchant-layout-previews/application-scenarios.webp`
- Modify: `scripts/lib/image-briefs.js`
- Test: `tests/unit/merchant-layouts.test.js`
- Test: `tests/unit/image-briefs.test.js`

**Interfaces:**
- Produces: `loadMerchantLayouts(filePath): Promise<object>`.
- Produces: `selectMerchantLayout(library, context): object | null`, where `context` contains `familyTraits`, `assetType`, `facts`, and `excludedConditions`.
- Extends `compileImageBrief()` output with `layout_seed` and conditional `difference_requirements`.

- [ ] **Step 1: Write failing behavior tests**

```js
test('selects one fixed merchant layout for a matching rigid aluminum sign role', async () => {
  const library = await loadMerchantLayouts('assets/merchant-layouts/rigid-aluminum-signs.json');
  const selected = selectMerchantLayout(library, {
    familyTraits: {material: 'aluminum', product_form: 'rigid_sign'},
    assetType: 'front_back', facts: ['front', 'back'], excludedConditions: []
  });
  assert.equal(selected.id, 'merchant-sign-front-back');
  assert.equal(selected.reuse_policy, 'FIXED_LAYOUT_ALLOWED');
});

test('merchant seed reuse does not require anti-copy changes', () => {
  const brief = compileImageBrief({
    sourceRoles: [{id: 'merchant-sign-front-back', role: 'MERCHANT_LAYOUT_SEED'}],
    layoutSeed: {id: 'merchant-sign-front-back', reuse_policy: 'FIXED_LAYOUT_ALLOWED'}
  });
  assert.deepEqual(brief.difference_requirements, []);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/unit/merchant-layouts.test.js tests/unit/image-briefs.test.js`  
Expected: FAIL because `merchant-layouts.js`, seed selection, and conditional difference requirements do not exist.

- [ ] **Step 3: Implement the minimal seed loader and selector**

Implement strict local JSON validation, exact asset-role filtering, stable trait matching, required-fact filtering, exclusions, and first-best deterministic selection. Keep merchant seeds separate from third-party template snapshots.

- [ ] **Step 4: Add the four approved smoke-test previews and metadata**

Derive WebP previews from the approved delivery images only. Record source project, approved artifact name, SHA-256, fixed layout regions, allowed adaptations, applicable traits, and compact failure guards. Do not copy Listing text or product identity into reusable prompt instructions.

- [ ] **Step 5: Integrate seed roles into `compileImageBrief`**

Third-party/product design references retain coherent anti-copy requirements. `MERCHANT_LAYOUT_SEED` with `FIXED_LAYOUT_ALLOWED` returns no novelty requirement while still replacing identity and copy from the current Product Master and facts.

- [ ] **Step 6: Run focused tests and commit**

Run: `node --test tests/unit/merchant-layouts.test.js tests/unit/image-briefs.test.js`  
Expected: PASS.

```powershell
git add scripts/lib/merchant-layouts.js scripts/lib/image-briefs.js assets/merchant-layouts assets/merchant-layout-previews tests/unit/merchant-layouts.test.js tests/unit/image-briefs.test.js
git commit -m "feat: add reusable merchant image layouts"
```

### Task 2: Scoped marketing expressions and one consolidated confirmation

**Files:**
- Modify: `scripts/lib/knowledge.js`
- Modify: `tests/unit/knowledge.test.js`
- Modify: `tests/fixtures/knowledge/seller-families/aluminum-signs.json`
- Modify: `references/knowledge-and-facts.md`

**Interfaces:**
- Extends `evaluateFamilyClaims()` with `marketing_expressions`, a shared `confirmation_required` list, and at most one question.
- Extends `applyFamilyClaimConfirmation()` to record expression decisions at `project` or `seller_family` scope without promoting expressions to facts.
- Produces normalized expression records with `id`, `text`, `allowed_scopes`, `non_derivable_facts`, `status`, and confirmation metadata.

- [ ] **Step 1: Write failing knowledge tests**

```js
test('asks once for process claims and related marketing expressions', () => {
  const result = evaluateFamilyClaims({family, candidateFacts, projectFacts: {}});
  assert.equal(result.questions.length, 1);
  assert.deepEqual(result.confirmation_required.map(item => item.kind), ['fact', 'expression']);
});

test('declined competitor expression remains observation-only', () => {
  const result = applyFamilyClaimConfirmation({
    family, factIds: [], expressionIds: ['color-stays-bright'], confirmed: false,
    scope: 'project', projectFacts: {}, projectExpressions: {}
  });
  assert.equal(result.projectExpressions['color-stays-bright'].status, 'market_observation');
  assert.equal(result.projectFacts['color-stays-bright'], undefined);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/unit/knowledge.test.js`  
Expected: FAIL because expressions are not modeled or included in the consolidated decision.

- [ ] **Step 3: Implement expression normalization and scoped confirmation**

Return one consolidated question for all unresolved process facts and expressions. Store positive decisions in their own expression collection; store negative/uncertain decisions as observation-only. Never insert expression text into project facts.

- [ ] **Step 4: Update the family fixture and focused reference**

Add representative image/Listing-safe expressions with field scopes and explicit non-derivable facts. Document that Listing self-audit, not family confirmation alone, decides field suitability.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/unit/knowledge.test.js`  
Expected: PASS.

```powershell
git add scripts/lib/knowledge.js tests/unit/knowledge.test.js tests/fixtures/knowledge/seller-families/aluminum-signs.json references/knowledge-and-facts.md
git commit -m "feat: scope reusable marketing expressions"
```

### Task 3: One-pass Listing self-audit and approval preflight

**Files:**
- Create: `scripts/lib/listing-audit.js`
- Modify: `scripts/lib/listing-briefs.js`
- Modify: `scripts/lib/listing.js`
- Modify: `scripts/lib/listing-drafts.js`
- Modify: `scripts/lib/transactions.js`
- Modify: `scripts/lib/operations.js`
- Test: `tests/unit/listing-audit.test.js`
- Test: `tests/unit/listing-drafts.test.js`
- Test: `tests/workflow/listing-fast-path.test.js`

**Interfaces:**
- Produces `auditListing(content, context): {ok, findings, changed_paths}`.
- Produces `deriveListingScope(state, content): object`.
- Produces `preflightListingScope(state, content): {ok: true, scope}` or throws `BLOCKING_INPUT`.
- `approveDraft(state, approval)` derives system metadata before hashing and versioning.

- [ ] **Step 1: Write failing audit and approval tests**

```js
test('bounded audit flags retail-language defects without rewriting clean fields', () => {
  const result = auditListing(listing, {buyerTerms: ['playground', 'driveway']});
  assert.deepEqual(result.findings.map(item => item.code), [
    'INTERNAL_QA_LANGUAGE', 'ABSTRACT_RETAIL_PHRASE', 'UNSUPPORTED_ABSOLUTE'
  ]);
  assert.equal(result.changed_paths.includes('title'), false);
});

test('approval derives finalizer metadata from current project state', () => {
  const approved = approveDraft(stateWithDraftMissingSystemMetadata, {userAction: 'approved', now});
  const content = approved.listing.approved[0].content;
  assert.equal(content.project_id, stateWithDraftMissingSystemMetadata.project.product_id);
  assert.deepEqual(content.rules_unverified, stateWithDraftMissingSystemMetadata.rules.unverified_fields);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/unit/listing-audit.test.js tests/unit/listing-drafts.test.js tests/workflow/listing-fast-path.test.js`  
Expected: FAIL because bounded audit and shared scope derivation do not exist.

- [ ] **Step 3: Implement a diagnostic, non-recursive audit**

Use explicit finding codes for internal QA language, abstract empty phrasing, unsupported absolutes/compliance implications, mounting/use-environment confusion, weak backend intent, and canonical terminology drift. Return affected paths only. Do not automatically rewrite clean fields or loop.

- [ ] **Step 4: Add the audit contract to the Listing brief**

The first-draft brief requests one generation plus one bounded self-check. Its repair contract permits one pass over findings and forbids recursive polish or professionalism-only rewrites.

- [ ] **Step 5: Derive system metadata and share approval preflight**

At approval, merge project ID, Product Master version, marketplace, language, product type, rule status, unverified fields, and upload readiness from current state. Validate that scope before producing immutable JSON/Markdown hashes. Keep metadata outside user micro patches so metadata-only normalization does not consume a formal copy version.

- [ ] **Step 6: Preserve fast micro revisions**

Changed-field validation may call audit filtering only for changed paths and direct terminology/keyword dependencies. Assert that market research, network refresh, image work, full draft generation, and repository tests remain absent.

- [ ] **Step 7: Run focused tests and commit**

Run: `node --test tests/unit/listing-audit.test.js tests/unit/listing-drafts.test.js tests/workflow/listing-fast-path.test.js`  
Expected: PASS.

```powershell
git add scripts/lib/listing-audit.js scripts/lib/listing-briefs.js scripts/lib/listing.js scripts/lib/listing-drafts.js scripts/lib/transactions.js scripts/lib/operations.js tests/unit/listing-audit.test.js tests/unit/listing-drafts.test.js tests/workflow/listing-fast-path.test.js
git commit -m "feat: preflight and audit listing drafts"
```

### Task 4: Product-relative delivery and direct ZIP verification

**Files:**
- Modify: `scripts/lib/bundle.js`
- Modify: `scripts/studio.js`
- Modify: `tests/unit/bundle.test.js`
- Modify: `tests/workflow/studio-cli.test.js`
- Modify: `tests/workflow/two-speed-end-to-end.test.js`
- Modify: `references/delivery-and-compliance.md`

**Interfaces:**
- Produces `verifyDelivery({deliveryDir, expectedScope?}): Promise<object>`.
- `projectOutputPath(projectDir, requestedPath, label)` resolves relative paths from `projectDir`.
- Manifest artifact records expose `container: 'delivery.zip'` and `archive_path`.
- Adds CLI command `verify-delivery --delivery-dir <dir>`.

- [ ] **Step 1: Write failing path, manifest, and archive tests**

```js
test('relative finalize output resolves inside the product root', async () => {
  await runCli(['finalize', '--project-dir', projectDir, '--output', 'delivery/final-v1', '--approval', approvalPath], deps);
  assert.equal(received.outputDir, path.join(projectDir, 'delivery', 'final-v1'));
});

test('finalizer verifies ZIP members without extraction', async () => {
  const result = await verifyDelivery({deliveryDir});
  assert.equal(result.ok, true);
  assert.equal(result.verified_images, 2);
  assert.equal(result.verified_hashes, result.manifest.artifacts.length);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/unit/bundle.test.js tests/workflow/studio-cli.test.js tests/workflow/two-speed-end-to-end.test.js`  
Expected: FAIL because relative output uses the process CWD, manifest containment is implicit, and direct verification does not exist.

- [ ] **Step 3: Correct output resolution and manifest semantics**

Resolve relative output against the exact project root, then enforce containment. Add `container` and `archive_path` while preserving compatibility fields needed by existing readers.

- [ ] **Step 4: Implement direct ZIP verification**

Read `delivery-manifest.json` and `delivery.zip`; compare exact member sets, byte lengths, and SHA-256 values; decode every declared image; parse Listing JSON; verify Listing and approval scope. Return counts and scope status. Do not write an extraction directory.

- [ ] **Step 5: Make finalization verify before reporting success**

After atomic output installation, run `verifyDelivery`. If verification fails, report the delivery as invalid and never claim completion. Expose the same verifier through `verify-delivery`.

- [ ] **Step 6: Run focused tests and commit**

Run: `node --test tests/unit/bundle.test.js tests/workflow/studio-cli.test.js tests/workflow/two-speed-end-to-end.test.js`  
Expected: PASS.

```powershell
git add scripts/lib/bundle.js scripts/studio.js tests/unit/bundle.test.js tests/workflow/studio-cli.test.js tests/workflow/two-speed-end-to-end.test.js references/delivery-and-compliance.md
git commit -m "feat: verify product-relative delivery archives"
```

### Task 5: Skill routing, regression matrix, and deployment validation

**Files:**
- Modify: `SKILL.md`
- Modify: `references/image-workflow.md`
- Modify: `references/listing-workflow.md`
- Modify: `tests/skill-structure.test.js`
- Modify: `tests/workflow/required-matrix.test.js`
- Modify: `tests/workflow/two-speed-end-to-end.test.js`

**Interfaces:**
- `SKILL.md` remains the compact fast/full router.
- Domain details remain in exactly the relevant reference rather than duplicating the design report.

- [ ] **Step 1: Write failing behavior/structure tests**

Add observable assertions that the Skill routes merchant-layout selection, consolidated family confirmation, bounded Listing audit, shared approval preflight, and direct delivery verification. Avoid tests that merely require a prose sentence when a runtime behavior can be asserted.

- [ ] **Step 2: Run the new tests and verify RED**

Run: `node --test tests/skill-structure.test.js tests/workflow/required-matrix.test.js tests/workflow/two-speed-end-to-end.test.js`  
Expected: FAIL because the entrypoint and end-to-end matrix do not yet expose the new behaviors.

- [ ] **Step 3: Make the smallest Skill/reference edits**

Keep `SKILL.md` concise. Route layout work to `image-workflow.md`, family claims/expressions to `knowledge-and-facts.md`, Listing audit to `listing-workflow.md`, and final verification to `delivery-and-compliance.md`. State the runtime recipe as light drafts, immutable approvals, strict delivery.

- [ ] **Step 4: Run focused and complete test suites**

Run: `node --test tests/skill-structure.test.js tests/workflow/required-matrix.test.js tests/workflow/two-speed-end-to-end.test.js`  
Expected: PASS.

Run: `npm test`  
Expected: all tests PASS, zero failures, without paid image generation.

- [ ] **Step 5: Validate the Skill package**

Run: `python D:/Codex/CodexHome/skills/.system/skill-creator/scripts/quick_validate.py .`  
Expected: validation success. If the bundled Python runtime is unavailable, record that limitation and rely on the repository's structure and full behavioral suite rather than silently claiming the validator ran.

- [ ] **Step 6: Commit**

```powershell
git add SKILL.md references/image-workflow.md references/listing-workflow.md tests/skill-structure.test.js tests/workflow/required-matrix.test.js tests/workflow/two-speed-end-to-end.test.js
git commit -m "docs: route efficient smoke-tested workflow"
```

### Task 6: Final review, merge, push, and installed-skill sync

**Files:**
- Review: all changed files
- Sync target after merge: `D:/Codex/CodexHome/skills/amazon-listing-studio/`

**Interfaces:**
- Source repository remains authoritative.
- Installed Skill must byte-match every tracked source file after sync.

- [ ] **Step 1: Review diff and repository status**

Run: `git diff main...HEAD --check`  
Run: `git diff --stat main...HEAD`  
Run: `git status --short --branch`  
Expected: no whitespace errors or unintended files.

- [ ] **Step 2: Run fresh final verification**

Run: `npm test`  
Expected: all tests PASS, zero failures.

- [ ] **Step 3: Merge and push after successful verification**

Fast-forward the reviewed branch into `main`, push `main` to the configured origin, and preserve unrelated worktrees or backup branches.

- [ ] **Step 4: Sync tracked files to the installed Skill**

Copy only repository-tracked files to `D:/Codex/CodexHome/skills/amazon-listing-studio/`. Do not delete untracked user files. Verify every tracked file by SHA-256.

- [ ] **Step 5: Test the installed Skill and clean this feature worktree**

Run the installed package's full test suite. After it passes and hashes match, remove only the `smoke-test-efficiency` worktree and delete only its merged local feature branch.
