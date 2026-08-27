import {auditListing} from './listing-audit.js';
import {computeCommonFacts, variationTupleKey} from './variations.js';

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

  while (joinedLength([...prefix, ...requiredVariation]) > limit && prefix.length > core.length) {
    prefix.pop();
  }
  if (joinedLength([...prefix, ...requiredVariation]) > limit) {
    throw new RangeError('core title terms and variation values exceed the title limit');
  }

  const includedOptional = [];
  for (const part of optional) {
    if (joinedLength([...prefix, ...includedOptional, part, ...requiredVariation]) <= limit) {
      includedOptional.push(part);
    }
  }
  return [...prefix, ...includedOptional, ...requiredVariation].join(' ');
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

    const expectedTuple = variationTupleKey(dimensions, child.variation_values);
    const actualTuple = variationTupleKey(dimensions, content.variation_values);
    if (!expectedTuple || actualTuple !== expectedTuple || content.child_sku !== sku
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
        if (normalizedValue !== normalizedText(expected) && containsValue(content.title, value)) {
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

  const affectedSkus = [...new Set(findings.items.map(finding => finding.sku).filter(Boolean))];
  return {ok: findings.items.length === 0, findings: findings.items, affectedSkus};
}
