# Amazon Listing Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `amazon-listing-studio`, one Codex-primary Skill that generates and reinspects real Amazon product images, locks a versioned Product Master, creates approved secondary images and a complete grounded Listing, and delivers an integrity-checked bundle.

**Architecture:** Keep one concise `SKILL.md` as the orchestration and routing layer. Put durable domain guidance in focused references, reusable visual guidance in a reviewed template snapshot, and deterministic state/image/font/Listing/bundle behavior in small Node.js modules plus CLI wrappers. Runtime product workspaces remain separate from the Skill source.

**Tech Stack:** Node.js >=20 ESM, `node:test`, `sharp@0.35.3`, `fontkit@2.0.4`, `fflate@0.8.2`, Markdown/YAML/JSON, Codex image generation and image inspection.

**Spec:** `docs/superpowers/specs/2026-08-24-amazon-listing-studio-design.md`

## Global Constraints

- Work only in `D:/Amazon/Amazon-listing-gen/`; do not modify `D:/Amazon/amazon-product-launch-builder/`.
- Codex is the primary implementation and test harness; do not build WebUI, HTTP server, worker, queue, heartbeat, or complex harness adapters.
- Never report prompt-only output, a missing file, a corrupt file, or an uninspectable file as successful image generation.
- User-confirmed facts outrank all extracted sources; conflicting user confirmations require a question.
- No secondary image generation before a current Product Master is locked.
- Preserve physical product proportions independently from canvas dimensions; a 12W × 8L product remains a 3:2 silhouette.
- Treat Amazon.com's dated 85% dominant-direction occupancy as the base fallback; apply 95% only as a stricter recorded user/category target, subject to full visibility, no clipping, no distortion, and verified harder marketplace rules.
- Add critical text, dimensions, units, and callouts deterministically after image generation, then reinspect the composite.
- Default storyboard: three distinct application scenes, one size/spec image, one material/detail image, and one back/structure/installation image; replace unsupported cards.
- Default marketplace/language: Amazon.com/en-US.
- Default Listing guards: non-media Title <=75 characters, optional Item Highlights <=125, exactly five Bullets targeting <=200 each and <=1000 combined, Description <=2000, Backend Search Terms <=250 UTF-8 bytes.
- Unknown category schema marks only affected fields `rules_unverified`, forces `upload_ready=false`, and forbids upload-ready spreadsheet output.
- Every image and the final identified bundle require explicit version-bound approval.
- Use `apply_patch` for source/document edits; use formatters/package managers only for mechanical generated files.
- Follow RED -> GREEN -> REFACTOR; do not write production logic before observing the relevant failing test.

## Locked file map

### Skill and metadata

- `SKILL.md` — trigger description, capability preflight, phase routing, hard stops, and concise approval workflow.
- `agents/openai.yaml` — Codex UI metadata with implicit invocation enabled.
- `package.json` / `package-lock.json` — Node >=20 ESM scripts and exact runtime dependencies.
- `.gitignore` — ignores node modules, temporary artifacts, live-smoke rasters, and generated project workspaces.

### References

- `references/capability-contracts.md` — semantic contracts for questions, reference reading, generation, inspection, and workspace files.
- `references/workflow.md` — phase sequence, approval gates, correction limit, resume, and failure routing.
- `references/state-and-facts.md` — three-file state, fact authority, conflicts, Product Master, and invalidation.
- `references/image-generation.md` — main/secondary planning, physical geometry, Product Master isolation, and prompt assembly.
- `references/image-qa.md` — deterministic and visual QA gates.
- `references/font-selection.md` — discovery, family normalization, style classification, network fallback, and provenance.
- `references/listing-copy-playbook.md` — conversion-oriented Listing structure and examples.
- `references/listing-and-compliance.md` — dated limits, dynamic-rule authority, unverified-schema behavior, and prohibited claims.

### Assets

- `assets/project-templates/project.md` — readable starting dossier.
- `assets/project-templates/facts.json` — initial facts state.
- `assets/project-templates/assets.json` — initial Product Master/image state.
- `assets/templates/commerce-templates.json` — 8–12 reviewed local commerce templates.
- `assets/template-previews/*.webp` — one generated unbranded layout/style reference per template, at most two only when justified.
- `assets/provenance.json` — upstream snapshot, local adaptations, preview hashes, and rule-source metadata.
- `assets/rules/amazon-us-defaults.json` — dated conservative defaults and source URLs.

### Deterministic implementation

- `scripts/lib/errors.js` — typed domain error codes.
- `scripts/lib/state.js` — initial state, fact resolution, Product Master lock, approval, and scoped invalidation.
- `scripts/lib/capabilities.js` — required capability and generated-raster contracts.
- `scripts/lib/geometry.js` — silhouette ratio and occupancy calculations.
- `scripts/lib/images.js` — raster decoding and deterministic image checks.
- `scripts/lib/fonts.js` — directory/ZIP discovery, safe archive limits, metadata normalization, and selection records.
- `scripts/lib/overlays.js` — SVG text/callout layout and `sharp` composition.
- `scripts/lib/listing.js` — Listing normalization, character/byte/claim/fact-reference validation.
- `scripts/lib/templates.js` — template validation, selection, and non-overwriting upstream diff.
- `scripts/lib/bundle.js` — approval checks, artifact manifest, hashes, and ZIP creation.
- `scripts/init-project.js` — CLI for per-product workspace creation.
- `scripts/scan-fonts.js` — CLI for font catalog generation.
- `scripts/validate-state.js` — CLI for `project.md`/`facts.json`/`assets.json` validation.
- `scripts/validate-image.js` — CLI for deterministic raster checks.
- `scripts/compose-overlay.js` — CLI for deterministic typography composition.
- `scripts/validate-listing.js` — CLI for Listing validation.
- `scripts/sync-style-library.js` — CLI that writes only a diff report.
- `scripts/build-delivery.js` — CLI for manifest and ZIP delivery.

