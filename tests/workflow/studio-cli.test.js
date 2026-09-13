import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runCli } from '../../scripts/studio.js';
import {miningHeaders, reverseHeaders, writeSellerSpriteWorkbook} from '../helpers/sellersprite-workbooks.js';
import { withTempWorkspace } from '../helpers/temp-workspace.js';

test('init and validate return stable JSON result shapes', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'sign-1');
    const initialized = await runCli([
      'init', '--project-dir', projectDir, '--project-id', 'sign-1', '--product-name', 'Safety Sign',
      '--marketplace', 'amazon.com', '--language', 'en-US', '--product-type', 'METAL_SIGN'
    ], {clock: () => 100});

    assert.equal(initialized.ok, true);
    assert.equal(initialized.operation, 'init');
    assert.equal(initialized.mode, 'full');
    assert.equal(JSON.parse(await readFile(path.join(projectDir, 'state.json'), 'utf8')).schema_version, 2);

    const validated = await runCli(['validate', '--project-dir', projectDir, '--scope', 'changed'], {clock: () => 200});
    assert.deepEqual(validated.result, {valid: true, errors: []});
  });
});

test('init derives one product directory from a collection root and safe slug', async () => {
  await withTempWorkspace(async root => {
    const projectsRoot = path.join(root, 'amazon-listing-projects');
    const initialized = await runCli([
      'init', '--projects-root', projectsRoot, '--project-id', 'slow-down-kids-pets-at-play-12x16',
      '--product-name', 'Slow Down Kids and Pets at Play Sign', '--product-type', 'METAL_SIGN'
    ]);

    const projectDir = path.join(projectsRoot, 'slow-down-kids-pets-at-play-12x16');
    assert.equal(initialized.ok, true);
    assert.equal(initialized.result.project_dir, projectDir);
    for (const relative of [
      'project.md', 'state.json', 'docs/superpowers/specs', 'docs/superpowers/plans',
      'references', 'images/main', 'images/secondary', 'images/candidates',
      'listing/drafts', 'listing/approved', 'delivery'
    ]) await access(path.join(projectDir, relative));
  });
});

test('init preserves an approved design in a pre-existing product directory', async () => {
  await withTempWorkspace(async root => {
    const projectsRoot = path.join(root, 'amazon-listing-projects');
    const projectDir = path.join(projectsRoot, 'sign-12x16');
    const designPath = path.join(projectDir, 'docs', 'superpowers', 'specs', 'design.md');
    await mkdir(path.dirname(designPath), {recursive: true});
    await writeFile(designPath, '# Approved design\n');

    const initialized = await runCli([
      'init', '--projects-root', projectsRoot, '--project-id', 'sign-12x16',
      '--product-name', 'Safety Sign', '--product-type', 'METAL_SIGN'
    ]);

    assert.equal(initialized.ok, true);
    assert.equal(await readFile(designPath, 'utf8'), '# Approved design\n');
    await access(path.join(projectDir, 'state.json'));
  });
});

test('init rejects unsafe slugs and unexpected files in a pre-existing product directory', async () => {
  await withTempWorkspace(async root => {
    const projectsRoot = path.join(root, 'amazon-listing-projects');
    const common = ['--projects-root', projectsRoot, '--product-name', 'Safety Sign', '--product-type', 'METAL_SIGN'];

    for (const projectId of ['../escape', 'nested/sign', path.resolve(root, 'absolute')]) {
      const result = await runCli(['init', ...common, '--project-id', projectId]);
      assert.equal(result.ok, false, projectId);
      assert.equal(result.code, 'BLOCKING_INPUT', projectId);
    }

    const occupied = path.join(projectsRoot, 'occupied');
    await mkdir(occupied, {recursive: true});
    await writeFile(path.join(occupied, 'unrelated.txt'), 'do not overwrite');
    const result = await runCli(['init', ...common, '--project-id', 'occupied']);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'BLOCKING_INPUT');
    assert.match(result.message, /unexpected|contains/i);
  });
});

