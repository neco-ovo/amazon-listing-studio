import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validateProjectState } from './project-state.js';
import { updateProject } from './transactions.js';
import { evaluateSharedAssetApplicability } from './variation-images.js';
import {
  computeCommonFacts,
  createVariationExtension,
  selectVariationTheme,
  validateVariationExtension,
  variationTupleKey
} from './variations.js';

const SUPPLEMENTAL_DIRECTORIES = childSku => [
  'family/shared-assets',
  'parent/listing',
  `children/${childSku}/assets`,
  `children/${childSku}/listing`
];

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), {code, details});
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function operationNow(value) {
  return typeof value === 'string' && value.trim() ? value : new Date().toISOString();
}

function assertVariationState(state) {
  if (!record(state?.variation) || state.project?.mode !== 'variation_family') {
    fail('BLOCKING_INPUT', 'A Variation Family project is required');
  }
  const validation = validateVariationExtension(state.variation);
  if (!validation.valid) {
    fail('BLOCKING_INPUT', 'Existing Variation state is invalid', {errors: validation.errors});
  }
}

function activeChildren(variation) {
  return Object.values(variation.children ?? {}).filter(child => child?.active !== false);
}

function factValue(value) {
  return record(value) && Object.hasOwn(value, 'value') ? value.value : value;
}

function normalizedSemanticValue(value) {
  const semantic = factValue(value);
  if (typeof semantic === 'string') return semantic.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
  if (semantic === null || semantic === undefined) return '';
  return JSON.stringify(semantic);
}

function supportedFact(value) {
  if (!record(value) || !Object.hasOwn(value, 'value')) {
    return Boolean(normalizedSemanticValue(value));
  }
  return value.publishable === true
    && value.status === 'user_confirmed'
    && (!Array.isArray(value.conflicts) || value.conflicts.length === 0)
    && Boolean(normalizedSemanticValue(value));
}

function lockedIdentityCommonFacts(variation) {
  if (variation.family_identity?.status !== 'locked' || !record(variation.family_identity.facts)) return {};
  return Object.fromEntries(Object.entries(variation.family_identity.facts)
    .filter(([field, value]) => supportedFact(value) && activeChildren(variation).every(child => {
      const childFact = child.facts?.[field];
      return childFact === undefined
        || (supportedFact(childFact)
          && normalizedSemanticValue(childFact) === normalizedSemanticValue(value));
    }))
    .map(([field, value]) => [field, structuredClone(factValue(value))]));
}

function commonFacts(variation) {
  return {
    ...lockedIdentityCommonFacts(variation),
    ...computeCommonFacts(activeChildren(variation)).common
  };
}

function inheritedChildFacts(variation) {
  const inherited = {};
  if (variation.family_identity?.status === 'locked' && record(variation.family_identity.facts)) {
    for (const [field, value] of Object.entries(variation.family_identity.facts)) {
      if (supportedFact(value)) inherited[field] = structuredClone(value);
    }
  }
  for (const [field, commonValue] of Object.entries(computeCommonFacts(activeChildren(variation)).common)) {
    const representative = activeChildren(variation)
      .map(child => child.facts?.[field])
      .find(value => supportedFact(value)
        && normalizedSemanticValue(value) === normalizedSemanticValue(commonValue));
    inherited[field] = structuredClone(representative ?? commonValue);
  }
  return inherited;
}

function markStale(value, {reason, affectedIds, now}) {
  return {
    ...value,
    status: 'stale',
    stale_at: now,
    stale_reason: reason,
    affected_ids: [...affectedIds]
  };
}

function recordOperation(variation, {kind, reasons, affectedIds, now}) {
  variation.last_operation = {
    kind,
    at: now,
    stale_reasons: [...new Set(reasons)],
    affected_ids: [...new Set(affectedIds)]
  };
  variation.updated_at = now;
}

function updateProjectTimestamp(state, now) {
  if (record(state.project)) state.project.updated_at = now;
}

function sharedAssetIsApproved(asset) {
  return asset?.status === 'approved' || Boolean(asset?.approval_id) || Boolean(asset?.approved_at);
}

