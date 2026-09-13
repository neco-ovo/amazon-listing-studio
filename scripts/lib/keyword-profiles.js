import path from 'node:path';

import {fail} from './errors.js';

const FIT_ORDER = {exact: 0, high: 1, related: 2, excluded: 3};
const FIT_VALUES = new Set(Object.keys(FIT_ORDER));
const REASON_CODES = new Set([
  'direct_match', 'related_intent', 'product_mismatch', 'unsupported_attribute', 'weak_or_duplicate'
]);

export function normalizeKeywordPhrase(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function slug(value) {
  return normalizeKeywordPhrase(value).replace(/\s+/g, '-');
}

export function mergeKeywordEvidence(reports) {
  const merged = new Map();
  for (const report of reports ?? []) {
    const sourceType = report?.report_type;
    if (!['reverse_asin', 'keyword_mining'].includes(sourceType)) continue;
    for (const row of report.rows ?? []) {
      const normalized = normalizeKeywordPhrase(row.keyword);
      if (!normalized) continue;
      const current = merged.get(normalized) ?? {
        phrase: String(row.keyword).trim(),
        normalized_phrase: normalized,
        sources: {},
        evidence: []
      };
      current.evidence.push({
        report_type: sourceType,
        report_identity: {...(report.report_identity ?? {})},
        source: {...(report.source ?? {})},
        row: {...row}
      });
      merged.set(normalized, current);
    }
  }
  return [...merged.values()].map(item => {
    item.evidence.sort((left, right) => evidenceKey(left).localeCompare(evidenceKey(right), 'en-US'));
    const phrases = item.evidence.map(entry => String(entry.row.keyword).trim()).sort(compareReadablePhrase);
    item.phrase = phrases[0];
    for (const type of ['reverse_asin', 'keyword_mining']) {
      const rows = item.evidence.filter(entry => entry.report_type === type).map(entry => entry.row);
      if (rows.length) item.sources[type] = {...rows.sort(compareRows)[0]};
    }
    return item;
  });
}

function evidenceKey(entry) {
  return `${entry.report_type}:${JSON.stringify(entry.report_identity)}:${entry.source.basename ?? ''}`;
}

function compareReadablePhrase(left, right) {
  const punctuation = value => (value.match(/[^\p{L}\p{N}\s]/gu) ?? []).length;
  return punctuation(left) - punctuation(right) || (left < right ? -1 : left > right ? 1 : 0);
}

function compareRows(left, right) {
  for (const field of ['traffic_share', 'purchases', 'monthly_searches', 'purchase_rate']) {
    const compared = descendingNullable(left[field], right[field]);
    if (compared) return compared;
  }
  return String(left.keyword).localeCompare(String(right.keyword), 'en-US');
}

function bestMetric(item, field) {
  const values = item.evidence
    .map(entry => entry.row[field])
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function descendingNullable(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function compareEvidence(left, right) {
  const fit = FIT_ORDER[left.fit] - FIT_ORDER[right.fit];
  if (fit) return fit;
  const reverse = Number(Boolean(right.sources.reverse_asin)) - Number(Boolean(left.sources.reverse_asin));
  if (reverse) return reverse;
  for (const field of ['traffic_share', 'purchases', 'monthly_searches', 'purchase_rate']) {
    const compared = descendingNullable(bestMetric(left, field), bestMetric(right, field));
    if (compared) return compared;
  }
  return left.normalized_phrase.localeCompare(right.normalized_phrase, 'en-US');
}

function assessedEvidence(evidence, fitAssessments) {
  return evidence.map(item => {
    const assessment = fitAssessments?.[item.normalized_phrase];
    if (!assessment || !FIT_VALUES.has(assessment.fit) || !REASON_CODES.has(assessment.reason_code)) {
      fail('KEYWORD_FIT_REQUIRED', 'Every keyword requires a valid product-fit assessment.', {
        keyword: item.phrase
      });
    }
    return {
      ...item,
      fit: assessment.fit,
      reason: String(assessment.reason ?? '').trim(),
      reason_code: assessment.reason_code
    };
  });
}

export function buildKeywordProfile({project = {}, intent = '', reports = [], fitAssessments = {}, now} = {}) {
  const evaluated = assessedEvidence(mergeKeywordEvidence(reports), fitAssessments).sort(compareEvidence);
  const eligible = evaluated.filter(item => item.fit === 'exact' || item.fit === 'high');
  const core = eligible.slice(0, 3);
  const supporting = eligible.slice(3);
  const backend = evaluated.filter(item => item.fit === 'related');
  const excluded = evaluated.filter(item => item.fit === 'excluded');
  const timestamp = now ?? new Date().toISOString();
  const analysisScopes = [...new Set(reports.map(report => report?.source?.analysis_scope).filter(Boolean))];
  return {
    schema_version: 1,
    marketplace: project.marketplace ?? null,
    locale: project.locale ?? null,
    product_type: project.product_type ?? null,
    normalized_intent: normalizeKeywordPhrase(intent),
    intent_slug: slug(intent),
    product_facts: {...(project.product_facts ?? {})},
    analysis_scope: analysisScopes.length === 1 ? analysisScopes[0] : 'mixed_partial',
    market_size_complete: false,
    reports: reports.map(report => ({
      report_type: report.report_type,
      source: {...report.source},
      report_identity: {...report.report_identity},
      rows: report.rows.map(item => ({...item})),
      skipped_rows: report.skipped_rows ?? 0
    })),
    groups: {core, supporting, backend, excluded},
    advertising: {
      exact_candidates: core.map(item => item.phrase),
      phrase_candidates: supporting.map(item => item.phrase),
      cautious_tests: backend.map(item => item.phrase),
      negative_candidates: excluded
        .filter(item => ['product_mismatch', 'unsupported_attribute'].includes(item.reason_code))
        .map(item => item.phrase)
    },
    generated_at: timestamp,
    refreshed_at: timestamp
  };
}

function comparable(value) {
  return normalizeKeywordPhrase(value);
}

export function isCompatibleKeywordProfile(profile, context, now = new Date().toISOString()) {
  const reasons = [];
  if (comparable(profile?.marketplace) !== comparable(context?.marketplace)) reasons.push('marketplace');
  if (comparable(profile?.locale) !== comparable(context?.locale)) reasons.push('locale');
  if (comparable(profile?.product_type) !== comparable(context?.product_type)) reasons.push('product_type');
  if (profile?.normalized_intent !== normalizeKeywordPhrase(context?.intent)) reasons.push('intent');
  if (context?.product_fact_conflict) reasons.push('product_fact_conflict');
  if (context?.intent_slug_collision) reasons.push('intent_slug_collision');
  const refreshed = Date.parse(profile?.refreshed_at);
  const current = Date.parse(now);
  const stale = !Number.isFinite(refreshed) || !Number.isFinite(current)
    || current - refreshed > 180 * 24 * 60 * 60 * 1000;
  return {compatible: reasons.length === 0, stale, reasons};
}

function safeSegment(value) {
  const segment = String(value ?? '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(segment)) {
    fail('UNSAFE_KEYWORD_PROFILE_PATH', 'Keyword profile path contains an unsafe or empty segment.', {segment});
  }
  return segment;
}

function beneath(root, target) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export function projectKeywordProfilePath(projectDir) {
  const root = path.resolve(projectDir);
  return path.resolve(root, 'references', 'keyword-profile.json');
}

export function reusableKeywordProfilePath(libraryDir, key) {
  const root = path.resolve(libraryDir);
  const target = path.resolve(
    root,
    'keyword-profiles',
    safeSegment(key?.marketplace),
    safeSegment(key?.locale),
    safeSegment(key?.product_type),
    `${safeSegment(key?.intent_slug)}.json`
  );
  if (!beneath(root, target)) {
    fail('UNSAFE_KEYWORD_PROFILE_PATH', 'Keyword profile path escapes its library root.');
  }
  return target;
}

function reportIdentity(report) {
  if (report?.report_type === 'reverse_asin') {
    const value = String(report.report_identity?.reference_asin ?? '').trim().toLocaleUpperCase('en-US');
    return value ? `reverse_asin:${value}` : null;
  }
  if (report?.report_type === 'keyword_mining') {
    const value = normalizeKeywordPhrase(report.report_identity?.seed_query);
    return value ? `keyword_mining:${value}` : null;
  }
  return null;
}

function exportTime(report) {
  const value = report?.source?.export_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mergeKeywordProfileReports(current, incoming, now = new Date().toISOString()) {
  const incomingIdentity = reportIdentity(incoming);
  if (!incomingIdentity) {
    fail('UNRESOLVED_KEYWORD_IMPORT', 'Report identity is required for automatic keyword evidence refresh.');
  }
  const reports = (current?.reports ?? []).map(report => ({...report}));
  const index = reports.findIndex(report => reportIdentity(report) === incomingIdentity);
  if (index === -1) {
    reports.push(incoming);
  } else {
    const oldReport = reports[index];
    if (JSON.stringify(oldReport) === JSON.stringify(incoming)) return current;
    const oldTime = exportTime(oldReport);
    const incomingTime = exportTime(incoming);
    if (oldTime === null || incomingTime === null || incomingTime <= oldTime) {
      fail('UNRESOLVED_KEYWORD_IMPORT', 'Conflicting keyword evidence cannot be replaced without a strictly newer export date.', {
        report_identity: incomingIdentity
      });
    }
    reports[index] = incoming;
  }
  return {
    ...current,
    reports,
    refreshed_at: now,
    needs_reanalysis: true
  };
}
