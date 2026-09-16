import assert from 'node:assert/strict';
import {access, mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {strToU8, zipSync} from 'fflate';

import {runCli} from '../../scripts/studio.js';
import {uploadTemplate} from '../helpers/upload-template.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'upload-prep-'));
  const projectDir = path.join(root, 'product');
  const deliveryDir = path.join(projectDir, 'delivery');
  const rulesLibrary = path.join(root, 'rules');
  await mkdir(deliveryDir, {recursive: true});
  await mkdir(rulesLibrary, {recursive: true});
  const approval = {
    id: 'final-1', type: 'final', finalized: true, status: 'approved',
    project_id: 'slow-kids-pets', marketplace: 'amazon.com', product_type: 'SIGNAGE',
    product_master_version: 1, listing_version: 1, artifact_ids: ['main']
  };
  await writeFile(path.join(projectDir, 'state.json'), JSON.stringify({
    schema_version: 2,
    project: {mode: 'single_product', product_id: 'slow-kids-pets', marketplace: 'amazon.com', product_type: 'SIGNAGE'},
    product_master: {version: 1}, gallery: {selected: ['main']},
    listing: {approved: [{version: 1}]}, approvals: [approval]
  }));
  const manifest = {
    approval_id: 'final-1', listing_version: 1, marketplace: 'amazon.com', product_type: 'SIGNAGE',
    artifacts: [{archive_path: 'images/main.png', media_type: 'image/png'}]
  };
  await writeFile(path.join(deliveryDir, 'delivery-manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(deliveryDir, 'delivery.zip'), Buffer.from(zipSync({
    'listing/listing.json': strToU8(JSON.stringify({
      project_id: 'slow-kids-pets', seller_sku: 'SKP-1', title: 'Slow Down Sign', bullets: ['Visible warning']
    })),
    'images/main.png': strToU8('image')
  })));
  const templatePath = path.join(root, 'template.xlsm');
  await writeFile(templatePath, uploadTemplate({macro: true}));
  const inputPath = path.join(root, 'input.json');
  return {root, projectDir, deliveryDir, rulesLibrary, templatePath, inputPath, manifest};
}

const dependencies = manifest => ({
  uploadDependencies: {
    verifySingle: async () => ({ok: true, manifest}),
    verifyVariation: async () => assert.fail('variation verifier should not run'),
    resolveRules: async () => ({status: 'fresh', refresh_required: false, rules: {}})
  }
});

function args(item, output = 'outputs/upload-1') {
  return ['prepare-upload', '--project-dir', item.projectDir, '--delivery-dir', item.deliveryDir,
    '--template', item.templatePath, '--input', item.inputPath, '--output', output,
    '--rules-library', item.rulesLibrary];
}

test('returns one hosting request without creating the output directory', async () => {
  const item = await fixture();
  await writeFile(item.inputPath, JSON.stringify({offer: {record_action: 'Create or Replace (Full Update)'}}));
  const result = await runCli(args(item), dependencies(item.manifest));
  assert.equal(result.ok, true);
  assert.equal(result.result.status, 'hosting_required');
  assert.deepEqual(result.result.proposed_images.map(image => image.object_key), ['skp-main.png']);
  await assert.rejects(access(path.join(item.projectDir, 'outputs/upload-1')));
});

test('writes a preserved workbook once exact hosted URLs arrive and never overwrites it', async () => {
  const item = await fixture();
  await writeFile(item.inputPath, JSON.stringify({
    offer: {record_action: 'Create or Replace (Full Update)'},
    image_urls: {delivery_identity: 'single:final-1:1', images: {'skp-main.png': 'https://img.example/skp-main.png'}}
  }));
  const first = await runCli(args(item), dependencies(item.manifest));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.result.status, 'upload-ready');
  await access(first.result.workbook_path);
  const saved = JSON.parse(await readFile(first.result.manifest_path, 'utf8'));
  assert.deepEqual(Object.keys(saved.image_urls), ['skp-main.png']);
  const second = await runCli(args(item), dependencies(item.manifest));
  assert.equal(second.ok, false);
  assert.equal(second.code, 'OUTPUT_EXISTS');
});

test('unrelated template formulas are diagnostics while mapped formulas block readiness', async () => {
  for (const [range, expected] of [['HZ6:HZ20', 'upload-ready'], ['T6:T20', 'manual-prep']]) {
    const item = await fixture();
    await writeFile(item.templatePath, uploadTemplate({
      macro: true, conditionalRange: range, conditionalFormula: 'INDIRECT("FO"&ROW())="AMAZON_NA"'
    }));
    await writeFile(item.inputPath, JSON.stringify({
      offer: {record_action: 'Create or Replace (Full Update)'},
      image_urls: {delivery_identity: 'single:final-1:1', images: {'skp-main.png': 'https://img.example/skp-main.png'}}
    }));
    const result = await runCli(args(item), dependencies(item.manifest));
    assert.equal(result.result.status, expected, range);
    if (expected === 'upload-ready') {
      assert.equal(result.result.findings.length, 0);
      assert.equal(result.result.diagnostics[0].code, 'UNSUPPORTED_TEMPLATE_CONDITION');
    }
  }
});

test('hosting request defers current-rule resolution', async () => {
  const item = await fixture();
  await writeFile(item.inputPath, JSON.stringify({offer: {record_action: 'Create or Replace (Full Update)'}}));
  const result = await runCli(args(item), {
    uploadDependencies: {
      ...dependencies(item.manifest).uploadDependencies,
      resolveRules: async () => assert.fail('rules must not resolve before hosted URLs exist')
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.status, 'hosting_required');
  assert.ok(result.result.unresolved.some(item => item.code === 'RULES_CHECK_DEFERRED'));
});
