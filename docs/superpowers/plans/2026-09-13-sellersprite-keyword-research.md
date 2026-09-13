# SellerSprite Keyword Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight, data-backed SellerSprite XLSX workflow that produces reusable keyword groups for Amazon Listing copy plus bounded advertising-start suggestions.

**Architecture:** A focused XLSX reader converts Reverse ASIN and Keyword Mining sheets into typed source reports. A pure analyzer merges evidence and applies model-supplied product-fit decisions before deterministic grouping; a small store writes one portable project profile and optionally caches an exact-match reusable copy. The existing Listing brief consumes the profile, while one CLI command orchestrates a single import-and-analysis pass.

**Tech Stack:** Node.js 20+, ECMAScript modules, ExcelJS 4.4.0, built-in `node:test`, existing atomic JSON/state helpers.

**Spec:** `docs/superpowers/specs/2026-09-13-sellersprite-keyword-research-design.md`

## Global Constraints

- Treat supplied SellerSprite values as vendor-reported or estimated signals, never causal proof or product facts.
- Current user facts and product identity always decide whether a keyword is applicable.
- Mark the supplied workbooks `top_10_sample` / `user_declared`; never infer sample scope from row count or filename.
- Do not add opaque scores, dashboards, databases, bids, budgets, forecasts, campaign management, or another approval/review loop.
- One analysis pass supplies Listing and advertising-start suggestions; micro Listing revisions reuse the saved profile.
- Reusable matching is exact after normalization on marketplace, locale, product type, and purchase intent.
- Keyword failure does not block image generation, Product Master work, or a fact-grounded Listing draft.
- Existing `market_language` projects remain valid without migration, reapproval, or rehashing.

## File structure

- Create `scripts/lib/sellersprite-workbooks.js`: workbook signature detection, typed row extraction, and import metadata.
- Create `scripts/lib/keyword-profiles.js`: phrase normalization, evidence merge, product-fit validation, deterministic grouping, advertising suggestions, compatibility, refresh, and paths.
- Modify `scripts/studio.js`: one `analyze-keywords` command that loads project facts, imports reports once, builds the profile, and writes it atomically.
- Modify `scripts/lib/operations.js`: classify keyword analysis as one full, data-backed profile operation.
- Modify `scripts/lib/listing-briefs.js`: expose profile groups to drafting while retaining `market_language` fallback.
- Modify `scripts/lib/listing.js`: select backend phrases conservatively without fragmenting them or exceeding the UTF-8 byte limit.
- Create `tests/helpers/sellersprite-workbooks.js`: sanitized XLSX fixture builder using the production ExcelJS dependency.
- Create `tests/unit/sellersprite-workbooks.test.js`: parser and malformed-input behavior.
- Create `tests/unit/keyword-profiles.test.js`: grouping, sample provenance, ads, reuse, and refresh behavior.
- Modify `tests/unit/listing-briefs.test.js`: profile priority and legacy fallback.
- Modify `tests/unit/listing.test.js`: conservative phrase-level backend selection.
- Modify `tests/workflow/studio-cli.test.js`: one-pass CLI persistence, optional cache, and failure isolation.
- Modify `tests/skill-structure.test.js`: progressive-disclosure routing and efficiency contract.
- Modify `SKILL.md`, `references/knowledge-and-facts.md`, and `references/listing-workflow.md`: runtime routing and bounded behavior.
- Modify `package.json` and `package-lock.json`: add ExcelJS 4.4.0.

---

### Task 1: Read supported SellerSprite workbooks

**Files:**
- Create: `scripts/lib/sellersprite-workbooks.js`
- Create: `tests/helpers/sellersprite-workbooks.js`
- Create: `tests/unit/sellersprite-workbooks.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `parseSellerSpriteWorkbook(filePath, importContext) -> Promise<SellerSpriteReport>`.
- `importContext` fields: `{sampleScope, scopeProvenance, referenceAsin, seedQuery}`.
- `SellerSpriteReport` fields: `{report_type, source, report_identity, rows, skipped_rows}`.
- Later tasks consume canonical row keys: `keyword`, `traffic_share`, `organic_rank`, `sponsored_rank`, `relevance`, `monthly_searches`, `purchases`, `purchase_rate`, `spr`, `title_density`, `products`, `demand_supply_ratio`, `click_concentration`, `conversion_concentration`, `ppc`.

- [ ] **Step 1: Install the one workbook dependency**

Run:

```powershell
npm install exceljs@4.4.0 --save-exact
```

Expected: `package.json` and `package-lock.json` add ExcelJS; no parser behavior exists yet.

- [ ] **Step 2: Write sanitized fixture helpers and failing parser tests**

Create a helper that writes real XLSX files with `ExcelJS.Workbook`. Use these exact canonical test headers:

```js
export const reverseHeaders = [
  '流量词', '流量占比', '自然排名', '广告排名', '月搜索量',
  '月购买量', '购买率', 'SPR', '标题密度', '商品数', '供需比', 'PPC价格'
];

