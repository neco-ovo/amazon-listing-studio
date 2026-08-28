import {auditListing} from './listing-audit.js';
import {computeCommonFacts} from './variations.js';

const OVERRIDE_FIELDS = new Set([
  'title',
  'item_highlights',
  'bullets',
  'description',
  'backend_search_terms',
  'special_features',
  'attributes',
  'claim_refs'
]);

const MERGED_OBJECT_FIELDS = new Set(['attributes', 'claim_refs']);
const RETAIL_FIELDS = [
  'title',
  'item_highlights',
  'bullets',
  'description',
  'backend_search_terms',
  'special_features',
  'attributes'
];
const REQUIRED_CHILD_FIELDS = [
  'project_id',
  'version',
  'marketplace',
  'language',
  'product_type',
  'product_master_version',
  'title',
  'item_highlights',
  'bullets',
  'description',
  'backend_search_terms',
  'special_features',
  'attributes'
];

function normalizedText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\b(?:inches|inch|in)\b/g, 'in')
    .replace(/\b(?:feet|foot|ft)\b/g, 'ft')
    .match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? '';
}

function containsValue(text, value) {
  const haystack = normalizedText(text);
  const needle = normalizedText(value);
  return Boolean(needle) && (` ${haystack} `).includes(` ${needle} `);
}

function phraseOccurrences(text, phrase) {
  const tokens = normalizedText(text).split(' ').filter(Boolean);
  const phraseTokens = normalizedText(phrase).split(' ').filter(Boolean);
  if (phraseTokens.length === 0) return [];
  const matches = [];
  for (let start = 0; start <= tokens.length - phraseTokens.length; start += 1) {
    if (phraseTokens.every((token, offset) => tokens[start + offset] === token)) {
      matches.push({start, end: start + phraseTokens.length - 1});
    }
  }
  return matches;
}

function containsIndependentValue(title, ownValue, siblingValue) {
  const own = phraseOccurrences(title, ownValue);
  const sibling = phraseOccurrences(title, siblingValue);
  return sibling.some(candidate => !own.some(interval => (
    interval.start <= candidate.start && interval.end >= candidate.end
  )));
}

function stringEntries(value, prefix) {
  if (typeof value === 'string') return [{path: prefix, value}];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => stringEntries(item, `${prefix}.${index}`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => stringEntries(item, `${prefix}.${key}`));
  }
  return [];
}

function retailStrings(content) {
  return RETAIL_FIELDS.flatMap(field => stringEntries(content?.[field], field));
}

function activeChildren(variation) {
  return Object.values(variation?.children ?? {}).filter(child => child && child.active !== false);
}

function childContentMap(childContents) {
  if (!Array.isArray(childContents)) return childContents ?? {};
  return Object.fromEntries(childContents
    .filter(content => content && typeof content === 'object')
    .map(content => [content.child_sku ?? content.sku, content]));
}

function addFinding(findings, finding) {
  const key = [finding.sku, finding.path, finding.code, normalizedText(finding.value)].join('\u001f');
  if (!findings.keys.has(key)) {
    findings.keys.add(key);
    findings.items.push(finding);
  }
}

function blockingInput(message) {
  const error = new Error(message);
  error.code = 'BLOCKING_INPUT';
  return error;
}

function titleCase(value) {
  return String(value).trim().replace(/\b\p{L}/gu, character => character.toLocaleUpperCase('en-US'));
}

function distinctParts(parts, seen = new Set()) {
  const result = [];
  for (const value of Array.isArray(parts) ? parts : []) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    const key = normalizedText(text);
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(titleCase(text));
    }
  }
  return result;
}

function joinedLength(parts) {
  return parts.join(' ').length;
}

function mergeObjects(base, override) {
  const merged = structuredClone(base ?? {});
  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    if (value && typeof value === 'object' && !Array.isArray(value)
      && baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)) {
      merged[key] = mergeObjects(baseValue, value);
    } else {
      merged[key] = structuredClone(value);
    }
  }
  return merged;
}

