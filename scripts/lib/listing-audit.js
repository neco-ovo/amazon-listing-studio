import { fail } from './errors.js';

export const SYSTEM_LISTING_FIELDS = Object.freeze([
  'project_id',
  'marketplace',
  'language',
  'product_type',
  'product_master_version',
  'rules_unverified',
  'upload_ready',
  'schema_status',
  'rule_status',
  'schema_authorization'
]);

const SYSTEM_LISTING_FIELD_SET = new Set(SYSTEM_LISTING_FIELDS);

export function isSystemListingPath(fieldPath) {
  return SYSTEM_LISTING_FIELD_SET.has(String(fieldPath ?? '').split('.')[0]);
}

const PATTERNS = Object.freeze([
  {code: 'INTERNAL_QA_LANGUAGE', pattern: /\b(?:empty (?:corner )?mounting holes?|confirmed (?:outdoor[- ]resistant )?performance|no visible screws?)\b/i},
  {code: 'ABSTRACT_RETAIL_PHRASE', pattern: /\b(?:supports exposed settings|supports straightforward placement|provides versatile use|remain suited to exposed placement|performance makes it)\b/i},
  {code: 'UNSUPPORTED_ABSOLUTE', pattern: /\b(?:guaranteed|lasts forever|never rusts?|osha compliant|lifetime warranty)\b/i}
]);

function strings(value, prefix = '') {
  if (typeof value === 'string') return [{path: prefix, value}];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, prefix ? `${prefix}.${index}` : String(index)));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => strings(item, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

export function auditListing(content, context = {}) {
  const findings = [];
  for (const entry of strings(content)) {
    for (const rule of PATTERNS) {
      if (rule.pattern.test(entry.value)) findings.push({path: entry.path, code: rule.code});
    }
  }

  const backend = String(content?.backend_search_terms ?? '').toLocaleLowerCase('en-US');
  const buyerTerms = (context.buyerTerms ?? []).map(term => String(term).toLocaleLowerCase('en-US')).filter(Boolean);
  if (backend && buyerTerms.length > 0 && !buyerTerms.some(term => backend.includes(term))) {
    findings.push({path: 'backend_search_terms', code: 'WEAK_SEARCH_INTENT'});
  }

  const unique = [];
  const seen = new Set();
  for (const finding of findings) {
    const key = `${finding.path}:${finding.code}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(finding);
    }
  }
  return {
    ok: unique.length === 0,
    findings: unique,
    changed_paths: [...new Set(unique.map(item => item.path))]
  };
}

export function deriveListingScope(state, content = {}) {
  const project = state?.project;
  const master = state?.product_master;
  if (!project?.product_id || !project.marketplace || !project.language || !project.product_type) {
    fail('BLOCKING_INPUT', 'Current project scope is incomplete');
  }
  if (master?.status !== 'locked' || !Number.isInteger(master.version) || master.version < 1) {
    fail('STALE_DEPENDENCY', 'Listing approval requires the current locked Product Master');
  }
  const rulesUnverified = Array.isArray(state.listing?.rules_unverified)
    ? [...new Set(state.listing.rules_unverified)]
    : [];
  const uploadReady = state.listing?.upload_ready === true && rulesUnverified.length === 0;
  return {
    project_id: project.product_id,
    marketplace: project.marketplace,
    language: project.language,
    product_type: project.product_type,
    product_master_version: master.version,
    rules_unverified: rulesUnverified,
    upload_ready: uploadReady,
    rule_status: state.listing?.rule_status ?? (uploadReady ? 'verified' : 'rules_unverified')
  };
}

export function preflightListingScope(state, content = {}) {
  const scope = deriveListingScope(state, content);
  for (const [field, expected] of Object.entries(scope)) {
    if (field === 'rules_unverified' || field === 'upload_ready') continue;
    // Older v2 drafts predate the explicit rule_status field. Its value is
    // still derived from authoritative state and frozen on the next approval.
    if (field === 'rule_status' && content[field] === undefined) continue;
    if (content[field] !== expected) fail('BLOCKING_INPUT', 'Listing scope does not match current project state', {field, expected, actual: content[field] ?? null});
  }
  if (!Array.isArray(content.rules_unverified)) fail('BLOCKING_INPUT', 'Listing rules_unverified must be an array');
  if (content.rules_unverified.length > 0 && content.upload_ready === true) {
    fail('BLOCKING_INPUT', 'Schema-unverified Listing cannot be upload ready');
  }
  return {ok: true, scope};
}
