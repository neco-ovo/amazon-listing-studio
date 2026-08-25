import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {unzipSync} from 'fflate';

import {
  buildDelivery,
  buildManifest,
  sha256File,
  verifyDelivery,
  validateApprovalScope,
} from '../../scripts/lib/bundle.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const fixtureRoot = path.resolve('tests/fixtures/bundle/project');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function mutableProject(root) {
  const projectDir = path.join(root, 'project');
  await cp(fixtureRoot, projectDir, {recursive: true});
  return projectDir;
}

async function readState(projectDir) {
  return JSON.parse(await readFile(path.join(projectDir, 'assets.json'), 'utf8'));
}

async function writeState(projectDir, state) {
  await writeFile(path.join(projectDir, 'assets.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function readApproval(projectDir) {
  return JSON.parse(await readFile(path.join(projectDir, 'approval.json'), 'utf8'));
}

test('builds an integrity manifest and ZIP with approved artifacts only', async () => {
  await withTempWorkspace(async root => {
    const projectDir = await mutableProject(root);
    const outputDir = path.join(root, 'delivery-v1');
    const approval = await readApproval(projectDir);
    const result = await buildDelivery({projectDir, outputDir, approval});

    assert.equal(result.manifest.artifacts.some(artifact => artifact.relative_path.includes('rejected')), false);
    assert.equal(result.manifest.artifacts.every(artifact => /^[a-f0-9]{64}$/.test(artifact.sha256)), true);
    assert.equal(result.manifest.artifacts.length, 4);
    const archive = unzipSync(await readFile(result.zipPath));
    assert.ok(archive['images/main-v2.png']);
    assert.ok(archive['images/secondary-size-v1.png']);
    assert.ok(archive['listing/listing.json']);
    assert.equal(archive['assets/rejected-history.png'], undefined);
    assert.equal(await sha256File(path.join(projectDir, 'assets/main-v2.png')), result.manifest.artifacts[0].sha256);
    assert.equal(result.manifest.artifacts.every(artifact => artifact.container === 'delivery.zip'), true);
    const verified = await verifyDelivery({deliveryDir: outputDir});
    assert.equal(verified.ok, true);
    assert.equal(verified.verified_images, 2);
    assert.equal(verified.verified_hashes, result.manifest.artifacts.length);
  });
});

test('validateApprovalScope rejects stale, unapproved, mismatched, and ambiguous scope', async t => {
  const state = await readState(fixtureRoot);
  const approval = await readApproval(fixtureRoot);

  await t.test('stale Product Master', () => {
    assert.throws(
      () => validateApprovalScope(state, {...approval, product_master_version: 1}),
      error => error.code === 'BUNDLE_INVALID' && error.details.reason === 'STALE_PRODUCT_MASTER',
    );
  });
  await t.test('unapproved selected image', () => {
    const changed = structuredClone(state);
    changed.images[1].status = 'draft';
    assert.throws(
      () => validateApprovalScope(changed, approval),
      error => error.code === 'BUNDLE_INVALID' && error.details.reason === 'UNAPPROVED_ARTIFACT',
    );
  });
  await t.test('Listing version mismatch', () => {
    assert.throws(
      () => validateApprovalScope(state, {...approval, listing_version: 2}),
      error => error.code === 'BUNDLE_INVALID' && error.details.reason === 'LISTING_VERSION_MISMATCH',
    );
  });
  await t.test('ambiguous approval', () => {
    assert.throws(
      () => validateApprovalScope(state, {...approval, ambiguous: true}),
      error => error.code === 'BUNDLE_INVALID' && error.details.reason === 'AMBIGUOUS_APPROVAL',
    );
  });
  await t.test('marketplace, product type, and Schema status scope', () => {
    for (const changed of [
      {...approval, marketplace: 'amazon.ca'},
      {...approval, product_type: 'OTHER_TYPE'},
      {...approval, schema_status: 'unverified'},
    ]) {
      assert.throws(
        () => validateApprovalScope(state, changed),
        error => error.code === 'BUNDLE_INVALID' && error.details.reason === 'APPROVAL_SCOPE_MISMATCH',
      );
    }
  });
});

test('buildDelivery rejects missing, corrupt, changed, and schema-unready files', async t => {
  await t.test('missing file', async () => {
    await withTempWorkspace(async root => {
      const projectDir = await mutableProject(root);
      await rm(path.join(projectDir, 'assets/secondary-size-v1.png'));
      await assert.rejects(
        buildDelivery({projectDir, outputDir: path.join(root, 'delivery'), approval: await readApproval(projectDir)}),
        error => error.code === 'BUNDLE_INVALID' && error.details.reason === 'MISSING_FILE',
      );
    });
  });

  await t.test('corrupt image with matching recorded hash', async () => {
    await withTempWorkspace(async root => {
      const projectDir = await mutableProject(root);
      const imagePath = path.join(projectDir, 'assets/secondary-size-v1.png');
      const corrupt = Buffer.from('not an image');
      await writeFile(imagePath, corrupt);
      const state = await readState(projectDir);
      state.images[1].sha256 = hash(corrupt);
      await writeState(projectDir, state);
      await assert.rejects(
        buildDelivery({projectDir, outputDir: path.join(root, 'delivery'), approval: await readApproval(projectDir)}),
        error => error.code === 'BUNDLE_INVALID' && error.details.reason === 'CORRUPT_IMAGE',
      );
    });
  });

  await t.test('changed hash', async () => {
    await withTempWorkspace(async root => {
      const projectDir = await mutableProject(root);
      await writeFile(path.join(projectDir, 'assets/secondary-size-v1.png'), Buffer.from('changed'));
      await assert.rejects(
        buildDelivery({projectDir, outputDir: path.join(root, 'delivery'), approval: await readApproval(projectDir)}),
        error => error.code === 'BUNDLE_INVALID' && error.details.reason === 'HASH_MISMATCH',
      );
    });
  });

  await t.test('schema-unverified bundle cannot be labeled upload-ready', async () => {
    await withTempWorkspace(async root => {
      const projectDir = await mutableProject(root);
      const listingPath = path.join(projectDir, 'listing.json');
      const listing = JSON.parse(await readFile(listingPath, 'utf8'));
      listing.rules_unverified = ['attributes'];
      listing.upload_ready = false;
      const bytes = Buffer.from(`${JSON.stringify(listing, null, 2)}\n`);
      await writeFile(listingPath, bytes);
      const state = await readState(projectDir);
      state.listing.json_sha256 = hash(bytes);
      await writeState(projectDir, state);
      await assert.rejects(
        buildDelivery({projectDir, outputDir: path.join(root, 'delivery'), approval: await readApproval(projectDir)}),
        error => error.code === 'BUNDLE_INVALID' && error.details.reason === 'SCHEMA_NOT_READY',
      );
    });
  });

  await t.test('schema-unverified bundle requires current version-bound authorization', async () => {
    await withTempWorkspace(async root => {
      const projectDir = await mutableProject(root);
      const listingPath = path.join(projectDir, 'listing.json');
      const listing = JSON.parse(await readFile(listingPath, 'utf8'));
      listing.rules_unverified = ['attributes'];
      listing.upload_ready = false;
      listing.schema_authorization = null;
      const bytes = Buffer.from(`${JSON.stringify(listing, null, 2)}\n`);
      await writeFile(listingPath, bytes);
      const state = await readState(projectDir);
      state.listing.json_sha256 = hash(bytes);
      state.listing.rules_unverified = ['attributes'];
      state.listing.upload_ready = false;
      state.listing.schema_status = 'unverified';
      state.listing.schema_authorization = null;
      await writeState(projectDir, state);
      const approval = {...await readApproval(projectDir), upload_ready: false, schema_status: 'unverified'};
      await assert.rejects(
        buildDelivery({projectDir, outputDir: path.join(root, 'delivery'), approval}),
        error => error.code === 'BUNDLE_INVALID' && error.details.reason === 'SCHEMA_AUTHORIZATION_REQUIRED',
      );
    });
  });
});

test('buildManifest records versioned artifact scope', () => {
  const manifest = buildManifest({
    approval: {id: 'approval-1', product_master_version: 2, change_summary: 'Final selection'},
    artifacts: [{relative_path: 'images/main.png', media_type: 'image/png', byte_size: 10, sha256: 'a'.repeat(64), version: 2}],
  });
  assert.equal(manifest.artifacts[0].product_master_version, 2);
  assert.equal(manifest.artifacts[0].approval_id, 'approval-1');
  assert.equal(manifest.artifacts[0].change_summary, 'Final selection');
  assert.equal(manifest.artifacts[0].container, 'delivery.zip');
  assert.equal(manifest.artifacts[0].archive_path, 'images/main.png');
});
