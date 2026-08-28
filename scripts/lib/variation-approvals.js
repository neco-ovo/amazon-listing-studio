import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

import {fail} from './errors.js';
import {hashApprovalFile} from './transactions.js';
import {auditVariationListings} from './variation-listing.js';
import {computeCommonFacts, validateVariationExtension} from './variations.js';
import {evaluateSharedAssetApplicability} from './variation-images.js';

const ARTIFACT_SCOPES = new Set(['child_main', 'shared_image']);
const LISTING_SCOPES = new Set(['parent_listing', 'child_listing']);

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function explicitApproval(input) {
  if (input?.userAction !== 'approved') {
    fail('BLOCKING_INPUT', 'Explicit approved user action is required');
  }
}

function assertVariationState(state) {
  if (state?.project?.mode !== 'variation_family' || !record(state.variation)) {
    fail('BLOCKING_INPUT', 'A Variation Family project is required');
  }
  const validation = validateVariationExtension(state.variation);
  if (!validation.valid) {
    fail('BLOCKING_INPUT', 'Existing Variation state is invalid', {errors: validation.errors});
  }
  if (!Array.isArray(state.approvals)) fail('BLOCKING_INPUT', 'Approval history is invalid');
}

function activeChildren(variation) {
  return Object.values(variation.children ?? {}).filter(child => child?.active !== false);
}

function approvalId(scopeType, target, now) {
  const timestamp = now.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `approval-${scopeType}-${target}-${timestamp}`;
}

function assertNewApprovalId(state, id) {
  if (state.approvals.some(item => item.id === id)) {
    fail('BLOCKING_INPUT', 'Approval ID already exists', {approval_id: id});
  }
}

function hashText(value) {
  return createHash('sha256').update(`${JSON.stringify(value, null, 2)}\n`, 'utf8').digest('hex');
}

export function variationFinalScopePayload(scope) {
  return {
    family_identity_version: scope.family_identity_version,
    parent_sku: scope.parent_sku,
    parent_version: scope.parent_version,
    parent_listing_approval_id: scope.parent_listing_approval_id,
    parent_listing_content_sha256: scope.parent_listing_content_sha256,
    theme_dimensions: structuredClone(scope.theme_dimensions),
    child_skus: structuredClone(scope.child_skus),
    child_variations: structuredClone(scope.child_variations),
    child_versions: structuredClone(scope.child_versions),
    asset_map: structuredClone(scope.asset_map),
    marketplace: scope.marketplace,
    product_type: scope.product_type,
    rule_scope: structuredClone(scope.rule_scope),
    rule_status: scope.rule_status,
    rules_unverified: structuredClone(scope.rules_unverified),
    upload_ready: scope.upload_ready
  };
}

export function hashVariationFinalScope(scope) {
  return hashText(variationFinalScopePayload(scope));
}

function exactArray(actual, expected) {
  return Array.isArray(actual) && isDeepStrictEqual(actual, expected);
}

function canonicalChildAssetPath(childSku, artifactPath) {
  const normalized = String(artifactPath ?? '').replaceAll('\\', '/');
  return normalized.startsWith(`children/${childSku}/assets/`);
}

function childArtifactLocation(state, child, artifactId) {
  const locations = [
    {assets: child.assets, owner: child},
    {assets: child.gallery?.assets, owner: child.gallery},
    {assets: state.variation.child_assets?.[child.sku], owner: state.variation.child_assets?.[child.sku]}
  ];
  const legacy = state.gallery?.assets?.[artifactId];
  if (legacy && (legacy.child_sku === child.sku
      || child.product_master?.approved_main_id === artifactId
      || child.legacy_refs?.gallery_asset_ids?.includes(artifactId))) {
    locations.push({assets: state.gallery.assets, owner: state.gallery});
  }
  return locations.find(location => record(location.assets?.[artifactId])) ?? null;
}

function assertCandidate(candidate, input, kind) {
  if (!candidate || !['candidate', 'approved'].includes(candidate.status)
      || candidate.inspection_status !== 'pass') {
    fail('BLOCKING_INPUT', `A passing current ${kind} candidate is required`, {
      artifact_id: input.artifactId ?? null
    });
  }
  if (candidate.path !== input.path) {
    fail('BLOCKING_INPUT', 'Approval path does not match the presented candidate');
  }
}