export const miningHeaders = [
  '关键词', '相关度', '月搜索量', '月购买量', '购买率',
  'SPR', '标题密度', '商品数', '供需比', 'PPC价格'
];
```

Test these observable cases:

```js
test('detects Reverse ASIN by mandatory columns and keeps one valid rank', async () => {
  const report = await parseSellerSpriteWorkbook(file, {
    sampleScope: 'top_10_sample', scopeProvenance: 'user_declared', referenceAsin: 'B0FQ1RL7YK'
  });
  assert.equal(report.report_type, 'reverse_asin');
  assert.equal(report.report_identity.reference_asin, 'B0FQ1RL7YK');
  assert.equal(report.rows[0].organic_rank, 6);
  assert.equal(report.rows[0].sponsored_rank, null);
});

test('detects Keyword Mining with reordered known columns', async () => {
  const report = await parseSellerSpriteWorkbook(file, {
    sampleScope: 'top_10_sample', scopeProvenance: 'user_declared', seedQuery: 'slow down kids at play sign'
  });
  assert.equal(report.report_type, 'keyword_mining');
  assert.equal(report.rows[0].relevance, 100);
  assert.equal(report.rows[0].monthly_searches, 6254);
});

test('skips malformed rows and fails only when no valid rows remain', async () => {
  const report = await parseSellerSpriteWorkbook(oneGoodOneBadFile, context);
  assert.equal(report.rows.length, 1);
  assert.equal(report.skipped_rows, 1);
  await assert.rejects(() => parseSellerSpriteWorkbook(allBadFile, context), error => error.code === 'UNSUPPORTED_KEYWORD_WORKBOOK');
});
```

Also cover duplicate mandatory headers, ambiguous signatures, an ordinary non-SellerSprite sheet, formula cells without cached values, error cells, percentages, currency, commas, optional malformed values becoming `null`, sanitized basenames, and default `unknown_partial` scope.

- [ ] **Step 3: Run the parser tests and verify RED**

Run:

```powershell
node --test tests/unit/sellersprite-workbooks.test.js
```

Expected: FAIL because `scripts/lib/sellersprite-workbooks.js` does not exist.

- [ ] **Step 4: Implement the minimal workbook reader**

Use an explicit alias map, exact normalized header lookup, and the first visible sheet matching exactly one signature:

```js
const HEADER_ALIASES = {
  keyword: ['keyword', '关键词', '流量词'],
  traffic_share: ['traffic share', '流量占比'],
  organic_rank: ['organic rank', '自然排名'],
  sponsored_rank: ['sponsored rank', '广告排名'],
  relevance: ['relevance', '相关度'],
  monthly_searches: ['monthly searches', 'm. searches', '月搜索量'],
  purchases: ['purchases', '月购买量'],
  purchase_rate: ['purchase rate', '购买率'],
  spr: ['spr'],
  title_density: ['title density', '标题密度'],
  products: ['products', '商品数'],
  demand_supply_ratio: ['dsr', 'demand to supply ratio', '供需比'],
  click_concentration: ['click concentration', '点击集中度'],
  conversion_concentration: ['conversion concentration', '转化集中度'],
  ppc: ['ppc bid', 'ppc价格']
};

