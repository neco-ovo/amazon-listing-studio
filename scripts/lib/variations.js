const VARIATION_SCHEMA_VERSION = 1;
const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONFIRMED_FACT_STATUSES = new Set(['user_confirmed']);

function normalizedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedDimension(value) {
  return normalizedText(value).toLowerCase();
}

function activeChildren(children) {
  const entries = Array.isArray(children) ? children : Object.values(children ?? {});
  return entries.filter(child => child && typeof child === 'object' && child.active !== false);
}

function normalizedFactValue(value) {
  if (typeof value === 'string') return normalizedText(value).toLowerCase();
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

function semanticFact(fact) {
  const isRecord = fact && typeof fact === 'object' && !Array.isArray(fact)
    && Object.prototype.hasOwnProperty.call(fact, 'value');
  if (!isRecord) {
    return {supported: Boolean(normalizedFactValue(fact)), value: fact, unresolved: false};
  }

  const conflictFree = !Array.isArray(fact.conflicts) || fact.conflicts.length === 0;
  const supported = fact.publishable === true && CONFIRMED_FACT_STATUSES.has(fact.status) && conflictFree
    && Boolean(normalizedFactValue(fact.value));
  return {supported, value: fact.value, unresolved: !supported, record: fact};
}

function blockingInput(message) {
  const error = new Error(message);
  error.code = 'BLOCKING_INPUT';
  return error;
}

function validSku(value) {
  return typeof value === 'string' && value === value.trim() && SKU_PATTERN.test(value);
}

export function variationTupleKey(dimensions, values) {
  if (!Array.isArray(dimensions) || !values || Array.isArray(values) || typeof values !== 'object') {
    return '';
  }
  return dimensions.map(dimension => normalizedText(values[dimension]).toLowerCase()).join('\u001f');
}

export function selectVariationTheme({allowedThemes, requestedDimensions} = {}) {
  if (!Array.isArray(requestedDimensions) || requestedDimensions.length === 0) {
    throw blockingInput('requested variation dimensions are required');
  }
  const requested = requestedDimensions.map(normalizedDimension);
  if (requested.some(dimension => !dimension) || new Set(requested).size !== requested.length) {
    throw blockingInput('requested variation dimensions must be unique non-empty fields');
  }

  const theme = (Array.isArray(allowedThemes) ? allowedThemes : []).find(candidate => {
    if (!Array.isArray(candidate) || candidate.length !== requested.length) return false;
    return candidate.map(normalizedDimension).every((dimension, index) => dimension === requested[index]);
  });
  if (!theme) throw blockingInput('requested variation theme is not category-permitted');

  return {
    dimensions: theme.map(normalizedDimension),
    source: 'category_permitted',
    verification_status: 'verified'
  };
}

export function computeCommonFacts(children) {
  const active = activeChildren(children);
  const factsByChild = active.map(child => child.facts && typeof child.facts === 'object' && !Array.isArray(child.facts)
    ? child.facts
    : {});
  const fields = new Set(factsByChild.flatMap(facts => Object.keys(facts)));
  const common = {};
  const child_only = {};
  const conflicts = {};

  for (const field of [...fields].sort()) {
    const facts = factsByChild.map(facts => semanticFact(facts[field]));
    const unresolved = facts.filter(fact => fact.unresolved);
    if (unresolved.length > 0) {
      conflicts[field] = unresolved.map(fact => structuredClone(fact.record));
      continue;
    }

    const values = facts.filter(fact => fact.supported).map(fact => fact.value);
    const normalizedValues = values.map(normalizedFactValue);
    const uniqueValues = [...new Set(normalizedValues)];

    if (values.length === facts.length && uniqueValues.length === 1) {
      common[field] = structuredClone(values[0]);
    } else if (uniqueValues.length > 0) {
      child_only[field] = uniqueValues.sort();
    }
  }

  return {common, child_only, conflicts};
}

const STANDARD_VARIATION_FIELDS = new Set([
  'size', 'size_name', 'color', 'color_name', 'pattern', 'pattern_name',
  'style', 'style_name', 'pack_count', 'item_package_quantity', 'number_of_items'
]);
const LARGE_DIFFERENCE_FIELDS = new Set([
  'warning_semantics', 'core_purpose', 'purpose', 'buyer_object', 'product_form', 'core_function'
]);

export function classifyChildDifferences({children, identityFields = [], override} = {}) {
  if (override === 'light' || override === 'large') {
    return {mode: override, reasons: [`override:${override}`]};
  }

  const {common, child_only, conflicts} = computeCommonFacts(children);
  const reasons = [];
  const identity = new Set((Array.isArray(identityFields) ? identityFields : []).map(normalizedDimension));
  const highImpact = field => LARGE_DIFFERENCE_FIELDS.has(field)
    || /warning|graphic|buyer|purpose|function|product_form|use_intent|use_object/.test(field);
  for (const field of Object.keys(conflicts)) {
    const normalizedField = normalizedDimension(field);
    if (identity.has(normalizedField) || highImpact(normalizedField)) {
      reasons.push(`conflict:${normalizedField}`);
    }
  }
  if (reasons.length > 0) return {mode: 'large', reasons};

  for (const field of Object.keys(child_only)) {
    const normalizedField = normalizedDimension(field);
    if (identity.has(normalizedField)) {
      reasons.push(`identity:${normalizedField}`);
    } else if (highImpact(normalizedField)) {
      reasons.push(`large:${normalizedField}`);
    } else if (!STANDARD_VARIATION_FIELDS.has(normalizedField)) {
      reasons.push(`child:${normalizedField}`);
    }
  }

  if (reasons.length > 0) return {mode: 'large', reasons};
  return {mode: 'light', reasons: Object.keys(common).length > 0 ? ['standard_variation_fields'] : []};
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
  } else if (Object.keys(variation.children).length === 0) {
    errors.push('variation.children must contain at least one child');
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