function recomputeSharedApplicability(variation, now) {
  const children = activeChildren(variation);
  const common = commonFacts(variation);
  const applicability = {};
  for (const [assetId, asset] of Object.entries(variation.shared_assets ?? {})) {
    const applicable = [];
    const inapplicable = [];
    const reasonsByChild = {};
    for (const child of children) {
      const result = evaluateSharedAssetApplicability({asset, child, commonFacts: common});
      if (result.applicable) applicable.push(child.sku);
      else {
        inapplicable.push(child.sku);
        reasonsByChild[child.sku] = result.reasons;
      }
    }
    applicability[assetId] = {
      applicable_child_skus: applicable,
      inapplicable_child_skus: inapplicable,
      reasons_by_child: reasonsByChild,
      evaluated_at: now
    };
    if (!sharedAssetIsApproved(asset)) asset.applicable_child_skus = [...applicable];
  }
  variation.shared_asset_applicability = applicability;
}

function validateChildSku(sku) {
  if (typeof sku !== 'string' || sku !== sku.trim() || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sku)) {
    fail('BLOCKING_INPUT', 'Child SKU is unsafe or invalid', {sku: sku ?? null});
  }
}

function assertSavedThemeVerified(variation) {
  if (variation.theme?.verification_status !== 'verified' || !verifiedThemeSource(variation.theme?.source)) {
    fail('BLOCKING_INPUT', 'A currently verified saved Variation theme and source are required');
  }
  const selected = selectVariationTheme({
    allowedThemes: variation.theme.source.allowed_themes,
    requestedDimensions: variation.theme.dimensions
  });
  if (!isDeepStrictEqual(selected.dimensions, variation.theme.dimensions)) {
    fail('BLOCKING_INPUT', 'Saved Variation theme dimensions do not exactly match verified category evidence');
  }
}

function assertCompleteTuple(variation, values, facts) {
  if (!record(values)) fail('BLOCKING_INPUT', 'Child variation_values are required');
  const dimensions = variation.theme.dimensions;
  if (!isDeepStrictEqual(Object.keys(values), dimensions)) {
    fail('BLOCKING_INPUT', 'Child variation_values must use the exact ordered Variation theme fields', {
      expected: dimensions,
      actual: Object.keys(values)
    });
  }
  const invalid = dimensions.filter(dimension => (
    typeof values[dimension] !== 'string'
    || values[dimension].trim() === ''
    || !Object.hasOwn(facts ?? {}, dimension)
    || normalizedSemanticValue(facts[dimension]) !== normalizedSemanticValue(values[dimension])
  ));
  if (invalid.length > 0) {
    fail('BLOCKING_INPUT', 'Child dimension facts must semantically match the complete variation tuple', {fields: invalid});
  }
}

function assertUniqueChild(variation, sku, values) {
  if (Object.hasOwn(variation.children, sku)) {
    fail('BLOCKING_INPUT', 'Child SKU already exists', {sku});
  }
  const tuple = variationTupleKey(variation.theme.dimensions, values);
  const duplicate = Object.values(variation.children).find(child => (
    variationTupleKey(variation.theme.dimensions, child.variation_values) === tuple
  ));
  if (duplicate) {
    fail('BLOCKING_INPUT', 'A Child record already uses this variation tuple', {
      sku: duplicate.sku,
      tuple
    });
  }
}

function promotedListingFields(parent) {
  const fields = parent?.listing?.promoted_fields ?? parent?.promoted_listing_fields ?? [];
  return new Set(Array.isArray(fields) ? fields : []);
}

const SYSTEM_VARIATION_LISTING_FIELDS = new Set([
  'variation_theme', 'variation_values', 'parent_sku', 'child_sku'
]);

function assertListingPatchAllowed(patch) {
  const protectedFields = Object.keys(record(patch) ? patch : {})
    .filter(field => SYSTEM_VARIATION_LISTING_FIELDS.has(field));
  if (protectedFields.length > 0) {
    fail('BLOCKING_INPUT', 'Child Listing patch cannot modify system-owned Variation fields', {
      fields: protectedFields
    });
  }
}

function changedPatch(current, patch) {
  const changed = {};
  for (const [field, value] of Object.entries(record(patch) ? patch : {})) {
    if (!isDeepStrictEqual(current?.[field], value)) changed[field] = structuredClone(value);
  }
  return changed;
}

function currentListingContent(listing) {
  if (record(listing?.draft?.content)) return listing.draft.content;
  if (record(listing?.overrides)) return listing.overrides;
  const approved = listing?.approved?.at(-1);
  return record(approved?.content) ? approved.content : {};
}