test('learn-category stores observations outside a product project', async () => {
  await withTempWorkspace(async root => {
    const inputPath = path.join(root, 'observations.json');
    const libraryDir = path.join(root, 'library');
    await writeFile(inputPath, JSON.stringify({
      observations: {weatherproof: {value: true, source_ids: ['url-1'], observed_at: '2026-08-25T00:00:00.000Z'}},
      market_language: ['jobsite']
    }));

    const result = await runCli([
      'learn-category', '--library-dir', libraryDir, '--marketplace', 'amazon.com',
      '--category-id', 'safety-signs', '--input', inputPath
    ]);

    assert.equal(result.ok, true);
    const saved = JSON.parse(await readFile(path.join(libraryDir, 'categories', 'amazon.com', 'safety-signs.json'), 'utf8'));
    assert.equal(saved.observations.weatherproof.value, true);
  });
});

test('analyze-keywords parses once and writes project and optional reusable profiles', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'sign-1');
    const libraryDir = path.join(root, 'library');
    await runCli([
      'init', '--project-dir', projectDir, '--project-id', 'sign-1', '--product-name', 'Safety Sign',
      '--marketplace', 'amazon.com', '--language', 'en-US', '--product-type', 'metal-sign'
    ]);
    const statePath = path.join(projectDir, 'state.json');
    const stateBefore = await readFile(statePath);
    const approvedImage = path.join(projectDir, 'images', 'main', 'approved.png');
    await writeFile(approvedImage, 'approved-image-bytes');
    const imageBefore = await readFile(approvedImage);
    const reversePath = path.join(root, 'reverse.xlsx');
    const miningPath = path.join(root, 'mining.xlsx');
    await writeSellerSpriteWorkbook(reversePath, {
      headers: reverseHeaders,
      rows: [['slow down kids at play sign', '6.23%', 6, null, 6254, 563, '9%', 13, 7, 2673, 14.5, '$1.84']]
    });
    await writeSellerSpriteWorkbook(miningPath, {
      headers: miningHeaders,
      rows: [['slow down kids at play sign', 100, 6254, 563, '9%', 13, 7, 2673, 14.5, '$1.84']]
    });
    const manifestPath = path.join(root, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      intent: 'slow down kids at play sign',
      sample_scope: 'top_10_sample',
      scope_provenance: 'user_declared',
      reports: [
        {path: reversePath, reference_asin: 'B0FQ1RL7YK'},
        {path: miningPath, seed_query: 'slow down kids at play sign'}
      ],
      fit_assessments: {
        'slow down kids at play sign': {fit: 'exact', reason: 'exact product intent', reason_code: 'direct_match'}
      }
    }));

    const result = await runCli([
      'analyze-keywords', '--project-dir', projectDir, '--input', manifestPath, '--library-dir', libraryDir
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.operation, 'analyze-keywords');
    assert.equal(result.mode, 'full');
    assert.equal(result.result.report_count, 2);
    assert.equal(result.result.analysis_passes, 1);
    assert.equal(result.result.web_research_used, false);
    assert.equal(result.result.market_size_complete, false);
    const projectProfile = JSON.parse(await readFile(path.join(projectDir, 'references', 'keyword-profile.json'), 'utf8'));
    const reusableProfile = JSON.parse(await readFile(result.result.cache_path, 'utf8'));
    assert.deepEqual(reusableProfile.groups, projectProfile.groups);
    assert.deepEqual(await readFile(statePath), stateBefore);
    assert.deepEqual(await readFile(approvedImage), imageBefore);
  });
});

