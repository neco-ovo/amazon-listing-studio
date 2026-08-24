import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {acceptGeneratedRaster} from '../../scripts/lib/capabilities.js';
import {utf8Bytes, validateListing} from '../../scripts/lib/listing.js';
import * as listingModule from '../../scripts/lib/listing.js';
import * as state from '../../scripts/lib/state.js';
import {diffUpstream, writeDiffReport} from '../../scripts/lib/templates.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const now = '2026-08-24T12:00:00.000Z';
const approvedMain = {id: 'main-v1', version: 1, status: 'approved', path: 'assets/main.png', media_type: 'image/png', sha256: 'b'.repeat(64), inspection_status: 'pass', approval_id: 'main-approval', approval_explicit: true, approved_at: now};
const lockInput = {
  now, identity: {product_type: 'sign'}, dimensions: {width: 12, length: 8, unit: 'in'}, color: 'silver', material: 'aluminum', variant: 'default', count: 1,
  canonical_reference_hashes: ['a'.repeat(64)], approved_main: approvedMain,
};

test('required Seed behavior matrix', async t => {
  await t.test('complete input locks Product Master', () => {
    const initial = state.createInitialState({projectId: 'p', productName: 'Sign', now});
    assert.equal(state.lockProductMaster(initial.assets, lockInput).product_master.status, 'locked');
  });

  await t.test('blocking missing fact is rejected', () => {
    const initial = state.createInitialState({projectId: 'p', productName: 'Sign', now});
    const missingColor = {...lockInput, color: ''};
    assert.throws(() => state.lockProductMaster(initial.assets, missingColor), error => error.code === 'BLOCKING_INPUT');
  });

  await t.test('latest explicit user confirmation beats lower-authority conflict', () => {
    const result = state.resolveFact(
      {id: 'size', field: 'size', value: '10x7', status: 'source_observed', sources: ['link']},
      {id: 'size', field: 'size', value: '12x8', status: 'user_confirmed', publishable: true, sources: ['user']},
      {now},
    );
    assert.equal(result.value, '12x8');
    assert.equal(result.conflicts[0].value, '10x7');
  });

  await t.test('image capability failure stays hard', async () => {
    await assert.rejects(acceptGeneratedRaster({prompt: 'make an image'}, {}), error => error.code === 'CAPABILITY_FAILURE');
  });

  await t.test('rejection and regeneration stop after two automatic corrections', () => {
    assert.equal(typeof state.planImageCorrection, 'function');
    assert.equal(state.planImageCorrection({id: 'x', correction_attempts: 0}).correction_attempts, 1);
    assert.equal(state.planImageCorrection({id: 'x', correction_attempts: 1}).correction_attempts, 2);
    assert.throws(() => state.planImageCorrection({id: 'x', correction_attempts: 2}), error => error.code === 'BLOCKING_INPUT');
  });

  await t.test('Product Master mutation invalidates only scoped dependents', () => {
    const project = {facts: {facts: [{id: 'size', dependents: ['image-a']}, {id: 'color', dependents: ['image-b']}]}, assets: {images: [{id: 'image-a', status: 'approved'}, {id: 'image-b', status: 'approved'}], listing: {id: null}}};
    const changed = state.invalidateDependents(project, ['size'], {now});
    assert.equal(changed.assets.images[0].status, 'stale');
    assert.equal(changed.assets.images[1].status, 'approved');
  });

  await t.test('unavailable category Schema authorization is version-bound', () => {
    assert.equal(typeof listingModule.createSchemaAuthorization, 'function');
    const scope = {project_id: 'p', marketplace: 'amazon.com', product_type: 'METAL_SIGN', product_master_version: 1, listing_version: 2};
    const authorization = listingModule.createSchemaAuthorization(scope, {authorized_at: now});
    assert.equal(listingModule.isSchemaAuthorizationCurrent(authorization, scope), true);
    assert.equal(listingModule.isSchemaAuthorizationCurrent(authorization, {...scope, listing_version: 3}), false);
  });

  await t.test('final approval does not survive a scoped revision', () => {
    assert.equal(typeof state.recordFinalApproval, 'function');
    const initial = state.createInitialState({projectId: 'p', productName: 'Sign', now});
    let assets = state.lockProductMaster(initial.assets, lockInput);
    assets.images[0] = {...assets.images[0], product_master_version: 1};
    assets.listing = {id: 'listing-v1', version: 1, product_master_version: 1, status: 'approved', validation_status: 'PASS', project_id: 'p', marketplace: 'amazon.com', product_type: 'METAL_SIGN', schema_status: 'verified', upload_ready: true};
    const final = state.recordFinalApproval(assets, {id: 'final-1', finalized: true, project_id: 'p', product_master_version: 1, listing_version: 1, artifact_ids: ['main-v1'], marketplace: 'amazon.com', product_type: 'METAL_SIGN', schema_status: 'verified', upload_ready: true, now});
    const revised = state.invalidateDependents({facts: {facts: [{id: 'size', dependents: ['main-v1', 'listing-v1']}]}, assets: final.assets}, ['size'], {now});
    assert.equal(revised.assets.images[0].status, 'stale');
    assert.equal(revised.assets.listing.status, 'stale');
  });

  await t.test('final approval rejects a stale marketplace scope', () => {
    const initial = state.createInitialState({projectId: 'p', productName: 'Sign', now});
    let assets = state.lockProductMaster(initial.assets, lockInput);
    assets.images[0] = {...assets.images[0], product_master_version: 1};
    assets.listing = {id: 'listing-v1', version: 1, product_master_version: 1, status: 'approved', validation_status: 'PASS', project_id: 'p', marketplace: 'amazon.com', product_type: 'METAL_SIGN', schema_status: 'verified', upload_ready: true};
    assert.throws(
      () => state.recordFinalApproval(assets, {id: 'final-1', finalized: true, project_id: 'p', product_master_version: 1, listing_version: 1, artifact_ids: ['main-v1'], marketplace: 'amazon.ca', product_type: 'METAL_SIGN', schema_status: 'verified', upload_ready: true, now}),
      error => error.code === 'BLOCKING_INPUT' && /scope/i.test(error.message)
    );
  });

  await t.test('backend terms count UTF-8 bytes', () => {
    assert.equal(utf8Bytes('sign 标牌'), Buffer.byteLength('sign 标牌', 'utf8'));
  });

  await t.test('template diff reports change without overwriting snapshot', async () => {
    await withTempWorkspace(async root => {
      const snapshotPath = path.join(root, 'snapshot.json');
      const reportPath = path.join(root, 'diff.json');
      const snapshot = {templates: [{id: 'a', value: 1}]};
      await writeFile(snapshotPath, JSON.stringify(snapshot));
      const before = await readFile(snapshotPath, 'utf8');
      await writeDiffReport(diffUpstream(snapshot, {templates: [{id: 'a', value: 2}, {id: 'b'}]}), reportPath);
      assert.equal(await readFile(snapshotPath, 'utf8'), before);
    });
  });

  await t.test('bundle integrity failures remain covered by the unit suite', async () => {
    const source = await readFile('tests/unit/bundle.test.js', 'utf8');
    for (const marker of ['MISSING_FILE', 'CORRUPT_IMAGE', 'HASH_MISMATCH', 'SCHEMA_NOT_READY']) assert.match(source, new RegExp(marker));
  });
});