export function buildChildTitle({coreTerms = [], identity = [], attributes = [], variationValues = [], limit = 75} = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('title limit must be a positive integer');

  const seen = new Set();
  const core = distinctParts(coreTerms, seen);
  const identityParts = distinctParts(identity, seen);
  const optional = distinctParts(attributes, seen);
  const requiredVariation = distinctParts(variationValues, seen);
  const prefix = [...core, ...identityParts];

  if (joinedLength([...prefix, ...requiredVariation]) > limit) {
    throw blockingInput('core title terms, identity, and variation values exceed the title limit');
  }

  const includedOptional = [];
  for (const part of optional) {
    if (joinedLength([...prefix, ...includedOptional, part, ...requiredVariation]) <= limit) {
      includedOptional.push(part);
    }
  }
  return [...prefix, ...includedOptional, ...requiredVariation].join(' ');
}

function exactTuple(dimensions, expected, actual) {
  if (!expected || Array.isArray(expected) || typeof expected !== 'object'
    || !actual || Array.isArray(actual) || typeof actual !== 'object') return false;
  const actualKeys = Object.keys(actual);
  return actualKeys.length === dimensions.length
    && actualKeys.every((key, index) => key === dimensions[index])
    && dimensions.every(dimension => Object.hasOwn(expected, dimension)
      && Object.hasOwn(actual, dimension)
      && actual[dimension] === expected[dimension]);
}

function hasRequiredContent(value) {
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== null && value !== undefined;
}

function requiredChildContent(parentContent) {
  const required = new Map(REQUIRED_CHILD_FIELDS.map(field => [field, true]));
  for (const field of Object.keys(parentContent ?? {})) {
    if (!required.has(field)) required.set(field, false);
  }
  return required;
}

export function materializeChildListing({parentContent = {}, childOverrides = {}, child = {}, dimensions = []} = {}) {
  const content = structuredClone(parentContent);
  for (const [field, value] of Object.entries(childOverrides ?? {})) {
    if (!OVERRIDE_FIELDS.has(field)) continue;
    if (MERGED_OBJECT_FIELDS.has(field) && value && typeof value === 'object' && !Array.isArray(value)) {
      content[field] = mergeObjects(content[field], value);
    } else {
      content[field] = structuredClone(value);
    }
  }

  const theme = Array.isArray(dimensions) ? [...dimensions] : [];
  content.parent_sku = parentContent.parent_sku ?? parentContent.sku ?? null;
  content.child_sku = child.sku ?? null;
  content.variation_theme = theme;
  content.variation_values = Object.fromEntries(theme.map(dimension => [
    dimension,
    structuredClone(child.variation_values?.[dimension] ?? null)
  ]));
  return content;
}