test('analyze-keywords keeps the project profile when optional caching fails', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'sign-1');
    await runCli([
      'init', '--project-dir', projectDir, '--project-id', 'sign-1', '--product-name', 'Safety Sign',
      '--product-type', 'metal-sign'
    ]);
    const miningPath = path.join(root, 'mining.xlsx');
    await writeSellerSpriteWorkbook(miningPath, {
      headers: miningHeaders, rows: [['kids sign', 100, 1000, 90, '9%', 10, 3, 100, 10, '$1']]
    });
    const manifestPath = path.join(root, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      intent: 'kids sign', reports: [{path: miningPath, seed_query: 'kids sign'}],
      fit_assessments: {'kids sign': {fit: 'exact', reason: 'match', reason_code: 'direct_match'}}
    }));
    const result = await runCli([
      'analyze-keywords', '--project-dir', projectDir, '--input', manifestPath,
      '--library-dir', path.join(root, 'library')
    ], {keywordDependencies: {writeCache: async () => { throw new Error('cache unavailable'); }}});
    assert.equal(result.ok, true);
    assert.deepEqual(result.result.warnings, [{code: 'KEYWORD_CACHE_NOT_WRITTEN'}]);
    await access(path.join(projectDir, 'references', 'keyword-profile.json'));
  });
});

test('analyze-keywords rejects unsupported input without creating a profile', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'sign-1');
    await runCli([
      'init', '--project-dir', projectDir, '--project-id', 'sign-1', '--product-name', 'Safety Sign',
      '--product-type', 'metal-sign'
    ]);
    const workbook = path.join(root, 'ordinary.xlsx');
    await writeSellerSpriteWorkbook(workbook, {headers: ['Name', 'Price'], rows: [['Sign', 10]]});
    const manifest = path.join(root, 'manifest.json');
    await writeFile(manifest, JSON.stringify({intent: 'sign', reports: [{path: workbook}], fit_assessments: {}}));
    const result = await runCli(['analyze-keywords', '--project-dir', projectDir, '--input', manifest]);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'UNSUPPORTED_KEYWORD_WORKBOOK');
    await assert.rejects(() => access(path.join(projectDir, 'references', 'keyword-profile.json')));
  });
});

test('unknown commands return a stable error instead of mutating files', async () => {
  const result = await runCli(['unknown-command']);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_COMMAND');
});

test('promote-variation returns stable full-mode CLI output', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'sign-1');
    const themePath = path.join(root, 'theme.json');
    const initialized = await runCli([
      'init', '--project-dir', projectDir, '--project-id', 'sign-1', '--product-name', 'Safety Sign',
      '--marketplace', 'amazon.com', '--language', 'en-US', '--product-type', 'METAL_SIGN'
    ]);
    assert.equal(initialized.ok, true);
    const statePath = path.join(projectDir, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.product_master = {version: 1, status: 'locked', approved_main_id: 'main-v1'};
    state.gallery.plan = [{id: 'main-v1', kind: 'main', status: 'approved'}];
    state.gallery.assets['main-v1'] = {
      id: 'main-v1', kind: 'main', status: 'approved', path: 'images/main/main-v1.png'
    };
    state.gallery.selected = ['main-v1'];
    state.listing.approved = [{id: 'listing-v1', version: 1, status: 'approved'}];
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(themePath, JSON.stringify({
      dimensions: ['size_name'],
      values: {size_name: '12 x 16 in'},
      source: {kind: 'category_schema', id: 'METAL_SIGN', allowed_themes: [['size_name']]},
      verification_status: 'verified'
    }));

    const output = await runCli([
      'promote-variation', '--project-dir', projectDir, '--parent-sku', 'PARENT-1',
      '--child-sku', 'CHILD-1', '--theme', themePath
    ]);

    assert.equal(output.ok, true);
    assert.equal(output.operation, 'promote-variation');
    assert.equal(output.mode, 'full');
    assert.equal(output.result.state.project.mode, 'variation_family');
  });
});

