const DEFAULT_LIMITS = {
  title_chars: 75,
  item_highlights_chars: 125,
  bullet_chars: 200,
  bullets_combined_chars: 1000,
  description_chars: 2000,
  search_terms_bytes: 250,
};

const BULLET_FORMAT = /^\[[A-Z0-9 &/-]{2,40}\] /;
const GENERIC_PROHIBITED = [
  {label: 'promotion', pattern: /\b(?:limited time|sale|discount|coupon|free shipping|best seller)\b/i},
  {label: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i},
  {label: 'url', pattern: /(?:https?:\/\/|www\.)\S+/i},
  {label: 'phone', pattern: /(?:\+?\d[\d ()-]{7,}\d)/},
  {label: 'html', pattern: /<\/?[a-z][^>]*>/i},
];

const chars = value => [...String(value ?? '')].length;

export function utf8Bytes(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

const SCHEMA_SCOPE_FIELDS = ['project_id', 'marketplace', 'product_type', 'product_master_version', 'listing_version'];

export function createSchemaAuthorization(scope, { authorized_at = new Date().toISOString() } = {}) {
  const missing = SCHEMA_SCOPE_FIELDS.filter(field => scope?.[field] === undefined || scope[field] === null || scope[field] === '');
  if (missing.length) throw new TypeError(`Schema authorization scope is incomplete: ${missing.join(', ')}`);
  return {
    status: 'authorized_to_continue_with_warnings',
    ...Object.fromEntries(SCHEMA_SCOPE_FIELDS.map(field => [field, scope[field]])),
    authorized_at
  };
}

export function isSchemaAuthorizationCurrent(authorization, scope) {
  return authorization?.status === 'authorized_to_continue_with_warnings'
    && SCHEMA_SCOPE_FIELDS.every(field => authorization[field] === scope?.[field]);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

export function normalizeListing(input = {}) {
  return {
    ...input,
    title: typeof input.title === 'string' ? input.title.trim() : '',
    item_highlights: typeof input.item_highlights === 'string' ? input.item_highlights.trim() : '',
    bullets: Array.isArray(input.bullets) ? input.bullets.map(value => String(value).trim()) : [],
    description: typeof input.description === 'string' ? input.description.trim() : '',
    backend_search_terms: typeof input.backend_search_terms === 'string' ? input.backend_search_terms.trim() : '',
    special_features: asArray(input.special_features).map(value => String(value).trim()).filter(Boolean),
    attributes: input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes) ? {...input.attributes} : {},
    claim_refs: input.claim_refs && typeof input.claim_refs === 'object' && !Array.isArray(input.claim_refs) ? structuredClone(input.claim_refs) : {},
    rules_unverified: Array.isArray(input.rules_unverified) ? [...input.rules_unverified] : [],
    schema_authorization: input.schema_authorization ?? null,
    validation: input.validation && typeof input.validation === 'object' ? {...input.validation} : {condense_attempts: 0},
  };
}

function addLimitError(errors, field, actual, limit, unit = 'characters') {
  if (actual > limit) errors.push({field, code: unit === 'bytes' ? 'BYTE_LIMIT' : 'CHAR_LIMIT', actual, limit, unit});
}

function textualFields(listing) {
  return [
    ['title', listing.title],
    ['item_highlights', listing.item_highlights],
    ...listing.bullets.map((value, index) => [`bullets[${index}]`, value]),
    ['description', listing.description],
    ...listing.special_features.map((value, index) => [`special_features[${index}]`, value]),
    ...Object.entries(listing.attributes).filter(([, value]) => typeof value === 'string').map(([key, value]) => [`attributes.${key}`, value]),
  ];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateProhibitedContent(listing, context, errors) {
  const prohibited = [...GENERIC_PROHIBITED];
  for (const brand of context.competitorBrands ?? []) {
    prohibited.push({label: `competitor brand: ${brand}`, pattern: new RegExp(`\\b${escapeRegex(brand)}\\b`, 'i')});
  }
  for (const [field, text] of textualFields(listing)) {
    for (const rule of prohibited) {
      if (rule.pattern.test(text)) errors.push({field, code: 'PROHIBITED_CONTENT', pattern: rule.label});
    }
  }
}

function validateRefArray(value, field, publishableFacts, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({field, code: 'CLAIM_REFS_MISSING'});
    return;
  }
  for (const factId of value) {
    if (!publishableFacts.has(factId)) errors.push({field, code: 'UNAPPROVED_FACT', fact_id: factId});
  }
}

function validateClaimRefs(listing, publishableFacts, errors) {
  const refs = listing.claim_refs;
  for (const field of ['title', 'item_highlights', 'description']) validateRefArray(refs[field], field, publishableFacts, errors);
  if (!Array.isArray(refs.bullets) || refs.bullets.length !== listing.bullets.length) {
    errors.push({field: 'bullets', code: 'CLAIM_REFS_MISSING'});
  } else {
    refs.bullets.forEach((value, index) => validateRefArray(value, `bullets[${index}]`, publishableFacts, errors));
  }
  if (listing.special_features.length > 0) {
    if (!Array.isArray(refs.special_features) || refs.special_features.length !== listing.special_features.length) {
      errors.push({field: 'special_features', code: 'CLAIM_REFS_MISSING'});
    } else {
      refs.special_features.forEach((value, index) => validateRefArray(value, `special_features[${index}]`, publishableFacts, errors));
    }
  }
  for (const key of Object.keys(listing.attributes)) validateRefArray(refs.attributes?.[key], `attributes.${key}`, publishableFacts, errors);
}

export function validateListing(input, context = {}) {
  const listing = normalizeListing(input);
  const limits = {...DEFAULT_LIMITS, ...(context.limits ?? {})};
  const errors = [];
  const counts = {
    title_chars: chars(listing.title),
    item_highlights_chars: chars(listing.item_highlights),
    bullet_chars: listing.bullets.map(chars),
    bullets_combined_chars: listing.bullets.reduce((total, bullet) => total + chars(bullet), 0),
    description_chars: chars(listing.description),
    search_terms_bytes: utf8Bytes(listing.backend_search_terms),
  };

  for (const field of ['project_id', 'version', 'marketplace', 'language', 'product_type', 'product_master_version', 'title', 'item_highlights', 'description', 'backend_search_terms']) {
    if (listing[field] === null || listing[field] === undefined || listing[field] === '') errors.push({field, code: 'REQUIRED'});
  }
  if (listing.special_features.length === 0) errors.push({field: 'special_features', code: 'REQUIRED'});
  if (Object.keys(listing.attributes).length === 0) errors.push({field: 'attributes', code: 'REQUIRED'});
  addLimitError(errors, 'title', counts.title_chars, limits.title_chars);
  addLimitError(errors, 'item_highlights', counts.item_highlights_chars, limits.item_highlights_chars);
  if (listing.bullets.length !== 5) errors.push({field: 'bullets', code: 'BULLET_COUNT', actual: listing.bullets.length, expected: 5});
  listing.bullets.forEach((bullet, index) => {
    if (!BULLET_FORMAT.test(bullet)) errors.push({field: `bullets[${index}]`, code: 'BULLET_FORMAT'});
    addLimitError(errors, `bullets[${index}]`, counts.bullet_chars[index], limits.bullet_chars);
  });
  if (counts.bullets_combined_chars > limits.bullets_combined_chars) {
    errors.push({field: 'bullets', code: 'BULLETS_COMBINED_LIMIT', actual: counts.bullets_combined_chars, limit: limits.bullets_combined_chars});
  }
  addLimitError(errors, 'description', counts.description_chars, limits.description_chars);
  addLimitError(errors, 'backend_search_terms', counts.search_terms_bytes, limits.search_terms_bytes, 'bytes');

  if (context.currentProductMasterVersion !== undefined && listing.product_master_version !== context.currentProductMasterVersion) {
    errors.push({field: 'product_master_version', code: 'STALE_PRODUCT_MASTER', actual: listing.product_master_version, expected: context.currentProductMasterVersion});
  }
  validateClaimRefs(listing, context.publishableFactIds ?? new Set(), errors);
  validateProhibitedContent(listing, context, errors);

  if ((listing.validation.condense_attempts ?? 0) >= 1 && errors.some(error => ['CHAR_LIMIT', 'BYTE_LIMIT', 'BULLETS_COMBINED_LIMIT'].includes(error.code))) {
    errors.push({field: 'validation', code: 'LIMIT_AFTER_CONDENSE', message: 'Content remains over a configured limit after one condense pass.'});
  }

  const schemaVerified = context.schemaVerified !== false;
  listing.rules_unverified = schemaVerified ? [] : [...new Set(context.unverifiedFields ?? [])];
  listing.schema_authorization = schemaVerified ? null : (context.schemaAuthorization ?? listing.schema_authorization);
  const authorizationScope = {
    project_id: context.projectId ?? listing.project_id,
    marketplace: listing.marketplace,
    product_type: listing.product_type,
    product_master_version: listing.product_master_version,
    listing_version: listing.version,
  };
  const authorizationCurrent = schemaVerified || isSchemaAuthorizationCurrent(listing.schema_authorization, authorizationScope);
  if (!schemaVerified && listing.schema_authorization && !authorizationCurrent) {
    errors.push({field: 'schema_authorization', code: 'SCHEMA_AUTHORIZATION_SCOPE_MISMATCH', expected: authorizationScope});
  }
  listing.upload_ready = errors.length === 0 && schemaVerified;
  const status = errors.length > 0
    ? ((listing.validation.condense_attempts ?? 0) >= 1 && errors.some(error => error.code === 'LIMIT_AFTER_CONDENSE') ? 'BLOCKED' : 'REVIEW_REQUIRED')
    : (schemaVerified ? 'PASS' : (authorizationCurrent ? 'PASS_WITH_WARNINGS' : 'AUTHORIZATION_REQUIRED'));
  listing.validation = {...listing.validation, status, counts, errors};
  return {ok: errors.length === 0, status, listing, counts, errors};
}
