import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validateProjectState } from './project-state.js';
import { updateProject } from './transactions.js';
import { createVariationExtension, validateVariationExtension } from './variations.js';

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

function verifiedThemeSource(source) {
  return record(source)
    && typeof source.kind === 'string' && source.kind.trim() !== ''
    && typeof source.id === 'string' && source.id.trim() !== '';
}

function desiredVariation({parentSku, childSku, theme, themeSource, now}) {
  if (!record(theme) || !Array.isArray(theme.dimensions) || !record(theme.values)) {
    fail('BLOCKING_INPUT', 'Variation theme must contain dimensions and values');
  }
  if (!verifiedThemeSource(themeSource)) {
    fail('BLOCKING_INPUT', 'A verified Variation theme source is required');
  }

  const variation = createVariationExtension({
    parentSku,
    dimensions: structuredClone(theme.dimensions),
    firstChildSku: childSku,
    firstChildFacts: theme.values,
    now
  });
  variation.theme.source = structuredClone(themeSource);
  variation.theme.verification_status = 'verified';
  const validation = validateVariationExtension(variation);
  if (!validation.valid) {
    fail('BLOCKING_INPUT', 'Variation promotion input is invalid', {errors: validation.errors});
  }
  return variation;
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
