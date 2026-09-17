import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  assertProjectPath,
  buildProductDocument,
  projectPaths,
  validateProductDocument, writeProjectSnapshot
} from '../../scripts/lib/project-layout.js';
import {mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {withTempWorkspace} from '../helpers/temp-workspace.js';
import {createProjectState} from '../../scripts/lib/project-state.js';

function singleState() {
  return {
    schema_version: 2,
    project: {
      product_id: 'sign-1', marketplace: 'amazon.com', language: 'en-US', product_type: 'aluminum-sign'
    },
    facts: {
      material: {status: 'confirmed', publishable: true, value: 'Aluminum'},
      unknown: {status: 'unknown', publishable: false, value: null}
    },
    gallery: {
      selected: ['main-v1'],
      assets: {
        'main-v1': {id: 'main-v1', kind: 'main', status: 'approved', path: 'assets/main.png'}
      }
    },
    listing: {
      approved: [{status: 'approved', json_path: 'listing/listing.json'}]
    }
  };
}

test('snapshot rollback retains a backup when restoration is blocked', async () => {
  await withTempWorkspace(async root => {
    const state = createProjectState({projectId: 'sign-1', productName: 'Sign', productType: 'METAL_SIGN'});
    await mkdir(path.join(root, '.studio'), {recursive: true});
    await writeFile(path.join(root, '.studio', 'state.json'), 'prior-state');
    let restoreBlocked = false;
    await assert.rejects(writeProjectSnapshot(root, state, {
      operations: {
        rename: async (from, to) => {
          if (from.includes('.tmp-') && to.endsWith('product.json')) throw new Error('injected install failure');
          if (from.includes('.bak-') && to.endsWith('state.json')) {
            restoreBlocked = true;
            throw new Error('locked restore');
          }
          return rename(from, to);
        }
      }
    }));
    assert.equal(restoreBlocked, true);
    const backups = (await readdir(path.join(root, '.studio')))
      .filter(name => name.startsWith('state.json.bak-'));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(root, '.studio', backups[0]), 'utf8'), 'prior-state');
  });
});

function variationDocument() {
  return {
    schema_version: 1,
    product_id: 'sign-family',
    marketplace: 'amazon.com',
    language: 'en-US',
    product_type: 'aluminum-sign',
    facts: {material: 'Aluminum'},
    approved_claims: [],
    excluded_claims: [],
    variation: {
      themes: ['size'],
      children: [{sku: 'SKU-A', values: {size: '8 x 12 in'}, facts: {}}]
    },
    assets: [{role: 'main', scope: 'child', child_sku: 'SKU-A', path: 'assets/children/SKU-A/main.png'}],
    listing: {children: {'SKU-A': 'listing/children/SKU-A/listing.json'}}
  };
}

function sparseVariationState() {
  const fact = value => ({status: 'user_confirmed', publishable: true, value, conflicts: []});
  const child = (sku, color, size) => ({
    sku, active: true, variation_values: {color_name: color, size_name: size},
    facts: {material: fact('Aluminum'), color_name: fact(color), size_name: fact(size)},
    product_master: {status: 'locked', version: 1},
    assets: {[`${sku}-main`]: {id: `${sku}-main`, kind: 'main', status: 'approved', path: `assets/children/${sku}/main.png`}},
    listing: {approved: [{status: 'approved', json_path: `listing/children/${sku}/listing.json`}]}
  });
  return {
    schema_version: 2,
    project: {product_id: 'sign-family', marketplace: 'amazon.com', language: 'en-US', product_type: 'aluminum-sign', mode: 'variation_family'},
    facts: {}, gallery: {selected: [], assets: {}}, listing: {approved: []},
    variation: {
      theme: {dimensions: ['color_name', 'size_name']},
      parent: {listing: {approved: [{status: 'approved', json_path: 'listing/parent/listing.json'}]}},
      children: {
        'YELLOW-8X12': child('YELLOW-8X12', 'Yellow', '8 x 12 in'),
        INACTIVE: {...child('INACTIVE', 'Blue', '8 x 12 in'), active: false},
        'RED-12X16': child('RED-12X16', 'Red', '12 x 16 in')
      },
      shared_assets: {
        material: {id: 'material', kind: 'material', status: 'approved', path: 'assets/shared/material.png', applicable_child_skus: ['YELLOW-8X12', 'RED-12X16']},
        yellow: {id: 'yellow', kind: 'application', status: 'approved', path: 'assets/shared/yellow.png', applicable_child_skus: ['YELLOW-8X12']}
      }
    }
  };
}

