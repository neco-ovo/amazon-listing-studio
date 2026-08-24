import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {createSchemaAuthorization, normalizeListing, utf8Bytes, validateListing} from '../../scripts/lib/listing.js';

const limits = {
  title_chars: 75,
  item_highlights_chars: 125,
  bullet_chars: 200,
  bullets_combined_chars: 1000,
  description_chars: 2000,
  search_terms_bytes: 250,
};

const context = {
  limits,
  publishableFactIds: new Set(['type', 'size', 'material', 'shape', 'use_context']),
  schemaVerified: true,
  currentProductMasterVersion: 2,
  competitorBrands: ['Acme Rival'],
  projectId: 'listing-fixture',
};

async function fixture() {
  const parsed = JSON.parse(await readFile('tests/fixtures/listing/valid.json', 'utf8'));
  delete parsed.validation_context;
  return parsed;
}

test('validates complete grounded conversion-oriented Listing output', async () => {
  const result = validateListing(await fixture(), context);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.listing.bullets.length, 5);
  assert.equal(result.listing.upload_ready, true);
  assert.equal(utf8Bytes('sign 标牌'), Buffer.byteLength('sign 标牌', 'utf8'));
  assert.ok(result.counts.title_chars <= 75);
});

test('normalizeListing keeps stable arrays and optional product-detail fields', () => {
  const listing = normalizeListing({title: 'x', bullets: null, special_features: 'one'});
  assert.deepEqual(listing.bullets, []);
  assert.deepEqual(listing.special_features, ['one']);
  assert.deepEqual(listing.attributes, {});
  assert.deepEqual(listing.rules_unverified, []);
});

test('enforces title, Item Highlights, Bullet, Description, and search limits', async t => {
  await t.test('title 76', async () => {
    const listing = await fixture();
    listing.title = 'x'.repeat(76);
    assert.ok(validateListing(listing, context).errors.some(error => error.field === 'title' && error.code === 'CHAR_LIMIT'));
  });
  await t.test('Item Highlights 126', async () => {
    const listing = await fixture();
    listing.item_highlights = 'x'.repeat(126);
    assert.ok(validateListing(listing, context).errors.some(error => error.field === 'item_highlights' && error.code === 'CHAR_LIMIT'));
  });
  await t.test('exactly five Bullets and heading format', async () => {
    const four = await fixture();
    four.bullets.pop();
    assert.ok(validateListing(four, context).errors.some(error => error.code === 'BULLET_COUNT'));
    const six = await fixture();
    six.bullets.push('[EXTRA POINT] Supported extra copy.');
    six.claim_refs.bullets.push(['type']);
    assert.ok(validateListing(six, context).errors.some(error => error.code === 'BULLET_COUNT'));
    const heading = await fixture();
    heading.bullets[0] = 'Clear notice without required heading.';
    assert.ok(validateListing(heading, context).errors.some(error => error.code === 'BULLET_FORMAT'));
  });
  await t.test('per-Bullet and combined targets', async () => {
    const perBullet = await fixture();
    perBullet.bullets[0] = `[LONG COPY] ${'x'.repeat(190)}`;
    assert.ok(validateListing(perBullet, context).errors.some(error => error.field === 'bullets[0]' && error.code === 'CHAR_LIMIT'));
    const combined = await fixture();
    const strictContext = {...context, limits: {...limits, bullets_combined_chars: 250}};
    assert.ok(validateListing(combined, strictContext).errors.some(error => error.code === 'BULLETS_COMBINED_LIMIT'));
  });
  await t.test('Description 2001', async () => {
    const listing = await fixture();
    listing.description = 'x'.repeat(2001);
    assert.ok(validateListing(listing, context).errors.some(error => error.field === 'description' && error.code === 'CHAR_LIMIT'));
  });
  await t.test('backend search terms 251 UTF-8 bytes', async () => {
    const listing = await fixture();
    listing.backend_search_terms = 'x'.repeat(251);
    assert.ok(validateListing(listing, context).errors.some(error => error.field === 'backend_search_terms' && error.code === 'BYTE_LIMIT'));
  });
});