const SIGNATURES = {
  reverse_asin: ['keyword', 'traffic_share', 'monthly_searches'],
  keyword_mining: ['keyword', 'relevance', 'monthly_searches']
};
```

For Reverse ASIN, require at least one valid `organic_rank` or `sponsored_rank` per retained row. Convert `18.53%` and numeric `0.1853` to the same decimal representation; preserve integers and currency as numbers. Throw `DomainError('UNSUPPORTED_KEYWORD_WORKBOOK', ...)` only for invalid signatures or zero retained rows.

- [ ] **Step 5: Run parser tests and the unit suite**

Run:

```powershell
node --test tests/unit/sellersprite-workbooks.test.js
npm run test:unit
```

Expected: PASS with no skipped or failed tests.

- [ ] **Step 6: Manually parse the two supplied workbooks without modifying them**

Run a small `node --input-type=module -e` invocation importing `parseSellerSpriteWorkbook` for:

```text
D:\downloads\ReverseASIN-US-B0FQ1RL7YK(10)-20260913 (1).xlsx
D:\downloads\KeywordMining-US-slow down kids at play sign(10)-20260913.xlsx
```

Pass `top_10_sample/user_declared`, `referenceAsin: B0FQ1RL7YK`, and `seedQuery: slow down kids at play sign`. Expected: both report types detected, 10 data rows imported from each, zero source files changed, and no claim of complete market size.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json scripts/lib/sellersprite-workbooks.js tests/helpers/sellersprite-workbooks.js tests/unit/sellersprite-workbooks.test.js
git commit -m "feat: parse SellerSprite keyword workbooks"
```

---

### Task 2: Merge evidence and build a bounded keyword profile

**Files:**
- Create: `scripts/lib/keyword-profiles.js`
- Create: `tests/unit/keyword-profiles.test.js`

**Interfaces:**
- Consumes: `SellerSpriteReport[]` from Task 1.
- Produces: `normalizeKeywordPhrase(value) -> string`.
- Produces: `mergeKeywordEvidence(reports) -> KeywordEvidence[]`.
- Produces: `buildKeywordProfile({project, intent, reports, fitAssessments, now}) -> KeywordProfile`.
- `fitAssessments` is model judgment grounded in current product facts, not a user approval: `{[normalizedPhrase]: {fit: 'exact'|'high'|'related'|'excluded', reason: string, reason_code: 'direct_match'|'related_intent'|'product_mismatch'|'unsupported_attribute'|'weak_or_duplicate'}}`.

- [ ] **Step 1: Write failing tests for evidence preservation and grouping**

Use the supplied sample values in sanitized JavaScript fixtures:

```js
const assessments = {
  'slow down kids at play sign': {fit: 'exact', reason: 'exact product intent'},
  'kids at play sign': {fit: 'high', reason: 'direct synonym'},
  'slow down signs': {fit: 'related', reason: 'broader sign intent'},
  'vinyl kids decal': {fit: 'excluded', reason: 'wrong product form'}
};

test('merges duplicate phrases without averaging unlike report evidence', () => {
  const merged = mergeKeywordEvidence([reverseReport, miningReport]);
  const keyword = merged.find(item => item.normalized_phrase === 'slow down kids at play sign');
  assert.equal(keyword.sources.reverse_asin.traffic_share, 0.0623);
  assert.equal(keyword.sources.keyword_mining.relevance, 100);
});

test('applies product fit before deterministic evidence ordering', () => {
  const profile = buildKeywordProfile({project, intent, reports, fitAssessments: assessments, now});
  assert.equal(profile.groups.core[0].phrase, 'slow down kids at play sign');
  assert.ok(profile.groups.excluded.some(item => item.phrase === 'vinyl kids decal'));
  assert.equal(profile.market_size_complete, false);
});
```

Add tests that missing metrics remain `null`, absent fit assessment fails with `KEYWORD_FIT_REQUIRED`, excluded phrases never appear in other groups, and no field named `score` exists.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test tests/unit/keyword-profiles.test.js
```

Expected: FAIL because the profile module does not exist.

- [ ] **Step 3: Implement phrase normalization, merge, and deterministic grouping**

Normalize only case, surrounding whitespace, repeated whitespace, punctuation, and hyphens for comparison. Preserve the first readable source phrase. Keep report observations under separate `sources.reverse_asin` and `sources.keyword_mining` objects.

Order eligible evidence by this explicit tuple, not a weighted score:

```js
const FIT_ORDER = {exact: 0, high: 1, related: 2};
// Compare: fit rank; Reverse-ASIN evidence present; traffic share descending;
// purchases descending; monthly searches descending; purchase rate descending;
// normalized phrase ascending as the stable final tie-breaker.
```

Assign at most three `exact`/`high` phrases to `core`. Put remaining `exact`/`high` phrases in `supporting`, `related` phrases in `backend`, and `excluded` assessments in `excluded`. With only ten sample rows, do not add thresholds or a scoring configuration.

- [ ] **Step 4: Add and test bounded advertising suggestions**

Add assertions:

```js
assert.deepEqual(profile.advertising.exact_candidates, profile.groups.core.map(item => item.phrase));
assert.deepEqual(profile.advertising.phrase_candidates, profile.groups.supporting.map(item => item.phrase));
assert.deepEqual(profile.advertising.cautious_tests, profile.groups.backend.map(item => item.phrase));
assert.ok(!JSON.stringify(profile.advertising).match(/bid|budget|forecast|profit/i));
```

Populate `negative_candidates` only from excluded entries whose reason code is `product_mismatch` or `unsupported_attribute`; do not treat weak demand or duplication as a negative keyword.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
node --test tests/unit/keyword-profiles.test.js
npm run test:unit
```

