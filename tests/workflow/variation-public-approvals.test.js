import assert from 'node:assert/strict';
import {access, copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {createProjectState, renderProjectSummary} from '../../scripts/lib/project-state.js';
import {createVariationExtension} from '../../scripts/lib/variations.js';
import {runCli} from '../../scripts/studio.js';
import {createMainImageFixtures} from '../helpers/png-fixtures.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const firstNow = '2026-08-28T01:00:00.000Z';

function fact(value) {
  return {value, status: 'user_confirmed', publishable: true, sources: ['merchant'], conflicts: []};
}

function listing(title, size = null) {
  return {
    title,
    item_highlights: 'Weather-resistant aluminum safety sign.',
    bullets: [{heading: 'CLEAR MESSAGE', body: 'Direct safety message for work areas.'}],
    description: 'A durable aluminum sign for workplace safety messaging.',
    backend_search_terms: 'aluminum workplace safety sign',
    special_features: ['Weather resistant'],
    attributes: {material: 'Aluminum', ...(size ? {size_name: size} : {})},
    claim_refs: {},
    rule_status: 'verified',
    rules_unverified: [],
    upload_ready: true
  };
}

async function writeInput(root, name, value) {
  const filePath = path.join(root, name);
  await writeFile(filePath, JSON.stringify(value));
  return filePath;
}

async function runInput(root, command, projectDir, name, value) {
  const input = await writeInput(root, name, value);
  return runCli([command, '--project-dir', projectDir, '--input', input]);
}

test('public CLI adds a Child, records scoped candidates, approves every Variation scope, and finalizes', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'family');
    await mkdir(projectDir, {recursive: true});
    const state = createProjectState({
      projectId: 'sign-family', productName: 'Safety Sign Family', productType: 'METAL_SIGN', now: firstNow
    });
    state.project.mode = 'variation_family';
    state.variation = createVariationExtension({
      parentSku: 'SIGN-PARENT', dimensions: ['size_name'], firstChildSku: 'SKU-12X16',
      firstChildFacts: {size_name: '12 x 16 in'}, now: firstNow
    });
    state.variation.theme.source = {
      kind: 'category_schema', id: 'METAL_SIGN', allowed_themes: [['size_name']]
    };
    state.variation.theme.verification_status = 'verified';
    state.variation.family_identity = {
      version: 1, status: 'locked', facts: {material: fact('aluminum')}, non_merge_boundaries: []
    };
    state.variation.children['SKU-12X16'].facts = {
      material: fact('aluminum'), size_name: fact('12 x 16 in')
    };
    await mkdir(path.join(projectDir, '.studio'), {recursive: true});
    await writeFile(path.join(projectDir, '.studio', 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));

    const added = await runInput(root, 'add-child', projectDir, 'add-child.json', {
      sku: 'SKU-8X12', variation_values: {size_name: '8 x 12 in'},
      facts: {material: fact('aluminum'), size_name: fact('8 x 12 in')},
      now: '2026-08-28T01:01:00.000Z'
    });
    assert.equal(added.ok, true);

    const fixtures = await createMainImageFixtures(path.join(root, 'fixtures'));
    for (const [relative, source] of [
      ['children/SKU-12X16/assets/main.png', fixtures.valid],
      ['children/SKU-8X12/assets/main.png', fixtures.valid],
      ['family/shared-assets/material.png', fixtures.valid]
    ]) {
      const target = path.join(projectDir, ...relative.split('/'));
      await mkdir(path.dirname(target), {recursive: true});
      await copyFile(source, target);
    }

    for (const [sku, id, relative, minute] of [
      ['SKU-12X16', 'sku-12x16-main', 'children/SKU-12X16/assets/main.png', '02'],
      ['SKU-8X12', 'sku-8x12-main', 'children/SKU-8X12/assets/main.png', '03']
    ]) {
      const recorded = await runInput(root, 'record-variation-candidate', projectDir, `${id}-candidate.json`, {
        scopeType: 'child_main', artifactId: id, childSku: sku, path: relative,
        inspection_status: 'pass', now: `2026-08-28T01:${minute}:00.000Z`
      });
      assert.equal(recorded.ok, true, recorded.message);
      const approved = await runInput(root, 'approve-variation', projectDir, `${id}-approval.json`, {
        scopeType: 'child_main', artifactId: id, childSku: sku, path: relative,
        userAction: 'approved', now: `2026-08-28T01:${Number(minute) + 2}:00.000Z`
      });
      assert.equal(approved.ok, true, approved.message);
    }

    const secondaryRelative = '.studio/work/secondary/sku-12x16-size.png';
    const secondaryTarget = path.join(projectDir, ...secondaryRelative.split('/'));
    await mkdir(path.dirname(secondaryTarget), {recursive: true});
    await copyFile(fixtures.valid, secondaryTarget);
    const secondaryRecorded = await runInput(root, 'record-variation-candidate', projectDir, 'secondary-candidate.json', {
      scopeType: 'child_secondary', artifactId: 'sku-12x16-size', childSku: 'SKU-12X16',
      kind: 'size_spec', path: secondaryRelative, inspection_status: 'pass',
      now: '2026-08-28T01:05:00.000Z'
    });
    assert.equal(secondaryRecorded.ok, true, secondaryRecorded.message);
    const secondaryApproved = await runInput(root, 'approve-variation', projectDir, 'secondary-approval.json', {
      scopeType: 'child_secondary', artifactId: 'sku-12x16-size', childSku: 'SKU-12X16',
      path: secondaryRelative, userAction: 'approved', now: '2026-08-28T01:05:30.000Z'
    });
    assert.equal(secondaryApproved.ok, true, secondaryApproved.message);
    await access(path.join(projectDir, 'assets', 'children', 'SKU-12X16', 'sku-12x16-size.png'));

    const sharedRecorded = await runInput(root, 'record-variation-candidate', projectDir, 'shared-candidate.json', {
      scopeType: 'shared_image', artifactId: 'material-v1', kind: 'secondary',
      path: 'family/shared-assets/material.png', scope: 'shared_asset',
      factDependencies: {material: 'aluminum'}, inspection_status: 'pass',
      now: '2026-08-28T01:06:00.000Z'
    });
    assert.equal(sharedRecorded.ok, true, sharedRecorded.message);
    const sharedApproved = await runInput(root, 'approve-variation', projectDir, 'shared-approval.json', {
      scopeType: 'shared_image', artifactId: 'material-v1',
      childSkus: ['SKU-12X16', 'SKU-8X12'], factDependencies: {material: 'aluminum'},
      path: 'family/shared-assets/material.png', userAction: 'approved',
      now: '2026-08-28T01:07:00.000Z'
    });
    assert.equal(sharedApproved.ok, true, sharedApproved.message);
    await access(path.join(projectDir, 'assets', 'children', 'SKU-12X16', 'main.png'));
    await access(path.join(projectDir, 'assets', 'children', 'SKU-8X12', 'main.png'));
    await access(path.join(projectDir, 'assets', 'shared', 'material-v1.png'));

    const statePathBeforeBatch = path.join(projectDir, '.studio', 'state.json');
    const beforeRejectedBatch = await readFile(statePathBeforeBatch);
    const rejectedBatch = await runInput(root, 'approve-variation-batch', projectDir, 'rejected-batch.json', {
      userAction: 'approved',
      approvals: [
        {scopeType: 'parent_listing', content: listing('Aluminum Safety Sign'), now: '2026-08-28T01:07:30.000Z'},
        {scopeType: 'child_listing', childSku: 'MISSING-SKU', content: listing('Missing Child'), now: '2026-08-28T01:07:31.000Z'}
      ]
    });
    assert.equal(rejectedBatch.ok, false);
    assert.deepEqual(await readFile(statePathBeforeBatch), beforeRejectedBatch);

    const batchApproved = await runInput(root, 'approve-variation-batch', projectDir, 'listing-batch.json', {
      userAction: 'approved',
      approvals: [
        {scopeType: 'parent_listing', content: listing('Aluminum Safety Sign'), now: '2026-08-28T01:08:00.000Z'},
        {scopeType: 'child_listing', childSku: 'SKU-12X16', content: listing('Aluminum Safety Sign 12 x 16 in', '12 x 16 in'), now: '2026-08-28T01:09:00.000Z'},
        {scopeType: 'child_listing', childSku: 'SKU-8X12', content: listing('Aluminum Safety Sign 8 x 12 in', '8 x 12 in'), now: '2026-08-28T01:10:00.000Z'},
        {scopeType: 'variation_final', now: '2026-08-28T01:11:00.000Z'}
      ]
    });
    assert.equal(batchApproved.ok, true, batchApproved.message);
    assert.equal(batchApproved.result.approvals.length, 4);
    await access(path.join(projectDir, 'listing', 'parent', 'listing.json'));
    await access(path.join(projectDir, 'listing', 'children', 'SKU-12X16', 'listing.json'));
    await access(path.join(projectDir, 'listing', 'children', 'SKU-8X12', 'listing.json'));

    const saved = JSON.parse(await readFile(path.join(projectDir, '.studio', 'state.json'), 'utf8'));
    const finalApproval = saved.approvals.at(-1);
    assert.equal(finalApproval.scope_type, 'variation_final');
    assert.equal(finalApproval.asset_map.child_secondary['SKU-12X16'][0].artifact_id, 'sku-12x16-size');
    const finalized = await runCli([
      'finalize', '--project-dir', projectDir, '--output', 'delivery/family-v1'
    ]);
    assert.equal(finalized.ok, true, finalized.message);
    await access(path.join(projectDir, 'delivery', 'delivery.zip'));
  });
});

