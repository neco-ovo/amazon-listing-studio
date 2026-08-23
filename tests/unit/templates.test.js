import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';

import sharp from 'sharp';

import {
  diffUpstream,
  selectTemplate,
  validateTemplateLibrary,
} from '../../scripts/lib/templates.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const execFileAsync = promisify(execFile);
const snapshotPath = path.resolve('assets/templates/commerce-templates.json');
const provenancePath = path.resolve('assets/provenance.json');
const requiredFields = [
  'id', 'version', 'name', 'asset_types', 'use_when', 'do_not_use_when',
  'required_facts', 'product_view', 'composition', 'scene', 'camera',
  'lighting', 'generated_layers', 'deterministic_layers', 'font_style',
  'qa', 'preview', 'provenance',
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('reviewed library contains ten complete templates and real preview rasters', async () => {
  const library = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  const result = validateTemplateLibrary(library);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(library.templates.length, 10);
  assert.ok(library.templates.length >= 8 && library.templates.length <= 12);
  assert.equal(provenance.previews.length, 10);

  for (const template of library.templates) {
    for (const field of requiredFields) assert.ok(Object.hasOwn(template, field), `${template.id}.${field}`);
    assert.ok(template.preview.path.endsWith('.webp'));
    assert.ok(['LAYOUT_REFERENCE', 'STYLE_REFERENCE'].includes(template.preview.reference_role));
    const previewPath = path.resolve(template.preview.path);
    const bytes = await readFile(previewPath);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 1024);
    assert.equal(metadata.height, 1024);
    assert.equal(template.preview.sha256, sha256(bytes));
    const record = provenance.previews.find(item => item.template_id === template.id);
    assert.equal(record?.sha256, template.preview.sha256);
    assert.ok(record?.final_prompt.includes('fictional generic product'));
  }
});

test('selectTemplate requires facts and respects exclusions', async () => {
  const library = JSON.parse(await readFile(snapshotPath, 'utf8'));
  assert.equal(selectTemplate(library, {
    assetType: 'main',
    factIds: new Set(['identity']),
  }).id, 'amazon-main');
  assert.equal(selectTemplate(library, {
    assetType: 'size-spec',
    factIds: new Set(),
  }), null);
  assert.equal(selectTemplate(library, {
    assetType: 'size-spec',
    factIds: new Set(['dimensions']),
  }).id, 'size-spec');
});

test('diffUpstream reports additions, changes, and removals', async () => {
  const oldLibrary = JSON.parse(await readFile('tests/fixtures/templates/upstream-old.json', 'utf8'));
  const newLibrary = JSON.parse(await readFile('tests/fixtures/templates/upstream-new.json', 'utf8'));
  const diff = diffUpstream(oldLibrary, newLibrary);
  assert.deepEqual(diff.added.map(item => item.id), ['photography-realism']);
  assert.deepEqual(diff.changed.map(item => item.id), ['product-commerce']);
  assert.deepEqual(diff.removed.map(item => item.id), ['technical-breakdown']);
});

test('sync CLI writes only a diff report and never overwrites the reviewed snapshot', async () => {
  await withTempWorkspace(async root => {
    const before = sha256(await readFile(snapshotPath));
    const report = path.join(root, 'style-diff.json');
    await execFileAsync(process.execPath, [
      'scripts/sync-style-library.js',
      '--upstream', 'tests/fixtures/templates/upstream-new.json',
      '--snapshot', snapshotPath,
      '--report', report,
    ]);
    const parsed = JSON.parse(await readFile(report, 'utf8'));
    assert.ok(Array.isArray(parsed.added));
    assert.equal(sha256(await readFile(snapshotPath)), before);
  });
});