Expected: PASS.

```powershell
git add scripts/lib/keyword-profiles.js tests/unit/keyword-profiles.test.js
git commit -m "feat: build bounded keyword profiles"
```

---

### Task 3: Store, match, and refresh profiles safely

**Files:**
- Modify: `scripts/lib/keyword-profiles.js`
- Modify: `tests/unit/keyword-profiles.test.js`

**Interfaces:**
- Produces: `projectKeywordProfilePath(projectDir) -> <projectDir>/references/keyword-profile.json`.
- Produces: `reusableKeywordProfilePath(libraryDir, key) -> <libraryDir>/keyword-profiles/<marketplace>/<locale>/<productType>/<intentSlug>.json`.
- Produces: `isCompatibleKeywordProfile(profile, context, now) -> {compatible, stale, reasons}`.
- Produces: `mergeKeywordProfileReports(current, incoming) -> KeywordProfile`.

- [ ] **Step 1: Write failing compatibility and refresh tests**

Test exact normalized matches and rejection for marketplace, locale, product type, intent, product-fact conflict, and intent-slug collision. Use a fixed `now` to assert that a profile older than 180 days is compatible but stale.

Test report refresh behavior:

```js
test('replaces only newer evidence with the same report identity', () => {
  const merged = mergeKeywordProfileReports(currentProfile, incomingReverse);
  assert.equal(merged.reports.reverse_asin.source.export_date, '2026-09-13');
  assert.deepEqual(merged.reports.keyword_mining, currentProfile.reports.keyword_mining);
});

test('refuses automatic replacement without ASIN or seed-query identity', () => {
  assert.throws(
    () => mergeKeywordProfileReports(currentProfile, missingIdentity),
    error => error.code === 'UNRESOLVED_KEYWORD_IMPORT'
  );
});
```