function assertInspectedCandidate(candidate, input, sha256, expectedBinding) {
  if (!/^[a-f0-9]{64}$/.test(candidate.candidate_sha256 ?? '')
      || candidate.candidate_sha256 !== sha256
      || !isDeepStrictEqual(candidate.inspection_binding, expectedBinding)) {
    fail('BLOCKING_INPUT', 'Artifact bytes or role changed after the inspected candidate was recorded', {
      artifact_id: input.artifactId ?? null
    });
  }
}

function commonFacts(variation) {
  const common = computeCommonFacts(activeChildren(variation)).common;
  for (const [field, fact] of Object.entries(variation.family_identity?.facts ?? {})) {
    const value = record(fact) && Object.hasOwn(fact, 'value') ? fact.value : fact;
    if (!Object.hasOwn(common, field) && value !== null && value !== undefined && value !== '') common[field] = value;
  }
  return common;
}

function applicableChildren(variation, asset) {
  const common = commonFacts(variation);
  return activeChildren(variation)
    .filter(child => evaluateSharedAssetApplicability({asset, child, commonFacts: common}).applicable)
    .map(child => child.sku);
}

function sharedScopeDeclaration(candidate) {
  const scope = typeof candidate.scope === 'string' ? candidate.scope : candidate.scope?.type;
  if (!['shared_asset', 'subset_shared'].includes(scope)) {
    fail('BLOCKING_INPUT', 'Artifact cannot substitute for a shared image scope');
  }
  const declared = scope === 'subset_shared'
    ? (record(candidate.scope) ? candidate.scope.child_skus : candidate.child_skus)
    : [];
  if (scope === 'subset_shared' && (!Array.isArray(declared) || declared.length === 0
      || declared.some(sku => typeof sku !== 'string' || !sku.trim())
      || new Set(declared).size !== declared.length)) {
    fail('BLOCKING_INPUT', 'Subset-shared approval requires a unique non-empty declared Child set');
  }
  return {asset_scope: scope, declared_child_skus: structuredClone(declared)};
}

async function approveChildMain(state, input, options) {
  const child = state.variation.children?.[input.childSku];
  if (!child || child.active === false) {
    fail('BLOCKING_INPUT', 'Child main approval requires an active exact Child SKU', {child_sku: input.childSku ?? null});
  }
  if (!canonicalChildAssetPath(input.childSku, input.path)
      && child.product_master?.approved_main_path !== input.path
      && child.legacy_refs?.main_image !== input.path) {
    fail('BLOCKING_INPUT', 'Child main path does not belong to the approved Child scope', {
      child_sku: input.childSku,
      path: input.path ?? null
    });
  }
  const location = childArtifactLocation(state, child, input.artifactId);
  const candidate = location?.assets?.[input.artifactId];
  assertCandidate(candidate, input, 'Child main image');
  if (candidate.kind !== 'main' || (candidate.child_sku && candidate.child_sku !== child.sku)) {
    fail('BLOCKING_INPUT', 'Artifact cannot substitute for the requested Child main scope');
  }

  const currentMaster = child.product_master;
  if (currentMaster !== null && currentMaster !== undefined
      && (currentMaster.status !== 'locked' || !(Number(currentMaster.version) > 0)
        || currentMaster.approved_main_id !== input.artifactId)) {
    fail('BLOCKING_INPUT', 'Child main approval cannot replace a stale or different Product Master binding');
  }

  const sha256 = await hashApprovalFile(input.path, options);
  assertInspectedCandidate(candidate, input, sha256, {
    scope_type: 'child_main', kind: 'main', path: input.path, child_sku: child.sku
  });
  const masterVersion = Number(currentMaster?.version ?? 1);
  const masterPath = currentMaster?.approved_main_path;
  const masterHash = currentMaster?.approved_main_sha256?.toLowerCase();
  if ((masterPath && masterPath !== input.path) || (masterHash && masterHash !== sha256)) {
    fail('BLOCKING_INPUT', 'Child main does not match the locked Product Master binding');
  }
  const now = input.now ?? new Date().toISOString();
  const id = approvalId('child-main', input.artifactId, now);
  assertNewApprovalId(state, id);
  const approval = {
    id,
    type: 'image',
    scope_version: 1,
    scope_type: 'child_main',
    artifact_id: input.artifactId,
    child_sku: child.sku,
    variation_values: structuredClone(child.variation_values),
    product_master_version: masterVersion,
    path: input.path,
    sha256,
    candidate_sha256: candidate.candidate_sha256,
    inspection_binding: structuredClone(candidate.inspection_binding),
    approved_main_path: masterPath ?? input.path,
    approved_main_sha256: masterHash ?? sha256,
    approved_at: now,
    user_action: input.userAction
  };

  const next = structuredClone(state);
  const nextChild = next.variation.children[child.sku];
  const nextLocation = childArtifactLocation(next, nextChild, input.artifactId);
  nextLocation.assets[input.artifactId] = {
    ...nextLocation.assets[input.artifactId], status: 'approved', sha256, approval_id: id, approved_at: now
  };
  nextChild.main_image = {
    artifact_id: input.artifactId, path: input.path, sha256, approval_id: id, approved_at: now
  };
  nextChild.product_master = {
    ...(record(currentMaster) ? structuredClone(currentMaster) : {}),
    version: masterVersion,
    status: 'locked',
    approved_main_id: input.artifactId,
    approved_main_path: masterPath ?? input.path,
    approved_main_sha256: masterHash ?? sha256
  };
  next.approvals.push(approval);
  next.variation.updated_at = now;
  next.project.updated_at = now;
  return next;
}

