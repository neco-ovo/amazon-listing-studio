import { fail } from './errors.js';

const ROUTES = Object.freeze({
  listing_field_edit: {mode: 'fast', reason: 'LOCAL_LISTING_CHANGE'},
  image_presentation_edit: {mode: 'fast', reason: 'PRESENTATION_ONLY_CHANGE'},
  next_gallery_item: {mode: 'fast', reason: 'APPROVED_GALLERY_PLAN'},
  approve_asset: {mode: 'fast', reason: 'CURRENT_ARTIFACT_APPROVAL'},
  knowledge_lookup: {mode: 'fast', reason: 'LOCAL_LIBRARY_LOOKUP'},
  new_project: {mode: 'full', reason: 'NEW_PROJECT'},
  first_product_master: {mode: 'full', reason: 'PRODUCT_MASTER_LOCK'},
  product_identity_change: {mode: 'full', reason: 'IDENTITY_DEPENDENCIES'},
  marketplace_change: {mode: 'full', reason: 'MARKETPLACE_RULE_SCOPE'},
  product_type_change: {mode: 'full', reason: 'PRODUCT_TYPE_RULE_SCOPE'},
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

const CHECKS = Object.freeze({
  listing_field_edit: {
    scope: 'changed',
    checks: ['listing.changed-field', 'listing.fact-links', 'listing.affected-keywords']
  },
  image_presentation_edit: {
    scope: 'changed',
    checks: ['image.decode', 'image.changed-geometry', 'image.saved-file-inspection']
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
