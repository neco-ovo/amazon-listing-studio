import {fail} from './errors.js';
import {compileImageBrief} from './image-briefs.js';

const VALID_SCOPE_TYPES = new Set([
  'child_specific',
  'shared_asset',
  'subset_shared',
  'family_range_asset',
  'parent_asset'
]);

const VISIBLE_ATTRIBUTE_ALIASES = Object.freeze({
  size_name: ['size_name', 'size'],
  color_name: ['color_name', 'color'],
  pattern_name: ['pattern_name', 'pattern'],
  style_name: ['style_name', 'style'],
  pack_count: ['pack_count', 'item_package_quantity', 'number_of_items'],
  item_package_quantity: ['item_package_quantity', 'pack_count', 'number_of_items'],
  number_of_items: ['number_of_items', 'pack_count', 'item_package_quantity'],
  orientation: ['orientation']
});

function normalizedText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\b(?:inches|inch|in)\b/g, 'in')
    .match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? '';
}

function nonEmptySkuList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    fail('BLOCKING_INPUT', `${label} requires a non-empty explicit child_skus list`);
  }
  const skus = value.map(sku => typeof sku === 'string' ? sku.trim() : '');
  if (skus.some(sku => !sku) || new Set(skus).size !== skus.length) {
    fail('BLOCKING_INPUT', `${label} child_skus must be unique non-empty SKU strings`);
  }
  return skus;
}

function normalizeScope(scope, child) {
  if (!scope || Array.isArray(scope) || typeof scope !== 'object' || !VALID_SCOPE_TYPES.has(scope.type)) {
    fail('BLOCKING_INPUT', 'Variation image scope must use an allowed explicit scope type');
  }

  let childSkus = [];
  if (scope.type === 'child_specific') {
    childSkus = nonEmptySkuList(scope.child_skus, 'child_specific');
    if (childSkus.length !== 1) fail('BLOCKING_INPUT', 'child_specific scope requires exactly one Child SKU');
    if (!child?.sku || child.sku !== childSkus[0]) {
      fail('BLOCKING_INPUT', 'child_specific scope must match the supplied Child SKU');
    }
  } else if (scope.type === 'subset_shared') {
    childSkus = nonEmptySkuList(scope.child_skus, 'subset_shared');
    if (child?.sku && !childSkus.includes(child.sku)) {
      fail('BLOCKING_INPUT', 'subset_shared scope must include the supplied Child SKU');
    }
  }

  return {type: scope.type, child_skus: childSkus};
}

function freezeDeep(value) {
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freezeDeep(item);
  }
  return Object.freeze(value);
}

function visibleRequirements(child, brief) {
  const required = {};
  for (const field of Object.keys(VISIBLE_ATTRIBUTE_ALIASES)) {
    if (field === 'orientation') continue;
    const value = child?.variation_values?.[field] ?? factValue(child?.facts?.[field]);
    if (normalizedText(value)) required[field] = structuredClone(value);
  }
  if (normalizedText(brief.identity?.orientation)) required.orientation = brief.identity.orientation;
  const printedWording = (brief.identity?.printed_copy ?? []).filter(value => normalizedText(value));
  if (printedWording.length > 0) required.printed_wording = structuredClone(printedWording);
  return required;
}

export function compileVariationImageBrief({
  scope,
  child = null,
  family = {},
  master,
  layoutSeed = null,
  userRequest = {},
  claims = {}
} = {}) {
  const normalizedScope = normalizeScope(scope, child);
  const brief = compileImageBrief({
    kind: userRequest.kind ?? family.image_kind ?? 'main',
    master,
    userRequest,
    references: family.references ?? {},
    claims,
    galleryItem: family.gallery_item ?? family.galleryItem ?? {},
    layoutSeed
  });
  brief.variation_binding = freezeDeep({
    scope: normalizedScope,
    child_sku: child?.sku ?? null,
    required_visible: visibleRequirements(child, brief)
  });
  return brief;
}

function factValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'value')) {
    return value.value;
  }
  return value;
}