function updateChildListing(listing, patch, sku, now) {
  const current = currentListingContent(listing);
  const fields = changedPatch(current, patch);
  if (Object.keys(fields).length === 0) return {listing, changedFields: []};
  const approvedVersion = Number(listing?.approved?.at(-1)?.version ?? 0);
  const draftRevision = Number(listing?.draft?.revision ?? approvedVersion);
  return {
    listing: {
      ...(record(listing) ? listing : {}),
      status: 'draft',
      draft: {
        revision: draftRevision + 1,
        content: {...structuredClone(current), ...fields},
        updated_at: now
      },
      approved: structuredClone(listing?.approved ?? []),
      stale_at: now,
      stale_reason: 'CHILD_LISTING_FIELDS_CHANGED',
      affected_ids: [sku]
    },
    changedFields: Object.keys(fields)
  };
}

export function addVariationChild(state, input = {}) {
  assertVariationState(state);
  assertSavedThemeVerified(state.variation);
  validateChildSku(input.sku);
  if (!record(input.facts)) fail('BLOCKING_INPUT', 'Child facts are required');
  assertCompleteTuple(state.variation, input.variation_values, input.facts);
  assertUniqueChild(state.variation, input.sku, input.variation_values);

  const now = operationNow(input.now);
  const next = structuredClone(state);
  const variation = next.variation;
  variation.children[input.sku] = {
    sku: input.sku,
    active: true,
    variation_values: structuredClone(input.variation_values),
    facts: {...inheritedChildFacts(variation), ...structuredClone(input.facts)},
    product_master: null,
    listing: {status: 'draft', draft: null, approved: []},
    legacy_refs: {},
    history: [{kind: 'added', at: now}]
  };

  const affectedIds = [variation.parent.sku, input.sku];
  variation.parent.common_facts = commonFacts(variation);
  variation.parent = markStale(variation.parent, {
    reason: 'ACTIVE_CHILD_SET_CHANGED', affectedIds, now
  });
  recomputeSharedApplicability(variation, now);
  recordOperation(variation, {
    kind: 'add_child', reasons: ['ACTIVE_CHILD_SET_CHANGED'], affectedIds, now
  });
  updateProjectTimestamp(next, now);
  return next;
}

export function reviseVariationChild(state, input = {}) {
  const {sku, factPatch, listingPatch, now: requestedNow} = input;
  assertVariationState(state);
  validateChildSku(sku);
  const existing = state.variation.children[sku];
  if (!existing || existing.active === false) {
    fail('BLOCKING_INPUT', 'An active Child is required for revision', {sku});
  }
  if (factPatch !== undefined && !record(factPatch)) fail('BLOCKING_INPUT', 'factPatch must be an object');
  if (listingPatch !== undefined && !record(listingPatch)) fail('BLOCKING_INPUT', 'listingPatch must be an object');
  for (const field of ['variation_theme', 'variation_values', 'theme']) {
    if (Object.hasOwn(input, field)) {
      fail('BLOCKING_INPUT', 'revise-child cannot modify the Variation theme or tuple', {field});
    }
  }

  const rawListingPatch = record(listingPatch?.fields) ? listingPatch.fields : listingPatch;
  assertListingPatchAllowed(listingPatch);
  assertListingPatchAllowed(rawListingPatch);
  const changedFacts = changedPatch(existing.facts, factPatch);
  const listingChanges = updateChildListing(existing.listing, rawListingPatch, sku, requestedNow);
  if (Object.keys(changedFacts).length === 0 && listingChanges.changedFields.length === 0) {
    return structuredClone(state);
  }

  const now = operationNow(requestedNow);
  const next = structuredClone(state);
  const variation = next.variation;
  const target = variation.children[sku];
  const reasons = [];
  const affectedIds = [sku];

  if (Object.keys(changedFacts).length > 0) {
    const beforeCommon = commonFacts(variation);
    target.facts = {...target.facts, ...changedFacts};
    const afterCommon = commonFacts(variation);
    target.product_master = target.product_master
      ? markStale(target.product_master, {reason: 'CHILD_FACTS_CHANGED', affectedIds: [sku], now})
      : null;
    target.listing = markStale(target.listing, {
      reason: 'CHILD_FACTS_CHANGED', affectedIds: [sku], now
    });
    reasons.push('CHILD_FACTS_CHANGED');
    if (!isDeepStrictEqual(beforeCommon, afterCommon)) {
      variation.parent.common_facts = afterCommon;
      const parentAffected = [variation.parent.sku, sku];
      variation.parent = markStale(variation.parent, {
        reason: 'COMMON_FACTS_CHANGED', affectedIds: parentAffected, now
      });
      reasons.push('COMMON_FACTS_CHANGED');
      affectedIds.push(...parentAffected);
    }
    recomputeSharedApplicability(variation, now);
  }

  if (listingChanges.changedFields.length > 0) {
    target.listing = updateChildListing(target.listing, rawListingPatch, sku, now).listing;
    reasons.push('CHILD_LISTING_FIELDS_CHANGED');
    const promoted = promotedListingFields(variation.parent);
    if (listingChanges.changedFields.some(field => promoted.has(field))) {
      const parentAffected = [variation.parent.sku, sku];
      variation.parent = markStale(variation.parent, {
        reason: 'PROMOTED_CHILD_LISTING_FIELD_CHANGED', affectedIds: parentAffected, now
      });
      reasons.push('PROMOTED_CHILD_LISTING_FIELD_CHANGED');
      affectedIds.push(...parentAffected);
    }
  }
  if (Object.keys(changedFacts).length > 0) {
    target.listing = markStale(target.listing, {
      reason: 'CHILD_FACTS_CHANGED', affectedIds: [sku], now
    });
  }

  target.history = [
    ...(Array.isArray(target.history) ? target.history : []),
    {kind: 'revised', at: now, fact_fields: Object.keys(changedFacts), listing_fields: listingChanges.changedFields}
  ];
  recordOperation(variation, {kind: 'revise_child', reasons, affectedIds, now});
  updateProjectTimestamp(next, now);
  return next;
}