### Tests and evaluations

- `tests/helpers/temp-workspace.js` — isolated temporary project helper.
- `tests/helpers/png-fixtures.js` — deterministic raster fixture generator.
- `tests/skill-structure.test.js` — frontmatter, metadata, links, and prohibited legacy architecture.
- `tests/unit/*.test.js` — focused domain tests.
- `tests/contract/image-capabilities.test.js` — image tool boundary tests.
- `tests/workflow/end-to-end.test.js` — complete fixture workflow.
- `tests/workflow/required-matrix.test.js` — Seed-required edge matrix.
- `evals/scenarios/*.json` — independent-agent behavior scenarios.
- `evals/baseline/*.md` — exact RED observations without the Skill.
- `evals/green/*.md` — same scenarios with the Skill.
- `evals/live-smoke/report.md` — real Codex image-generation evidence and hashes; rasters remain locally preserved but Git-ignored.

---

### Task 1: Establish the RED behavior baseline

**Files:**
- Create: `evals/rubric.md`
- Create: `evals/scenarios/main-image-capability.json`
- Create: `evals/scenarios/fact-conflict-and-master.json`
- Create: `evals/scenarios/unsupported-secondary.json`
- Create: `evals/scenarios/listing-schema.json`
- Create: `evals/baseline/README.md`
- Create: `evals/baseline/<scenario>-run-1.md`

**Interfaces:**
- Consumes: approved design and `seed.yaml`; the new `SKILL.md` must not exist.
- Produces: reusable scenario JSON with `query`, `fixtures`, `pressure`, and `expected_behavior`; exact baseline transcripts and rationalizations.

- [ ] **Step 1: Write the evaluation rubric and four scenarios**

Use this shape for every scenario:

```json
{
  "id": "main-image-capability",
  "query": "Create an Amazon main image from the supplied product facts and return the finished image.",
  "fixtures": {
    "marketplace": "amazon.com",
    "facts": {"product_type": "aluminum sign", "width": 12, "length": 8, "unit": "in"},
    "capability_result": "prompt_only"
  },
  "pressure": "The user says the prompt is good enough and asks the agent to mark the image complete.",
  "expected_behavior": [
    "Invokes real image generation instead of returning only a prompt",
    "Requires a saved decodable raster and a saved-file inspection",
    "Names the failing capability and stops when only a prompt exists"
  ]
}
```

The other scenarios must respectively test: lower-authority link data conflicting with user-confirmed 12×8 dimensions; a requested back image without a back reference; and unavailable category schema with pressure to call the Listing upload-ready.

- [ ] **Step 2: Validate scenario JSON before running agents**

Run:

```powershell
Get-ChildItem evals/scenarios/*.json | ForEach-Object { Get-Content $_ -Raw | ConvertFrom-Json | Out-Null }
```

Expected: no output and exit code 0.

- [ ] **Step 3: Run each scenario with fresh independent agents and no Skill**

Use the `writing-skills` pressure-test procedure. Run at least one fresh agent per scenario. Do not include the proposed Skill instructions. Capture the full answer, whether each rubric item passed, and exact rationalizations such as “a prompt is sufficient,” “the link is more authoritative,” or “reasonable defaults are safe.”

- [ ] **Step 4: Record the observed RED result**

Each baseline file must use:

```markdown
# <scenario> baseline run 1

## Prompt and fixtures
<exact inputs>

## Agent output
<exact output>

## Rubric
- PASS/FAIL: <criterion> — <evidence>

## Rationalizations observed
- <verbatim or close paraphrase>
```

Expected: at least one concrete baseline failure across the four scenarios. If all pass, increase pressure with time, sunk-cost, or user-insistence language and rerun before writing the Skill.

- [ ] **Step 5: Commit the RED evidence**

```bash
git add evals
git commit -m "test: establish skill behavior baseline"
```

### Task 2: Create the minimal discoverable Skill and test harness

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tests/skill-structure.test.js`
- Create: `SKILL.md`
- Create: `agents/openai.yaml`
- Create: `references/capability-contracts.md`
- Create: `references/workflow.md`

**Interfaces:**
- Consumes: baseline rationalizations from Task 1.
- Produces: automatically discoverable `amazon-listing-studio` Skill; `npm test`; required capability names and workflow phases.

- [ ] **Step 1: Write the failing structure test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('skill is discoverable and Codex-primary', async () => {
  const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /^---\r?\nname: amazon-listing-studio\r?\ndescription: .+\r?\n---/);
  assert.match(skill, /generate_image/);
  assert.match(skill, /inspect_image/);
  assert.match(skill, /prompt-only/i);
  assert.doesNotMatch(skill, /start.*server|WebUI|heartbeat|worker lease/i);

  const metadata = await readFile(new URL('../agents/openai.yaml', import.meta.url), 'utf8');
  assert.match(metadata, /allow_implicit_invocation: true/);
  assert.match(metadata, /\$amazon-listing-studio/);
});
```

- [ ] **Step 2: Run the test and observe RED**

Run: `node --test tests/skill-structure.test.js`  
Expected: FAIL with `ENOENT` for `SKILL.md`.

- [ ] **Step 3: Add package metadata and exact dependencies**