async function approveSharedImage(state, input, options) {
  const candidate = state.variation.shared_assets?.[input.artifactId];
  assertCandidate(candidate, input, 'shared image');
  const scope = sharedScopeDeclaration(candidate);
  if (!record(input.factDependencies) || Object.keys(input.factDependencies).length === 0) {
    fail('BLOCKING_INPUT', 'Shared image approval requires explicit factual dependencies');
  }
  if (record(candidate.fact_dependencies)
      && !isDeepStrictEqual(candidate.fact_dependencies, input.factDependencies)) {
    fail('BLOCKING_INPUT', 'Shared image factual dependencies do not match the candidate');
  }
  const scopedAsset = {...candidate, fact_dependencies: structuredClone(input.factDependencies)};
  const applicable = applicableChildren(state.variation, scopedAsset);
  if (!exactArray(input.childSkus, applicable)) {
    fail('BLOCKING_INPUT', 'Shared image approval must name the exact currently applicable Child set', {
      expected: applicable,
      actual: input.childSkus ?? null
    });
  }

  const sha256 = await hashApprovalFile(input.path, options);
  assertInspectedCandidate(candidate, input, sha256, {
    scope_type: 'shared_image', kind: candidate.kind, path: input.path,
    asset_scope: structuredClone(candidate.scope)
  });
  const now = input.now ?? new Date().toISOString();
  const id = approvalId('shared-image', input.artifactId, now);
  assertNewApprovalId(state, id);
  const approval = {
    id,
    type: 'image',
    scope_version: 1,
    scope_type: 'shared_image',
    artifact_id: input.artifactId,
    path: input.path,
    sha256,
    candidate_sha256: candidate.candidate_sha256,
    inspection_binding: structuredClone(candidate.inspection_binding),
    ...scope,
    fact_dependencies: structuredClone(input.factDependencies),
    applicable_child_skus: [...applicable],
    approved_at: now,
    user_action: input.userAction
  };
  const next = structuredClone(state);
  next.variation.shared_assets[input.artifactId] = {
    ...next.variation.shared_assets[input.artifactId],
    status: 'approved',
    sha256,
    approval_id: id,
    approved_at: now,
    fact_dependencies: structuredClone(input.factDependencies),
    applicable_child_skus: [...applicable]
  };
  next.approvals.push(approval);
  next.variation.updated_at = now;
  next.project.updated_at = now;
  return next;
}

export async function approveVariationArtifact(state, input, options = {}) {
  explicitApproval(input);
  assertVariationState(state);
  if (!ARTIFACT_SCOPES.has(input?.artifactType)) {
    fail('BLOCKING_INPUT', 'Unsupported Variation artifact approval scope', {scope_type: input?.artifactType ?? null});
  }
  if ((input.artifactType === 'child_main' && (input.childSkus !== undefined || input.factDependencies !== undefined))
      || (input.artifactType === 'shared_image' && input.childSku !== undefined)) {
    fail('BLOCKING_INPUT', 'Variation artifact approval fields do not match the selected scope');
  }
  if (input.artifactType === 'child_main') return approveChildMain(state, input, options);
  return approveSharedImage(state, input, options);
}

function latestContent(listing) {
  const approved = listing?.approved?.at(-1)?.content;
  if (record(approved)) return approved;
  if (record(listing?.draft?.content)) return listing.draft.content;
  if (record(listing?.overrides)) return listing.overrides;
  return null;
}

