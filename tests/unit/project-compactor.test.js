import test from 'node:test';
import assert from 'node:assert/strict';
import {access, mkdir, readFile, readdir, rename, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {compactProject} from '../../scripts/lib/project-compactor.js';
import {createProjectState} from '../../scripts/lib/project-state.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

async function tree(root, current = '') {
  const target = path.join(root, current);
  const entries = await readdir(target, {withFileTypes: true});
  const result = {};
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(current, entry.name);
    result[relative] = entry.isDirectory() ? 'directory' : await readFile(path.join(root, relative), 'utf8');
    if (entry.isDirectory()) Object.assign(result, await tree(root, relative));
  }
  return result;
}

async function legacyProject(root) {
  const projectDir = path.join(root, 'legacy-sign');
  const state = createProjectState({
    projectId: 'legacy-sign', productName: 'Legacy Sign', marketplace: 'amazon.com',
    language: 'en-US', productType: 'METAL_SIGN'
  });
  await mkdir(path.join(projectDir, 'images'), {recursive: true});
  await writeFile(path.join(projectDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(path.join(projectDir, 'custom-tool.mjs'), 'user code');
  await writeFile(path.join(projectDir, 'images', 'candidate.png'), 'candidate');
  return projectDir;
}

test('dry-run reports changes without changing project bytes', async () => {
  await withTempWorkspace(async root => {
    const projectDir = await legacyProject(root);
    const before = await tree(projectDir);
    const report = await compactProject(projectDir, {apply: false});
    assert.equal(report.applied, false);
    assert.ok(report.preserved.includes('custom-tool.mjs'));
    assert.deepEqual(await tree(projectDir), before);
  });
});

test('apply preserves unknown files under .studio/legacy', async () => {
  await withTempWorkspace(async root => {
    const projectDir = await legacyProject(root);
    const report = await compactProject(projectDir, {apply: true});
    assert.equal(report.applied, true);
    assert.equal(await readFile(path.join(projectDir, '.studio', 'legacy', 'custom-tool.mjs'), 'utf8'), 'user code');
    await access(path.join(projectDir, '.studio', 'state.json'));
    await access(path.join(projectDir, 'product.json'));
    await assert.rejects(access(path.join(projectDir, 'state.json')), error => error.code === 'ENOENT');
  });
});

test('preserves unknown files inside old generated-looking directories', async () => {
  await withTempWorkspace(async root => {
    const projectDir = await legacyProject(root);
    await mkdir(path.join(projectDir, 'outputs'), {recursive: true});
    await writeFile(path.join(projectDir, 'outputs', 'seller-note.txt'), 'keep me');
    await compactProject(projectDir, {apply: true});
    assert.equal(
      await readFile(path.join(projectDir, '.studio', 'legacy', 'outputs', 'seller-note.txt'), 'utf8'),
      'keep me'
    );
  });
});

test('migrates and validates the approved Listing JSON and Markdown pair', async () => {
  await withTempWorkspace(async root => {
    const projectDir = await legacyProject(root);
    const statePath = path.join(projectDir, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const content = {title: 'Direct title'};
    const json = `${JSON.stringify(content, null, 2)}\n`;
    const markdown = '# Direct title\n';
    state.listing.approved = [{
      status: 'approved', content,
      json_path: 'listing/approved.json', markdown_path: 'listing/approved.md'
    }];
    await mkdir(path.join(projectDir, 'listing'));
    await writeFile(path.join(projectDir, 'listing', 'approved.json'), json);
    await writeFile(path.join(projectDir, 'listing', 'approved.md'), markdown);
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await compactProject(projectDir, {apply: true});
    assert.deepEqual(JSON.parse(await readFile(path.join(projectDir, 'listing', 'listing.json'), 'utf8')), content);
    assert.equal(await readFile(path.join(projectDir, 'listing', 'listing.md'), 'utf8'), markdown);
  });
});

test('keeps historical Listings in legacy without validating them as current', async () => {
  await withTempWorkspace(async root => {
    const projectDir = await legacyProject(root);
    const statePath = path.join(projectDir, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.listing.approved = [
      {status: 'approved', json_path: 'listing/v1.json', markdown_path: 'listing/v1.md'},
      {status: 'approved', json_path: 'listing/v2.json', markdown_path: 'listing/v2.md'}
    ];
    await mkdir(path.join(projectDir, 'listing'));
    await writeFile(path.join(projectDir, 'listing', 'v1.json'), '{"title":"Old"}\n');
    await writeFile(path.join(projectDir, 'listing', 'v1.md'), '# Old\n');
    await writeFile(path.join(projectDir, 'listing', 'v2.json'), '{"title":"Current"}\n');
    await writeFile(path.join(projectDir, 'listing', 'v2.md'), '# Current\n');
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await compactProject(projectDir, {apply: true});
    assert.equal(JSON.parse(await readFile(path.join(projectDir, 'listing', 'listing.json'))).title, 'Current');
    assert.equal(await readFile(path.join(projectDir, '.studio', 'legacy', 'listing', 'v1.md'), 'utf8'), '# Old\n');
  });
});

test('rejects an approved Listing whose recorded hash does not match', async () => {
  await withTempWorkspace(async root => {
    const projectDir = await legacyProject(root);
    const statePath = path.join(projectDir, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.listing.approved = [{
      status: 'approved', json_path: 'listing/approved.json', json_sha256: '0'.repeat(64)
    }];
    await mkdir(path.join(projectDir, 'listing'));
    await writeFile(path.join(projectDir, 'listing', 'approved.json'), '{"title":"Direct"}\n');
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    const before = await tree(projectDir);
    await assert.rejects(compactProject(projectDir, {apply: true}), /Hash mismatch/);
    assert.deepEqual(await tree(projectDir), before);
  });
});

test('rejects a corrupt indexed image before swapping the original', async () => {
  await withTempWorkspace(async root => {
    const projectDir = await legacyProject(root);
    const statePath = path.join(projectDir, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.gallery.assets.main = {id: 'main', kind: 'main', status: 'approved', path: 'images/main.png'};
    state.gallery.selected = ['main'];
    await writeFile(path.join(projectDir, 'images', 'main.png'), 'not an image');
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    const before = await tree(projectDir);
    await assert.rejects(compactProject(projectDir, {apply: true}));
    assert.deepEqual(await tree(projectDir), before);
  });
});

test('promotion failure restores every original byte', async () => {
  await withTempWorkspace(async root => {
    const projectDir = await legacyProject(root);
    const before = await tree(projectDir);
    let renames = 0;
    await assert.rejects(
      compactProject(projectDir, {
        apply: true,
        operations: {
          rename: async (from, to) => {
            renames += 1;
            if (renames === 2) throw new Error('injected promotion failure');
            return rename(from, to);
          }
        }
      }),
      /injected promotion failure/
    );
    assert.deepEqual(await tree(projectDir), before);
    await assert.rejects(stat(`${projectDir}.compact-staging`), error => error.code === 'ENOENT');
  });
});

test('backup cleanup failure reports success and retains the recovery copy', async () => {
  await withTempWorkspace(async root => {
    const projectDir = await legacyProject(root);
    const report = await compactProject(projectDir, {
      apply: true,
      operations: {rm: async () => { throw new Error('locked backup'); }}
    });
    assert.equal(report.applied, true);
    assert.equal(report.backup_retained, true);
    await access(`${projectDir}.compact-backup`);
    await access(path.join(projectDir, '.studio', 'state.json'));
  });
});