export function auditVariationListings({parentContent = {}, childContents = {}, variation = {}} = {}) {
  const dimensions = Array.isArray(variation?.theme?.dimensions) ? variation.theme.dimensions : [];
  const children = activeChildren(variation);
  const contents = childContentMap(childContents);
  const parentSku = variation?.parent?.sku ?? parentContent.parent_sku ?? parentContent.sku ?? null;
  const findings = {items: [], keys: new Set()};
  const requiredContent = requiredChildContent(parentContent);
  const valuesByDimension = Object.fromEntries(dimensions.map(dimension => [dimension, new Map()]));
  for (const child of children) {
    for (const dimension of dimensions) {
      const value = child.variation_values?.[dimension];
      if (normalizedText(value)) valuesByDimension[dimension].set(normalizedText(value), value);
    }
  }

  const commonFacts = computeCommonFacts(children);
  const leakageValues = new Map();
  for (const child of children) {
    for (const dimension of dimensions) {
      const value = child.variation_values?.[dimension];
      if (normalizedText(value)) leakageValues.set(normalizedText(value), {field: dimension, value});
    }
  }
  for (const [field, values] of Object.entries(commonFacts.child_only)) {
    for (const value of values) {
      if (normalizedText(value)) leakageValues.set(normalizedText(value), {field, value});
    }
  }
  const conflictValues = new Map();
  for (const field of Object.keys(commonFacts.conflicts)) {
    addFinding(findings, {
      sku: parentSku,
      affected_skus: children.map(child => child.sku),
      path: `facts.${field}`,
      code: 'VARIATION_FACT_CONFLICT',
      field
    });
    for (const child of children) {
      const candidate = computeCommonFacts([child]).common[field];
      if (normalizedText(candidate)) {
        conflictValues.set(`${field}\u001f${normalizedText(candidate)}`, {field, value: candidate});
      }
    }
  }
  for (const entry of retailStrings(parentContent)) {
    for (const candidate of leakageValues.values()) {
      if (containsValue(entry.value, candidate.value)) {
        addFinding(findings, {
          sku: parentSku,
          path: entry.path,
          code: 'PARENT_CHILD_ONLY_ATTRIBUTE',
          field: candidate.field,
          value: candidate.value
        });
      }
    }
    for (const candidate of conflictValues.values()) {
      if (containsValue(entry.value, candidate.value)) {
        addFinding(findings, {
          sku: parentSku,
          path: entry.path,
          code: 'PARENT_UNRESOLVED_ATTRIBUTE',
          field: candidate.field,
          value: candidate.value
        });
      }
    }
  }

  for (const finding of auditListing(parentContent).findings) {
    addFinding(findings, {...finding, sku: parentSku});
  }

  for (const child of children) {
    const sku = child.sku;
    const content = contents[sku];
    if (!content) {
      addFinding(findings, {sku, path: '', code: 'MISSING_CHILD_LISTING'});
      continue;
    }

    for (const [field, requireValue] of requiredContent) {
      if (!Object.hasOwn(content, field) || (requireValue && !hasRequiredContent(content[field]))) {
        addFinding(findings, {sku, path: field, code: 'MISSING_CHILD_CONTENT'});
      }
    }

    if (!exactTuple(dimensions, child.variation_values, content.variation_values) || content.child_sku !== sku
      || content.parent_sku !== parentSku
      || JSON.stringify(content.variation_theme) !== JSON.stringify(dimensions)) {
      addFinding(findings, {
        sku,
        path: 'variation_values',
        code: 'CHILD_VARIATION_TUPLE_MISMATCH'
      });
    }

    for (const dimension of dimensions) {
      const expected = child.variation_values?.[dimension];
      if (normalizedText(content.attributes?.[dimension]) !== normalizedText(expected)) {
        addFinding(findings, {
          sku,
          path: `attributes.${dimension}`,
          code: 'CHILD_VARIATION_ATTRIBUTE_MISMATCH',
          field: dimension,
          value: expected
        });
      }
      if (!containsValue(content.title, expected)) {
        addFinding(findings, {
          sku,
          path: 'title',
          code: 'CHILD_TITLE_VARIATION_MISMATCH',
          field: dimension,
          value: expected
        });
      }
      for (const [normalizedValue, value] of valuesByDimension[dimension]) {
        if (normalizedValue !== normalizedText(expected)
          && containsIndependentValue(content.title, expected, value)) {
          addFinding(findings, {
            sku,
            path: 'title',
            code: 'CHILD_TITLE_VARIATION_MISMATCH',
            field: dimension,
            value
          });
        }
      }
    }

    for (const finding of auditListing(content).findings) {
      addFinding(findings, {...finding, sku});
    }
  }

  const affectedSkus = [...new Set(findings.items.flatMap(finding => [
    finding.sku,
    ...(finding.affected_skus ?? [])
  ]).filter(Boolean))];
  return {ok: findings.items.length === 0, findings: findings.items, affectedSkus};
}