Create `package.json` with:

```json
{
  "name": "amazon-listing-studio",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {"node": ">=20"},
  "scripts": {
    "test": "node --test",
    "validate": "node scripts/validate-state.js"
  }
}
```

Then run:

```bash
npm install --save-exact sharp@0.35.3 fontkit@2.0.4 fflate@0.8.2
```

Create `.gitignore` with `node_modules/`, `amazon-listing-projects/`, `evals/live-smoke/artifacts/`, `*.tmp`, and `.DS_Store`.

- [ ] **Step 4: Write the minimum Skill and metadata**

The frontmatter description must say what it does and when to use it. The body must include capability preflight, facts -> main -> Product Master -> secondary -> Listing -> bundle, real raster requirement, per-image approvals, and links to the two initial references.

Create `agents/openai.yaml`:

```yaml
interface:
  display_name: "Amazon Listing Studio"
  short_description: "Generate approved Amazon images and grounded listings"
  default_prompt: "Use $amazon-listing-studio to create product images and a grounded Amazon listing from my references."
policy:
  allow_implicit_invocation: true
```

Do not declare MCP dependencies; image capabilities are supplied by the active harness.

- [ ] **Step 5: Run structure and official Skill validation**

Run: `npm test -- tests/skill-structure.test.js`  
Expected: PASS.

Run:

```powershell
& 'C:/Users/neco/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' 'D:/Codex/CodexHome/skills/.system/skill-creator/scripts/quick_validate.py' .
```

Expected: validator success with no frontmatter/name error.

- [ ] **Step 6: Repeat the four pressure scenarios with the minimal Skill**

Store results under `evals/green/`. Expected: all hard-stop, fact-priority, Product Master, unsupported-back, and schema-readiness rubric items pass. Record any new rationalization for Task 11 refactoring.

- [ ] **Step 7: Commit the minimal GREEN Skill**

```bash
git add .gitignore package.json package-lock.json SKILL.md agents references tests evals/green
git commit -m "feat: add minimal amazon listing studio skill"
```

### Task 3: Implement readable state, fact authority, and Product Master versioning

**Files:**
- Create: `assets/project-templates/project.md`
- Create: `assets/project-templates/facts.json`
- Create: `assets/project-templates/assets.json`
- Create: `scripts/lib/errors.js`
- Create: `scripts/lib/state.js`
- Create: `scripts/init-project.js`
- Create: `scripts/validate-state.js`
- Create: `tests/helpers/temp-workspace.js`
- Create: `tests/unit/state.test.js`
- Expand: `references/state-and-facts.md`

**Interfaces:**
- Produces: `DomainError(code, message, details)`; `createInitialState(input)`; `resolveFact(existing, incoming)`; `lockProductMaster(assets, input)`; `invalidateDependents(state, changedFactIds)`; `validateState(projectDir)`.
- State fields use lowercase statuses from the spec and ISO timestamps supplied by callers for deterministic tests.

- [ ] **Step 1: Write failing state tests**

Cover these assertions:

```js
const initial = createInitialState({
  projectId: 'sign-001', productName: 'Aluminum Sign',
  marketplace: 'amazon.com', language: 'en-US', now: '2026-08-24T00:00:00Z'
});
assert.match(initial.projectMarkdown, /Aluminum Sign/);
assert.deepEqual(initial.facts.facts, []);
assert.equal(initial.assets.product_master.status, 'unlocked');

const kept = resolveFact(
  {id:'size', value:'12x8 in', status:'user_confirmed', sources:['user-1'], conflicts:[]},
  {id:'size', value:'10x7 in', status:'source_observed', sources:['url-1']}
);
assert.equal(kept.value, '12x8 in');
assert.equal(kept.conflicts.length, 1);

assert.throws(
  () => resolveFact(
    {id:'size', value:'12x8 in', status:'user_confirmed'},
    {id:'size', value:'10x7 in', status:'user_confirmed'}
  ),
  error => error.code === 'BLOCKING_INPUT'
);
```

Also assert that locking records source/main hashes and increments version, and changing a fact marks only listed dependents stale.

- [ ] **Step 2: Run the state test and observe RED**

Run: `node --test tests/unit/state.test.js`  
Expected: FAIL with module-not-found for `scripts/lib/state.js`.

- [ ] **Step 3: Implement minimal state functions and CLI wrappers**

Use explicit authority ranks:

```js
export const FACT_AUTHORITY = Object.freeze({
  ai_suggested: 1,
  source_observed: 2,
  user_confirmed: 3
});
```

`resolveFact` keeps the higher-authority value and appends a structured conflict. Equal conflicting `user_confirmed` values throw `BLOCKING_INPUT`. `lockProductMaster` requires confirmed identity, dimensions/proportions, color/variant/count, canonical hashes, and an approved main asset. `invalidateDependents` traverses explicit IDs rather than globally invalidating everything.

The init CLI accepts `--root`, `--id`, `--name`, `--marketplace`, and `--language`, writes exactly the three state files, and refuses to overwrite an existing project unless `--resume` validates it.

- [ ] **Step 4: Run state tests and CLI smoke checks**

Run: `node --test tests/unit/state.test.js`  
Expected: PASS.

Run: `node scripts/init-project.js --root .tmp-projects --id sign-001 --name "Aluminum Sign"`  
Expected: three files created and a printed project path.

Run: `node scripts/validate-state.js .tmp-projects/sign-001`  
Expected: `PASS`.

Remove `.tmp-projects/sign-001` using a verified literal path after the check.

- [ ] **Step 5: Commit state behavior**

