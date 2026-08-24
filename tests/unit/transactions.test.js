import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createProjectState, renderProjectSummary } from '../../scripts/lib/project-state.js';
import { approveArtifact, updateProject } from '../../scripts/lib/transactions.js';
import { withTempWorkspace } from '../helpers/temp-workspace.js';

const now = '2026-08-25T01:00:00.000Z';

async function createApproachableProject(root) {
  const state = createProjectState({
    projectId: 'sign-1',
    productName: 'Safety Sign',
    marketplace: 'amazon.com',
    language: 'en-US',
    productType: 'METAL_SIGN',
    now
  });
  state.project.stage = 'secondary_images';
  state.product_master = {version: 1, status: 'locked', approved_main_id: 'main-v1'};
  state.gallery.plan = [
    {id: 'scene-1', kind: 'application', status: 'candidate'},
    {id: 'size-1', kind: 'size_spec', status: 'planned'}
  ];
  state.gallery.assets['scene-1'] = {
    id: 'scene-1',
    kind: 'application',
    status: 'candidate',
    path: 'images/scene-1.png',
    inspection_status: 'pass',
    product_master_version: 1,
    fact_ids: ['material']
  };
  await mkdir(path.join(root, 'images'));
  await writeFile(path.join(root, 'images', 'scene-1.png'), Buffer.from('saved-raster-fixture'));
  await writeFile(path.join(root, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(path.join(root, 'project.md'), renderProjectSummary(state));
}

test('approval hashes and binds the exact artifact in one transaction', async () => {
  await withTempWorkspace(async root => {
    await createApproachableProject(root);
    let hashCalls = 0;
    const result = await updateProject(root, state => approveArtifact(state, {
      artifactId: 'scene-1',
      artifactType: 'image',
      path: 'images/scene-1.png',
      userAction: 'approved',
      now
    }, {
      projectDir: root,
      hashFile: async () => {
        hashCalls += 1;
        return 'a'.repeat(64);
      }
    }));

    assert.equal(hashCalls, 1);
    assert.equal(result.state.gallery.assets['scene-1'].status, 'approved');
    assert.equal(result.state.gallery.assets['scene-1'].sha256, 'a'.repeat(64));
    assert.equal(result.approval.sha256, 'a'.repeat(64));
    assert.equal(result.next_action.kind, 'generate_gallery_item');
    assert.equal(result.next_action.gallery_item_id, 'size-1');
    assert.match(await readFile(path.join(root, 'project.md'), 'utf8'), /Selected images: 1/);
  });
});

test('validation failure preserves prior state bytes', async () => {
  await withTempWorkspace(async root => {
    await createApproachableProject(root);
    const before = await readFile(path.join(root, 'state.json'));

    await assert.rejects(
      updateProject(root, () => ({schema_version: 99})),
      error => error.code === 'BLOCKING_INPUT' && /invalid project state/i.test(error.message)
    );

    assert.deepEqual(await readFile(path.join(root, 'state.json')), before);
  });
});

test('final approval cannot overwrite an artifact-specific approval id', async () => {
  await withTempWorkspace(async root => {
    await createApproachableProject(root);
    const approved = await updateProject(root, state => approveArtifact(state, {
      artifactId: 'scene-1', artifactType: 'image', path: 'images/scene-1.png', userAction: 'approved', now
    }, {projectDir: root, hashFile: async () => 'b'.repeat(64)}));
    const artifactApprovalId = approved.approval.id;

    const finalState = structuredClone(approved.state);
    finalState.approvals.push({id: 'final-approval-1', type: 'final', approved_at: now});
    await updateProject(root, () => finalState);

    const persisted = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'));
    assert.equal(persisted.gallery.assets['scene-1'].approval_id, artifactApprovalId);
  });
});
