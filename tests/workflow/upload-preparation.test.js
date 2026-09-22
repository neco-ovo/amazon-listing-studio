import assert from 'node:assert/strict';
import {access, mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';

import {runCli} from '../../scripts/studio.js';
import {createProjectState} from '../../scripts/lib/project-state.js';
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
  const state = createProjectState({
    projectId: 'slow-kids-pets', marketplace: 'amazon.com', language: 'en-US', productType: 'SIGNAGE'
  });
  state.project.mode = 'single_product';
  state.product_master = {version: 1, status: 'locked', approved_main_id: 'main'};
  state.gallery.plan = [{id: 'main', kind: 'main', status: 'approved'}];
  state.gallery.assets.main = {id: 'main', kind: 'main', status: 'approved', path: 'assets/main.png'};
  state.gallery.selected = ['main'];
  state.listing.approved = [{id: 'listing-v1', version: 1, status: 'approved'}];
  state.approvals.push(approval);
  await mkdir(path.join(projectDir, '.studio'), {recursive: true});
  await writeFile(path.join(projectDir, '.studio', 'state.json'), JSON.stringify(state));
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

test('returns a verified image-only ZIP for the default manual hosting path', async () => {
  const item = await fixture();
  await writeFile(item.inputPath, JSON.stringify({offer: {record_action: 'Create or Replace (Full Update)'}}));
  const result = await runCli(args(item), dependencies(item.manifest));
  assert.equal(result.ok, true);
  assert.equal(result.result.status, 'manual_upload_required');
  assert.deepEqual(result.result.proposed_images.map(image => image.object_key), ['skp-main.png']);
  const imageArchive = unzipSync(await readFile(result.result.image_zip_path));
  assert.deepEqual(Object.keys(imageArchive), ['images/main.png']);
  await assert.rejects(access(path.join(item.projectDir, 'outputs/upload-1')));
});

test('atomically replaces the one current upload workbook', async () => {
  const item = await fixture();
  await writeFile(item.inputPath, JSON.stringify({
    item_type_keyword: 'industrial-warning-signs',
    offer: {record_action: 'Create or Replace (Full Update)'},
    image_urls: {delivery_identity: 'single:final-1:1', images: {'skp-main.png': 'https://img.example/skp-main.png'}}
  }));
  const first = await runCli(args(item), dependencies(item.manifest));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.result.status, 'upload-ready');
  assert.equal(first.result.rows[0].item_type_keyword, 'industrial-warning-signs');
  await access(first.result.workbook_path);
  const saved = JSON.parse(await readFile(first.result.manifest_path, 'utf8'));
  assert.deepEqual(Object.keys(saved.image_urls), ['skp-main.png']);
  const second = await runCli(args(item), dependencies(item.manifest));
  assert.equal(second.ok, true);
  assert.equal(second.result.workbook_path, first.result.workbook_path);
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
  assert.equal(result.result.status, 'manual_upload_required');
  assert.ok(result.result.unresolved.some(item => item.code === 'RULES_CHECK_DEFERRED'));
});

test('writes a non-first upload sheet using moved technical-header columns', async () => {
  const item = await fixture();
  const template = uploadTemplate({
    macro: true,
    leadingInstructionSheet: true,
    technicalHeaders: {
      N: 'item_type_keyword[marketplace_id=ATVPDKIKX0DER]#1.value',
      V: 'main_product_image_locator[marketplace_id=ATVPDKIKX0DER]#1.media_location'
    }
  });
  await writeFile(item.templatePath, template);
  await writeFile(item.inputPath, JSON.stringify({
    item_type_keyword: 'industrial-warning-signs',
    offer: {record_action: 'Create or Replace (Full Update)'},
    image_urls: {delivery_identity: 'single:final-1:1', images: {'skp-main.png': 'https://img.example/skp-main.png'}}
  }));
  const result = await runCli(args(item), dependencies(item.manifest));
  assert.equal(result.ok, true, JSON.stringify(result));
  const before = unzipSync(template);
  const after = unzipSync(await readFile(result.result.workbook_path));
  assert.deepEqual(after['xl/worksheets/sheet1.xml'], before['xl/worksheets/sheet1.xml']);
  const upload = strFromU8(after['xl/worksheets/sheet2.xml']);
  const shared = strFromU8(after['xl/sharedStrings.xml']);
  assert.match(upload, /r="N7"[^>]*t="s"/);
  assert.match(upload, /r="V7"[^>]*t="s"/);
  assert.match(shared, /industrial-warning-signs/);
  assert.match(shared, /https:\/\/img\.example\/skp-main\.png/);
});