test('public Variation candidate routing rejects a sibling Child path without mutating state', async () => {
  await withTempWorkspace(async projectDir => {
    const state = createProjectState({projectId: 'sign-family', productType: 'METAL_SIGN', now: firstNow});
    state.project.mode = 'variation_family';
    state.variation = createVariationExtension({
      parentSku: 'SIGN-PARENT', dimensions: ['size_name'], firstChildSku: 'SKU-12X16',
      firstChildFacts: {size_name: '12 x 16 in'}, now: firstNow
    });
    state.variation.theme.source = {kind: 'category_schema', id: 'METAL_SIGN', allowed_themes: [['size_name']]};
    state.variation.theme.verification_status = 'verified';
    state.variation.children['SKU-12X16'].facts.size_name = fact('12 x 16 in');
    await mkdir(path.join(projectDir, '.studio'), {recursive: true});
    await writeFile(path.join(projectDir, '.studio', 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));
    const before = await readFile(path.join(projectDir, '.studio', 'state.json'));
    const input = await writeInput(projectDir, 'bad-candidate.json', {
      scopeType: 'child_main', artifactId: 'wrong-main', childSku: 'SKU-12X16',
      path: 'children/OTHER-SKU/assets/main.png', inspection_status: 'pass'
    });

    const result = await runCli([
      'record-variation-candidate', '--project-dir', projectDir, '--input', input
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'BLOCKING_INPUT');
    assert.deepEqual(await readFile(path.join(projectDir, '.studio', 'state.json')), before);
  });
});

test('Variation approval rejects files changed after scoped candidate inspection without mutating state', async t => {
  for (const scopeType of ['child_main', 'child_secondary', 'shared_image']) {
    await t.test(scopeType, async () => {
      await withTempWorkspace(async root => {
        const projectDir = path.join(root, 'family');
        await mkdir(projectDir, {recursive: true});
        const state = createProjectState({projectId: 'sign-family', productType: 'METAL_SIGN', now: firstNow});
        state.project.mode = 'variation_family';
        state.variation = createVariationExtension({
          parentSku: 'SIGN-PARENT', dimensions: ['size_name'], firstChildSku: 'SKU-12X16',
          firstChildFacts: {size_name: '12 x 16 in'}, now: firstNow
        });
        state.variation.theme.source = {
          kind: 'category_schema', id: 'METAL_SIGN', allowed_themes: [['size_name']]
        };
        state.variation.theme.verification_status = 'verified';
        state.variation.family_identity = {
          version: 1, status: 'locked', facts: {material: fact('aluminum')}, non_merge_boundaries: []
        };
        state.variation.children['SKU-12X16'].facts = {
          material: fact('aluminum'), size_name: fact('12 x 16 in')
        };
        if (scopeType === 'child_secondary') {
          state.variation.children['SKU-12X16'].product_master = {
            version: 1, status: 'locked', approved_main_id: 'sku-12x16-main'
          };
        }
        await mkdir(path.join(projectDir, '.studio'), {recursive: true});
        await writeFile(path.join(projectDir, '.studio', 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
        await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));

        const fixtures = await createMainImageFixtures(path.join(root, 'fixtures'));
        const relative = scopeType === 'child_main'
          ? 'children/SKU-12X16/assets/main.png'
          : scopeType === 'child_secondary'
            ? '.studio/work/secondary/size.png'
            : 'family/shared-assets/material.png';
        const target = path.join(projectDir, ...relative.split('/'));
        await mkdir(path.dirname(target), {recursive: true});
        await copyFile(fixtures.valid, target);
        const artifactId = scopeType === 'child_main' ? 'sku-12x16-main'
          : scopeType === 'child_secondary' ? 'sku-12x16-size' : 'material-v1';
        const scopedFields = scopeType === 'child_main'
          ? {childSku: 'SKU-12X16'}
          : scopeType === 'child_secondary'
            ? {childSku: 'SKU-12X16', kind: 'size_spec'}
            : {kind: 'secondary', scope: 'shared_asset', factDependencies: {material: 'aluminum'}};
        const recorded = await runInput(root, 'record-variation-candidate', projectDir, `${scopeType}-candidate.json`, {
          scopeType, artifactId, path: relative, inspection_status: 'pass', ...scopedFields
        });
        assert.equal(recorded.ok, true, recorded.message);
        assert.match(recorded.result.candidate.candidate_sha256, /^[a-f0-9]{64}$/);

        await writeFile(target, Buffer.from(`changed-after-inspection-${scopeType}`));
        const statePath = path.join(projectDir, '.studio', 'state.json');
        const beforeApproval = await readFile(statePath);
        const approvalFields = ['child_main', 'child_secondary'].includes(scopeType)
          ? {childSku: 'SKU-12X16'}
          : {
              childSkus: ['SKU-12X16'],
              factDependencies: {material: 'aluminum'}
            };
        const approved = await runInput(root, 'approve-variation', projectDir, `${scopeType}-approval.json`, {
          scopeType, artifactId, path: relative, userAction: 'approved', ...approvalFields
        });

        assert.equal(approved.ok, false);
        assert.equal(approved.code, 'BLOCKING_INPUT');
        assert.match(approved.message, /inspected candidate|changed/i);
        assert.deepEqual(await readFile(statePath), beforeApproval);
      });
    });
  }
});

test('shared candidate records from staging and rejects unrelated paths atomically', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'family');
    await mkdir(path.join(projectDir, '.studio'), {recursive: true});
    const state = createProjectState({projectId: 'sign-family', productType: 'METAL_SIGN', now: firstNow});
    state.project.mode = 'variation_family';
    state.variation = createVariationExtension({
      parentSku: 'SIGN-PARENT', dimensions: ['size_name'], firstChildSku: 'SKU-12X16',
      firstChildFacts: {size_name: '12 x 16 in'}, now: firstNow
    });
    state.variation.children['SKU-12X16'].facts.mounting_holes = fact({
      count: 4, placement: 'one at each corner', pre_drilled: true
    });
    const statePath = path.join(projectDir, '.studio', 'state.json');
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));
    const fixtures = await createMainImageFixtures(path.join(root, 'fixtures'));
    const staged = path.join(projectDir, '.studio', 'work', 'secondary', 'mounting-package-v2.png');
    await mkdir(path.dirname(staged), {recursive: true});
    await copyFile(fixtures.valid, staged);

    const recorded = await runInput(root, 'record-variation-candidate', projectDir, 'staged-shared.json', {
      scopeType: 'shared_image', artifactId: 'mounting-package-v2', kind: 'mounting_package',
      path: '.studio/work/secondary/mounting-package-v2.png',
      scope: {type: 'subset_shared', child_skus: ['SKU-12X16']},
      factDependencies: {
        mounting_holes: {count: 4, placement: 'one at each corner', pre_drilled: true}
      },
      inspection_status: 'pass'
    });
    assert.equal(recorded.ok, true, recorded.message);
    assert.deepEqual(recorded.result.candidate.scope, {
      type: 'subset_shared', child_skus: ['SKU-12X16']
    });
    assert.deepEqual(recorded.result.candidate.fact_dependencies.mounting_holes, {
      count: 4, placement: 'one at each corner', pre_drilled: true
    });

    const before = await readFile(statePath);
    const rejected = await runInput(root, 'record-variation-candidate', projectDir, 'bad-shared-path.json', {
      scopeType: 'shared_image', artifactId: 'bad-path', kind: 'secondary',
      path: 'tmp/bad.png', scope: 'shared_asset', factDependencies: {material: 'aluminum'}
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'BLOCKING_INPUT');
    assert.match(rejected.message, /shared image path.+staging or legacy shared-assets directory/i);
    assert.deepEqual(await readFile(statePath), before);
  });
});
