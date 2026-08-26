import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createProjectState, renderProjectSummary } from '../../scripts/lib/project-state.js';
import { promoteToVariation } from '../../scripts/lib/variation-project.js';
import { withTempWorkspace } from '../helpers/temp-workspace.js';

const now = '2026-08-27T00:00:00.000Z';

async function createCompletedProject(projectDir) {
  const state = createProjectState({
    projectId: 'sign-1',
    productName: 'Safety Sign',
    marketplace: 'amazon.com',
    language: 'en-US',
    productType: 'METAL_SIGN',
    now
  });
  state.project.stage = 'delivered';
  state.facts = {
    size_name: {value: '12 x 16 in', status: 'user_confirmed', publishable: true, sources: ['supplier-1'], conflicts: []},
    material: {value: 'aluminum', status: 'user_confirmed', publishable: true, sources: ['supplier-1'], conflicts: []}
  };
  state.product_master = {version: 2, status: 'locked', approved_main_id: 'main-v1', sha256: 'a'.repeat(64)};
  state.gallery = {
    plan: [{id: 'main-v1', kind: 'main', status: 'approved'}],
    assets: {
      'main-v1': {
        id: 'main-v1', kind: 'main', status: 'approved', path: 'images/main/main-v1.png',
        sha256: 'b'.repeat(64), approval_id: 'approval-main-v1'
      }
    },
    selected: ['main-v1']
  };
  state.listing = {
    draft: null,
    approved: [{id: 'listing-v1', version: 1, path: 'listing/approved/listing-v1.json', sha256: 'c'.repeat(64)}]
  };
  state.approvals = [{id: 'approval-main-v1', type: 'image', sha256: 'b'.repeat(64)}];
  state.delivery = {id: 'delivery-v1', status: 'built', path: 'delivery/v1', manifest_sha256: 'd'.repeat(64)};

  await mkdir(path.join(projectDir, 'images', 'main'), {recursive: true});
  await mkdir(path.join(projectDir, 'listing', 'approved'), {recursive: true});
  await mkdir(path.join(projectDir, 'delivery', 'v1'), {recursive: true});
  await writeFile(path.join(projectDir, 'images', 'main', 'main-v1.png'), Buffer.from('approved-main-image'));
  await writeFile(path.join(projectDir, 'listing', 'approved', 'listing-v1.json'), '{"version":1}\n');
  await writeFile(path.join(projectDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));
  return state;
}

function promotionInput(projectDir) {
  return {
    projectDir,
    parentSku: 'PARENT-1',
    childSku: 'CHILD-1',
    theme: {dimensions: ['size_name'], values: {size_name: '12 x 16 in'}},
    themeSource: {kind: 'category_schema', id: 'METAL_SIGN'},
    now
  };
}

test('promotes a completed project without moving approved legacy files', async () => {
  await withTempWorkspace(async projectDir => {
    const original = await createCompletedProject(projectDir);
    const before = await readFile(path.join(projectDir, 'images', 'main', 'main-v1.png'));

    const result = await promoteToVariation(promotionInput(projectDir));

    assert.equal(result.resumed, false);
    assert.equal(result.state.project.mode, 'variation_family');
    assert.equal(result.state.variation.children['CHILD-1'].legacy_refs.main_image, 'images/main/main-v1.png');
    assert.deepEqual(await readFile(path.join(projectDir, 'images', 'main', 'main-v1.png')), before);
    for (const field of ['facts', 'product_master', 'gallery', 'listing', 'approvals', 'delivery']) {
      assert.deepEqual(result.state[field], original[field], field);
    }
    assert.deepEqual(result.state.variation.children['CHILD-1'].facts, original.facts);
    assert.deepEqual(result.state.variation.children['CHILD-1'].product_master, original.product_master);
    assert.deepEqual(result.state.variation.children['CHILD-1'].listing, original.listing);
    assert.deepEqual(result.state.variation.theme, {
      dimensions: ['size_name'],
      source: {kind: 'category_schema', id: 'METAL_SIGN'},
      verification_status: 'verified'
    });
    assert.deepEqual(result.created, [
      'family/shared-assets', 'parent/listing', 'children/CHILD-1/assets', 'children/CHILD-1/listing'
    ]);
    for (const relative of result.created) {
      assert.equal((await stat(path.join(projectDir, relative))).isDirectory(), true);
    }
  });
});

test('promotion resumes idempotently after directory creation', async () => {
  await withTempWorkspace(async projectDir => {
    await createCompletedProject(projectDir);
    const input = promotionInput(projectDir);
    const promoted = await promoteToVariation(input);
    const persistedBeforeResume = await readFile(path.join(projectDir, 'state.json'));

    const resumed = await promoteToVariation(input);

    assert.equal(resumed.resumed, true);
    assert.deepEqual(resumed.created, []);
    assert.deepEqual(resumed.state, promoted.state);
    assert.deepEqual(await readFile(path.join(projectDir, 'state.json')), persistedBeforeResume);
  });
});

test('promotion rejects stale Parent, first Child, or theme dependencies', async () => {
  await withTempWorkspace(async projectDir => {
    await createCompletedProject(projectDir);
    const input = promotionInput(projectDir);
    await promoteToVariation(input);

    for (const changed of [
      {...input, parentSku: 'PARENT-2'},
      {...input, childSku: 'CHILD-2'},
      {...input, theme: {dimensions: ['size_name'], values: {size_name: '8 x 12 in'}}}
    ]) {
      await assert.rejects(
        promoteToVariation(changed),
        error => error.code === 'STALE_DEPENDENCY'
      );
    }
  });
});

test('promotion requires a verified theme source before creating directories', async () => {
  await withTempWorkspace(async projectDir => {
    await createCompletedProject(projectDir);
    const input = promotionInput(projectDir);

    await assert.rejects(
      promoteToVariation({...input, themeSource: null}),
      error => error.code === 'BLOCKING_INPUT'
    );
    await assert.rejects(stat(path.join(projectDir, 'family')), error => error.code === 'ENOENT');
  });
});
