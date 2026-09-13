import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildKeywordProfile,
  isCompatibleKeywordProfile,
  mergeKeywordEvidence,
  mergeKeywordProfileReports,
  normalizeKeywordPhrase,
  projectKeywordProfilePath,
  reusableKeywordProfilePath
} from '../../scripts/lib/keyword-profiles.js';

function row(keyword, values = {}) {
  return {
    keyword,
    traffic_share: null,
    organic_rank: null,
    sponsored_rank: null,
    relevance: null,
    monthly_searches: null,
    purchases: null,
    purchase_rate: null,
    spr: null,
    title_density: null,
    products: null,
    demand_supply_ratio: null,
    click_concentration: null,
    conversion_concentration: null,
    ppc: null,
    ...values
  };
}

const reverseReport = {
  report_type: 'reverse_asin',
  source: {basename: 'reverse.xlsx', analysis_scope: 'top_10_sample'},
  report_identity: {reference_asin: 'B0TEST'},
  rows: [
    row('Slow Down Kids at Play Sign', {traffic_share: 0.0623, monthly_searches: 6254, purchases: 563}),
    row('slow down signs', {traffic_share: 0.1853, monthly_searches: 13491}),
    row('vinyl kids decal', {traffic_share: 0.01, monthly_searches: 900})
  ]
};

const miningReport = {
  report_type: 'keyword_mining',
  source: {basename: 'mining.xlsx', analysis_scope: 'top_10_sample'},
  report_identity: {seed_query: 'slow down kids at play sign'},
  rows: [
    row('slow-down kids at play sign!', {relevance: 100, monthly_searches: 6254, purchase_rate: 0.09}),
    row('kids at play sign', {relevance: 95, monthly_searches: 5000, purchases: 450}),
    row('children playing sign', {relevance: 80, monthly_searches: 2200}),
    row('playground warning sign', {relevance: 75, monthly_searches: 1800}),
    row('kids safety sign', {relevance: 70, monthly_searches: 1500})
  ]
};

const assessments = {
  'slow down kids at play sign': {fit: 'exact', reason: 'exact product intent', reason_code: 'direct_match'},
  'kids at play sign': {fit: 'high', reason: 'direct synonym', reason_code: 'direct_match'},
  'slow down signs': {fit: 'related', reason: 'broader sign intent', reason_code: 'related_intent'},
  'children playing sign': {fit: 'high', reason: 'close shopper language', reason_code: 'direct_match'},
  'playground warning sign': {fit: 'high', reason: 'related use intent', reason_code: 'direct_match'},
  'kids safety sign': {fit: 'related', reason: 'broader safety intent', reason_code: 'related_intent'},
  'vinyl kids decal': {fit: 'excluded', reason: 'wrong product form', reason_code: 'product_mismatch'}
};

test('normalizes punctuation and spacing for comparison', () => {
  assert.equal(normalizeKeywordPhrase('  Kids-at--Play SIGN! '), 'kids at play sign');
});

test('merges duplicate phrases without averaging unlike report evidence', () => {
  const merged = mergeKeywordEvidence([reverseReport, miningReport]);
  const keyword = merged.find(item => item.normalized_phrase === 'slow down kids at play sign');
  assert.equal(keyword.phrase, 'Slow Down Kids at Play Sign');
  assert.equal(keyword.sources.reverse_asin.traffic_share, 0.0623);
  assert.equal(keyword.sources.keyword_mining.relevance, 100);
  assert.equal(keyword.sources.keyword_mining.organic_rank, null);
});

test('applies product fit before deterministic evidence ordering', () => {
  const profile = buildKeywordProfile({
    project: {marketplace: 'US', locale: 'en-US', product_type: 'rigid aluminum sign'},
    intent: 'slow down kids at play warning sign',
    reports: [reverseReport, miningReport],
    fitAssessments: assessments,
    now: '2026-09-13T00:00:00.000Z'
  });
  assert.equal(profile.groups.core[0].phrase, 'Slow Down Kids at Play Sign');
  assert.equal(profile.groups.core.length, 3);
  assert.equal(profile.groups.supporting[0].phrase, 'playground warning sign');
  assert.ok(profile.groups.excluded.some(item => item.phrase === 'vinyl kids decal'));
  assert.equal(profile.market_size_complete, false);
  assert.equal(JSON.stringify(profile).includes('"score"'), false);
  assert.deepEqual(profile.advertising.exact_candidates, profile.groups.core.map(item => item.phrase));
  assert.deepEqual(profile.advertising.phrase_candidates, profile.groups.supporting.map(item => item.phrase));
  assert.deepEqual(profile.advertising.cautious_tests, profile.groups.backend.map(item => item.phrase));
  assert.deepEqual(profile.advertising.negative_candidates, ['vinyl kids decal']);
  assert.doesNotMatch(JSON.stringify(profile.advertising), /bid|budget|forecast|profit/i);
});