function valuesMatch(expected, actual) {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  const actualValue = normalizedText(factValue(actual));
  return Boolean(actualValue) && expectedValues.some(value => normalizedText(value) === actualValue);
}

function assetScope(asset) {
  if (typeof asset?.scope === 'string') return {type: asset.scope, child_skus: asset.child_skus ?? []};
  if (asset?.scope && typeof asset.scope === 'object' && !Array.isArray(asset.scope)) {
    return {type: asset.scope.type, child_skus: asset.scope.child_skus ?? []};
  }
  return {type: null, child_skus: []};
}

export function evaluateSharedAssetApplicability({asset, child, commonFacts = {}} = {}) {
  const reasons = [];
  const scope = assetScope(asset);
  if (scope.type !== 'shared_asset' && scope.type !== 'subset_shared') {
    reasons.push('ASSET_SCOPE_NOT_SHARED');
    return {applicable: false, reasons};
  }
  if (scope.type === 'subset_shared') {
    const childSkus = Array.isArray(scope.child_skus) ? scope.child_skus : [];
    if (childSkus.length === 0) reasons.push('SUBSET_SCOPE_MISSING_CHILD_SKUS');
    else if (!child?.sku || !childSkus.includes(child.sku)) reasons.push('CHILD_OUTSIDE_ASSET_SCOPE');
  }

  for (const [field, expected] of Object.entries(asset?.fact_dependencies ?? {})) {
    if (!valuesMatch(expected, commonFacts?.[field])) reasons.push(`COMMON_FACT_MISMATCH:${field}`);
    if (!valuesMatch(expected, child?.facts?.[field])) reasons.push(`CHILD_FACT_MISMATCH:${field}`);
  }
  return {applicable: reasons.length === 0, reasons};
}

function observedValue(observation, aliases) {
  for (const field of aliases) {
    if (observation?.[field] !== undefined && observation?.[field] !== null) return observation[field];
  }
  return null;
}

function visibleText(observation) {
  const source = Array.isArray(observation?.visible_text) ? observation.visible_text : [observation?.visible_text];
  return source.filter(value => typeof value === 'string').join(' ');
}

function textIncludes(text, phrase) {
  const tokens = normalizedText(text).split(' ').filter(Boolean);
  const phraseTokens = normalizedText(phrase).split(' ').filter(Boolean);
  return phraseTokens.length > 0
    && (` ${tokens.join(' ')} `).includes(` ${phraseTokens.join(' ')} `);
}

export function validateVariationImageObservation({brief, observation = {}} = {}) {
  const required = brief?.variation_binding?.required_visible;
  if (!required || typeof required !== 'object') {
    return {ok: false, failures: [{code: 'MISSING_VARIATION_BINDING', message: 'Image brief has no Variation binding.'}]};
  }

  const failures = [];
  for (const [field, aliases] of Object.entries(VISIBLE_ATTRIBUTE_ALIASES)) {
    const expected = required[field];
    if (!normalizedText(expected)) continue;
    const actual = observedValue(observation, aliases);
    if (!normalizedText(actual)) {
      failures.push({code: 'MISSING_REQUIRED_VISIBLE_ATTRIBUTE', field, expected});
    } else if (normalizedText(actual) !== normalizedText(expected)) {
      failures.push({
        code: 'CROSS_CHILD_CONTAMINATION',
        field,
        expected,
        actual,
        message: `Observed ${field} belongs to a different Child than ${brief.variation_binding.child_sku ?? 'the bound scope'}.`
      });
    }
  }

  const observedText = visibleText(observation);
  for (const wording of required.printed_wording ?? []) {
    if (textIncludes(observedText, wording)) continue;
    failures.push({
      code: normalizedText(observedText) ? 'CROSS_CHILD_CONTAMINATION' : 'MISSING_CORE_PRINTED_WORDING',
      field: 'printed_wording',
      expected: wording,
      actual: observedText || null
    });
  }

  for (const finding of observation.inspection_findings ?? []) {
    if (finding?.code === 'VISIBLE_DISTORTION') {
      failures.push({code: 'VISIBLE_DISTORTION', ...structuredClone(finding)});
    }
  }
  return {ok: failures.length === 0, failures};
}
