const VARIATION_SCHEMA_VERSION = 1;
const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function normalizedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedDimension(value) {
  return normalizedText(value).toLowerCase();
}

function validSku(value) {
  return SKU_PATTERN.test(normalizedText(value));
}

export function variationTupleKey(dimensions, values) {
  if (!Array.isArray(dimensions) || !values || Array.isArray(values) || typeof values !== 'object') {
    return '';
  }
  return dimensions.map(dimension => normalizedText(values[dimension]).toLowerCase()).join('\u001f');
}

export function createVariationExtension({
  parentSku,
  dimensions,
  firstChildSku,
  firstChildFacts,
  now = new Date().toISOString()
}) {
  const childValues = Object.fromEntries(
    (Array.isArray(dimensions) ? dimensions : []).map(dimension => [dimension, firstChildFacts?.[dimension]])
  );

  return {
    schema_version: VARIATION_SCHEMA_VERSION,
    mode: 'variation_family',
    family_identity: {version: 0, status: 'draft', facts: {}, non_merge_boundaries: []},
    theme: {dimensions, source: null, verification_status: 'unverified'},
    parent: {sku: parentSku, version: 0, status: 'draft', listing: {draft: null, approved: []}},
    children: {
      [firstChildSku]: {
        sku: firstChildSku,
        active: true,
        variation_values: childValues,
        facts: {},
        product_master: null,
        listing: {draft: null, approved: []},
        legacy_refs: {}
      }
    },
    shared_assets: {},
    versions: [],
    updated_at: now
  };
}

export function validateVariationExtension(variation) {
  const errors = [];
  if (!variation || Array.isArray(variation) || typeof variation !== 'object') {
    return {valid: false, errors: ['variation must be an object']};
  }
  if (variation.schema_version !== VARIATION_SCHEMA_VERSION) errors.push('variation.schema_version must be 1');
  if (variation.mode !== 'variation_family') errors.push('variation.mode must be variation_family');
  if (!variation.family_identity || Array.isArray(variation.family_identity) || typeof variation.family_identity !== 'object') {
    errors.push('variation.family_identity must be an object');
  }

  const dimensions = variation.theme?.dimensions;
  if (!variation.theme || !Array.isArray(dimensions) || dimensions.length === 0) {
    errors.push('variation.theme.dimensions must be a non-empty array');
  } else {
    const seenDimensions = new Set();
    for (const dimension of dimensions) {
      const key = normalizedDimension(dimension);
      if (!key) errors.push('variation.theme.dimensions cannot contain empty values');
      else if (seenDimensions.has(key)) errors.push('variation.theme.dimensions cannot contain repeated values');
      else seenDimensions.add(key);
    }
  }

  if (!validSku(variation.parent?.sku)) errors.push('variation.parent.sku is required');
  if (!variation.parent || Array.isArray(variation.parent) || typeof variation.parent !== 'object') {
    errors.push('variation.parent must be an object');
  }
  if (!variation.children || Array.isArray(variation.children) || typeof variation.children !== 'object') {
    errors.push('variation.children must be an object');
  } else {
    const tupleKeys = new Set();
    for (const [childSku, child] of Object.entries(variation.children)) {
      if (!validSku(childSku) || !validSku(child?.sku) || childSku !== child?.sku) {
        errors.push(`variation child SKU is unsafe or invalid: ${childSku}`);
      }
      if (!child || Array.isArray(child) || typeof child !== 'object') {
        errors.push(`variation child must be an object: ${childSku}`);
        continue;
      }
      if (!child.variation_values || Array.isArray(child.variation_values) || typeof child.variation_values !== 'object') {
        errors.push(`variation child values must be an object: ${childSku}`);
        continue;
      }
      if (Array.isArray(dimensions) && dimensions.length > 0) {
        const missing = dimensions.some(dimension => !normalizedText(child.variation_values[dimension]));
        if (missing) {
          errors.push(`variation child is missing dimension values: ${childSku}`);
          continue;
        }
        const tupleKey = variationTupleKey(dimensions, child.variation_values);
        if (tupleKeys.has(tupleKey)) errors.push(`duplicate variation tuple: ${tupleKey}`);
        tupleKeys.add(tupleKey);
      }
    }
  }

  if (!variation.shared_assets || Array.isArray(variation.shared_assets) || typeof variation.shared_assets !== 'object') {
    errors.push('variation.shared_assets must be an object');
  }
  if (!Array.isArray(variation.versions)) errors.push('variation.versions must be an array');
  return {valid: errors.length === 0, errors};
}
