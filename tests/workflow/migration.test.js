import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { migrateLegacyProject } from '../../scripts/lib/migration.js';
import { withTempWorkspace } from '../helpers/temp-workspace.js';

async function writeLegacyProject(sourceDir) {
  await mkdir(path.join(sourceDir, 'images'), {recursive: true});
  await writeFile(path.join(sourceDir, 'project.md'), '# Legacy Safety Sign\n\n- Stage: Delivery built\n');
  await writeFile(path.join(sourceDir, 'facts.json'), JSON.stringify({
    schema_version: 1,
    project_id: 'legacy-sign',
    facts: [{id: 'material', field: 'material', value: 'aluminum', status: 'user_confirmed', publishable: true, sources: ['user-1'], conflicts: [], dependents: []}]
  }));
  const images = Array.from({length: 7}, (_, index) => ({
    id: index === 0 ? 'main-v1' : `secondary-${index}`,
    version: 1,
    kind: index === 0 ? 'main' : 'secondary',
    status: 'approved',
    selected: true,
    path: `images/${index}.png`,
    sha256: String(index + 1).repeat(64).slice(0, 64),
    product_master_version: 1,
    approval_id: `approval-${index}`,
    approval_explicit: true,
    approved_at: '2026-08-24T00:00:00.000Z'
  }));
  await writeFile(path.join(sourceDir, 'assets.json'), JSON.stringify({
    schema_version: 1,
    project_id: 'legacy-sign',
    product_master: {version: 1, status: 'locked', identity: {product_type: 'METAL_SIGN'}, approved_main_id: 'main-v1'},
    storyboard: images.slice(1).map(image => ({id: image.id, kind: image.kind, status: 'approved'})),
    images,
    listing: {
      id: 'listing-v3', version: 3, status: 'approved', marketplace: 'amazon.com', product_type: 'METAL_SIGN',
      product_master_version: 1, approval_id: 'listing-approval', schema_status: 'unverified', upload_ready: false
    },
    approvals: [{id: 'final-approval', type: 'final', approved_at: '2026-08-24T01:00:00.000Z'}],
    final_bundle: {version: 1, status: 'built', path: 'delivery/final-v1'}
  }));
}

test('migration preserves master, selected assets, listing approval, and delivery', async () => {
  await withTempWorkspace(async root => {
    const sourceDir = path.join(root, 'legacy');
    const destinationDir = path.join(root, 'migrated');
    await writeLegacyProject(sourceDir);
    const sourceFactsBefore = await readFile(path.join(sourceDir, 'facts.json'));

    const state = await migrateLegacyProject({sourceDir, destinationDir});

    assert.equal(state.product_master.version, 1);
    assert.equal(state.gallery.selected.length, 7);
    assert.equal(state.listing.approved.at(-1).version, 3);
    assert.equal(state.delivery.status, 'built');
    assert.deepEqual(await readFile(path.join(sourceDir, 'facts.json')), sourceFactsBefore);
    assert.ok((await readFile(path.join(destinationDir, 'project.md'), 'utf8')).includes('Legacy Safety Sign'));
    assert.equal(JSON.parse(await readFile(path.join(destinationDir, 'state.json'), 'utf8')).schema_version, 2);
  });
});

test('migrate refuses identical source and destination', async () => {
  await withTempWorkspace(async root => {
    const sourceDir = path.join(root, 'legacy');
    await writeLegacyProject(sourceDir);
    await assert.rejects(
      migrateLegacyProject({sourceDir, destinationDir: sourceDir}),
      error => error.code === 'BLOCKING_INPUT' && /destination/i.test(error.message)
    );
  });
});
