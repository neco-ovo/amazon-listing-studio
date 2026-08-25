import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { buildV2Delivery, sha256File } from '../../scripts/lib/bundle.js';
import { createProjectState, renderProjectSummary } from '../../scripts/lib/project-state.js';
import { approveDraft, createDraft } from '../../scripts/lib/listing-drafts.js';
import { withTempWorkspace } from '../helpers/temp-workspace.js';

const now = '2026-08-25T06:00:00.000Z';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function png(filePath, color) {
  await sharp({create: {width: 32, height: 32, channels: 3, background: color}}).png().toFile(filePath);
}

async function buildApprovedFixture(root) {
  const projectDir = path.join(root, 'project');
  const imageDir = path.join(projectDir, 'images');
  await mkdir(imageDir, {recursive: true});
  await png(path.join(imageDir, 'main.png'), '#ffffff');
  await png(path.join(imageDir, 'scene.png'), '#eeeeee');
  const mainHash = await sha256File(path.join(imageDir, 'main.png'));
  const sceneHash = await sha256File(path.join(imageDir, 'scene.png'));

  let state = createProjectState({projectId: 'sign-1', productName: 'Safety Sign', productType: 'METAL_SIGN', now});
  state.project.stage = 'delivery';
  state.product_master = {version: 1, status: 'locked', approved_main_id: 'main-v1'};
  state.gallery.plan = [
    {id: 'main-v1', kind: 'main', status: 'approved'},
    {id: 'scene-v1', kind: 'application', status: 'approved'}
  ];
  state.gallery.selected = ['main-v1', 'scene-v1'];
  state.gallery.assets = {
    'main-v1': {id: 'main-v1', kind: 'main', status: 'approved', path: 'images/main.png', media_type: 'image/png', version: 1, sha256: mainHash, approval_id: 'approve-main', product_master_version: 0, approved_at: now},
    'scene-v1': {id: 'scene-v1', kind: 'application', status: 'approved', path: 'images/scene.png', media_type: 'image/png', version: 1, sha256: sceneHash, approval_id: 'approve-scene', product_master_version: 1, approved_at: now}
  };
  state.approvals = [
    {id: 'approve-main', type: 'image', artifact_id: 'main-v1', sha256: mainHash, approved_at: now, user_action: 'approved'},
    {id: 'approve-scene', type: 'image', artifact_id: 'scene-v1', sha256: sceneHash, product_master_version: 1, approved_at: now, user_action: 'approved'}
  ];
  state = createDraft(state, {
    project_id: 'sign-1', marketplace: 'amazon.com', language: 'en-US', product_type: 'METAL_SIGN',
    product_master_version: 1, title: 'Hard Hat Required Aluminum Sign',
    item_highlights: 'Clear PPE warning for jobsites and work areas.', bullets: [],
    description: 'Aluminum workplace warning sign.', backend_search_terms: 'jobsite ppe head protection',
    special_features: ['Rounded corners'], attributes: {material: 'Aluminum'},
    rules_unverified: ['attributes'], upload_ready: false
  }, {now});
  state = approveDraft(state, {userAction: 'approved', now});
  await writeFile(path.join(projectDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));
  return {
    projectDir,
    state,
    finalApproval: {
      id: 'final-1', finalized: true, project_id: 'sign-1', product_master_version: 1,
      listing_version: 1, artifact_ids: ['main-v1', 'scene-v1'], marketplace: 'amazon.com',
      product_type: 'METAL_SIGN', schema_status: 'unverified', upload_ready: false, approved_at: now
    }
  };
}

test('finalize rehashes and decodes every selected artifact before rejecting mutation', async () => {
  await withTempWorkspace(async root => {
    const project = await buildApprovedFixture(root);
    await png(path.join(project.projectDir, 'images', 'main.png'), '#000000');
    let hashCalls = 0;
    await assert.rejects(
      buildV2Delivery({
        ...project,
        outputDir: path.join(root, 'delivery'),
        hashFile: async filePath => { hashCalls += 1; return sha256File(filePath); }
      }),
      error => error.code === 'BUNDLE_INVALID' && error.details?.reason === 'HASH_MISMATCH'
    );
    assert.equal(hashCalls, project.state.gallery.selected.length);
  });
});

test('v2 delivery renders the approved Listing and preserves unverified readiness', async () => {
  await withTempWorkspace(async root => {
    const project = await buildApprovedFixture(root);
    const delivery = await buildV2Delivery({...project, outputDir: path.join(root, 'delivery')});
    const archive = unzipSync(await readFile(delivery.zipPath));
    const listing = JSON.parse(Buffer.from(archive['listing/listing.json']).toString('utf8'));
    assert.deepEqual(listing.rules_unverified, ['attributes']);
    assert.equal(listing.upload_ready, false);
    assert.equal(delivery.manifest.artifacts.length, 4);
  });
});

test('post-approval Listing mutation is rejected by its frozen hash', async () => {
  await withTempWorkspace(async root => {
    const project = await buildApprovedFixture(root);
    project.state.listing.approved[0].content.title = 'Mutated after approval';
    await writeFile(path.join(project.projectDir, 'state.json'), `${JSON.stringify(project.state, null, 2)}\n`);
    await assert.rejects(
      buildV2Delivery({...project, outputDir: path.join(root, 'delivery')}),
      error => error.code === 'BUNDLE_INVALID' && error.details?.reason === 'HASH_MISMATCH'
    );
  });
});

test('gallery selection change after Listing approval requires Listing reapproval', async () => {
  await withTempWorkspace(async root => {
    const project = await buildApprovedFixture(root);
    project.state.gallery.selected = ['main-v1'];
    project.finalApproval.artifact_ids = ['main-v1'];
    await writeFile(path.join(project.projectDir, 'state.json'), `${JSON.stringify(project.state, null, 2)}\n`);

    await assert.rejects(
      buildV2Delivery({...project, outputDir: path.join(root, 'delivery')}),
      error => error.code === 'BUNDLE_INVALID' && error.details?.reason === 'LISTING_SCOPE_STALE'
    );
  });
});
