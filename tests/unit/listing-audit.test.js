import test from 'node:test';
import assert from 'node:assert/strict';
import { auditListing } from '../../scripts/lib/listing-audit.js';

test('bounded audit flags retail-language defects without rewriting clean fields', () => {
  const listing = {
    title: 'Slow Down Kids and Pets at Play Sign',
    item_highlights: 'Confirmed outdoor-resistant performance supports exposed settings.',
    bullets: [
      {heading: 'EASY TO MOUNT', body: 'Four empty corner mounting holes support straightforward placement.'},
      {heading: 'LASTS FOREVER', body: 'Guaranteed non-rusting construction for every environment.'}
    ],
    description: 'The performance makes it suitable for doors, walls, and fences.',
    backend_search_terms: 'property boundary canine activity zone'
  };

  const result = auditListing(listing, {buyerTerms: ['playground', 'driveway', 'kids playing']});
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(item => item.code === 'INTERNAL_QA_LANGUAGE'));
  assert.ok(result.findings.some(item => item.code === 'ABSTRACT_RETAIL_PHRASE'));
  assert.ok(result.findings.some(item => item.code === 'UNSUPPORTED_ABSOLUTE'));
  assert.ok(result.findings.some(item => item.code === 'WEAK_SEARCH_INTENT'));
  assert.equal(result.changed_paths.includes('title'), false);
  assert.equal(listing.title, 'Slow Down Kids and Pets at Play Sign');
});

test('clean direct consumer copy passes without a polish loop', () => {
  const listing = {
    title: 'Slow Down Kids and Pets at Play Aluminum Sign, 12 x 16 In',
    item_highlights: 'Weather-resistant aluminum warning sign with four pre-drilled corner holes.',
    bullets: [{heading: 'VISIBLE WARNING', body: 'Clear message for driveways, yards, and playground areas.'}],
    description: 'Rust-resistant aluminum construction supports outdoor use in rain and changing weather.',
    backend_search_terms: 'kids playing children at play driveway yard playground caution notice'
  };
  const result = auditListing(listing, {buyerTerms: ['driveway', 'yard', 'playground']});
  assert.deepEqual(result, {ok: true, findings: [], changed_paths: []});
});
