import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {unzipSync, zipSync} from 'fflate';

import {hostImagesR2, mapManualR2Images} from '../../scripts/lib/r2-hosting.js';
import {runCli} from '../../scripts/studio.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r2-hosting-'));
  const deliveryDir = path.join(root, 'delivery');
  const inputPath = path.join(root, 'upload-input.json');
  const input = {item_type_keyword: 'speed-limit-signs', offers: {SKU1: {price: 12.99}}};
  await writeFile(inputPath, `${JSON.stringify(input)}\n`);
  const archiveBytes = Buffer.from(zipSync({
    'children/SKU1/images/demo-main.png': new Uint8Array([137, 80, 78, 71]),
    'children/SKU1/images/demo-size.png': new Uint8Array([137, 80, 78, 71])
  }));
  const delivery = {
    delivery_identity: 'variation:approval-1:1',
    manifest: {delivery_kind: 'variation'},
    matrix: {parent_sku: 'PARENT', children: [{child_sku: 'SKU1', parent_sku: 'PARENT', variation_values: {}, asset_paths: []}]},
    listings: {parent: {}, children: {SKU1: {seller_sku: 'SKU1'}}},
    image_slots: {SKU1: [
      {source: 'children/SKU1/images/demo-main.png', media_type: 'image/png', role: 'main', slot_id: 'main'},
      {source: 'children/SKU1/images/demo-size.png', media_type: 'image/png', role: 'size', slot_id: 'size'}
    ]}
  };
  return {root, deliveryDir, inputPath, input, archiveBytes, delivery};
}

test('uploads verified delivery images and merges URLs into the existing upload input', async () => {
  const sample = await fixture();
  const heads = new Map();
  const uploads = [];
  const result = await hostImagesR2({
    projectDir: sample.root,
    deliveryDir: sample.deliveryDir,
    inputPath: sample.inputPath,
    bucket: 'amazon-listing-images',
    publicBaseUrl: 'https://images.example.com/catalog/'
  }, {
    readDelivery: async () => sample.delivery,
    readArchive: async () => sample.archiveBytes,
    checkWrangler: async () => true,
    headUrl: async url => heads.get(url) ?? {status: 404, contentType: null},
    putObject: async upload => {
      uploads.push(upload);
      heads.set(upload.url, {status: 200, contentType: 'image/png'});
    }
  });

  assert.equal(result.status, 'hosted');
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(item => item.bucket === 'amazon-listing-images' && item.contentType === 'image/png'));
  const hosted = JSON.parse(await readFile(result.input_path, 'utf8'));
  assert.equal(hosted.item_type_keyword, sample.input.item_type_keyword);
  assert.deepEqual(hosted.offers, sample.input.offers);
  assert.equal(hosted.image_urls.delivery_identity, sample.delivery.delivery_identity);
  assert.deepEqual(Object.keys(hosted.image_urls.images).sort(), ['demo-main.png', 'demo-size.png']);
});

test('preflights the full batch and stops before upload when an object already exists', async () => {
  const sample = await fixture();
  let uploads = 0;
  await assert.rejects(() => hostImagesR2({
    projectDir: sample.root,
    deliveryDir: sample.deliveryDir,
    inputPath: sample.inputPath,
    bucket: 'amazon-listing-images',
    publicBaseUrl: 'https://images.example.com'
  }, {
    readDelivery: async () => sample.delivery,
    readArchive: async () => sample.archiveBytes,
    checkWrangler: async () => true,
    headUrl: async url => ({status: url.endsWith('demo-size.png') ? 200 : 404, contentType: 'image/png'}),
    putObject: async () => { uploads += 1; }
  }), error => error.code === 'R2_OBJECT_COLLISION');
  assert.equal(uploads, 0);
});

test('resumes only receipt-bound objects that remain publicly reachable', async () => {
  const sample = await fixture();
  let firstUploads = 0;
  const heads = new Map();
  await assert.rejects(() => hostImagesR2({
    projectDir: sample.root,
    deliveryDir: sample.deliveryDir,
    inputPath: sample.inputPath,
    bucket: 'amazon-listing-images',
    publicBaseUrl: 'https://images.example.com'
  }, {
    readDelivery: async () => sample.delivery,
    readArchive: async () => sample.archiveBytes,
    checkWrangler: async () => true,
    headUrl: async url => heads.get(url) ?? {status: 404, contentType: null},
    putObject: async upload => {
      firstUploads += 1;
      if (firstUploads === 2) throw Object.assign(new Error('network'), {code: 'NETWORK'});
      heads.set(upload.url, {status: 200, contentType: 'image/png'});
    }
  }), error => error.code === 'R2_UPLOAD_FAILED');

  let resumedUploads = 0;
  const result = await hostImagesR2({
    projectDir: sample.root,
    deliveryDir: sample.deliveryDir,
    inputPath: sample.inputPath,
    bucket: 'amazon-listing-images',
    publicBaseUrl: 'https://images.example.com'
  }, {
    readDelivery: async () => sample.delivery,
    readArchive: async () => sample.archiveBytes,
    checkWrangler: async () => true,
    headUrl: async url => heads.get(url) ?? {status: 404, contentType: null},
    putObject: async upload => {
      resumedUploads += 1;
      heads.set(upload.url, {status: 200, contentType: 'image/png'});
    }
  });
  assert.equal(result.status, 'hosted');
  assert.equal(resumedUploads, 1);
});