export function removeVariationChild(state, {sku, now: requestedNow} = {}) {
  assertVariationState(state);
  validateChildSku(sku);
  const existing = state.variation.children[sku];
  if (!existing || existing.active === false) {
    fail('BLOCKING_INPUT', 'An active Child is required for removal', {sku});
  }
  if (activeChildren(state.variation).length === 1) {
    fail('BLOCKING_INPUT', 'A Variation Family must retain at least one active Child');
  }

  const now = operationNow(requestedNow);
  const next = structuredClone(state);
  const variation = next.variation;
  const target = variation.children[sku];
  target.active = false;
  target.removed_at = now;
  target.history = [
    ...(Array.isArray(target.history) ? target.history : []),
    {kind: 'removed', at: now}
  ];

  const affectedIds = [variation.parent.sku, sku];
  variation.parent.common_facts = commonFacts(variation);
  variation.parent = markStale(variation.parent, {
    reason: 'ACTIVE_CHILD_SET_CHANGED', affectedIds, now
  });
  recomputeSharedApplicability(variation, now);
  recordOperation(variation, {
    kind: 'remove_child', reasons: ['ACTIVE_CHILD_SET_CHANGED'], affectedIds, now
  });
  updateProjectTimestamp(next, now);
  return next;
}

function verifiedThemeSource(source) {
  return record(source)
    && ['category_schema', 'user_template'].includes(source.kind)
    && typeof source.id === 'string' && source.id.trim() !== ''
    && Array.isArray(source.allowed_themes) && source.allowed_themes.length > 0;
}

function desiredVariation({parentSku, childSku, theme, themeSource, now}) {
  if (!record(theme) || !Array.isArray(theme.dimensions) || !record(theme.values)) {
    fail('BLOCKING_INPUT', 'Variation theme must contain dimensions and values');
  }
  if (!verifiedThemeSource(themeSource)) {
    fail('BLOCKING_INPUT', 'A verified Variation theme source is required');
  }
  const selectedTheme = selectVariationTheme({
    allowedThemes: themeSource.allowed_themes,
    requestedDimensions: theme.dimensions
  });

  const variation = createVariationExtension({
    parentSku,
    dimensions: selectedTheme.dimensions,
    firstChildSku: childSku,
    firstChildFacts: theme.values,
    now
  });
  variation.theme.source = structuredClone(themeSource);
  variation.theme.verification_status = selectedTheme.verification_status;
  const validation = validateVariationExtension(variation);
  if (!validation.valid) {
    fail('BLOCKING_INPUT', 'Variation promotion input is invalid', {errors: validation.errors});
  }
  return variation;
}