function listingContents(variation, replacementSku = null, replacementContent = null) {
  return Object.fromEntries(activeChildren(variation).flatMap(child => {
    const content = child.sku === replacementSku ? replacementContent : latestContent(child.listing);
    return content ? [[child.sku, content]] : [];
  }));
}

function assertProjectScope(state, content) {
  const expected = {
    project_id: state.project.product_id,
    marketplace: state.project.marketplace,
    language: state.project.language,
    product_type: state.project.product_type
  };
  for (const [field, value] of Object.entries(expected)) {
    if (content[field] !== undefined && content[field] !== value) {
      fail('BLOCKING_INPUT', 'Variation Listing scope does not match the current project', {
        field, expected: value, actual: content[field]
      });
    }
  }
  return expected;
}

function listingSnapshot({content, version, approvalId: id, now}) {
  const approvedContent = {...structuredClone(content), version};
  const contentSha256 = hashText(approvedContent);
  return {
    id: `listing-v${version}`,
    version,
    status: 'approved',
    approval_id: id,
    approved_at: now,
    content: approvedContent,
    content_sha256: contentSha256,
    json_sha256: contentSha256
  };
}

function ruleScope(content) {
  const rulesUnverified = Array.isArray(content.rules_unverified) ? [...new Set(content.rules_unverified)] : [];
  const ruleStatus = content.rule_status ?? (content.upload_ready === true ? 'verified' : 'rules_unverified');
  const uploadReady = content.upload_ready === true;
  if ((ruleStatus === 'verified' && rulesUnverified.length > 0)
      || (uploadReady && (ruleStatus !== 'verified' || rulesUnverified.length > 0))) {
    fail('BLOCKING_INPUT', 'Variation Listing rule status, unverified fields, and upload readiness are incoherent');
  }
  return {rule_status: ruleStatus, rules_unverified: rulesUnverified, upload_ready: uploadReady};
}

function assertCallerBinding(content, expected, forbidden = []) {
  for (const field of forbidden) {
    if (content[field] !== undefined) {
      fail('BLOCKING_INPUT', 'Variation Listing content contains fields from another approval scope', {field});
    }
  }
  for (const [field, value] of Object.entries(expected)) {
    if (content[field] !== undefined && !isDeepStrictEqual(content[field], value)) {
      fail('BLOCKING_INPUT', 'Variation Listing content does not match its exact approval scope', {
        field, expected: value, actual: content[field]
      });
    }
  }
}

function approveParentListing(state, input) {
  const projectScope = assertProjectScope(state, input.content);
  assertCallerBinding(input.content, {
    parent_sku: state.variation.parent.sku,
    variation_theme: state.variation.theme.dimensions
  }, ['child_sku', 'variation_values']);
  const current = state.variation.parent.listing;
  const version = Number(current?.approved?.at(-1)?.version ?? 0) + 1;
  const content = {
    ...structuredClone(input.content),
    ...projectScope,
    parent_sku: state.variation.parent.sku,
    variation_theme: [...state.variation.theme.dimensions]
  };
  const audit = auditVariationListings({
    parentContent: content,
    childContents: listingContents(state.variation),
    variation: state.variation
  });
  const findings = audit.findings.filter(item => item.sku === state.variation.parent.sku);
  if (findings.length > 0) {
    fail('BLOCKING_INPUT', 'Parent Listing contains Child-only or invalid content', {findings});
  }
  const now = input.now ?? new Date().toISOString();
  const id = approvalId('parent-listing', `v${version}`, now);
  assertNewApprovalId(state, id);
  const snapshot = listingSnapshot({content, version, approvalId: id, now});
  const approval = {
    id,
    type: 'listing',
    scope_version: 1,
    scope_type: 'parent_listing',
    parent_sku: state.variation.parent.sku,
    family_identity_version: Number(state.variation.family_identity?.version ?? 0),
    theme_dimensions: [...state.variation.theme.dimensions],
    listing_version: version,
    content_sha256: snapshot.content_sha256,
    ...projectScope,
    ...ruleScope(content),
    approved_at: now,
    user_action: input.userAction
  };
  const next = structuredClone(state);
  next.variation.parent.version = version;
  next.variation.parent.status = 'approved';
  next.variation.parent.listing = {
    ...(record(next.variation.parent.listing) ? next.variation.parent.listing : {}),
    status: 'approved', draft: null,
    approved: [...(next.variation.parent.listing?.approved ?? []), snapshot]
  };
  next.approvals.push(approval);
  next.variation.updated_at = now;
  next.project.updated_at = now;
  return next;
}

