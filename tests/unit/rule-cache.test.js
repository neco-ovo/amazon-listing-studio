import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveRules } from '../../scripts/lib/rule-cache.js';

async function ruleLibrary(snapshot = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'listing-rule-cache-'));
  const ruleDir = path.join(root, 'rules', 'amazon.com');
  await mkdir(ruleDir, {recursive: true});
  await writeFile(path.join(ruleDir, 'safety-sign.json'), JSON.stringify({
    marketplace: 'amazon.com',
    product_types: ['safety-sign'],
    verified_on: '2026-08-24',
    limits: {title_chars: 75},
    ...snapshot
  }), 'utf8');
  return root;
}

test('reuses a matching snapshot within 90 days without refresh', async () => {
  const libraryDir = await ruleLibrary();
  const result = await resolveRules({
    libraryDir,
    marketplace: 'amazon.com',
    productType: 'safety-sign',
    now: '2026-10-01T00:00:00Z',
    purpose: 'draft'
  });

  assert.equal(result.status, 'fresh');
  assert.equal(result.refresh_required, false);
  assert.equal(result.rules.limits.title_chars, 75);
  assert.deepEqual(result.warnings, []);
});

test('stale snapshot warns for draft but refreshes for upload-ready output', async () => {
  const libraryDir = await ruleLibrary();
  const input = {
    libraryDir,
    marketplace: 'amazon.com',
    productType: 'safety-sign',
    now: '2027-01-01T00:00:00Z'
  };

  const draft = await resolveRules({...input, purpose: 'draft'});
  const upload = await resolveRules({...input, purpose: 'upload_ready'});

  assert.equal(draft.status, 'stale');
  assert.equal(draft.refresh_required, false);
  assert.match(draft.warnings[0], /stale/i);
  assert.equal(upload.status, 'stale');
  assert.equal(upload.refresh_required, true);
});

test('missing or mismatched rules require refresh only for current verification', async () => {
  const libraryDir = await ruleLibrary({product_types: ['other-type']});
  const draft = await resolveRules({
    libraryDir,
    marketplace: 'amazon.com',
    productType: 'safety-sign',
    now: '2026-10-01T00:00:00Z',
    purpose: 'draft'
  });
  const verify = await resolveRules({
    libraryDir,
    marketplace: 'amazon.com',
    productType: 'safety-sign',
    now: '2026-10-01T00:00:00Z',
    purpose: 'verify_current'
  });

  assert.equal(draft.status, 'missing');
  assert.equal(draft.refresh_required, false);
  assert.equal(verify.status, 'missing');
  assert.equal(verify.refresh_required, true);
});
