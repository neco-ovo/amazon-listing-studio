import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runCli } from '../../scripts/studio.js';
import { withTempWorkspace } from '../helpers/temp-workspace.js';

test('init and validate return stable JSON result shapes', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'sign-1');
    const initialized = await runCli([
      'init', '--project-dir', projectDir, '--project-id', 'sign-1', '--product-name', 'Safety Sign',
      '--marketplace', 'amazon.com', '--language', 'en-US', '--product-type', 'METAL_SIGN'
    ], {clock: () => 100});

    assert.equal(initialized.ok, true);
    assert.equal(initialized.operation, 'init');
    assert.equal(initialized.mode, 'full');
    assert.equal(JSON.parse(await readFile(path.join(projectDir, 'state.json'), 'utf8')).schema_version, 2);

    const validated = await runCli(['validate', '--project-dir', projectDir, '--scope', 'changed'], {clock: () => 200});
    assert.deepEqual(validated.result, {valid: true, errors: []});
  });
});

test('learn-category stores observations outside a product project', async () => {
  await withTempWorkspace(async root => {
    const inputPath = path.join(root, 'observations.json');
    const libraryDir = path.join(root, 'library');
    await writeFile(inputPath, JSON.stringify({
      observations: {weatherproof: {value: true, source_ids: ['url-1'], observed_at: '2026-08-25T00:00:00.000Z'}},
      market_language: ['jobsite']
    }));

    const result = await runCli([
      'learn-category', '--library-dir', libraryDir, '--marketplace', 'amazon.com',
      '--category-id', 'safety-signs', '--input', inputPath
    ]);

    assert.equal(result.ok, true);
    const saved = JSON.parse(await readFile(path.join(libraryDir, 'categories', 'amazon.com', 'safety-signs.json'), 'utf8'));
    assert.equal(saved.observations.weatherproof.value, true);
  });
});

test('unknown commands return a stable error instead of mutating files', async () => {
  const result = await runCli(['unknown-command']);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_COMMAND');
});