Also reject equal/unknown-date conflicting replacements and path segments that are unsafe or empty.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test tests/unit/keyword-profiles.test.js
```

Expected: FAIL on missing lifecycle functions.

- [ ] **Step 3: Implement exact compatibility and report-identity refresh**

Use normalized exact strings only; do not use fuzzy matching. Return `stale: true` when `now - refreshed_at > 180 days`, but do not reject the profile solely for age. Replacement identity is:

```js
reverse_asin: [marketplace, reference_asin, report_type]
keyword_mining: [marketplace, seed_query, report_type]
```

Require an incoming export date to be strictly newer for automatic replacement. Preserve the complementary report unchanged.

- [ ] **Step 4: Implement safe conventional paths**

Use `path.resolve`, validate every generated segment with `/^[a-z0-9]+(?:-[a-z0-9]+)*$/i`, and assert that the final path remains beneath its selected root. Do not write files in this pure module.

- [ ] **Step 5: Run tests and commit**

```powershell
node --test tests/unit/keyword-profiles.test.js
npm run test:unit
git add scripts/lib/keyword-profiles.js tests/unit/keyword-profiles.test.js
git commit -m "feat: reuse keyword profiles safely"
```

---

### Task 4: Add one-pass project CLI orchestration

**Files:**
- Modify: `scripts/studio.js`
- Modify: `scripts/lib/operations.js`
- Modify: `tests/unit/operations.test.js`
- Modify: `tests/workflow/studio-cli.test.js`

**Interfaces:**
- Adds: `scripts/studio.js analyze-keywords --project-dir <dir> --input <manifest.json> [--library-dir <dir>]`.
- Manifest shape:

```json
{
  "intent": "slow down kids at play sign",
  "sample_scope": "top_10_sample",
  "scope_provenance": "user_declared",
  "reports": [
    {"path": "D:/downloads/reverse.xlsx", "reference_asin": "B0FQ1RL7YK"},
    {"path": "D:/downloads/mining.xlsx", "seed_query": "slow down kids at play sign"}
  ],
  "fit_assessments": {
    "slow down kids at play sign": {"fit": "exact", "reason": "exact product intent", "reason_code": "direct_match"}
  }
}
```

- Produces project file: `references/keyword-profile.json`.
- Optionally produces reusable file under the selected seller library.

- [ ] **Step 1: Write a failing end-to-end CLI test**

Initialize a real temporary project, generate the two XLSX fixtures, write the manifest, and call `runCli`. Assert:

```js
assert.equal(result.ok, true);
assert.equal(result.operation, 'analyze-keywords');
assert.equal(result.mode, 'full');
assert.equal(result.result.report_count, 2);
assert.equal(result.result.analysis_passes, 1);
assert.equal(result.result.web_research_used, false);
assert.equal(result.result.market_size_complete, false);
```

Read both saved JSON files and assert identical grouped keyword content. Snapshot `state.json` and an approved image file before the command, then assert their bytes remain unchanged afterward.

Add an operation-routing assertion:

```js
assert.deepEqual(classifyOperation({kind: 'keyword_analysis'}), {
  mode: 'full', reasons: ['DATA_BACKED_KEYWORD_PROFILE']
});
```

- [ ] **Step 2: Add failing fallback tests**

Cover:

- unsupported workbook returns `ok: false`, `code: UNSUPPORTED_KEYWORD_WORKBOOK`, and creates no misleading profile;
- omitted `--library-dir` still writes the project profile;
- an unwritable or failed optional cache returns a warning while preserving the valid project profile;
- no CLI path invokes a web dependency or requests per-keyword approval.

- [ ] **Step 3: Run and verify RED**

```powershell
node --test tests/workflow/studio-cli.test.js
```

Expected: FAIL because `analyze-keywords` is unknown.

- [ ] **Step 4: Implement the command with one atomic project write**

Add `keyword_analysis: {mode: 'full', reason: 'DATA_BACKED_KEYWORD_PROFILE'}` to `scripts/lib/operations.js`, then map `analyze-keywords` to `keyword_analysis` in `operationFor`. Load `state.json` only to derive `marketplace`, `language`, `product_type`, and current publishable facts. Parse each report once, build one profile, then use the existing `writeJsonAtomically` helper for the project profile.

If `--library-dir` is present, derive the reusable path and attempt a second atomic write after the project write. Return a compact warning such as `{code: 'KEYWORD_CACHE_NOT_WRITTEN'}` if optional caching fails; do not roll back or rewrite the project profile.

- [ ] **Step 5: Run workflow and full tests, then commit**

```powershell
node --test tests/unit/operations.test.js tests/workflow/studio-cli.test.js
npm test
git add scripts/studio.js scripts/lib/operations.js tests/unit/operations.test.js tests/workflow/studio-cli.test.js
git commit -m "feat: analyze SellerSprite keywords in one pass"
```

---

### Task 5: Feed keyword groups into Listing drafting

**Files:**
- Modify: `scripts/lib/listing-briefs.js`
- Modify: `scripts/lib/listing.js`
- Modify: `tests/unit/listing-briefs.test.js`
- Modify: `tests/unit/listing.test.js`

**Interfaces:**
- Extends: `compileListingBrief({facts, marketLanguage, keywordProfile, rules, marketingExpressions})`.
- Produces: `selectBackendSearchPhrases({listing, candidates, byteLimit}) -> string`.

- [ ] **Step 1: Write failing Listing brief tests**

Assert that a current keyword profile produces:

```js
assert.deepEqual(brief.keyword_groups.core, ['slow down kids at play sign', 'kids at play sign']);
assert.deepEqual(brief.fields.title.keyword_candidates, brief.keyword_groups.core);
assert.deepEqual(brief.fields.backend_search_terms.candidates, ['slow down signs']);
assert.deepEqual(brief.advertising.exact_candidates, ['slow down kids at play sign']);
```

Also keep the existing fixture unchanged and assert that omitting `keywordProfile` preserves the current `market_language` output and backend candidates byte-for-byte.

- [ ] **Step 2: Write failing phrase-preserving backend tests**

Use these cases:

```js
test('drops a fully covered phrase after conservative normalization', () => {
  const listing = {title: 'Slow-Down Kids at Play Sign'};
  assert.equal(selectBackendSearchPhrases({listing, candidates: ['slow down kids at play sign']}), '');
});

test('keeps a useful partially uncovered phrase intact', () => {
  const listing = {title: 'Kids at Play Sign'};
  assert.equal(selectBackendSearchPhrases({listing, candidates: ['residential street warning']}), 'residential street warning');
});