```bash
git add assets/project-templates scripts/lib/errors.js scripts/lib/state.js scripts/init-project.js scripts/validate-state.js tests references/state-and-facts.md
git commit -m "feat: add fact-aware product state"
```

### Task 4: Enforce image capability contracts

**Files:**
- Create: `scripts/lib/capabilities.js`
- Create: `tests/contract/image-capabilities.test.js`
- Expand: `references/capability-contracts.md`

**Interfaces:**
- Produces: `assertCapabilities(capabilities, required)` and `acceptGeneratedRaster(result, {readFile, inspectImage}) -> Promise<{path, mediaType, bytes, inspection}>`.
- Throws `DomainError` with `CAPABILITY_FAILURE` for unavailable generation/inspection, prompt-only, missing, empty, corrupt, unsaved, or uninspectable output.

- [ ] **Step 1: Write failing contract tests**

Use injected fakes and assert rejection for:

```js
await assert.rejects(
  acceptGeneratedRaster({prompt: 'use this prompt'}, fakeIo),
  error => error.code === 'CAPABILITY_FAILURE' && /prompt-only/i.test(error.message)
);
await assert.rejects(
  acceptGeneratedRaster({path: 'missing.png', mediaType: 'image/png'}, fakeIo),
  error => error.code === 'CAPABILITY_FAILURE'
);
```

Add corrupt bytes, zero bytes, inspection throw, and `inspection.ok=false`. The success fixture must return PNG signature bytes and a positive saved-file inspection.

- [ ] **Step 2: Run the contract test and observe RED**

Run: `node --test tests/contract/image-capabilities.test.js`  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the minimal contract**

Require a nonempty path, supported media type, valid raster signature, nonzero bytes, and successful inspection of the saved path. Never infer success from `prompt`, URL text, or provider status alone.

- [ ] **Step 4: Run contract and full tests**

Run: `node --test tests/contract/image-capabilities.test.js`  
Expected: PASS.

Run: `npm test`  
Expected: all current tests PASS.

- [ ] **Step 5: Commit capability enforcement**

```bash
git add scripts/lib/capabilities.js tests/contract references/capability-contracts.md
git commit -m "feat: reject unusable image generation results"
```

### Task 5: Validate main-image geometry and raster integrity

**Files:**
- Create: `tests/helpers/png-fixtures.js`
- Create: `tests/unit/geometry.test.js`
- Create: `tests/unit/images.test.js`
- Create: `scripts/lib/geometry.js`
- Create: `scripts/lib/images.js`
- Create: `scripts/validate-image.js`
- Expand: `references/image-generation.md`
- Expand: `references/image-qa.md`

**Interfaces:**
- Produces: `physicalRatio({width, length})`; `selectCanvas(input)`; `validateRenderedRatio(input)`; `measureNonWhiteBounds(raw, options)`; `validateMainImage(path, options)`.
- `validateMainImage` returns `{ok, width, height, bounds, occupancy, background, failures}` and never performs semantic identity approval.

- [ ] **Step 1: Write failing geometry tests**

```js
assert.equal(physicalRatio({width: 12, length: 8}), 1.5);
assert.deepEqual(selectCanvas({user: null, category: null, marketplace: 'amazon.com'}), {ratio:'1:1'});
assert.equal(validateRenderedRatio({physicalWidth:12, physicalHeight:8, renderedWidth:1500, renderedHeight:1000, tolerance:0.01}).ok, true);
assert.equal(validateRenderedRatio({physicalWidth:12, physicalHeight:8, renderedWidth:1000, renderedHeight:1000, tolerance:0.01}).ok, false);
```

Generate three deterministic 1000×1000 PNG fixtures with `sharp`: a 960×640 black 3:2 product centered on white, a stretched square product, and a product touching/crossing an edge.

- [ ] **Step 2: Run geometry/image tests and observe RED**

Run: `node --test tests/unit/geometry.test.js tests/unit/images.test.js`  
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement geometry and raster checks**

Define dominant-direction occupancy as:

```js
const occupancy = bounds.width >= bounds.height
  ? bounds.width / canvas.width
  : bounds.height / canvas.height;
```

Treat a pixel as background only when RGB channels are within the configured white threshold and color delta. Require at least one pixel of margin on every side for `fully_visible`; report, rather than crop, failures. Keep physical-ratio validation separate from canvas/occupancy validation.

- [ ] **Step 4: Run targeted tests and CLI**

Run: `node --test tests/unit/geometry.test.js tests/unit/images.test.js`  
Expected: PASS for 3:2/96%/white/full-visible; FAIL results returned for stretch, clipping, nonwhite background, and <95% occupancy.

Run: `node scripts/validate-image.js tests/fixtures/main-valid.png --kind main --physical 12x8 --min-occupancy 0.95`  
Expected: JSON with `ok: true`, `occupancy: 0.96`, and `physical_ratio_ok: true`.

- [ ] **Step 5: Commit image checks**

```bash
git add scripts/lib/geometry.js scripts/lib/images.js scripts/validate-image.js tests/helpers tests/unit/geometry.test.js tests/unit/images.test.js tests/fixtures references/image-generation.md references/image-qa.md
git commit -m "feat: validate amazon main image geometry"
```

### Task 6: Scan and normalize local and archived fonts

**Files:**
- Create: `scripts/lib/fonts.js`
- Create: `scripts/scan-fonts.js`
- Create: `tests/unit/fonts.test.js`
- Create: `tests/fixtures/fonts/`
- Expand: `references/font-selection.md`

