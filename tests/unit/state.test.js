import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  approveSecondaryImage,
  createInitialState,
  initializeProject,
  invalidateDependents,
  lockProductMaster,
  resolveFact,
  validateState
} from '../../scripts/lib/state.js';
import { withTempWorkspace } from '../helpers/temp-workspace.js';

const now = '2026-08-24T00:00:00.000Z';

test('creates small readable initial state', () => {
  const initial = createInitialState({
    projectId: 'sign-001',
    productName: 'Aluminum Sign',
    marketplace: 'amazon.com',
    language: 'en-US',
    now
  });

  assert.match(initial.projectMarkdown, /Aluminum Sign/);
  assert.match(initial.projectMarkdown, /amazon\.com/);
  assert.deepEqual(initial.facts.facts, []);
  assert.equal(initial.assets.product_master.status, 'unlocked');
  assert.equal(initial.assets.product_master.version, 0);
});

test('user-confirmed fact wins over conflicting link observation and preserves conflict', () => {
  const kept = resolveFact(
    { id: 'size', field: 'dimensions', value: '12x8 in', status: 'user_confirmed', publishable: true, sources: ['user-1'], conflicts: [] },
    { id: 'size', field: 'dimensions', value: '10x7 in', status: 'source_observed', publishable: false, sources: ['url-1'], conflicts: [] },
    { now }
  );

  assert.equal(kept.value, '12x8 in');
  assert.equal(kept.status, 'user_confirmed');
  assert.equal(kept.conflicts.length, 1);
  assert.equal(kept.conflicts[0].value, '10x7 in');
  assert.deepEqual(kept.conflicts[0].sources, ['url-1']);
});

test('conflicting user confirmations require a question', () => {
  assert.throws(
    () => resolveFact(
      { id: 'size', field: 'dimensions', value: '12x8 in', status: 'user_confirmed', sources: ['user-1'] },
      { id: 'size', field: 'dimensions', value: '10x7 in', status: 'user_confirmed', sources: ['user-2'] },
      { now }
    ),
    error => error.code === 'BLOCKING_INPUT' && error.details.fact_id === 'size'
  );
});

test('Product Master cannot lock before a real approved main image', () => {
  const { assets } = createInitialState({ projectId: 'sign-001', productName: 'Aluminum Sign', now });
  assert.throws(
    () => lockProductMaster(assets, {
      now,
      identity: { product_type: 'aluminum sign' },
      dimensions: { width: 12, length: 8, unit: 'in' },
      color: 'brushed silver',
      variant: 'default',
      count: 1,
      canonical_reference_hashes: ['a'.repeat(64)],
      approved_main: { id: 'main-v1', status: 'planned' }
    }),
    error => error.code === 'BLOCKING_INPUT' && /approved main raster/i.test(error.message)
  );
});

test('locks a hashed Product Master and increments its stable version', () => {
  const { assets } = createInitialState({ projectId: 'sign-001', productName: 'Aluminum Sign', now });
  const locked = lockProductMaster(assets, {
    now,
    identity: { product_type: 'aluminum sign', intrinsic_text: 'KEEP OUT' },
    dimensions: { width: 12, length: 8, unit: 'in' },
    color: 'brushed silver',
    material: 'aluminum',
    variant: 'default',
    count: 1,
    confirmed_visible_components: ['sign'],
    canonical_reference_hashes: ['a'.repeat(64)],
    approved_main: { id: 'main-v1', status: 'approved', path: 'images/main/main-v1.png', sha256: 'b'.repeat(64), inspection_status: 'pass', approval_id: 'main-approval-1', approval_explicit: true, approved_at: now }
  });

  assert.equal(locked.product_master.status, 'locked');
  assert.equal(locked.product_master.version, 1);
  assert.equal(locked.product_master.physical_ratio, 1.5);
  assert.equal(locked.product_master.approved_main_sha256, 'b'.repeat(64));
  assert.equal(locked.images[0].master_version, 1);
});