test('requires complete approved fact references', async () => {
  const missing = await fixture();
  delete missing.claim_refs.title;
  assert.ok(validateListing(missing, context).errors.some(error => error.code === 'CLAIM_REFS_MISSING'));

  const unknown = await fixture();
  unknown.claim_refs.description.push('unapproved_performance');
  assert.ok(validateListing(unknown, context).errors.some(error => error.code === 'UNAPPROVED_FACT'));
});

test('requires every conversion-oriented Listing output field to be nonempty', async t => {
  for (const [field, empty] of [
    ['title', ''], ['item_highlights', ''], ['description', ''], ['backend_search_terms', ''],
    ['special_features', []], ['attributes', {}],
  ]) {
    await t.test(field, async () => {
      const listing = await fixture();
      listing[field] = empty;
      const result = validateListing(listing, context);
      assert.ok(result.errors.some(error => error.field === field && error.code === 'REQUIRED'));
      assert.equal(result.listing.upload_ready, false);
    });
  }
});

test('rejects competitor brands, promotions, and contact details', async t => {
  for (const [name, field, value] of [
    ['competitor', 'description', 'Better than Acme Rival for every buyer.'],
    ['promotion', 'item_highlights', 'Limited time sale with free shipping.'],
    ['contact', 'description', 'Questions? Email help@example.com or visit https://example.com.'],
  ]) {
    await t.test(name, async () => {
      const listing = await fixture();
      listing[field] = value;
      assert.ok(validateListing(listing, context).errors.some(error => error.code === 'PROHIBITED_CONTENT'));
    });
  }
});

test('rejects stale Product Master and reports limit failure after one condense', async () => {
  const stale = await fixture();
  stale.product_master_version = 1;
  assert.ok(validateListing(stale, context).errors.some(error => error.code === 'STALE_PRODUCT_MASTER'));

  const exhausted = await fixture();
  exhausted.title = 'x'.repeat(76);
  exhausted.validation.condense_attempts = 1;
  const result = validateListing(exhausted, context);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.errors.some(error => error.code === 'LIMIT_AFTER_CONDENSE'));
});

test('unavailable category schema preserves supported copy but warns only affected fields', async () => {
  const listing = await fixture();
  const scope = {project_id: 'listing-fixture', marketplace: listing.marketplace, product_type: listing.product_type, product_master_version: listing.product_master_version, listing_version: listing.version};
  const schemaAuthorization = createSchemaAuthorization(scope, {authorized_at: '2026-08-24T00:00:00.000Z'});
  const result = validateListing(listing, {
    ...context,
    schemaVerified: false,
    unverifiedFields: ['attributes', 'special_features'],
    schemaAuthorization,
  });
  assert.equal(result.ok, true);
  assert.equal(result.listing.title, listing.title);
  assert.deepEqual(result.listing.rules_unverified, ['attributes', 'special_features']);
  assert.equal(result.listing.upload_ready, false);
  assert.equal(result.status, 'PASS_WITH_WARNINGS');
});

test('schema-unverified copy requires current project-and-version authorization for delivery status', async () => {
  const listing = await fixture();
  const missing = validateListing(listing, {...context, schemaVerified: false, unverifiedFields: ['attributes'], schemaAuthorization: null});
  assert.equal(missing.ok, true);
  assert.equal(missing.status, 'AUTHORIZATION_REQUIRED');

  const stale = createSchemaAuthorization({project_id: 'listing-fixture', marketplace: listing.marketplace, product_type: listing.product_type, product_master_version: 2, listing_version: 99});
  const staleResult = validateListing(listing, {...context, schemaVerified: false, unverifiedFields: ['attributes'], schemaAuthorization: stale});
  assert.equal(staleResult.ok, false);
  assert.ok(staleResult.errors.some(error => error.code === 'SCHEMA_AUTHORIZATION_SCOPE_MISMATCH'));
});