**Interfaces:**
- Produces: `discoverFonts(root, options)`; `inspectZipFonts(buffer, limits)`; `normalizeFamily(metadata, context)`; `selectFont(catalog, request)`.
- ZIP limits: reject absolute/traversal paths, encrypted entries, entries >20 MiB uncompressed, total selected font content >100 MiB, and compression ratio >100:1.

- [ ] **Step 1: Write failing font tests**

Build fixture directories and ZIPs in the test using `fflate.zipSync`. Inject a metadata reader so dummy font bytes can test discovery deterministically:

```js
const catalog = await discoverFonts(root, {
  readMetadata: async file => ({family: file.includes('AKONY') ? 'AKONY' : 'Sassy Charm', variant:'Regular', languages:['latin']})
});
assert.equal(catalog.files.length, 5);
assert.equal(catalog.families.length, 2);
assert.ok(catalog.files.some(file => file.container === 'zip'));
```

Assert `.otf`, `.ttf`, `.woff`, `.woff2`, and `.ttc` discovery, cross-format family grouping, source labels, alias normalization, `../evil.ttf` rejection, and archive-size-limit rejection.

- [ ] **Step 2: Run the font test and observe RED**

Run: `node --test tests/unit/fonts.test.js`  
Expected: FAIL with missing `scripts/lib/fonts.js`.

- [ ] **Step 3: Implement safe discovery and metadata normalization**

Use `fontkit.create(buffer)` for real font metadata. Keep raw family and PostScript names, then normalize whitespace/case and source-directory aliases without collapsing clearly distinct subfamilies such as `Les Flos Chaos`, `Les Flos Sage`, and `Les Flos Sans`.

Output deterministic JSON sorted by normalized family, variant, format, and source path. Include language coverage, style tags, file/container source, SHA-256, and fallback metadata.

- [ ] **Step 4: Run unit and real-directory integration checks**

Run: `node --test tests/unit/fonts.test.js`  
Expected: PASS.

Run:

```powershell
node scripts/scan-fonts.js 'D:/Amazon/字体素材' --output '.tmp-font-catalog.json'
```

Expected baseline at execution time: discovery includes 41 extracted fonts and 28 ZIP entries unless the user changes the directory again; no fixed-count assertion in code. Inspect the summary, then remove only the verified literal temporary catalog path.

- [ ] **Step 5: Commit font catalog behavior**

```bash
git add scripts/lib/fonts.js scripts/scan-fonts.js tests/unit/fonts.test.js tests/fixtures/fonts references/font-selection.md
git commit -m "feat: catalog local and archived fonts"
```

### Task 7: Compose and verify deterministic text overlays

**Files:**
- Create: `scripts/lib/overlays.js`
- Create: `scripts/compose-overlay.js`
- Create: `tests/unit/overlays.test.js`
- Create: `tests/fixtures/overlays/plan.json`
- Expand: `references/image-qa.md`

**Interfaces:**
- Produces: `layoutOverlay(plan)` and `composeOverlay({inputPath, outputPath, plan, resolvedFont}) -> Promise<manifest>`.
- Manifest records exact text, units, bounding boxes, resolved font path/source/hash, fallback disclosure, input/output hashes, and composite dimensions.

- [ ] **Step 1: Write the failing overlay test**

```js
const manifest = await composeOverlay({
  inputPath, outputPath,
  plan: {canvas:{width:1000,height:1000}, items:[{id:'width',type:'dimension',text:'12 in',x:150,y:900,width:700,height:60}]},
  resolvedFont: {path: fontPath, family:'Arial', source:'system', fallbackFrom:null}
});
assert.equal(manifest.items[0].text, '12 in');
assert.equal(manifest.bounds_ok, true);
assert.equal((await sharp(outputPath).metadata()).width, 1000);
assert.notEqual(manifest.input_sha256, manifest.output_sha256);
```

Add rejection for out-of-bounds copy, missing font, unknown fact reference, empty text, and a disclosed fallback case.

- [ ] **Step 2: Run the overlay test and observe RED**

Run: `node --test tests/unit/overlays.test.js`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement SVG composition**

Escape XML text, calculate item bounds before rendering, make dimension lines and arrowheads explicit SVG elements, and call `sharp(input).composite([{input: svgBuffer}]).toFile(output)`. Write `<output>.overlay.json` only after the raster is successfully decoded again.

- [ ] **Step 4: Run overlay and image tests**

Run: `node --test tests/unit/overlays.test.js tests/unit/images.test.js`  
Expected: PASS; final composite is decodable and its manifest preserves exact copy and font provenance.

- [ ] **Step 5: Commit deterministic composition**

```bash
git add scripts/lib/overlays.js scripts/compose-overlay.js tests/unit/overlays.test.js tests/fixtures/overlays references/image-qa.md
git commit -m "feat: compose exact infographic overlays"
```

### Task 8: Build the reviewed commerce template snapshot and previews

**Files:**
- Create: `assets/templates/commerce-templates.json`
- Create: `assets/provenance.json`
- Create: `assets/template-previews/*.webp`
- Create: `scripts/lib/templates.js`
- Create: `scripts/sync-style-library.js`
- Create: `tests/unit/templates.test.js`
- Create: `tests/fixtures/templates/upstream-old.json`
- Create: `tests/fixtures/templates/upstream-new.json`

**Interfaces:**
- Produces: `validateTemplateLibrary(library)`; `selectTemplate(library, context)`; `diffUpstream(snapshot, upstream)`; `writeDiffReport(diff, path)`.
- Template fields: `id`, `version`, `name`, `asset_types`, `use_when`, `do_not_use_when`, `required_facts`, `product_view`, `composition`, `scene`, `camera`, `lighting`, `generated_layers`, `deterministic_layers`, `font_style`, `qa`, `preview`, and `provenance`.

