import { fail } from './errors.js';
import { findEmptyBenefitPhrases, findFrontBackDuplicates } from './listing.js';
import { auditListing } from './listing-audit.js';

const ROUTES = Object.freeze({
  listing_field_edit: {mode: 'fast', reason: 'LOCAL_LISTING_CHANGE'},
  add_child: {mode: 'fast', reason: 'LOCAL_CHILD_ADDITION'},
  child_listing_field_edit: {mode: 'fast', reason: 'LOCAL_CHILD_CHANGE'},
  child_fact_local: {mode: 'fast', reason: 'LOCAL_CHILD_FACT'},
  child_fact_common: {mode: 'dependency', reason: 'FAMILY_COMMON_FACT_DEPENDENCIES'},
  resolve_fact_conflicts: {mode: 'dependency', reason: 'FAMILY_FACT_RESOLUTION'},
  child_fact_identity: {mode: 'full', reason: 'CHILD_IDENTITY_DEPENDENCIES'},
  remove_child: {mode: 'fast', reason: 'LOCAL_CHILD_REMOVAL'},
  image_presentation_edit: {mode: 'fast', reason: 'PRESENTATION_ONLY_CHANGE'},
  next_gallery_item: {mode: 'fast', reason: 'APPROVED_GALLERY_PLAN'},
  record_candidate: {mode: 'fast', reason: 'CURRENT_IMAGE_CANDIDATE'},
  approve_asset: {mode: 'fast', reason: 'CURRENT_ARTIFACT_APPROVAL'},
  knowledge_lookup: {mode: 'fast', reason: 'LOCAL_LIBRARY_LOOKUP'},
  learn_category: {mode: 'full', reason: 'SHARED_KNOWLEDGE_CHANGE'},
  new_project: {mode: 'full', reason: 'NEW_PROJECT'},
  first_product_master: {mode: 'full', reason: 'PRODUCT_MASTER_LOCK'},
  product_identity_change: {mode: 'full', reason: 'IDENTITY_DEPENDENCIES'},
  marketplace_change: {mode: 'full', reason: 'MARKETPLACE_RULE_SCOPE'},
  product_type_change: {mode: 'full', reason: 'PRODUCT_TYPE_RULE_SCOPE'},
  variation_theme_change: {mode: 'full', reason: 'VARIATION_THEME_DEPENDENCIES'},
  first_listing_draft: {mode: 'full', reason: 'COMPLETE_LISTING_DRAFT'},
  migrate: {mode: 'full', reason: 'STATE_SCHEMA_CHANGE'},
  finalize: {mode: 'full', reason: 'FINAL_INTEGRITY'}
});

export function classifyOperation(change) {
  const route = ROUTES[change?.kind];
  return route
    ? {mode: route.mode, reasons: [route.reason]}
    : {mode: 'full', reasons: ['UNKNOWN_OPERATION']};
}

export function classifyChildFactImpact(state, factPatch = {}) {
  const fields = Object.keys(factPatch);
  const identity = new Set([
    'purpose', 'core_function', 'product_form', 'warning_semantics', 'product_identity', 'material'
  ]);
  const theme = new Set(state?.variation?.theme?.dimensions ?? []);
  if (fields.some(field => identity.has(field) || theme.has(field))) return 'child_fact_identity';
  const common = new Set(Object.keys(state?.variation?.family_identity?.facts ?? {}));
  return fields.some(field => common.has(field)) ? 'child_fact_common' : 'child_fact_local';
}

const CHECKS = Object.freeze({
  listing_field_edit: {
    scope: 'changed',
    checks: ['listing.changed-field', 'listing.fact-links', 'listing.affected-keywords']
  },
  image_presentation_edit: {
    scope: 'changed',
    checks: ['image.decode', 'image.changed-geometry', 'image.saved-file-inspection']
  },
  record_candidate: {
    scope: 'changed',
    checks: ['image.decode', 'image.relevant-checks', 'image.saved-file-inspection']
  },
  approve_asset: {
    scope: 'artifact',
    checks: ['artifact.file', 'artifact.product-master-binding', 'artifact.fact-bindings', 'artifact.approval-scope']
  },
  finalize: {
    scope: 'final',
    checks: ['final.selected-artifacts', 'final.hashes', 'final.approvals', 'final.dependencies', 'final.bundle']
  }
});

export function validationPlan({operation, changedPaths = []}) {
  if (!operation?.kind) fail('BLOCKING_INPUT', 'operation.kind is required');
  const configured = CHECKS[operation.kind];
  if (configured) {
    return {
      scope: configured.scope,
      changed_paths: [...new Set(changedPaths)],
      checks: [...configured.checks]
    };
  }
  return {
    scope: 'final',
    changed_paths: [...new Set(changedPaths)],
    checks: ['state.complete', 'facts.complete', 'dependencies.complete']
  };
}

function valueAtPath(root, fieldPath) {
  return fieldPath.split('.').reduce((value, part) => {
    if (value === null || value === undefined) return undefined;
    return value[Array.isArray(value) ? Number(part) : part];
  }, root);
}

export function validateChangedListing(state, changedPaths = []) {
  const content = state?.listing?.draft?.content;
  if (!content) fail('BLOCKING_INPUT', 'A working Listing draft is required');
  const paths = [...new Set(changedPaths)];
  if (paths.length === 0) fail('BLOCKING_INPUT', 'Changed Listing paths are required');
  for (const fieldPath of paths) {
    const value = valueAtPath(content, fieldPath);
    if (value === undefined) fail('BLOCKING_INPUT', 'Changed Listing field does not exist', {field: fieldPath});
    if (typeof value === 'string' && value.trim() === '') {
      fail('BLOCKING_INPUT', 'Changed Listing field cannot be blank', {field: fieldPath});
    }
  }

  const emptyPhrases = findEmptyBenefitPhrases(content).filter(field => paths.includes(field));
  if (emptyPhrases.length) fail('BLOCKING_INPUT', 'Changed Bullet uses empty benefit phrasing', {fields: emptyPhrases});
  const audit = auditListing(content);
  const affectedFindings = audit.findings.filter(item => paths.some(field => item.path === field || item.path.startsWith(`${field}.`)));
  if (affectedFindings.length) fail('BLOCKING_INPUT', 'Changed Listing field fails retail-language self-check', {findings: affectedFindings});
  const backendChanged = paths.includes('backend_search_terms');
  return {
    ok: true,
    plan: validationPlan({operation: {kind: 'listing_field_edit'}, changedPaths: paths}),
    advisories: backendChanged ? {frontend_duplicates: findFrontBackDuplicates(content)} : {}
  };
}