test('routes host-images-r2 through the existing verified delivery boundary', async () => {
  const calls = [];
  const result = await runCli([
    'host-images-r2',
    '--project-dir', 'D:/project',
    '--input', 'D:/input.json',
    '--bucket', 'amazon-listing-images',
    '--public-base-url', 'https://images.example.com'
  ], {
    r2Dependencies: {
      hostImages: async input => {
        calls.push(input);
        return {status: 'hosted'};
      },
      readState: async () => ({schema_version: 2, project: {mode: 'single_product'}, gallery: {selected: ['main']}, listing: {approved: [{version: 1}]}, product_master: {version: 1}, approvals: [{type: 'final', finalized: true, project_id: undefined, product_master_version: 1, listing_version: 1, artifact_ids: ['main']}]}),
      readDelivery: async () => ({delivery_identity: 'single:approval-1:1'})
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.operation, 'host-images-r2');
  assert.equal(calls[0].bucket, 'amazon-listing-images');
});

test('maps a user-uploaded prefix from verified source paths without listing the bucket', async () => {
  const sample = await fixture();
  const checked = [];
  const result = await mapManualR2Images({
    deliveryDir: sample.deliveryDir,
    inputPath: sample.inputPath,
    publicBaseUrl: 'https://images.example.com',
    prefix: 'SPEED LIMIT SIGN'
  }, {
    readDelivery: async () => sample.delivery,
    headUrl: async url => {
      checked.push(url);
      return {status: 200, contentType: 'image/png'};
    }
  });
  const hosted = JSON.parse(await readFile(result.input_path, 'utf8'));
  assert.equal(checked[0], 'https://images.example.com/SPEED%20LIMIT%20SIGN/children/SKU1/images/demo-main.png');
  assert.equal(hosted.image_urls.images['demo-main.png'], checked[0]);
  assert.equal(hosted.item_type_keyword, sample.input.item_type_keyword);
});

test('falls back to the image ZIP before network work when Wrangler is unavailable', async () => {
  const sample = await fixture();
  let networkCalls = 0;
  const imageZipPath = path.join(sample.deliveryDir, 'product-images.zip');
  const result = await hostImagesR2({
    projectDir: sample.root,
    deliveryDir: sample.deliveryDir,
    inputPath: sample.inputPath,
    bucket: 'amazon-listing-images',
    publicBaseUrl: 'https://images.example.com',
    imageZipPath
  }, {
    readDelivery: async () => sample.delivery,
    readArchive: async () => sample.archiveBytes,
    checkWrangler: async () => false,
    headUrl: async () => { networkCalls += 1; },
    putObject: async () => { networkCalls += 1; }
  });
  assert.equal(result.status, 'manual_upload_required');
  assert.equal(result.image_zip_path, imageZipPath);
  assert.equal(networkCalls, 0);
  assert.deepEqual(Object.keys(unzipSync(await readFile(imageZipPath))).sort(), [
    'children/SKU1/images/demo-main.png', 'children/SKU1/images/demo-size.png'
  ]);
});

test('routes manual R2 mapping through the same verified delivery boundary', async () => {
  const calls = [];
  const result = await runCli([
    'map-r2-images', '--project-dir', 'D:/project', '--input', 'D:/input.json',
    '--public-base-url', 'https://images.example.com', '--prefix', 'SPEED LIMIT SIGN'
  ], {
    r2Dependencies: {
      mapImages: async input => { calls.push(input); return {status: 'hosted'}; },
      readState: async () => ({schema_version: 2, project: {mode: 'single_product'}, gallery: {selected: ['main']}, listing: {approved: [{version: 1}]}, product_master: {version: 1}, approvals: [{type: 'final', finalized: true, project_id: undefined, product_master_version: 1, listing_version: 1, artifact_ids: ['main']}]}),
      readDelivery: async () => ({delivery_identity: 'single:approval-1:1'})
    }
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].prefix, 'SPEED LIMIT SIGN');
});