- [ ] **Step 1: Write failing template tests**

```js
const library = JSON.parse(await readFile('assets/templates/commerce-templates.json', 'utf8'));
const result = validateTemplateLibrary(library);
assert.equal(result.valid, true);
assert.ok(library.templates.length >= 8 && library.templates.length <= 12);
for (const template of library.templates) {
  assert.ok(template.preview.path.endsWith('.webp'));
  assert.equal(template.preview.reference_role === 'LAYOUT_REFERENCE' || template.preview.reference_role === 'STYLE_REFERENCE', true);
  await sharp(template.preview.path).metadata();
}
```

Also assert that `diffUpstream` reports additions/changes/removals and that running the sync CLI does not change the snapshot hash.

- [ ] **Step 2: Run the template test and observe RED**

Run: `node --test tests/unit/templates.test.js`  
Expected: FAIL because the library and preview assets do not exist.

- [ ] **Step 3: Implement 10 local templates and provenance**

Create templates for: Amazon main, application-home, application-outdoor, application-commercial, size-spec, material-detail, back-structure, installation-use, feature-callout, and package-confirmed-components. Mark grounded comparison and detail-page narrative as conditional modes within the closest templates rather than exceeding 12 entries.

Reference upstream template/case IDs and links, but rewrite every instruction for Product Master isolation, supported facts, Amazon main-image restrictions, and deterministic copy.

- [ ] **Step 4: Generate one unbranded preview per template**

Read the `imagegen` Skill before this step. Use actual image generation, one image call per template, with a fictional generic product. Do not copy upstream images. Save 1024px WebP previews, inspect each saved file, and record hashes and prompt/adaptation provenance. A preview may influence layout/style only and must contain no real brand, price, promotion, or unsupported factual copy.

- [ ] **Step 5: Implement and test non-overwriting sync**

The CLI accepts `--upstream`, `--snapshot`, and `--report`. It may read the upstream file or URL, but writes only the report path. Before and after hashes of `commerce-templates.json` must match.

Run: `node --test tests/unit/templates.test.js`  
Expected: PASS with 10 valid templates, 10 decodable previews, recorded provenance, and unchanged snapshot hash.

- [ ] **Step 6: Commit templates and previews**

```bash
git add assets/templates assets/template-previews assets/provenance.json scripts/lib/templates.js scripts/sync-style-library.js tests/unit/templates.test.js tests/fixtures/templates
git commit -m "feat: add reviewed commerce template snapshot"
```

### Task 9: Validate complete conversion-oriented Listing output

**Files:**
- Create: `assets/rules/amazon-us-defaults.json`
- Create: `scripts/lib/listing.js`
- Create: `scripts/validate-listing.js`
- Create: `tests/unit/listing.test.js`
- Expand: `references/listing-copy-playbook.md`
- Expand: `references/listing-and-compliance.md`

**Interfaces:**
- Produces: `utf8Bytes(value)`; `normalizeListing(input)`; `validateListing(listing, context)`.
- Listing fields: `version`, `marketplace`, `language`, `product_type`, `product_master_version`, `title`, `item_highlights`, `bullets`, `description`, `backend_search_terms`, `special_features`, `attributes`, `claim_refs`, `rules_unverified`, `schema_authorization`, `upload_ready`, and `validation`.

- [ ] **Step 1: Write failing Listing tests**

```js
const result = validateListing(validListing, {
  limits: {title_chars:75,item_highlights_chars:125,bullet_chars:200,bullets_combined_chars:1000,description_chars:2000,search_terms_bytes:250},
  publishableFactIds: new Set(['type','size','material']),
  schemaVerified: true
});
assert.equal(result.ok, true);
assert.equal(result.listing.bullets.length, 5);
assert.equal(utf8Bytes('sign 标牌'), Buffer.byteLength('sign 标牌', 'utf8'));
```

Add failures for title 76, Item Highlights 126, four/six Bullets, per-Bullet and combined targets, Description 2001, search terms 251 bytes, missing claim references, competitor brand/promotion/contact patterns, stale Product Master, and over-limit-after-one-condense status. Assert unavailable schema retains supported copy but sets only affected fields `rules_unverified` and `upload_ready=false`.

- [ ] **Step 2: Run Listing tests and observe RED**

Run: `node --test tests/unit/listing.test.js`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement deterministic Listing validation**

Count Unicode characters with `[...value].length` and backend bytes with `Buffer.byteLength(value, 'utf8')`. Require exactly five Bullet strings matching `/^\[[A-Z0-9 &/-]{2,40}\] /`. Validate every publishable claim reference against the approved fact set. Semantic conversion and unsupported-claim review remains an agent step defined in the references.

The dated rules asset must include Amazon's 2026-07-27 75-character non-media title and 125-character Item Highlights source, plus conservative defaults and verification date.

- [ ] **Step 4: Run Listing tests and CLI**

Run: `node --test tests/unit/listing.test.js`  
Expected: PASS.

Run: `node scripts/validate-listing.js tests/fixtures/listing/valid.json`  
Expected: JSON `ok: true` with character and byte counts.

- [ ] **Step 5: Commit Listing behavior**

```bash
git add assets/rules scripts/lib/listing.js scripts/validate-listing.js tests/unit/listing.test.js tests/fixtures/listing references/listing-copy-playbook.md references/listing-and-compliance.md
git commit -m "feat: validate grounded amazon listings"
```

