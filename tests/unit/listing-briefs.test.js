import test from 'node:test';
import assert from 'node:assert/strict';
import { compileListingBrief } from '../../scripts/lib/listing-briefs.js';
import { findEmptyBenefitPhrases, findFrontBackDuplicates } from '../../scripts/lib/listing.js';

const fixture = {
  facts: {
    material: {value: 'Aluminum', authority: 'project', publishable: true},
    weatherproof: {value: true, authority: 'category', publishable: false},
    mounting_surfaces: {value: ['doors', 'walls', 'fences'], authority: 'project', publishable: true}
  },
  marketLanguage: ['jobsite', 'construction site', 'PPE', 'work area'],
  rules: {limits: {title_chars: 75, item_highlights_chars: 125}}
};

test('brief assigns purchase intent before mounting surfaces', () => {
  const brief = compileListingBrief(fixture);
  assert.equal(brief.fields.item_highlights.priority[0], 'purchase_intent');
  assert.ok(brief.fields.item_highlights.priority.indexOf('mounting_surfaces') > 0);
  assert.equal(brief.fields.backend_search_terms.strategy, 'complement_frontend');
  assert.deepEqual(Object.keys(brief.publishable_facts), ['material', 'mounting_surfaces']);
  assert.deepEqual(brief.market_language, fixture.marketLanguage);
});

test('brief requires benefit-led Bullet headings and natural fact synthesis', () => {
  const brief = compileListingBrief(fixture);
  assert.equal(brief.fields.bullets.heading_rule, 'consumer_benefit_not_raw_spec');
  assert.ok(brief.language_rules.includes('combine_confirmed_facts_into_natural_consumer_language'));
  assert.ok(brief.language_rules.includes('avoid_empty_conservative_phrasing'));
});

test('detects fully covered backend tokens and empty benefit phrasing', () => {
  const listing = {
    title: 'Aluminum Safety Sign',
    item_highlights: 'Waterproof warning display.',
    bullets: [],
    description: '',
    backend_search_terms: 'aluminum waterproof jobsite ppe'
  };
  assert.deepEqual(findFrontBackDuplicates(listing), ['aluminum', 'waterproof']);
  assert.deepEqual(
    findEmptyBenefitPhrases({bullets: [{body: 'Supports exposed settings.'}]}),
    ['bullets.0.body']
  );
  assert.deepEqual(
    findEmptyBenefitPhrases({bullets: [{body: 'Provides a clear warning display in a compact size.'}]}),
    []
  );
});