test('requires one fit assessment for every merged phrase', () => {
  assert.throws(
    () => buildKeywordProfile({project: {}, intent: 'sign', reports: [miningReport], fitAssessments: {}}),
    error => error.code === 'KEYWORD_FIT_REQUIRED'
  );
});

test('excluded weak or duplicate phrases are not suggested as negatives', () => {
  const report = {...miningReport, rows: [row('kids sign', {relevance: 60, monthly_searches: 100})]};
  const profile = buildKeywordProfile({
    project: {}, intent: 'kids sign', reports: [report],
    fitAssessments: {'kids sign': {fit: 'excluded', reason: 'duplicate', reason_code: 'weak_or_duplicate'}}
  });
  assert.equal(profile.groups.core.length, 0);
  assert.equal(profile.groups.backend.length, 0);
  assert.deepEqual(profile.advertising.negative_candidates, []);
});

test('matches reusable profiles exactly and reports staleness separately', () => {
  const profile = {
    marketplace: 'US', locale: 'en-US', product_type: 'Rigid Aluminum Sign',
    normalized_intent: 'slow down kids at play sign', intent_slug: 'slow-down-kids-at-play-sign',
    refreshed_at: '2026-01-01T00:00:00.000Z'
  };
  const context = {
    marketplace: 'us', locale: 'en-US', product_type: 'rigid aluminum sign',
    intent: 'Slow Down Kids at Play Sign'
  };
  assert.deepEqual(
    isCompatibleKeywordProfile(profile, context, '2026-09-13T00:00:00.000Z'),
    {compatible: true, stale: true, reasons: []}
  );
  assert.equal(isCompatibleKeywordProfile(profile, {...context, locale: 'en-CA'}).compatible, false);
  assert.equal(isCompatibleKeywordProfile(profile, {...context, product_type: 'vinyl decal'}).compatible, false);
  assert.equal(isCompatibleKeywordProfile(profile, {...context, intent: 'horse crossing sign'}).compatible, false);
  assert.equal(isCompatibleKeywordProfile(profile, {...context, product_fact_conflict: true}).compatible, false);
  assert.equal(isCompatibleKeywordProfile(profile, {...context, intent_slug_collision: true}).compatible, false);
});

test('builds conventional safe profile paths', () => {
  assert.match(projectKeywordProfilePath('D:/Amazon/project'), /references[\\/]keyword-profile\.json$/);
  assert.match(reusableKeywordProfilePath('D:/Amazon/library', {
    marketplace: 'us', locale: 'en-us', product_type: 'rigid-aluminum-sign', intent_slug: 'slow-kids-sign'
  }), /keyword-profiles[\\/]us[\\/]en-us[\\/]rigid-aluminum-sign[\\/]slow-kids-sign\.json$/);
  assert.throws(
    () => reusableKeywordProfilePath('D:/Amazon/library', {
      marketplace: 'us', locale: 'en-us', product_type: '../escape', intent_slug: 'sign'
    }), error => error.code === 'UNSAFE_KEYWORD_PROFILE_PATH'
  );
});

test('replaces only newer evidence with the same report identity', () => {
  const currentReverse = {
    ...reverseReport,
    source: {...reverseReport.source, export_date: '2026-09-01'},
    report_identity: {reference_asin: 'B0TEST'}
  };
  const currentMining = {
    ...miningReport,
    source: {...miningReport.source, export_date: '2026-09-02'}
  };
  const current = {
    marketplace: 'US', refreshed_at: '2026-09-02T00:00:00.000Z',
    reports: [currentReverse, currentMining], groups: {core: []}
  };
  const incoming = {
    ...currentReverse,
    source: {...currentReverse.source, export_date: '2026-09-13'},
    rows: [row('new phrase', {traffic_share: 0.2, monthly_searches: 100, organic_rank: 2})]
  };
  const merged = mergeKeywordProfileReports(current, incoming, '2026-09-13T00:00:00.000Z');
  assert.equal(merged.reports.find(report => report.report_type === 'reverse_asin').source.export_date, '2026-09-13');
  assert.deepEqual(merged.reports.find(report => report.report_type === 'keyword_mining'), currentMining);
  assert.equal(merged.needs_reanalysis, true);
});

test('refuses ambiguous report replacement', () => {
  const current = {
    marketplace: 'US',
    reports: [{...reverseReport, source: {...reverseReport.source, export_date: '2026-09-13'}}]
  };
  const missingIdentity = {...reverseReport, report_identity: {}, source: {...reverseReport.source, export_date: '2026-09-14'}};
  assert.throws(
    () => mergeKeywordProfileReports(current, missingIdentity),
    error => error.code === 'UNRESOLVED_KEYWORD_IMPORT'
  );
  const sameDateConflict = {
    ...reverseReport, source: {...reverseReport.source, export_date: '2026-09-13'}, rows: [row('changed')]
  };
  assert.throws(
    () => mergeKeywordProfileReports(current, sameDateConflict),
    error => error.code === 'UNRESOLVED_KEYWORD_IMPORT'
  );
});