function approveChildListing(state, input) {
  const child = state.variation.children?.[input.childSku];
  if (!child || child.active === false) {
    fail('BLOCKING_INPUT', 'Child Listing approval requires an active exact Child SKU', {child_sku: input.childSku ?? null});
  }
  const parentSnapshot = state.variation.parent.listing?.approved?.at(-1);
  const parentApproval = state.approvals.find(item => item.id === parentSnapshot?.approval_id);
  if (!parentSnapshot || parentSnapshot.status !== 'approved' || parentApproval?.scope_type !== 'parent_listing') {
    fail('BLOCKING_INPUT', 'Child Listing requires a current Parent Listing approval');
  }
  const projectScope = assertProjectScope(state, input.content);
  assertCallerBinding(input.content, {
    parent_sku: state.variation.parent.sku,
    child_sku: child.sku,
    variation_theme: state.variation.theme.dimensions,
    variation_values: child.variation_values
  });
  const version = Number(child.listing?.approved?.at(-1)?.version ?? 0) + 1;
  const content = {
    ...structuredClone(input.content),
    ...projectScope,
    product_master_version: Number(child.product_master?.version ?? 0),
    parent_sku: state.variation.parent.sku,
    child_sku: child.sku,
    variation_theme: [...state.variation.theme.dimensions],
    variation_values: structuredClone(child.variation_values),
    version
  };
  const audit = auditVariationListings({
    parentContent: parentSnapshot.content,
    childContents: listingContents(state.variation, child.sku, content),
    variation: state.variation
  });
  const findings = audit.findings.filter(item => item.sku === child.sku);
  if (findings.length > 0) {
    fail('BLOCKING_INPUT', 'Child Listing does not match its exact Child scope', {child_sku: child.sku, findings});
  }
  const now = input.now ?? new Date().toISOString();
  const id = approvalId('child-listing', `${child.sku}-v${version}`, now);
  assertNewApprovalId(state, id);
  const snapshot = listingSnapshot({content, version, approvalId: id, now});
  const approval = {
    id,
    type: 'listing',
    scope_version: 1,
    scope_type: 'child_listing',
    child_sku: child.sku,
    variation_values: structuredClone(child.variation_values),
    product_master_version: Number(child.product_master?.version ?? 0),
    listing_version: version,
    parent_listing_version: parentSnapshot.version,
    parent_listing_approval_id: parentApproval.id,
    theme_dimensions: [...state.variation.theme.dimensions],
    content_sha256: snapshot.content_sha256,
    ...projectScope,
    ...ruleScope(content),
    approved_at: now,
    user_action: input.userAction
  };
  const next = structuredClone(state);
  next.variation.children[child.sku].listing = {
    ...(record(next.variation.children[child.sku].listing) ? next.variation.children[child.sku].listing : {}),
    status: 'approved', draft: null,
    approved: [...(next.variation.children[child.sku].listing?.approved ?? []), snapshot]
  };
  next.approvals.push(approval);
  next.variation.updated_at = now;
  next.project.updated_at = now;
  return next;
}

export function approveVariationListing(state, input) {
  explicitApproval(input);
  assertVariationState(state);
  if (!LISTING_SCOPES.has(input?.scopeType) || !record(input.content)) {
    fail('BLOCKING_INPUT', 'Variation Listing approval requires an explicit supported scope and content');
  }
  if ((input.scopeType === 'parent_listing' && input.childSku !== undefined)
      || (input.scopeType === 'child_listing' && input.childSkus !== undefined)) {
    fail('BLOCKING_INPUT', 'Variation Listing approval fields do not match the selected scope');
  }
  if (input.scopeType === 'parent_listing') return approveParentListing(state, input);
  return approveChildListing(state, input);
}

function approvalFor(state, id, scopeType) {
  const approval = state.approvals.find(item => item.id === id);
  if (!approval || approval.scope_version !== 1 || approval.scope_type !== scopeType
      || approval.user_action !== 'approved') {
    fail('BLOCKING_INPUT', `A current ${scopeType} approval is required`, {approval_id: id ?? null});
  }
  return approval;
}

function childSpecificAssets(state, child) {
  const assets = new Map();
  for (const container of [child.assets, child.gallery?.assets, state.variation.child_assets?.[child.sku]]) {
    for (const [id, asset] of Object.entries(container ?? {})) assets.set(id, asset);
  }
  for (const id of child.legacy_refs?.gallery_asset_ids ?? []) {
    const asset = state.gallery?.assets?.[id];
    if (asset) assets.set(id, asset);
  }
  return assets;
}

