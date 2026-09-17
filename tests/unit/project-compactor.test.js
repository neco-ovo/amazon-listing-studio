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