test('defines compact paths without creating directories', () => {
  const paths = projectPaths('D:/products/sign');
  assert.equal(paths.state, path.resolve('D:/products/sign/.studio/state.json'));
  assert.equal(paths.product, path.resolve('D:/products/sign/product.json'));
  assert.equal(paths.assets, path.resolve('D:/products/sign/assets'));
});

test('projects only confirmed publishable facts and approved artifacts', () => {
  const document = buildProductDocument(singleState());
  assert.deepEqual(document.facts, {material: 'Aluminum'});
  assert.equal(document.assets[0].path, 'assets/main.png');
  assert.equal(document.listing.product, 'listing/listing.json');
  assert.equal(JSON.stringify(document).includes('sha256'), false);
});

test('rejects duplicate Children and invalid scope references', async () => {
  const document = variationDocument();
  document.variation.children.push(structuredClone(document.variation.children[0]));
  await assert.rejects(validateProductDocument(document), /duplicate Child SKU/i);

  const invalidScope = variationDocument();
  invalidScope.assets[0].child_sku = 'MISSING';
  await assert.rejects(validateProductDocument(invalidScope), /listed active Child/i);
});

test('rejects unsafe and resolved paths outside the project root', async () => {
  assert.throws(() => assertProjectPath('D:/products/sign', '../outside.png'), /escapes the project root/i);
  await assert.rejects(
    validateProductDocument(variationDocument(), {
      projectDir: 'D:/products/sign',
      realpathFile: async value => value === path.resolve('D:/products/sign')
        ? value
        : path.resolve('D:/products/outside.png')
    }),
    /outside the project root/i
  );
});

test('projects only active sparse Children and canonical asset scopes', () => {
  const product = buildProductDocument(sparseVariationState());
  assert.deepEqual(product.variation.children.map(child => child.sku), ['YELLOW-8X12', 'RED-12X16']);
  assert.deepEqual(product.facts, {material: 'Aluminum'});
  assert.deepEqual(product.variation.children.map(child => child.facts), [{}, {}]);
  assert.equal(product.assets.find(asset => asset.path.endsWith('material.png')).scope, 'shared');
  assert.deepEqual(product.assets.find(asset => asset.path.endsWith('yellow.png')), {
    role: 'application', scope: 'child', child_sku: 'YELLOW-8X12', path: 'assets/shared/yellow.png'
  });
  assert.equal(product.assets.some(asset => asset.scope === 'shared' && asset.child_skus), false);
  assert.equal(product.listing.parent, 'listing/parent/listing.json');
  assert.equal(product.listing.children['RED-12X16'], 'listing/children/RED-12X16/listing.json');
});

test('omits only the affected Child scope after targeted invalidation', () => {
  const state = sparseVariationState();
  state.variation.children['YELLOW-8X12'].product_master.status = 'stale';
  state.variation.shared_assets.yellow.status = 'stale';
  const product = buildProductDocument(state);
  assert.equal(product.assets.some(asset => asset.child_sku === 'YELLOW-8X12'), false);
  assert.equal(product.assets.some(asset => asset.child_sku === 'RED-12X16'), true);
  assert.equal(product.assets.some(asset => asset.scope === 'shared'), true);
});