function finalChildSecondaries(state, child) {
  const secondary = [];
  for (const [artifactId, asset] of childSpecificAssets(state, child)) {
    if (artifactId === child.product_master?.approved_main_id || asset?.kind === 'main' || asset?.status !== 'approved') continue;
    const approval = state.approvals.find(item => item.id === asset.approval_id);
    const isLegacy = child.legacy_refs?.gallery_asset_ids?.includes(artifactId) === true;
    const approvalScope = approval?.scope_type ?? null;
    const explicitScope = approvalScope === 'child_secondary';
    const legacyScope = approvalScope === null && isLegacy;
    if (!approval || approval.type !== 'image' || (!explicitScope && !legacyScope)
        || (explicitScope ? approval.scope_version !== 1 : approval.scope_version !== undefined)
        || approval.user_action !== 'approved' || approval.artifact_id !== artifactId
        || approval.path !== asset.path || approval.sha256 !== asset.sha256
        || (explicitScope && asset.child_sku !== child.sku)
        || (asset.child_sku !== undefined && asset.child_sku !== child.sku)
        || (explicitScope && asset.product_master_version !== child.product_master.version)
        || (asset.product_master_version !== undefined
          && asset.product_master_version !== child.product_master.version)
        || (!isLegacy && !canonicalChildAssetPath(child.sku, asset.path))
        || (explicitScope && approval.child_sku !== child.sku)
        || (approval.child_sku !== undefined && approval.child_sku !== child.sku)
        || (explicitScope && approval.product_master_version !== child.product_master.version)
        || (approval.product_master_version !== undefined
          && approval.product_master_version !== child.product_master.version)) {
      fail('BLOCKING_INPUT', 'Child-specific secondary approval binding is invalid', {
        child_sku: child.sku, artifact_id: artifactId
      });
    }
    secondary.push({
      artifact_id: artifactId,
      path: approval.path,
      sha256: approval.sha256,
      approval_id: approval.id,
      approval_scope_type: approvalScope,
      child_sku: child.sku,
      product_master_version: child.product_master.version
    });
  }
  return secondary;
}

function finalChildScope(state, child, parentScope) {
  const master = child.product_master;
  if (master?.status !== 'locked' || !(Number(master.version) > 0) || !master.approved_main_id) {
    fail('BLOCKING_INPUT', 'Final Variation approval requires every Child Product Master to be locked', {child_sku: child.sku});
  }
  const location = childArtifactLocation(state, child, master.approved_main_id);
  const asset = location?.assets?.[master.approved_main_id] ?? child.main_image;
  if (location && asset?.status !== 'approved') {
    fail('BLOCKING_INPUT', 'Final Variation approval requires the current approved Child main', {child_sku: child.sku});
  }
  const mainApproval = approvalFor(state, asset?.approval_id, 'child_main');
  const masterPath = master.approved_main_path;
  const masterHash = master.approved_main_sha256?.toLowerCase();
  if (mainApproval.child_sku !== child.sku || mainApproval.artifact_id !== master.approved_main_id
      || mainApproval.sha256 !== asset.sha256 || mainApproval.path !== asset.path
      || mainApproval.product_master_version !== master.version
      || (masterPath && (masterPath !== asset.path || masterPath !== mainApproval.approved_main_path))
      || (masterHash && (masterHash !== asset.sha256 || masterHash !== mainApproval.approved_main_sha256))
      || !isDeepStrictEqual(mainApproval.variation_values, child.variation_values)) {
    fail('BLOCKING_INPUT', 'Child main approval does not match its exact current Child scope', {child_sku: child.sku});
  }
  const listing = child.listing?.approved?.at(-1);
  const listingApproval = approvalFor(state, listing?.approval_id, 'child_listing');
  const listingRuleMatches = isDeepStrictEqual(ruleScope(listingApproval), ruleScope(listing?.content));
  if (child.listing?.status !== 'approved' || listing?.status !== 'approved'
      || listingApproval.child_sku !== child.sku
      || listingApproval.listing_version !== listing.version
      || listingApproval.product_master_version !== master.version
      || listingApproval.project_id !== state.project.product_id
      || listingApproval.marketplace !== state.project.marketplace
      || listingApproval.product_type !== state.project.product_type
      || listingApproval.parent_listing_version !== parentScope.version
      || listingApproval.parent_listing_approval_id !== parentScope.approvalId
      || !isDeepStrictEqual(listingApproval.theme_dimensions, state.variation.theme.dimensions)
      || !listingRuleMatches
      || !isDeepStrictEqual(listingApproval.variation_values, child.variation_values)
      || listingApproval.content_sha256 !== (listing.content_sha256 ?? listing.json_sha256)
      || listingApproval.content_sha256 !== hashText(listing.content)) {
    fail('BLOCKING_INPUT', 'Child Listing approval does not match its exact current Child scope', {child_sku: child.sku});
  }
  return {
    version: {
      child_sku: child.sku,
      variation_values: structuredClone(child.variation_values),
      product_master_version: master.version,
      listing_version: listing.version,
      listing_content_sha256: listingApproval.content_sha256,
      approved_main_path: mainApproval.path,
      approved_main_sha256: mainApproval.sha256,
      main_approval_id: mainApproval.id,
      listing_approval_id: listingApproval.id
    },
    main: {
      artifact_id: mainApproval.artifact_id,
      path: mainApproval.path,
      sha256: mainApproval.sha256,
      approval_id: mainApproval.id
    },
    secondary: finalChildSecondaries(state, child),
    listingApproval
  };
}