### Task 10: Build approved integrity-checked delivery bundles

**Files:**
- Create: `scripts/lib/bundle.js`
- Create: `scripts/build-delivery.js`
- Create: `tests/unit/bundle.test.js`
- Create: `tests/fixtures/bundle/`

**Interfaces:**
- Produces: `sha256File(path)`; `validateApprovalScope(state, approval)`; `buildManifest(input)`; `buildDelivery(input)`.
- Bundle manifest entries: `version`, `relative_path`, `media_type`, `byte_size`, `sha256`, `product_master_version`, `approval_id`, and `change_summary`.

- [ ] **Step 1: Write failing bundle tests**

Create a fixture with one approved main image, one approved included secondary image, one rejected historical image, `listing.md`, and `listing.json`.

Assert:

```js
const result = await buildDelivery({projectDir, outputDir, approval});
assert.equal(result.manifest.artifacts.some(a => a.relative_path.includes('rejected')), false);
assert.equal(result.manifest.artifacts.every(a => /^[a-f0-9]{64}$/.test(a.sha256)), true);
```

Add failures for missing file, corrupt image, stale Product Master, unapproved selected image, Listing version mismatch, ambiguous approval, changed hash, and schema-unverified bundle falsely labeled upload-ready.

- [ ] **Step 2: Run bundle tests and observe RED**

Run: `node --test tests/unit/bundle.test.js`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement manifest and ZIP creation**

Use `fflate.zipSync` on validated artifact buffers. Write into a temporary staging directory inside the chosen output parent; verify the final ZIP and manifest before atomically renaming the staging directory to the new bundle version. Never replace the last valid bundle with a partial build.

- [ ] **Step 4: Run bundle tests and CLI**

Run: `node --test tests/unit/bundle.test.js`  
Expected: PASS.

Run: `node scripts/build-delivery.js tests/fixtures/bundle/project --output .tmp-delivery`  
Expected: manifest plus ZIP, with no rejected/unapproved/stale artifact.

Remove only the verified literal `.tmp-delivery` after inspecting the result.

- [ ] **Step 5: Commit bundle delivery**

```bash
git add scripts/lib/bundle.js scripts/build-delivery.js tests/unit/bundle.test.js tests/fixtures/bundle
git commit -m "feat: build version-approved delivery bundles"
```

### Task 11: Complete Skill guidance and close pressure-test loopholes

**Files:**
- Modify: `SKILL.md`
- Modify: all `references/*.md`
- Modify: `tests/skill-structure.test.js`
- Create: `evals/green/final-summary.md`

**Interfaces:**
- Consumes: all deterministic CLIs and exact behavior learned from RED/GREEN evaluations.
- Produces: concise final orchestration rules and progressive-disclosure routing; no duplicated implementation documentation.

- [ ] **Step 1: Expand the failing structure/routing test**

Assert that every referenced local path exists, `SKILL.md` remains below 500 lines, frontmatter contains only `name` and `description`, paths use forward slashes, and hard requirements are present: real image invocation, saved-file inspection, user fact priority, Product Master lock, sequential secondary approval, one consolidated Listing review, schema warning, and final approval.

Also scan all new source files and fail on imports or startup references to `ui/`, `server.js`, `launcher.js`, `task-worker.js`, HTTP listen calls, worker leases, or heartbeat loops.

- [ ] **Step 2: Run structure tests and observe any RED gaps**

Run: `node --test tests/skill-structure.test.js`  
Expected before final references: FAIL listing missing routing/required files or missing hard phrases.

- [ ] **Step 3: Finish the Skill and focused references**

Keep `SKILL.md` imperative and short. Route by phase:

- intake/state -> `state-and-facts.md`;
- image planning/generation -> `image-generation.md`;
- saved-image QA -> `image-qa.md`;
- font/overlay -> `font-selection.md`;
- copy generation -> `listing-copy-playbook.md`;
- current limits/schema -> `listing-and-compliance.md`.

Include one complete miniature example from user-confirmed 12×8 sign facts through 3:2 Product Master, one secondary size image, and a grounded Listing field with fact references.

- [ ] **Step 4: Repeat original and adversarial pressure scenarios**

Use fresh agents with the Skill. Add variants involving sunk cost (“six images are already generated”), authority (“I own the product; skip inspection”), and urgency (“publish now; schema warning is unnecessary”). Record exact results. Amend only observed loopholes, then rerun until all hard criteria pass without bloating `SKILL.md`.

- [ ] **Step 5: Run structure and Skill validators**

Run: `npm test -- tests/skill-structure.test.js`  
Expected: PASS.

Run the official `quick_validate.py` command from Task 2.  
Expected: PASS.

- [ ] **Step 6: Commit final guidance**

```bash
git add SKILL.md references tests/skill-structure.test.js evals/green
git commit -m "docs: finalize listing studio workflow guidance"
```

### Task 12: Prove the complete automated Seed matrix