test('never fragments a phrase to fit the UTF-8 byte limit', () => {
  const result = selectBackendSearchPhrases({listing: {}, candidates: ['jobsite warning', 'residential street warning'], byteLimit: 20});
  assert.equal(result, 'jobsite warning');
});
```

- [ ] **Step 3: Run and verify RED**

```powershell
node --test tests/unit/listing-briefs.test.js tests/unit/listing.test.js
```

Expected: FAIL on missing keyword-profile fields and backend selector.

- [ ] **Step 4: Implement the minimal brief extension and selector**

Expose phrases rather than raw metric objects in field instructions; keep full evidence once under `keyword_profile`. Excluded phrases remain visible for validation but never become candidates. The backend selector compares normalized token sets, drops a candidate only when every meaningful token is already present on the front end, appends only complete phrases, and stops before exceeding `byteLimit`.

- [ ] **Step 5: Prove micro revisions do not reanalyze keywords**

Extend the existing micro-revision test to include a saved `references/keyword-profile.json`, then assert its bytes and modified time remain unchanged after `runListingRevision`. Do not add keyword parsing to `runListingRevision`.

- [ ] **Step 6: Run tests and commit**

```powershell
node --test tests/unit/listing-briefs.test.js tests/unit/listing.test.js
npm test
git add scripts/lib/listing-briefs.js scripts/lib/listing.js tests/unit/listing-briefs.test.js tests/unit/listing.test.js
git commit -m "feat: apply keyword profiles to Listings"
```

---

### Task 6: Route the lightweight workflow and verify the complete Skill

**Files:**
- Modify: `SKILL.md`
- Modify: `references/knowledge-and-facts.md`
- Modify: `references/listing-workflow.md`
- Modify: `tests/skill-structure.test.js`
- Modify: `tests/contract/seed-behaviors.test.js`

**Interfaces:**
- Documents the `analyze-keywords` command and `references/keyword-profile.json` convention.
- Keeps XLSX parsing optional and scoped to market/Listing work.

- [ ] **Step 1: Write failing Skill contract tests**

Add meaningful assertions that the references require:

- SellerSprite XLSX or compatible cached profile before web keyword fallback;
- `top_10_sample` is not complete market analysis;
- one analysis pass and no per-keyword approval;
- four Listing keyword groups and four bounded advertising groups;
- no bids, budgets, forecasts, dashboards, or opaque scores;
- micro revisions do not refresh research;
- keyword failure does not block images/Product Master;
- legacy `market_language` fallback remains available.

Extend the Seed behavior matrix with one profile-backed Listing brief and one legacy brief.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test tests/skill-structure.test.js tests/contract/seed-behaviors.test.js
```

Expected: FAIL because current references still describe only generic market language.

- [ ] **Step 3: Update progressive-disclosure routing**

Keep `SKILL.md` compact: add SellerSprite reports and keyword profiles only to the existing facts/Listing routes. Put parser, grouping, reuse, Top 10 labeling, and advertising boundaries in the two focused references. Do not add another always-loaded reference.

In `references/knowledge-and-facts.md`, distinguish keyword-intent profiles from seller-family facts and category observations. In `references/listing-workflow.md`, route `analyze-keywords`, assign groups to fields, and state that advertising suggestions are optional starting points from the same pass.

- [ ] **Step 4: Run focused and full verification**

```powershell
node --test tests/skill-structure.test.js tests/contract/seed-behaviors.test.js
npm test
git diff --check
```

Expected: all tests pass, no whitespace errors, and no source workbook has changed.

- [ ] **Step 5: Validate the Skill package**

Run the bundled validator with its configured Python environment:

```powershell
python D:\Codex\CodexHome\skills\.system\skill-creator\scripts\quick_validate.py .
```

Expected: `Skill is valid!`. If the desktop Python lacks PyYAML, record that environment dependency separately; do not install unrelated global packages or treat the validator failure as a product-test failure.

- [ ] **Step 6: Commit the completed runtime guidance**

```powershell
git add SKILL.md references/knowledge-and-facts.md references/listing-workflow.md tests/skill-structure.test.js tests/contract/seed-behaviors.test.js
git commit -m "docs: route SellerSprite keyword research"
```

- [ ] **Step 7: Review the complete branch before integration**

Run:

```powershell
git status --short
git log --oneline --decorate -8
git diff --stat afa25b3d23bb669466d3b1880ef772350f51aac0..HEAD
```

Expected: clean worktree, the design/plan plus six focused implementation commits, and no unrelated file changes. Request independent review before pushing or merging.
