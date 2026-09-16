import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  assertProjectPath,
  buildProductDocument,
  projectPaths,
  validateProductDocument
} from '../../scripts/lib/project-layout.js';

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