function finalSharedScope(state, childSkus, {version, now, userAction}) {
  const assets = {};
  const mappings = [];
  for (const [artifactId, asset] of Object.entries(state.variation.shared_assets ?? {})) {
    if (asset.status !== 'approved' || !asset.approval_id) continue;
    const approval = approvalFor(state, asset.approval_id, 'shared_image');
    if (approval.artifact_id !== artifactId || approval.sha256 !== asset.sha256 || approval.path !== asset.path
        || !isDeepStrictEqual(approval.fact_dependencies, asset.fact_dependencies)) {
      fail('BLOCKING_INPUT', 'Shared image approval binding is invalid', {artifact_id: artifactId});
    }
    if (!['shared_asset', 'subset_shared'].includes(approval.asset_scope)
        || !Array.isArray(approval.declared_child_skus)
        || (approval.asset_scope === 'shared_asset' && approval.declared_child_skus.length > 0)
        || (approval.asset_scope === 'subset_shared' && approval.declared_child_skus.length === 0)) {
      fail('BLOCKING_INPUT', 'Shared image approval has no immutable asset-scope declaration', {artifact_id: artifactId});
    }
    const approvedAsset = {
      scope: approval.asset_scope === 'subset_shared'
        ? {type: 'subset_shared', child_skus: structuredClone(approval.declared_child_skus)}
        : 'shared_asset',
      fact_dependencies: structuredClone(approval.fact_dependencies)
    };
    const mapped = new Set(approval.applicable_child_skus ?? []);
    for (const mapping of state.variation.shared_asset_mappings ?? []) {
      if (mapping.approval_id === approval.id && mapping.artifact_id === artifactId) {
        for (const sku of mapping.child_skus ?? []) mapped.add(sku);
      }
    }
    const currentlyApplicable = applicableChildren(state.variation, approvedAsset)
      .filter(sku => childSkus.includes(sku));
    const newChildren = currentlyApplicable.filter(sku => !mapped.has(sku));
    if (newChildren.length > 0) {
      mappings.push({
        id: `mapping-${artifactId}-variation-v${version}`,
        scope_version: 1,
        scope_type: 'shared_image',
        mapping_type: 'shared_approval_reference',
        approval_id: approval.id,
        artifact_id: artifactId,
        child_skus: newChildren,
        fact_dependencies: structuredClone(approval.fact_dependencies),
        mapped_at: now,
        user_action: userAction
      });
      for (const sku of newChildren) mapped.add(sku);
    }
    const applicable = currentlyApplicable.filter(sku => mapped.has(sku));
    if (applicable.length === 0) continue;
    assets[artifactId] = {
      path: approval.path,
      sha256: approval.sha256,
      approval_id: approval.id,
      asset_scope: approval.asset_scope,
      declared_child_skus: structuredClone(approval.declared_child_skus),
      fact_dependencies: structuredClone(approval.fact_dependencies),
      child_skus: applicable
    };
  }
  return {assets, mappings};
}

