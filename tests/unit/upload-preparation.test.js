import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {zipSync} from 'fflate';

import {
  attachHostedUrls,
  projectUploadPreparation,
  readVerifiedDelivery,
  validateRelationshipNamespaces
} from '../../scripts/lib/upload-preparation.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const manifest = {
  schema_version: 1,
  delivery_kind: 'variation',
  approval_id: 'final-v2',
  variation_version: 2,
  project_id: 'slow-down-kids-pets',
  marketplace: 'amazon.com',
  product_type: 'DECORATIVE_SIGNAGE',
  approval_scope: {
    child_variations: [{child_sku: 'RWB-8X12', variation_values: {Color: 'Red White Blue', Size: '8 x 12 in'}}]
  },
  delivery_scope: {child_skus: ['RWB-8X12']},
  artifacts: []
};

const matrix = {
  schema_version: 1,
  parent_sku: 'PARENT',
  theme_dimensions: ['Color', 'Size'],
  children: [{
    parent_sku: 'PARENT',
    child_sku: 'RWB-8X12',
    variation_values: {Color: 'Red White Blue', Size: '8 x 12 in'},
    asset_paths: [
      'children/RWB-8X12/skp-rwb-8x12-main.png',
      'children/RWB-8X12/secondary/skp-rwb-8x12-scene.png',
      'children/RWB-8X12/secondary/skp-rwb-8x12-scene-2.png'
    ]
  }]
};

function listing(title = 'Delivered title') {
  return {
    version: 3,
    project_id: 'slow-down-kids-pets',
    marketplace: 'amazon.com',
    product_type: 'DECORATIVE_SIGNAGE',
    child_sku: 'RWB-8X12',
    parent_sku: 'PARENT',
    title
  };
}

async function variationDelivery(root) {
  const deliveryDir = path.join(root, 'delivery');
  await mkdir(deliveryDir);
  await writeFile(path.join(deliveryDir, 'delivery-manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(deliveryDir, 'delivery.zip'), Buffer.from(zipSync({
    'variation-matrix.json': Buffer.from(JSON.stringify(matrix)),
    'parent/listing.json': Buffer.from(JSON.stringify({...listing('Parent title'), parent_sku: 'PARENT', child_sku: undefined})),
    'children/RWB-8X12/listing.json': Buffer.from(JSON.stringify(listing())),
    'children/RWB-8X12/skp-rwb-8x12-main.png': Buffer.from('main'),
    'children/RWB-8X12/secondary/skp-rwb-8x12-scene.png': Buffer.from('scene'),
    'children/RWB-8X12/secondary/skp-rwb-8x12-scene-2.png': Buffer.from('scene2')
  })));
  return deliveryDir;
}

test('reads Listing rows from the verified delivery instead of mutable project state', async () => {
  await withTempWorkspace(async root => {
    const deliveryDir = await variationDelivery(root);
    const delivery = await readVerifiedDelivery({
      deliveryDir,
      expectedScope: {id: 'final-v2'},
      verifyVariation: async () => ({ok: true, manifest, matrix}),
      verifySingle: async () => assert.fail('single verifier should not run')
    });
    assert.equal(delivery.listings.children['RWB-8X12'].title, 'Delivered title');
    assert.equal(delivery.delivery_identity, 'variation:final-v2:2');
    assert.equal(JSON.parse(await readFile(path.join(deliveryDir, 'delivery-manifest.json'), 'utf8')).approval_id, 'final-v2');
  });
});

test('parses the exact delivery bytes supplied to verification', async () => {
  await withTempWorkspace(async root => {
    const deliveryDir = await variationDelivery(root);
    const delivery = await readVerifiedDelivery({
      deliveryDir,
      expectedScope: {id: 'final-v2'},
      verifyVariation: async ({manifestBytes, archiveBytes}) => {
        assert.ok(Buffer.isBuffer(manifestBytes));
        assert.ok(Buffer.isBuffer(archiveBytes));
        await writeFile(path.join(deliveryDir, 'delivery.zip'), 'replaced after verification started');
        return {ok: true, manifest, matrix};
      },
      verifySingle: async () => assert.fail('single verifier should not run')
    });
    assert.equal(delivery.listings.children['RWB-8X12'].title, 'Delivered title');
  });
});

test('projects repeated gallery roles with stable unique delivered object keys', async () => {
  await withTempWorkspace(async root => {
    const deliveryDir = await variationDelivery(root);
    const delivery = await readVerifiedDelivery({
      deliveryDir,
      expectedScope: {id: 'final-v2'},
      verifyVariation: async () => ({ok: true, manifest, matrix}),
      verifySingle: async () => assert.fail('single verifier should not run')
    });
    const result = projectUploadPreparation({delivery, input: {}});
    assert.deepEqual(result.proposed_images.map(item => item.object_key), [
      'skp-rwb-8x12-main.png',
      'skp-rwb-8x12-scene.png',
      'skp-rwb-8x12-scene-2.png'
    ]);
    assert.deepEqual(result.rows[1].gallery_slots.map(item => item.slot_id), ['main', 'scene-1', 'scene-2']);
  });
});

test('projects one sellable row and immutable identity for a single delivery', () => {
  const delivery = {
    delivery_identity: 'single:final-3:3',
    manifest: {approval_id: 'final-3', listing_version: 3, approval_scope: {}},
    listings: {single: listing()},
    image_slots: [{source: 'images/main.png', media_type: 'image/png'}]
  };
  const result = projectUploadPreparation({delivery, input: {}});
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].relationship, undefined);
  assert.equal(result.delivery_identity, 'single:final-3:3');
  assert.equal(result.proposed_images[0].object_key, 'sdkp-main.png');
});

test('accepts only HTTPS URL mappings for the exact current key set', () => {
  const projection = {
    delivery_identity: 'single:final-3:3',
    proposed_images: [{object_key: 'sdkp-main.png'}]
  };
  assert.throws(() => attachHostedUrls(projection, {
    delivery_identity: 'single:final-2:2', images: {'sdkp-main.png': 'https://img.example/main.png'}
  }), /delivery identity/i);
  assert.throws(() => attachHostedUrls(projection, {
    delivery_identity: projection.delivery_identity, images: {}
  }), /exact proposed object keys/i);
  assert.throws(() => attachHostedUrls(projection, {
    delivery_identity: projection.delivery_identity,
    images: {'sdkp-main.png': 'https://img.example/main.png', 'extra.png': 'https://img.example/extra.png'}
  }), /exact proposed object keys/i);
  assert.throws(() => attachHostedUrls(projection, {
    delivery_identity: projection.delivery_identity, images: {'sdkp-main.png': 'http://img.example/main.png'}
  }), /HTTPS/i);
  assert.equal(attachHostedUrls(projection, {
    delivery_identity: projection.delivery_identity, images: {'sdkp-main.png': 'https://img.example/main.png'}
  }).proposed_images[0].url, 'https://img.example/main.png');
});

test('rejects package fields on a Variation row but permits a distinct bundle row', () => {
  assert.equal(validateRelationshipNamespaces([{
    seller_sku: 'CHILD-8X12', parentage_level: 'Child', package_contains_sku: 'CHILD-8X12'
  }])[0].code, 'RELATIONSHIP_CONFLICT');
  assert.deepEqual(validateRelationshipNamespaces([{
    seller_sku: 'BUNDLE-1', package_contains_sku: 'CHILD-8X12'
  }]), []);
});
