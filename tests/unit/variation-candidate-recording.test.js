import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {createProjectState, renderProjectSummary} from '../../scripts/lib/project-state.js';
import {createVariationExtension} from '../../scripts/lib/variations.js';
import {runRecordCandidate, runRecordVariationCandidate} from '../../scripts/studio.js';
import {createMainImageFixtures} from '../helpers/png-fixtures.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const now = '2026-08-28T04:00:00.000Z';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('Variation candidate inspection and hash use one immutable byte snapshot', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'family');
    const relativePath = 'children/SKU-12X16/assets/main.png';
    const filePath = path.join(projectDir, ...relativePath.split('/'));
    const inspectedBytes = Buffer.from('bytes-present-when-inspection-started');
    const replacementBytes = Buffer.from('replacement-written-during-inspection');
    await mkdir(path.dirname(filePath), {recursive: true});
    await writeFile(filePath, inspectedBytes);

    const state = createProjectState({projectId: 'sign-family', productType: 'METAL_SIGN', now});
    state.project.mode = 'variation_family';
    state.variation = createVariationExtension({
      parentSku: 'SIGN-PARENT', dimensions: ['size_name'], firstChildSku: 'SKU-12X16',
      firstChildFacts: {size_name: '12 x 16 in'}, now
    });
    await writeFile(path.join(projectDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));

    const result = await runRecordVariationCandidate({
      projectDir,
      candidate: {
        scopeType: 'child_main', artifactId: 'main-v1', childSku: 'SKU-12X16',
        path: relativePath, inspection_status: 'pass', now
      }
    }, {
      decode: async (_filePath, _candidate, context = {}) => {
        const {fileBytes} = context;
        assert.deepEqual(fileBytes, inspectedBytes);
        return {width: 1200, height: 1200, format: 'png'};
      },
      check: async ({fileBytes}) => {
        assert.deepEqual(fileBytes, inspectedBytes);
        return {ok: true, failures: []};
      },
      inspect: async ({fileBytes}) => {
        assert.deepEqual(fileBytes, inspectedBytes);
        await writeFile(filePath, replacementBytes);
        return {status: 'pass', findings: []};
      }
    });

    assert.equal(result.candidate.candidate_sha256, digest(inspectedBytes));
    assert.deepEqual(await readFile(filePath), replacementBytes);
  });
});

test('legacy candidate recording retains its default file-path inspection flow', async () => {
  await withTempWorkspace(async root => {
    const projectDir = path.join(root, 'single');
    const relativePath = 'images/main/main-v1.png';
    const filePath = path.join(projectDir, ...relativePath.split('/'));
    const fixtures = await createMainImageFixtures(path.join(root, 'fixtures'));
    await mkdir(path.dirname(filePath), {recursive: true});
    await copyFile(fixtures.valid, filePath);
    const state = createProjectState({projectId: 'single', productType: 'METAL_SIGN', now});
    await writeFile(path.join(projectDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));

    const result = await runRecordCandidate({
      projectDir,
      candidate: {
        id: 'main-v1', kind: 'main', path: relativePath,
        inspection_status: 'pass', automatic_attempts: 0
      }
    });

    assert.equal(result.candidate.status, 'candidate');
    assert.equal(result.candidate.path, relativePath);
  });
});
