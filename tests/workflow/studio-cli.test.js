import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
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

test('init derives one product directory from a collection root and safe slug', async () => {
  await withTempWorkspace(async root => {
    const projectsRoot = path.join(root, 'amazon-listing-projects');
    const initialized = await runCli([
      'init', '--projects-root', projectsRoot, '--project-id', 'slow-down-kids-pets-at-play-12x16',
      '--product-name', 'Slow Down Kids and Pets at Play Sign', '--product-type', 'METAL_SIGN'
    ]);

    const projectDir = path.join(projectsRoot, 'slow-down-kids-pets-at-play-12x16');
    assert.equal(initialized.ok, true);
    assert.equal(initialized.result.project_dir, projectDir);
    for (const relative of [
      'project.md', 'state.json', 'docs/superpowers/specs', 'docs/superpowers/plans',
      'references', 'images/main', 'images/secondary', 'images/candidates',
      'listing/drafts', 'listing/approved', 'delivery'
    ]) await access(path.join(projectDir, relative));
  });
});

test('init preserves an approved design in a pre-existing product directory', async () => {
  await withTempWorkspace(async root => {
    const projectsRoot = path.join(root, 'amazon-listing-projects');
    const projectDir = path.join(projectsRoot, 'sign-12x16');
    const designPath = path.join(projectDir, 'docs', 'superpowers', 'specs', 'design.md');
    await mkdir(path.dirname(designPath), {recursive: true});
    await writeFile(designPath, '# Approved design\n');

    const initialized = await runCli([
      'init', '--projects-root', projectsRoot, '--project-id', 'sign-12x16',
      '--product-name', 'Safety Sign', '--product-type', 'METAL_SIGN'
    ]);

    assert.equal(initialized.ok, true);
    assert.equal(await readFile(designPath, 'utf8'), '# Approved design\n');
    await access(path.join(projectDir, 'state.json'));
  });
});

test('init rejects unsafe slugs and unexpected files in a pre-existing product directory', async () => {
  await withTempWorkspace(async root => {
    const projectsRoot = path.join(root, 'amazon-listing-projects');
    const common = ['--projects-root', projectsRoot, '--product-name', 'Safety Sign', '--product-type', 'METAL_SIGN'];

    for (const projectId of ['../escape', 'nested/sign', path.resolve(root, 'absolute')]) {
      const result = await runCli(['init', ...common, '--project-id', projectId]);
      assert.equal(result.ok, false, projectId);
      assert.equal(result.code, 'BLOCKING_INPUT', projectId);
    }

    const occupied = path.join(projectsRoot, 'occupied');
    await mkdir(occupied, {recursive: true});
    await writeFile(path.join(occupied, 'unrelated.txt'), 'do not overwrite');
    const result = await runCli(['init', ...common, '--project-id', 'occupied']);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'BLOCKING_INPUT');
    assert.match(result.message, /unexpected|contains/i);
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

test('finalize routes v2 delivery through the unified CLI', async () => {
  await withTempWorkspace(async root => {
    const approvalPath = path.join(root, 'final-approval.json');
    await writeFile(approvalPath, JSON.stringify({id: 'final-1', finalized: true}));
    let received;
    const result = await runCli([
      'finalize', '--project-dir', root, '--output', path.join(root, 'delivery'), '--approval', approvalPath
    ], {
      buildV2: async input => { received = input; return {zipPath: 'delivery.zip'}; }
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'full');
    assert.equal(received.projectDir, root);
    assert.equal(received.finalApproval.id, 'final-1');
  });
});

test('finalize rejects a delivery output outside the product root', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'product');
    const approvalPath = path.join(projectDir, 'final-approval.json');
    await mkdir(projectDir);
    await writeFile(approvalPath, JSON.stringify({id: 'final-1', finalized: true}));

    const result = await runCli([
      'finalize', '--project-dir', projectDir, '--output', path.join(root, 'outside-delivery'), '--approval', approvalPath
    ], {buildV2: async () => ({zipPath: 'must-not-run.zip'})});

    assert.equal(result.ok, false);
    assert.equal(result.code, 'BLOCKING_INPUT');
    assert.match(result.message, /delivery.+product root|outside.+project/i);
  });
});