export function approveVariationVersion(state, input) {
  explicitApproval(input);
  assertVariationState(state);
  if (state.variation.family_identity?.status !== 'locked'
      || !(Number(state.variation.family_identity.version) > 0)
      || state.variation.theme?.verification_status !== 'verified') {
    fail('BLOCKING_INPUT', 'Final Variation approval requires locked identity and a verified Variation Theme');
  }
  const children = activeChildren(state.variation);
  if (children.length === 0) fail('BLOCKING_INPUT', 'Final Variation approval requires active Children');
  const parent = state.variation.parent;
  const parentListing = parent.listing?.approved?.at(-1);
  const parentApproval = approvalFor(state, parentListing?.approval_id, 'parent_listing');
  const parentRuleMatches = isDeepStrictEqual(ruleScope(parentApproval), ruleScope(parentListing?.content));
  if (parent.status !== 'approved' || parentListing?.status !== 'approved'
      || parent.version !== parentListing.version
      || parentApproval.parent_sku !== parent.sku
      || parentApproval.family_identity_version !== state.variation.family_identity.version
      || parentApproval.listing_version !== parentListing.version
      || parentApproval.marketplace !== state.project.marketplace
      || parentApproval.product_type !== state.project.product_type
      || !isDeepStrictEqual(parentApproval.theme_dimensions, state.variation.theme.dimensions)
      || !parentRuleMatches
      || parentApproval.content_sha256 !== (parentListing.content_sha256 ?? parentListing.json_sha256)
      || parentApproval.content_sha256 !== hashText(parentListing.content)) {
    fail('BLOCKING_INPUT', 'Final Variation approval requires a current Parent Listing approval');
  }

  const childScopes = children.map(child => finalChildScope(state, child, {
    version: parentListing.version,
    approvalId: parentApproval.id
  }));
  const ruleScopes = [parentApproval, ...childScopes.map(item => item.listingApproval)].map(ruleScope);
  if (ruleScopes.some(scope => !isDeepStrictEqual(scope, ruleScopes[0]))) {
    fail('BLOCKING_INPUT', 'Parent and Child Listing rule scopes must match for final approval');
  }
  const finalRuleScope = ruleScopes[0];
  const childSkus = children.map(child => child.sku);
  const version = Number(state.variation.versions?.at(-1)?.version ?? 0) + 1;
  const now = input.now ?? new Date().toISOString();
  const sharedScope = finalSharedScope(state, childSkus, {version, now, userAction: input.userAction});
  const id = approvalId('variation-final', `v${version}`, now);
  assertNewApprovalId(state, id);
  const frozenScope = {
    family_identity_version: state.variation.family_identity.version,
    parent_sku: parent.sku,
    parent_version: parentListing.version,
    parent_listing_approval_id: parentApproval.id,
    parent_listing_content_sha256: parentApproval.content_sha256,
    theme_dimensions: [...state.variation.theme.dimensions],
    child_skus: [...childSkus],
    child_variations: childScopes.map(item => ({
      child_sku: item.version.child_sku,
      variation_values: structuredClone(item.version.variation_values)
    })),
    child_versions: childScopes.map(item => structuredClone(item.version)),
    asset_map: {
      child_main: Object.fromEntries(childScopes.map(item => [item.version.child_sku, structuredClone(item.main)])),
      child_secondary: Object.fromEntries(childScopes.map(item => [
        item.version.child_sku, structuredClone(item.secondary)
      ])),
      shared: sharedScope.assets
    },
    marketplace: state.project.marketplace,
    product_type: state.project.product_type,
    rule_scope: structuredClone(finalRuleScope),
    ...structuredClone(finalRuleScope)
  };
  const scopeSha256 = hashVariationFinalScope(frozenScope);
  const approval = {
    id,
    type: 'final',
    scope_version: 1,
    scope_type: 'variation_final',
    variation_version: version,
    finalized: true,
    ...structuredClone(frozenScope),
    scope_sha256: scopeSha256,
    approved_at: now,
    user_action: input.userAction
  };
  const versionRecord = {
    id: `variation-v${version}`,
    version,
    status: 'approved',
    approval_id: id,
    scope: structuredClone(frozenScope),
    scope_sha256: scopeSha256,
    approved_at: now
  };
  const next = structuredClone(state);
  next.approvals.push(approval);
  next.variation.shared_asset_mappings = [
    ...(next.variation.shared_asset_mappings ?? []),
    ...structuredClone(sharedScope.mappings)
  ];
  next.variation.versions.push(versionRecord);
  next.variation.updated_at = now;
  next.project.updated_at = now;
  return next;
}