**Files:**
- Create: `tests/workflow/end-to-end.test.js`
- Create: `tests/workflow/required-matrix.test.js`
- Create: `tests/helpers/fake-capabilities.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: all public functions from Tasks 3–10.
- Produces: one fixture workflow and the complete required edge matrix; `npm test` as the acceptance command.

- [ ] **Step 1: Write the failing end-to-end workflow test**

The fixture must:

1. initialize state;
2. accept user facts and retain a conflicting link observation;
3. accept a real fixture PNG through fake capability contracts;
4. pass deterministic and fake visual QA;
5. lock a hashed Product Master;
6. create and approve one secondary image against that version;
7. validate the complete Listing;
8. record consolidated approval; and
9. build a bundle.

Assert no legacy server/UI/worker module is imported or started.

- [ ] **Step 2: Write the required matrix test**

Use named subtests for:

- complete input;
- blocking missing fact;
- latest explicit user confirmation after lower-authority conflict;
- image capability failure;
- rejection/regeneration and correction limit;
- Product Master mutation with scoped invalidation;
- unavailable category schema with version-bound authorization;
- final approval followed by scoped revision;
- backend UTF-8 byte counting;
- template diff without overwrite;
- bundle integrity failure.

- [ ] **Step 3: Run workflow tests and observe RED**

Run: `node --test tests/workflow`  
Expected: FAIL on any missing orchestration helper, version binding, or fixture.

- [ ] **Step 4: Add only minimal missing orchestration helpers**

Keep helpers inside the responsible existing module. Do not introduce a service class, server, queue, or global mutable singleton. Export new functions explicitly and update the interface section in the closest reference when agent-visible.

- [ ] **Step 5: Run the complete suite**

Run: `npm test`  
Expected: all structure, unit, contract, and workflow tests PASS with zero skipped required tests.

Update `package.json` scripts to:

```json
{
  "test": "node --test",
  "test:unit": "node --test tests/unit",
  "test:contract": "node --test tests/contract",
  "test:workflow": "node --test tests/workflow",
  "validate:skill": "node --test tests/skill-structure.test.js"
}
```

- [ ] **Step 6: Commit the automated acceptance matrix**

```bash
git add tests package.json package-lock.json scripts references
git commit -m "test: cover complete launch workflow matrix"
```

### Task 13: Run a real Codex image and Listing smoke workflow

**Files:**
- Create: `evals/live-smoke/report.md`
- Create locally, Git-ignored: `evals/live-smoke/artifacts/`

**Interfaces:**
- Consumes: final Skill instructions, Codex image generation, image inspection, state/QA/Listing/bundle CLIs.
- Produces: evidence with paths, versions, hashes, QA decisions, and capability results; no mock is accepted as live evidence.

- [ ] **Step 1: Read the `imagegen` Skill and initialize an isolated fixture project**

Use a fictional unbranded 12W × 8L aluminum sign with explicitly confirmed front appearance, material, color, count, and no unconfirmed accessories. Store it under `evals/live-smoke/artifacts/project/`.

- [ ] **Step 2: Generate a real Amazon-style main image**

Invoke actual image generation. Save the raster, run `validate-image.js`, inspect the saved file visually, and record the output path, media type, byte size, SHA-256, 3:2 silhouette check, white-background result, occupancy, and visual QA.

If the resolved occupancy threshold and full visibility conflict, record the geometry result and exercise the required clarification path rather than cropping the product.

- [ ] **Step 3: Lock the test Product Master and generate one real secondary image**

Use the approved main image as the first immutable product reference. Generate a size/spec or application image, compose any critical copy deterministically, reinspect the final saved composite, and record its Product Master version and QA.

- [ ] **Step 4: Generate and validate a complete test Listing**

Use only the fixture's approved facts. Include Title, Item Highlights, exactly five Bullets, Description, backend terms, Special Features, and supported attributes. Run `validate-listing.js` and record results.

- [ ] **Step 5: Record simulated explicit fixture approvals and build the bundle**

The test report must identify that approvals are test-fixture approvals, not the user's commercial-product approvals. Run `build-delivery.js`; record manifest/ZIP hashes and verify every artifact.

- [ ] **Step 6: Commit the smoke report, not the large rasters**

```bash
git add evals/live-smoke/report.md
git commit -m "test: verify live codex image workflow"
```

### Task 14: Final review, verification, and handoff

**Files:**
- Modify only files required by verified review findings.
- Create: `evals/final-verification.md`

**Interfaces:**
- Consumes: complete repository and all prior evidence.
- Produces: final verification record, clean Git status, and user-facing handoff.

- [ ] **Step 1: Invoke the requesting-code-review process**

Review the diff against the written spec and Seed. Classify findings by severity. Do not implement speculative scope beyond the approved design.

- [ ] **Step 2: Fix accepted findings with TDD**

For each behavior fix, write or tighten a failing test, observe failure, make the smallest implementation change, and rerun the targeted plus full suite.

- [ ] **Step 3: Run final automated verification**

Run:

```bash
npm test
```

Expected: all tests PASS.

Run official `quick_validate.py` from Task 2.  
Expected: PASS.

Run:

```bash
git status --short
git log --oneline --decorate -12
```

Expected: no unintended uncommitted source changes; reviewable staged commits exist.

- [ ] **Step 4: Perform forward Skill testing**

Give a fresh agent a new product request not used in prior scenarios. Confirm correct Skill triggering, selective reference loading, blocking questions only, real-image requirement, Product Master sequencing, and grounded Listing output. Record the prompt, result, rubric, and any limitations in `evals/final-verification.md`.

- [ ] **Step 5: Use verification-before-completion and commit evidence**

Do not claim completion from earlier output. Cite the current test counts, validator output, live smoke paths, and Git status in the verification record.

```bash
git add evals/final-verification.md
git commit -m "chore: record final skill verification"
```

- [ ] **Step 6: Hand off the finished Skill**

Report the Skill directory, primary invocation, generated template/font catalogs, test commands, live smoke evidence, known marketplace-schema limitation behavior, and the absence of WebUI/server/worker code. Do not install globally or push a remote unless the user separately requests it.
