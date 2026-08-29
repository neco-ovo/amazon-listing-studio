import {fail} from './errors.js';
import {compileImageBrief} from './image-briefs.js';
import {isDeepStrictEqual} from 'node:util';

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
    .replace(/[×✕]/gu, ' x ')
    .replace(/(\d)\s*x\s*(\d)/g, '$1 x $2')
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
  const orientation = brief.output?.target_orientation ?? brief.identity?.orientation;
  if (normalizedText(orientation)) required.orientation = orientation;
  const printedWording = (brief.identity?.printed_copy ?? []).filter(value => normalizedText(value));
  if (printedWording.length > 0) required.printed_wording = structuredClone(printedWording);
  return required;
}

function semanticChildFacts(facts) {
  if (!facts || Array.isArray(facts) || typeof facts !== 'object') return {};
  return Object.fromEntries(Object.entries(facts)
    .map(([field, fact]) => [field, factValue(fact)])
    .filter(([, value]) => value !== null && value !== undefined && normalizedText(value))
    .map(([field, value]) => [field, structuredClone(value)]));
}

function childPrintedWording(child) {
  const productMaster = child?.product_master ?? child?.master ?? {};
  const wording = child?.printed_copy ?? productMaster?.printed_copy ?? productMaster?.identity?.printed_copy ?? [];
  return (Array.isArray(wording) ? wording : [wording]).filter(value => normalizedText(value));
}

function activeFamilyChildren(family) {
  const children = Array.isArray(family?.children) ? family.children : Object.values(family?.children ?? {});
  return children.filter(child => child && typeof child === 'object' && child.active !== false);
}

function phraseOverlaps(left, right) {
  const leftText = normalizedText(left);
  const rightText = normalizedText(right);
  return Boolean(leftText && rightText)
    && ((` ${leftText} `).includes(` ${rightText} `) || (` ${rightText} `).includes(` ${leftText} `));
}

function phraseTokens(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[×✕]/gu, ' x ')
    .replace(/(\d)\s*x\s*(\d)/gi, '$1 x $2')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function residualForeignPhrase(value, protectedValues) {
  const candidateText = normalizedText(value);
  if (protectedValues.some(own => normalizedText(own).includes(candidateText))) return null;

  const originalTokens = phraseTokens(value);
  const normalizedTokens = originalTokens.map(normalizedText);
  const protectedPhrases = protectedValues.flatMap(protectedValue => {
    const tokens = phraseTokens(protectedValue).map(normalizedText);
    if (tokens.at(-1) === 'in') return [tokens, tokens.slice(0, -1)];
    return [tokens];
  }).filter(tokens => tokens.length > 0)
    .sort((left, right) => right.length - left.length);

  let removed = true;
  while (removed) {
    removed = false;
    for (const protectedTokens of protectedPhrases) {
      for (let start = 0; start <= normalizedTokens.length - protectedTokens.length; start += 1) {
        if (!protectedTokens.every((token, index) => normalizedTokens[start + index] === token)) continue;
        originalTokens.splice(start, protectedTokens.length);
        normalizedTokens.splice(start, protectedTokens.length);
        removed = true;
        break;
      }
      if (removed) break;
    }
  }
  const residual = originalTokens.join(' ');
  return normalizedText(residual) ? residual : null;
}

function forbiddenSiblingVisible(family, child, required) {
  const protectedValues = [
    ...Object.values(required).flatMap(value => Array.isArray(value) ? value : [value]),
    ...Object.values(child?.variation_values ?? {})
  ];
  const seen = new Set();
  const add = (items, value) => {
    const normalized = normalizedText(value);
    if (!normalized || seen.has(normalized)) return;
    if (protectedValues.some(own => phraseOverlaps(value, own))) {
      const residual = residualForeignPhrase(value, protectedValues);
      if (residual) add(items, residual);
      return;
    }
    seen.add(normalized);
    items.push(structuredClone(value));
  };
  const values = [];
  const printedWording = [];
  for (const sibling of activeFamilyChildren(family)) {
    if (!sibling.sku || sibling.sku === child?.sku) continue;
    for (const value of Object.values(sibling.variation_values ?? {})) add(values, value);
    for (const wording of childPrintedWording(sibling)) add(printedWording, wording);
  }
  return {values, printed_wording: printedWording};
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
  const requiredVisible = visibleRequirements(child, brief);
  brief.variation_binding = freezeDeep({
    scope: normalizedScope,
    child_sku: child?.sku ?? null,
    variation_values: structuredClone(child?.variation_values ?? {}),
    child_facts: semanticChildFacts(child?.facts),
    required_visible: requiredVisible,
    forbidden_sibling_visible: forbiddenSiblingVisible(family, child, requiredVisible)
  });
  return brief;
}

function factValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'value')) {
    return value.value;
  }
  return value;
}

function normalizedSemanticValue(value) {
  const semantic = factValue(value);
  if (Array.isArray(semantic)) return semantic.map(normalizedSemanticValue);
  if (semantic && typeof semantic === 'object') {
    return Object.fromEntries(Object.keys(semantic).sort().map(key => [key, normalizedSemanticValue(semantic[key])]));
  }
  if (typeof semantic === 'string') return normalizedText(semantic);
  return semantic;
}

function valuesMatch(expected, actual) {
  const actualValue = normalizedSemanticValue(actual);
  return actualValue !== null && actualValue !== undefined && actualValue !== ''
    && isDeepStrictEqual(normalizedSemanticValue(expected), actualValue);
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
  if (!asset?.fact_dependencies || Array.isArray(asset.fact_dependencies)
    || typeof asset.fact_dependencies !== 'object' || Object.keys(asset.fact_dependencies).length === 0) {
    reasons.push('MISSING_FACT_DEPENDENCIES');
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

  for (const value of brief.variation_binding.forbidden_sibling_visible?.values ?? []) {
    if (!textIncludes(observedText, value)) continue;
    failures.push({
      code: 'CROSS_CHILD_CONTAMINATION',
      field: 'variation_values',
      actual: value,
      message: 'Observed visible value belongs to an active sibling Child.'
    });
  }
  for (const wording of brief.variation_binding.forbidden_sibling_visible?.printed_wording ?? []) {
    if (!textIncludes(observedText, wording)) continue;
    failures.push({
      code: 'CROSS_CHILD_CONTAMINATION',
      field: 'printed_wording',
      actual: wording,
      message: 'Observed printed wording belongs to an active sibling Child.'
    });
  }

  for (const finding of observation.inspection_findings ?? []) {
    if (finding?.code === 'VISIBLE_DISTORTION') {
      failures.push({code: 'VISIBLE_DISTORTION', ...structuredClone(finding)});
    }
  }
  return {ok: failures.length === 0, failures};
}
