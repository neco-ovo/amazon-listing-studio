import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadMerchantLayouts, selectMerchantLayout } from '../../scripts/lib/merchant-layouts.js';

const libraryPath = path.resolve('assets/merchant-layouts/rigid-aluminum-signs.json');

test('selects one fixed merchant layout for a matching rigid aluminum sign role', async () => {
  const library = await loadMerchantLayouts(libraryPath);
  const selected = selectMerchantLayout(library, {
    familyTraits: {material: 'aluminum', product_form: 'rigid_sign'},
    assetType: 'front_back',
    facts: ['front', 'back', 'aluminum'],
    excludedConditions: []
  });

  assert.equal(selected.id, 'merchant-sign-front-back');
  assert.equal(selected.reuse_policy, 'FIXED_LAYOUT_ALLOWED');
});

test('returns no seed when facts or stable family traits do not fit', async () => {
  const library = await loadMerchantLayouts(libraryPath);
  assert.equal(selectMerchantLayout(library, {
    familyTraits: {material: 'vinyl', product_form: 'decal'},
    assetType: 'front_back',
    facts: ['front'],
    excludedConditions: []
  }), null);
});

test('merchant seed previews are real hashed WebP files', async () => {
  const library = await loadMerchantLayouts(libraryPath);
  assert.equal(library.layouts.length, 4);
  for (const layout of library.layouts) {
    const bytes = await readFile(path.resolve(layout.preview.path));
    assert.equal(bytes.subarray(0, 4).toString('hex'), '52494646');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), layout.preview.sha256);
  }
});