test('finalize routes v2 delivery through the unified CLI', async () => {
  await withTempWorkspace(async root => {
    const approvalPath = path.join(root, 'final-approval.json');
    await writeFile(approvalPath, JSON.stringify({id: 'final-1', finalized: true}));
    let received;
    const result = await runCli([
      'finalize', '--project-dir', root, '--output', path.join(root, 'delivery'), '--approval', approvalPath
    ], {
      buildV2: async input => { received = input; return {zipPath: 'delivery.zip'}; }
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'full');
    assert.equal(received.projectDir, root);
    assert.equal(received.finalApproval.id, 'final-1');
  });
});

test('finalize uses the current stored single-product final approval when --approval is omitted', async () => {
  await withTempWorkspace(async root => {
    const finalApproval = {
      id: 'final-current', type: 'final', finalized: true, project_id: 'sign-1',
      product_master_version: 2, listing_version: 3, artifact_ids: ['main-v2', 'scene-v2'],
      marketplace: 'amazon.com', product_type: 'METAL_SIGN'
    };
    await writeFile(path.join(root, 'state.json'), JSON.stringify({
      schema_version: 2,
      project: {product_id: 'sign-1', marketplace: 'amazon.com', product_type: 'METAL_SIGN'},
      product_master: {version: 2, status: 'locked'},
      gallery: {selected: ['main-v2', 'scene-v2']},
      listing: {approved: [{version: 3, status: 'approved'}]},
      approvals: [
        {...finalApproval, id: 'final-stale', product_master_version: 1},
        finalApproval
      ]
    }));
    let received;

    const result = await runCli([
      'finalize', '--project-dir', root, '--output', path.join(root, 'delivery')
    ], {buildV2: async input => { received = input; return {zipPath: 'delivery.zip'}; }});

    assert.equal(result.ok, true, result.message);
    assert.deepEqual(received.finalApproval, finalApproval);
  });
});

test('finalize rejects ambiguous current single-product final approvals', async () => {
  await withTempWorkspace(async root => {
    const scope = {
      type: 'final', finalized: true, project_id: 'sign-1', product_master_version: 1,
      listing_version: 1, artifact_ids: ['main-v1'], marketplace: 'amazon.com', product_type: 'METAL_SIGN'
    };
    await writeFile(path.join(root, 'state.json'), JSON.stringify({
      schema_version: 2,
      project: {product_id: 'sign-1', marketplace: 'amazon.com', product_type: 'METAL_SIGN'},
      product_master: {version: 1, status: 'locked'},
      gallery: {selected: ['main-v1']},
      listing: {approved: [{version: 1, status: 'approved'}]},
      approvals: [{...scope, id: 'final-a'}, {...scope, id: 'final-b'}]
    }));

    const result = await runCli([
      'finalize', '--project-dir', root, '--output', path.join(root, 'delivery')
    ], {buildV2: async () => ({zipPath: 'must-not-run.zip'})});

    assert.equal(result.ok, false);
    assert.equal(result.code, 'BLOCKING_INPUT');
    assert.match(result.message, /single current immutable final approval/i);
  });
});

test('relative finalize output resolves from the product directory', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'product');
    await mkdir(projectDir);
    const approvalPath = path.join(projectDir, 'final-approval.json');
    await writeFile(approvalPath, JSON.stringify({id: 'final-1', finalized: true}));
    let received;
    const result = await runCli([
      'finalize', '--project-dir', projectDir, '--output', 'delivery/final-v1', '--approval', approvalPath
    ], {buildV2: async input => { received = input; return {zipPath: 'delivery.zip'}; }});

    assert.equal(result.ok, true);
    assert.equal(received.outputDir, path.join(projectDir, 'delivery', 'final-v1'));
  });
});

test('verify-delivery exposes direct archive verification', async () => {
  let received;
  const result = await runCli(['verify-delivery', '--delivery-dir', 'D:/fixture-delivery'], {
    verifyV2: async input => { received = input; return {ok: true, verified_hashes: 7}; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'full');
  assert.equal(received.deliveryDir, path.resolve('D:/fixture-delivery'));
});

test('finalize rejects a delivery output outside the product root', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'product');
    const approvalPath = path.join(projectDir, 'final-approval.json');
    await mkdir(projectDir);
    await writeFile(approvalPath, JSON.stringify({id: 'final-1', finalized: true}));

    const result = await runCli([
      'finalize', '--project-dir', projectDir, '--output', path.join(root, 'outside-delivery'), '--approval', approvalPath
    ], {buildV2: async () => ({zipPath: 'must-not-run.zip'})});

    assert.equal(result.ok, false);
    assert.equal(result.code, 'BLOCKING_INPUT');
    assert.match(result.message, /delivery.+product root|outside.+project/i);
  });
});
