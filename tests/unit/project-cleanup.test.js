import assert from 'node:assert/strict';
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {cleanupAfterApproval} from '../../scripts/lib/project-cleanup.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

test('removes only registered candidates and known temporary files', async () => {
  await withTempWorkspace(async root => {
    const work = path.join(root, '.studio', 'work');
    const rejected = path.join(work, 'images', 'rejected.png');
    const unknown = path.join(work, 'custom.mjs');
    const lock = path.join(work, '~$upload.xlsx');
    await mkdir(path.dirname(rejected), {recursive: true});
    await writeFile(rejected, 'generated');
    await writeFile(unknown, 'user file');
    await writeFile(lock, 'lock');

    const result = await cleanupAfterApproval(root, {candidatePaths: ['.studio/work/images/rejected.png']});

    assert.equal(await exists(rejected), false);
    assert.equal(await exists(lock), false);
    assert.equal(await readFile(unknown, 'utf8'), 'user file');
    assert.deepEqual(result.preserved_unknown, ['.studio/work/custom.mjs']);
  });
});

test('never removes a registered path outside the system work directory', async () => {
  await withTempWorkspace(async root => {
    const source = path.join(root, 'reference.png');
    await writeFile(source, 'user source');
    await cleanupAfterApproval(root, {candidatePaths: ['reference.png']});
    assert.equal(await readFile(source, 'utf8'), 'user source');
  });
});