test('Product Master and secondary approvals require explicit approval evidence', () => {
  const { assets } = createInitialState({ projectId: 'sign-001', productName: 'Aluminum Sign', now });
  const input = {
    now, identity: { product_type: 'aluminum sign' }, dimensions: { width: 12, length: 8, unit: 'in' },
    color: 'silver', variant: 'default', count: 1, canonical_reference_hashes: ['a'.repeat(64)],
    approved_main: { id: 'main-v1', status: 'approved', path: 'main.png', sha256: 'b'.repeat(64), inspection_status: 'pass' }
  };
  assert.throws(() => lockProductMaster(assets, input), error => error.code === 'BLOCKING_INPUT' && /explicit/i.test(error.message));

  const locked = lockProductMaster(assets, {
    ...input,
    approved_main: {...input.approved_main, approval_id: 'main-approval', approval_explicit: true, approved_at: now}
  });
  assert.throws(
    () => approveSecondaryImage(locked, {
      product_master_version: 1,
      image: {id: 'secondary-v1', version: 1, kind: 'size-spec', path: 'secondary.png', sha256: 'c'.repeat(64), inspection_status: 'pass'}
    }),
    error => error.code === 'BLOCKING_INPUT' && /explicit/i.test(error.message)
  );
});

test('invalidates only explicit fact dependents', () => {
  const state = {
    facts: {
      version: 2,
      facts: [
        { id: 'size', dependents: ['main-v1', 'size-spec-v1', 'listing-v1'] },
        { id: 'color', dependents: ['scene-v1'] }
      ]
    },
    assets: {
      images: [
        { id: 'main-v1', status: 'approved' },
        { id: 'size-spec-v1', status: 'approved' },
        { id: 'scene-v1', status: 'approved' }
      ],
      listing: { id: 'listing-v1', status: 'approved' }
    }
  };

  const next = invalidateDependents(state, ['size'], { now, reason: 'dimensions changed' });
  assert.equal(next.assets.images.find(item => item.id === 'main-v1').status, 'stale');
  assert.equal(next.assets.images.find(item => item.id === 'size-spec-v1').status, 'stale');
  assert.equal(next.assets.images.find(item => item.id === 'scene-v1').status, 'approved');
  assert.equal(next.assets.listing.status, 'stale');
});

test('initializes and validates three project files without overwrite', async () => {
  await withTempWorkspace(async root => {
    const result = await initializeProject(root, {
      projectId: 'sign-001', productName: 'Aluminum Sign', marketplace: 'amazon.com', language: 'en-US', now
    });
    assert.equal(result.created.length, 3);
    assert.match(await readFile(path.join(root, 'sign-001', 'project.md'), 'utf8'), /Aluminum Sign/);
    assert.equal((await validateState(path.join(root, 'sign-001'))).valid, true);
    await assert.rejects(
      initializeProject(root, { projectId: 'sign-001', productName: 'Other', now }),
      error => error.code === 'BLOCKING_INPUT'
    );
  });
});

test('creates a missing project collection root before the project directory', async () => {
  await withTempWorkspace(async temp => {
    const missingRoot = path.join(temp, 'projects');
    const result = await initializeProject(missingRoot, {
      projectId: 'sign-002', productName: 'Second Sign', now
    });
    assert.equal(result.projectDir, path.join(missingRoot, 'sign-002'));
    assert.equal((await validateState(result.projectDir)).valid, true);
  });
});

test('validateState rejects malformed fact and approved-image records on resume', async () => {
  await withTempWorkspace(async root => {
    const result = await initializeProject(root, { projectId: 'broken', productName: 'Broken', now });
    const factsPath = path.join(result.projectDir, 'facts.json');
    const assetsPath = path.join(result.projectDir, 'assets.json');
    const facts = JSON.parse(await readFile(factsPath, 'utf8'));
    facts.facts.push({field: 'size', value: '12x8'});
    await (await import('node:fs/promises')).writeFile(factsPath, JSON.stringify(facts));
    const assets = JSON.parse(await readFile(assetsPath, 'utf8'));
    assets.images.push({id: 'approved-but-empty', status: 'approved'});
    await (await import('node:fs/promises')).writeFile(assetsPath, JSON.stringify(assets));
    const validation = await validateState(result.projectDir);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(error => /fact/i.test(error)));
    assert.ok(validation.errors.some(error => /image/i.test(error)));
  });
});
