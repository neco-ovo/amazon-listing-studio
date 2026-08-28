import assert from 'node:assert/strict';
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {runCli} from '../../scripts/studio.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

function fact(value) {
  return {value, status: 'user_confirmed', publishable: true, sources: ['merchant'], conflicts: []};
}

test('public CLI promotes one product, adds a sparse compound-theme Child, and prepares scoped outputs', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'sign-family');
    const initialized = await runCli([
      'init', '--project-dir', projectDir, '--project-id', 'sign-family',
      '--product-name', 'Rigid Aluminum Sign', '--product-type', 'METAL_SIGN'
    ]);
    assert.equal(initialized.ok, true);

    const statePath = path.join(projectDir, 'state.json');
    const legacyMainPath = path.join(projectDir, 'images', 'main', 'main-v1.png');
    const legacyBytes = Buffer.from('approved-legacy-main');
    await mkdir(path.dirname(legacyMainPath), {recursive: true});
    await writeFile(legacyMainPath, legacyBytes);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.facts = {
      material: fact('aluminum'),
      color_name: fact('Deer Crossing'),
      size_name: fact('12 x 16 in')
    };
    state.product_master = {version: 1, status: 'locked', approved_main_id: 'main-v1'};
    state.gallery.plan = [{id: 'main-v1', kind: 'main', status: 'approved'}];
    state.gallery.assets['main-v1'] = {
      id: 'main-v1', kind: 'main', status: 'approved', path: 'images/main/main-v1.png'
    };
    state.gallery.selected = ['main-v1'];
    state.listing.approved = [{id: 'listing-v1', version: 1, status: 'approved'}];
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const themePath = path.join(root, 'theme.json');
    await writeFile(themePath, JSON.stringify({
      dimensions: ['color_name', 'size_name'],
      values: {color_name: 'Deer Crossing', size_name: '12 x 16 in'},
      source: {
        kind: 'category_schema', id: 'METAL_SIGN',
        allowed_themes: [['size_name'], ['color_name', 'size_name']]
      },
      verification_status: 'verified'
    }));
    const promoted = await runCli([
      'promote-variation', '--project-dir', projectDir, '--parent-sku', 'SIGN-P',
      '--child-sku', 'SIGN-DEER-12', '--theme', themePath, '--now', '2026-08-28T00:00:00.000Z'
    ]);
    assert.equal(promoted.ok, true);

    const childPath = path.join(root, 'horse-child.json');
    await writeFile(childPath, JSON.stringify({
      sku: 'SIGN-HORSE-16',
      variation_values: {color_name: 'Horse Crossing', size_name: '16 x 20 in'},
      facts: {
        material: fact('aluminum'),
        color_name: fact('Horse Crossing'),
        size_name: fact('16 x 20 in')
      },
      now: '2026-08-28T00:05:00.000Z'
    }));
    const added = await runCli(['add-child', '--project-dir', projectDir, '--input', childPath]);
    assert.equal(added.ok, true);
    assert.equal(added.mode, 'fast');
    const afterAdd = JSON.parse(await readFile(statePath, 'utf8'));
    const untouchedFirstChildListing = structuredClone(afterAdd.variation.children['SIGN-DEER-12'].listing);

    const revisionPath = path.join(root, 'horse-revision.json');
    await writeFile(revisionPath, JSON.stringify({
      sku: 'SIGN-HORSE-16',
      listingPatch: {title: 'Horse Crossing Aluminum Sign 16 x 20 Inch'},
      now: '2026-08-28T00:10:00.000Z'
    }));
    const revised = await runCli(['revise-child', '--project-dir', projectDir, '--input', revisionPath]);
    assert.equal(revised.ok, true);
    assert.equal(revised.mode, 'fast');

    const saved = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(saved.variation.theme.dimensions, ['color_name', 'size_name']);
    assert.deepEqual(Object.keys(saved.variation.children).sort(), ['SIGN-DEER-12', 'SIGN-HORSE-16']);
    assert.deepEqual(saved.variation.children['SIGN-HORSE-16'].variation_values, {
      color_name: 'Horse Crossing', size_name: '16 x 20 in'
    });
    assert.deepEqual(saved.variation.children['SIGN-DEER-12'].listing, untouchedFirstChildListing);
    assert.equal(saved.variation.children['SIGN-HORSE-16'].listing.draft.content.title,
      'Horse Crossing Aluminum Sign 16 x 20 Inch');
    assert.deepEqual(await readFile(legacyMainPath), legacyBytes);
    assert.equal(saved.variation.children['SIGN-DEER-12'].legacy_refs.main_image, 'images/main/main-v1.png');
    for (const relative of [
      'children/SIGN-DEER-12/assets', 'children/SIGN-DEER-12/listing',
      'children/SIGN-HORSE-16/assets', 'children/SIGN-HORSE-16/listing'
    ]) await access(path.join(projectDir, relative));
  });
});