function assertApprovalComplete(state) {
  const master = state.product_master;
  const mainId = master?.approved_main_id;
  const main = mainId ? state.gallery?.assets?.[mainId] : null;
  if (master?.status !== 'locked' || !mainId || main?.id !== mainId || main.status !== 'approved' || main.kind !== 'main') {
    fail('BLOCKING_INPUT', 'Promotion requires an approval-complete locked Product Master with an approved main image');
  }
  if (state.listing?.approved?.at(-1)?.status !== 'approved') {
    fail('BLOCKING_INPUT', 'Promotion requires an approved Listing snapshot');
  }
}

function firstChildSku(variation) {
  return Object.keys(variation.children ?? {})[0] ?? null;
}

function assertMatchingPromotion(current, desired) {
  const validation = validateVariationExtension(current);
  if (!validation.valid) {
    fail('BLOCKING_INPUT', 'Existing Variation state is invalid', {errors: validation.errors});
  }

  const currentChildSku = firstChildSku(current);
  const desiredChildSku = firstChildSku(desired);
  const matches = current.parent.sku === desired.parent.sku
    && currentChildSku === desiredChildSku
    && isDeepStrictEqual(current.theme, desired.theme)
    && isDeepStrictEqual(
      current.children[currentChildSku]?.variation_values,
      desired.children[desiredChildSku]?.variation_values
    );
  if (!matches) {
    fail('STALE_DEPENDENCY', 'Existing Variation does not match the requested promotion');
  }
}

async function ensureDirectories(projectDir, childSku) {
  const created = [];
  for (const relative of SUPPLEMENTAL_DIRECTORIES(childSku)) {
    const target = path.join(projectDir, ...relative.split('/'));
    let exists = false;
    try {
      const entry = await stat(target);
      if (!entry.isDirectory()) fail('BLOCKING_INPUT', 'Variation directory path is occupied by a file', {path: relative});
      exists = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!exists) {
      await mkdir(target, {recursive: true});
      created.push(relative);
    }
  }
  return created;
}

function legacyReferences(state) {
  const mainId = state.product_master?.approved_main_id;
  const mainImage = mainId ? state.gallery?.assets?.[mainId]?.path : null;
  return {
    ...(mainImage ? {main_image: mainImage} : {}),
    product_master_version: state.product_master?.version ?? null,
    gallery_asset_ids: Object.keys(state.gallery?.assets ?? {}),
    selected_asset_ids: structuredClone(state.gallery?.selected ?? []),
    listing_ids: (state.listing?.approved ?? []).map(item => item.id ?? item.version),
    approval_ids: (state.approvals ?? []).map(item => item.id),
    delivery_id: state.delivery?.id ?? state.delivery?.version ?? null
  };
}

function applyPromotion(state, variation, now) {
  const childSku = firstChildSku(variation);
  const child = variation.children[childSku];
  child.facts = structuredClone(state.facts);
  child.product_master = structuredClone(state.product_master);
  child.listing = structuredClone(state.listing);
  child.legacy_refs = legacyReferences(state);

  const next = structuredClone(state);
  next.project.mode = 'variation_family';
  next.project.updated_at = now;
  next.variation = variation;
  return next;
}

export async function promoteToVariation({
  projectDir,
  parentSku,
  childSku,
  theme,
  themeSource,
  now = new Date().toISOString()
}) {
  const root = path.resolve(projectDir);
  const desired = desiredVariation({parentSku, childSku, theme, themeSource, now});
  const current = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'));
  const projectValidation = validateProjectState(current);
  if (!projectValidation.valid) {
    fail('BLOCKING_INPUT', 'Existing project state is invalid', {errors: projectValidation.errors});
  }

  if (current.variation) assertMatchingPromotion(current.variation, desired);
  else assertApprovalComplete(current);
  const created = await ensureDirectories(root, childSku);

  if (current.variation && current.project.mode === 'variation_family') {
    return {state: current, created, resumed: true};
  }

  const transaction = await updateProject(root, state => {
    if (state.variation) {
      assertMatchingPromotion(state.variation, desired);
      const next = structuredClone(state);
      next.project.mode = 'variation_family';
      return {state: next, resumed: true};
    }
    return {state: applyPromotion(state, desired, now), resumed: false};
  });
  return {...transaction, created};
}
