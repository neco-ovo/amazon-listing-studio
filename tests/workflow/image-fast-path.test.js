import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createProjectState, renderProjectSummary } from '../../scripts/lib/project-state.js';
import { runApprove, runRecordCandidate } from '../../scripts/studio.js';
import { withTempWorkspace } from '../helpers/temp-workspace.js';

async function createProject(root) {
  const state = createProjectState({
    projectId: 'sign-1', productName: 'Safety Sign', marketplace: 'amazon.com', language: 'en-US',
    productType: 'METAL_SIGN', now: '2026-08-25T00:00:00.000Z'
  });
  state.project.stage = 'secondary_images';
  state.product_master = {version: 1, status: 'locked', approved_main_id: 'main-v1'};
  state.gallery.plan = [
    {id: 'scene-1', kind: 'application', status: 'planned'},
    {id: 'size-1', kind: 'size_spec', status: 'planned'}
  ];
  await mkdir(path.join(root, 'images'));
  await writeFile(path.join(root, 'images', 'scene-1.png'), Buffer.from('candidate'));
  await writeFile(path.join(root, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(path.join(root, 'project.md'), renderProjectSummary(state));
}

const candidate = {
  id: 'scene-1', kind: 'application', path: 'images/scene-1.png', product_master_version: 1,
  fact_ids: ['material'], automatic_attempts: 0
};

test('rejected candidate is inspected but not hashed or fully registered', async () => {
  await withTempWorkspace(async root => {
    await createProject(root);
    const calls = [];
    const result = await runRecordCandidate({projectDir: root, candidate}, {
      decode: async () => { calls.push('decode'); return {width: 1200, height: 1200}; },
      check: async () => { calls.push('relevant-image-checks'); return {ok: true, failures: []}; },
      inspect: async () => { calls.push('saved-file-inspection'); return {status: 'fail', reason_codes: ['MISLEADING_ACCESSORY']}; }
    });

    assert.equal(result.candidate.sha256, undefined);
    assert.equal(result.candidate.status, 'rejected');
    assert.deepEqual(calls, ['decode', 'relevant-image-checks', 'saved-file-inspection']);
    const persisted = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'));
    assert.deepEqual(Object.keys(persisted.gallery.assets['scene-1']).sort(), [
      'automatic_attempts', 'id', 'kind', 'reason_codes', 'status'
    ]);
  });
});

test('passing candidate defers hashing until approval and advances the gallery plan', async () => {
  await withTempWorkspace(async root => {
    await createProject(root);
    const recorded = await runRecordCandidate({projectDir: root, candidate}, {
      decode: async () => ({width: 1200, height: 1200}),
      check: async () => ({ok: true, failures: []}),
      inspect: async () => ({status: 'pass', findings: []})
    });
    assert.equal(recorded.candidate.status, 'candidate');
    assert.equal(recorded.candidate.sha256, undefined);
    assert.deepEqual(recorded.candidate.dimensions, {width: 1200, height: 1200});

    let hashCalls = 0;
    const approved = await runApprove({
      projectDir: root,
      artifactId: 'scene-1',
      artifactType: 'image',
      path: 'images/scene-1.png',
      now: '2026-08-25T01:00:00.000Z'
    }, {
      hashFile: async () => { hashCalls += 1; return 'c'.repeat(64); }
    });

    assert.equal(hashCalls, 1);
    assert.equal(approved.next_action.kind, 'generate_gallery_item');
    assert.equal(approved.next_action.gallery_item_id, 'size-1');
  });
});

test('approved main candidate hashes once and returns the Product Master lock action', async () => {
  await withTempWorkspace(async root => {
    const state = createProjectState({
      projectId: 'new-sign', productName: 'New Sign', marketplace: 'amazon.com', language: 'en-US',
      productType: 'METAL_SIGN', now: '2026-08-25T00:00:00.000Z'
    });
    state.project.stage = 'main_image';
    state.gallery.plan = [{id: 'main-v1', kind: 'main', status: 'planned'}];
    await mkdir(path.join(root, 'images'));
    await writeFile(path.join(root, 'images', 'main-v1.png'), Buffer.from('main-candidate'));
    await writeFile(path.join(root, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(root, 'project.md'), renderProjectSummary(state));

    await runRecordCandidate({
      projectDir: root,
      candidate: {id: 'main-v1', kind: 'main', path: 'images/main-v1.png', fact_ids: ['identity']}
    }, {
      decode: async () => ({width: 1200, height: 1600}),
      check: async () => ({ok: true, failures: []}),
      inspect: async () => ({status: 'pass', findings: []})
    });
    const approved = await runApprove({
      projectDir: root,
      artifactId: 'main-v1', artifactType: 'image', path: 'images/main-v1.png',
      now: '2026-08-25T01:00:00.000Z'
    }, {hashFile: async () => 'd'.repeat(64)});

    assert.equal(approved.next_action.kind, 'lock_product_master');
    assert.equal(approved.next_action.approved_main_id, 'main-v1');
  });
});
