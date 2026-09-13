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
        sources: {}
      };
      if (!current.sources[sourceType]) current.sources[sourceType] = {...row};
      merged.set(normalized, current);
    }
  }
  return [...merged.values()];
}

function bestMetric(item, field) {
  const values = Object.values(item.sources)
    .map(source => source[field])
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
