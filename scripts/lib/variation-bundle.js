import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';

import {unzipSync, zipSync} from 'fflate';
import sharp from 'sharp';

import {isSafeArchivePath, sha256File} from './bundle.js';
import {DomainError} from './errors.js';
import {renderListing} from './listing-drafts.js';
import {
  hashVariationFinalScope,
  variationFinalScopePayload
} from './variation-approvals.js';
import {validateVariationExtension} from './variations.js';

function invalid(reason, message, details = {}) {
  return new DomainError('BUNDLE_INVALID', message, {reason, ...details});
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function exactTuple(dimensions, values) {
  if (!record(values) || !Array.isArray(dimensions)) return false;
  const keys = Object.keys(values);
  return keys.length === dimensions.length
    && keys.every((key, index) => key === dimensions[index])
    && dimensions.every(dimension => values[dimension] !== null && values[dimension] !== undefined && values[dimension] !== '');
}

function tupleKey(dimensions, values) {
  return JSON.stringify(dimensions.map(dimension => values[dimension]));
}

function assertUniqueTuples(dimensions, rows) {
  const seen = new Set();
  for (const row of rows) {
    if (!exactTuple(dimensions, row.variation_values)) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'A Child does not contain the exact ordered Variation tuple.', {
        child_sku: row.child_sku ?? null
      });
    }
    const key = tupleKey(dimensions, row.variation_values);
    if (seen.has(key)) {
      throw invalid('DUPLICATE_VARIATION_TUPLE', 'Variation delivery contains a duplicate Child tuple.', {
        child_sku: row.child_sku ?? null
      });
    }
    seen.add(key);
  }
}

function fullDeliveryScope(approval) {
  return {
    scope_version: approval.scope_version,
    scope_type: approval.scope_type,
    variation_version: approval.variation_version,
    ...variationFinalScopePayload(approval)
  };
}

function projectDeliveryScope(approval, selectedSkus) {
  const full = fullDeliveryScope(approval);
  const selected = new Set(selectedSkus);
  return {
    ...full,
    child_skus: full.child_skus.filter(sku => selected.has(sku)),
    child_variations: full.child_variations.filter(item => selected.has(item.child_sku)),
    child_versions: full.child_versions.filter(item => selected.has(item.child_sku)),
    asset_map: {
      child_main: Object.fromEntries(Object.entries(full.asset_map.child_main)
        .filter(([sku]) => selected.has(sku))),
      child_secondary: Object.fromEntries(Object.entries(full.asset_map.child_secondary)
        .filter(([sku]) => selected.has(sku))),
      shared: Object.fromEntries(Object.entries(full.asset_map.shared).flatMap(([id, asset]) => {
        const childSkus = asset.child_skus.filter(sku => selected.has(sku));
        return childSkus.length > 0 ? [[id, {...structuredClone(asset), child_skus: childSkus}]] : [];
      }))
    }
  };
}

function projectionHash(scope) {
  return hash(jsonBytes(scope));
}

function isSafeManifestPath(value) {
  if (!isSafeArchivePath(value)) return false;
  let current = value;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return false;
    }
    if (decoded === current) return true;
    const separatorsBefore = [...current].filter(character => character === '/' || character === '\\').length;
    const separatorsAfter = [...decoded].filter(character => character === '/' || character === '\\').length;
    if (separatorsAfter !== separatorsBefore || !isSafeArchivePath(decoded)) return false;
    current = decoded;
  }
  return false;
}

function assertExpectedScope(manifest, expected) {
  const provenance = manifest.approval_provenance;
  if (!record(provenance)
      || provenance.approval_id !== manifest.approval_id
      || provenance.variation_version !== manifest.variation_version
      || !/^[a-f0-9]{64}$/.test(provenance.final_scope_sha256 ?? '')
      || provenance.projection_sha256 !== projectionHash(manifest.approval_scope)) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Delivery approval projection provenance is invalid.');
  }
  if (!expected) {
    if (manifest.delivery_type === 'family'
        && hashVariationFinalScope(manifest.approval_scope) !== provenance.final_scope_sha256) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'Family delivery no longer matches its final approval hash.');
    }
    return false;
  }
  if (expected.id !== provenance.approval_id
      || expected.variation_version !== provenance.variation_version
      || expected.scope_sha256 !== provenance.final_scope_sha256
      || hashVariationFinalScope(expected) !== expected.scope_sha256) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Delivery does not descend from the expected final approval.');
  }
  const projected = projectDeliveryScope(expected, manifest.delivery_scope.child_skus);
  if (!isDeepStrictEqual(manifest.approval_scope, projected)) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Delivery projection does not match the expected immutable Variation scope.');
  }
  return true;
}

function requireFinalApproval(state, supplied) {
  if (state?.schema_version !== 2 || state?.project?.mode !== 'variation_family'
      || !record(state.variation) || !Array.isArray(state.approvals)) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'A valid Variation Family project is required.');
  }
  const validation = validateVariationExtension(state.variation);
  if (!validation.valid) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Variation Family state is invalid.', {errors: validation.errors});
  }
  if (!supplied?.id || supplied.finalized !== true || supplied.scope_type !== 'variation_final'
      || supplied.scope_version !== 1 || supplied.user_action !== 'approved'
      || !/^[a-f0-9]{64}$/.test(supplied.scope_sha256 ?? '')
      || hashVariationFinalScope(supplied) !== supplied.scope_sha256) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'An immutable final Variation approval is required.');
  }
  const stored = state.approvals.find(item => item.id === supplied.id);
  if (!stored || !isDeepStrictEqual(stored, supplied)) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Supplied Variation approval is stale or substituted.');
  }
  const version = state.variation.versions?.find(item => (
    item.approval_id === supplied.id && item.version === supplied.variation_version && item.status === 'approved'
  ));
  if (!version || !record(version.scope) || version.scope_sha256 !== supplied.scope_sha256
      || hashVariationFinalScope(version.scope) !== version.scope_sha256) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Approved Variation version record is missing.');
  }
  for (const [field, value] of Object.entries(version.scope)) {
    if (!isDeepStrictEqual(supplied[field], value)) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'Final approval no longer matches its immutable Variation version.', {field});
    }
  }
  return stored;
}

function activeChildren(variation) {
  return Object.values(variation.children ?? {}).filter(child => child?.active !== false);
}

function approvalById(state, id, scopeType = null) {
  const approval = state.approvals.find(item => item.id === id);
  if (!approval || (scopeType && approval.scope_type !== scopeType) || approval.user_action !== 'approved') {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Required scoped approval record is missing.', {approval_id: id ?? null});
  }
  return approval;
}

function latestApprovedListing(owner) {
  return owner?.listing?.approved?.at(-1);
}

function currentChildAsset(state, child, artifactId) {
  const candidates = [
    child.assets?.[artifactId],
    child.gallery?.assets?.[artifactId],
    state.variation.child_assets?.[child.sku]?.[artifactId]
  ];
  const legacy = state.gallery?.assets?.[artifactId];
  if (legacy && (child.legacy_refs?.gallery_asset_ids?.includes(artifactId)
      || child.product_master?.approved_main_id === artifactId)) candidates.push(legacy);
  return candidates.find(Boolean) ?? null;
}

function assertCurrentAssetBinding(state, child, frozen, scopeType, version) {
  const current = currentChildAsset(state, child, frozen.artifact_id);
  const approval = approvalById(state, frozen.approval_id, scopeType === 'child_secondary' ? null : scopeType);
  const approvalScope = approval.scope_type ?? null;
  const isSecondary = scopeType === 'child_secondary';
  const legacySecondary = isSecondary && frozen.approval_scope_type === null;
  const isLegacyAsset = child.legacy_refs?.gallery_asset_ids?.includes(frozen.artifact_id) === true;
  if (current?.status !== 'approved' || current.path !== frozen.path || current.sha256 !== frozen.sha256
      || current.approval_id !== frozen.approval_id
      || approval.type !== 'image'
      || (legacySecondary ? approval.scope_version !== undefined : approval.scope_version !== 1)
      || approval.artifact_id !== frozen.artifact_id || approval.path !== frozen.path
      || approval.sha256 !== frozen.sha256
      || (isSecondary && ![null, 'child_secondary'].includes(frozen.approval_scope_type))
      || (legacySecondary && !isLegacyAsset)
      || (isSecondary && approvalScope !== frozen.approval_scope_type)
      || (isSecondary && frozen.child_sku !== child.sku)
      || (isSecondary && frozen.product_master_version !== version.product_master_version)
      || (!legacySecondary && approval.child_sku !== child.sku)
      || (legacySecondary && approval.child_sku !== undefined && approval.child_sku !== child.sku)
      || (!legacySecondary && approval.product_master_version !== version.product_master_version)
      || (legacySecondary && approval.product_master_version !== undefined
        && approval.product_master_version !== version.product_master_version)
      || (current.child_sku !== undefined && current.child_sku !== child.sku)
      || (current.product_master_version !== undefined
        && current.product_master_version !== version.product_master_version)
      || (scopeType === 'child_main' && (
        !isDeepStrictEqual(approval.variation_values, version.variation_values)
        || approval.approved_main_path !== version.approved_main_path
        || approval.approved_main_sha256 !== version.approved_main_sha256
      ))) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'A current Child asset binding is stale or unapproved.', {
      child_sku: child.sku,
      artifact_id: frozen.artifact_id
    });
  }
}

function validateListingSnapshot({
  state, snapshot, approvalId, version, scopeType, expectedContentHash, child = null
}) {
  if (snapshot?.status !== 'approved' || snapshot.version !== version || snapshot.approval_id !== approvalId
      || !record(snapshot.content)) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Approved Listing snapshot is stale or incomplete.', {
      child_sku: child?.sku ?? null
    });
  }
  const approval = approvalById(state, approvalId, scopeType);
  const contentHash = hash(jsonBytes(snapshot.content));
  if (approval.content_sha256 !== contentHash
      || approval.content_sha256 !== (snapshot.content_sha256 ?? snapshot.json_sha256)
      || approval.content_sha256 !== expectedContentHash) {
    throw invalid('HASH_MISMATCH', 'Approved Listing content changed after approval.', {
      child_sku: child?.sku ?? null
    });
  }
  const content = snapshot.content;
  if (content.project_id !== state.project.product_id || content.marketplace !== state.project.marketplace
      || content.product_type !== state.project.product_type || content.version !== version) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Approved Listing content does not match the frozen project scope.', {
      child_sku: child?.sku ?? null
    });
  }
  if (child && (content.child_sku !== child.sku
      || content.product_master_version !== child.product_master?.version
      || !isDeepStrictEqual(content.variation_values, child.variation_values))) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Child Listing does not match its current Child scope.', {child_sku: child.sku});
  }
  for (const field of ['title', 'item_highlights', 'bullets', 'description', 'backend_search_terms', 'special_features', 'attributes']) {
    if (!Object.hasOwn(content, field) || content[field] === null || content[field] === undefined) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'Approved Listing is incomplete.', {field, child_sku: child?.sku ?? null});
    }
  }
  return snapshot;
}

function validateCurrentScope(state, approval, selectedSkus) {
  const dimensions = approval.theme_dimensions;
  if (!Array.isArray(dimensions) || dimensions.length === 0
      || !isDeepStrictEqual(dimensions, state.variation.theme?.dimensions)
      || approval.family_identity_version !== state.variation.family_identity?.version
      || approval.parent_version !== state.variation.parent?.version
      || approval.parent_sku !== state.variation.parent?.sku
      || approval.marketplace !== state.project.marketplace
      || approval.product_type !== state.project.product_type) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Final approval no longer matches the current Family scope.');
  }
  const children = activeChildren(state.variation);
  const childSkus = children.map(child => child.sku);
  if (!isDeepStrictEqual(approval.child_skus, childSkus)
      || !Array.isArray(approval.child_versions) || approval.child_versions.length !== children.length
      || !Array.isArray(approval.child_variations) || approval.child_variations.length !== children.length) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Final approval does not freeze the exact active Child set.');
  }
  assertUniqueTuples(dimensions, approval.child_variations);

  const parentSnapshot = latestApprovedListing(state.variation.parent);
  if (state.variation.parent?.status !== 'approved'
      || state.variation.parent?.listing?.status !== 'approved') {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Parent Listing is not currently approved.');
  }
  validateListingSnapshot({
    state, snapshot: parentSnapshot, approvalId: approval.parent_listing_approval_id,
    version: approval.parent_version, scopeType: 'parent_listing',
    expectedContentHash: approval.parent_listing_content_sha256
  });
  if (parentSnapshot.content.parent_sku !== state.variation.parent.sku) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Parent Listing identity does not match the current Parent SKU.');
  }

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const version = approval.child_versions[index];
    const variation = approval.child_variations[index];
    if (version?.child_sku !== child.sku || variation?.child_sku !== child.sku
        || !isDeepStrictEqual(version.variation_values, child.variation_values)
        || !isDeepStrictEqual(variation.variation_values, child.variation_values)
        || version.product_master_version !== child.product_master?.version) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'A Child scope changed after final approval.', {child_sku: child.sku});
    }
    if (!selectedSkus.has(child.sku)) continue;
    if (child.product_master?.status !== 'locked' || child.listing?.status !== 'approved') {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'A Child Product Master or Listing is not currently approved.', {
        child_sku: child.sku
      });
    }
    validateListingSnapshot({
      state, snapshot: latestApprovedListing(child), approvalId: version.listing_approval_id,
      version: version.listing_version, scopeType: 'child_listing',
      expectedContentHash: version.listing_content_sha256, child
    });
    const main = approval.asset_map?.child_main?.[child.sku];
    if (!main || main.artifact_id !== child.product_master?.approved_main_id
        || main.approval_id !== version.main_approval_id
        || main.path !== version.approved_main_path || main.sha256 !== version.approved_main_sha256) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'A Child main-image mapping is stale.', {child_sku: child.sku});
    }
    approvalById(state, main.approval_id, 'child_main');
    assertCurrentAssetBinding(state, child, main, 'child_main', version);
    if (!Array.isArray(approval.asset_map?.child_secondary?.[child.sku])) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'A Child secondary-image mapping is missing.', {child_sku: child.sku});
    }
    for (const secondary of approval.asset_map.child_secondary[child.sku]) {
      assertCurrentAssetBinding(state, child, secondary, 'child_secondary', version);
    }
  }
  if (!record(approval.asset_map?.shared)) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Final approval has no shared-asset map.');
  }
  for (const [artifactId, frozen] of Object.entries(approval.asset_map.shared)) {
    if (!frozen.child_skus?.some(sku => selectedSkus.has(sku))) continue;
    const current = state.variation.shared_assets?.[artifactId];
    const scopedApproval = approvalById(state, frozen.approval_id, 'shared_image');
    const currentScope = typeof current?.scope === 'string' ? current.scope : current?.scope?.type;
    const currentDeclared = currentScope === 'subset_shared'
      ? (record(current.scope) ? current.scope.child_skus : current.child_skus)
      : [];
    const mapped = new Set(scopedApproval.applicable_child_skus ?? []);
    for (const mapping of state.variation.shared_asset_mappings ?? []) {
      if (mapping.approval_id === scopedApproval.id && mapping.artifact_id === artifactId) {
        for (const sku of mapping.child_skus ?? []) mapped.add(sku);
      }
    }
    const currentMembers = activeChildren(state.variation).map(child => child.sku).filter(sku => mapped.has(sku));
    if (current?.status !== 'approved' || current.path !== frozen.path || current.sha256 !== frozen.sha256
        || current.approval_id !== frozen.approval_id
        || !isDeepStrictEqual(current.fact_dependencies, frozen.fact_dependencies)
        || scopedApproval.artifact_id !== artifactId || scopedApproval.path !== frozen.path
        || scopedApproval.sha256 !== frozen.sha256
        || !isDeepStrictEqual(scopedApproval.fact_dependencies, frozen.fact_dependencies)
        || scopedApproval.type !== 'image' || scopedApproval.scope_version !== 1
        || !['shared_asset', 'subset_shared'].includes(frozen.asset_scope)
        || !Array.isArray(frozen.declared_child_skus)
        || scopedApproval.asset_scope !== frozen.asset_scope
        || currentScope !== frozen.asset_scope
        || !isDeepStrictEqual(scopedApproval.declared_child_skus, frozen.declared_child_skus)
        || !isDeepStrictEqual(currentDeclared, frozen.declared_child_skus)
        || !isDeepStrictEqual(current.applicable_child_skus, scopedApproval.applicable_child_skus)
        || !isDeepStrictEqual(currentMembers, frozen.child_skus)) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'A current shared-asset binding is stale or unapproved.', {
        artifact_id: artifactId
      });
    }
  }
  return {children, parentSnapshot};
}

function selectChildren(approval, children, childSkus) {
  if (childSkus === null) return children;
  if (!Array.isArray(childSkus) || childSkus.length !== 1 || new Set(childSkus).size !== childSkus.length
      || childSkus.some(sku => !approval.child_skus.includes(sku))) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Child delivery selection must name exactly one approved Child.');
  }
  const wanted = new Set(childSkus);
  return children.filter(child => wanted.has(child.sku));
}

function resolveProjectFile(projectDir, relativePath) {
  if (!isSafeArchivePath(relativePath)) {
    throw invalid('UNSAFE_PATH', 'Approved artifact path is unsafe.', {relativePath});
  }
  const root = path.resolve(projectDir);
  const resolved = path.resolve(root, ...relativePath.split('/'));
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw invalid('UNSAFE_PATH', 'Approved artifact path escapes the project directory.', {relativePath});
  }
  return resolved;
}

function mediaType(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  return ({'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'})[extension]
    ?? 'image/png';
}

async function loadImage(projectDir, asset, archivePath, hashFile) {
  const filePath = resolveProjectFile(projectDir, asset.path);
  let bytes;
  let actualHash;
  try {
    bytes = await readFile(filePath);
    actualHash = await hashFile(filePath);
  } catch (cause) {
    const error = invalid('MISSING_FILE', 'Approved Variation image is missing.', {path: asset.path});
    error.cause = cause;
    throw error;
  }
  if (actualHash !== asset.sha256 || hash(bytes) !== asset.sha256) {
    throw invalid('HASH_MISMATCH', 'Approved Variation image changed after approval.', {path: asset.path});
  }
  try {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) throw new Error('missing raster dimensions');
  } catch (cause) {
    const error = invalid('CORRUPT_IMAGE', 'Approved Variation image cannot be decoded.', {path: asset.path});
    error.cause = cause;
    throw error;
  }
  return {
    relative_path: archivePath,
    archive_path: archivePath,
    media_type: mediaType(asset.path),
    byte_size: bytes.length,
    sha256: actualHash,
    version: asset.version ?? 1,
    asset_id: asset.artifact_id,
    asset_ids: [asset.artifact_id],
    bytes
  };
}

function safeOutputName(sourcePath, fallbackId, used) {
  let filename = path.posix.basename(sourcePath);
  if (!filename || used.has(filename.toLocaleLowerCase('en-US'))) {
    const extension = path.posix.extname(filename) || '.png';
    filename = `${String(fallbackId).replace(/[^a-z0-9._-]/gi, '-')}${extension}`;
  }
  const key = filename.toLocaleLowerCase('en-US');
  if (used.has(key)) throw invalid('APPROVAL_SCOPE_MISMATCH', 'Approved assets collide in the delivery archive.', {filename});
  used.add(key);
  return filename;
}

function assertFrozenAsset(id, asset) {
  if (!record(asset) || asset.artifact_id !== id || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '')) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Frozen asset mapping is invalid.', {asset_id: id});
  }
  if (!isSafeManifestPath(asset.path)) {
    throw invalid('UNSAFE_PATH', 'Frozen asset mapping contains an unsafe path.', {asset_id: id, path: asset.path});
  }
}

function validateFrozenScopePaths(scope) {
  for (const version of scope.child_versions) {
    if (!isSafeManifestPath(version.approved_main_path)) {
      throw invalid('UNSAFE_PATH', 'Frozen Child version contains an unsafe approved main path.', {
        child_sku: version.child_sku ?? null,
        path: version.approved_main_path ?? null
      });
    }
    if (version.approved_main_path !== scope.asset_map.child_main?.[version.child_sku]?.path) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'Frozen Child main path copies do not agree.', {
        child_sku: version.child_sku ?? null
      });
    }
  }
  for (const [sku, asset] of Object.entries(scope.asset_map.child_main)) {
    assertFrozenAsset(asset?.artifact_id, asset);
    if (!scope.child_skus.includes(sku)) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'Frozen main-image path belongs to an unselected Child.', {child_sku: sku});
    }
  }
  for (const [sku, assets] of Object.entries(scope.asset_map.child_secondary)) {
    if (!scope.child_skus.includes(sku) || !Array.isArray(assets)) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'Frozen secondary-image path mapping is invalid.', {child_sku: sku});
    }
    for (const asset of assets) assertFrozenAsset(asset?.artifact_id, asset);
  }
  for (const [artifactId, asset] of Object.entries(scope.asset_map.shared)) {
    assertFrozenAsset(artifactId, {...asset, artifact_id: artifactId});
  }
}

function deriveAssetLayout(scope, selectedSkus) {
  const sharedPaths = {};
  const physicalShared = new Map();
  const sharedUsedNames = new Set();
  for (const [artifactId, asset] of Object.entries(scope.asset_map.shared)) {
    assertFrozenAsset(artifactId, {...asset, artifact_id: artifactId});
    if (!Array.isArray(asset.child_skus) || asset.child_skus.some(sku => !scope.child_skus.includes(sku))) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'Frozen shared asset Child mapping is invalid.', {asset_id: artifactId});
    }
    if (!asset.child_skus.some(sku => selectedSkus.includes(sku))) continue;
    let physical = physicalShared.get(asset.sha256);
    if (!physical) {
      const filename = safeOutputName(asset.path, artifactId, sharedUsedNames);
      physical = {
        archivePath: `shared/${filename}`,
        sha256: asset.sha256,
        mediaType: mediaType(asset.path),
        assetIds: [],
        assets: []
      };
      physicalShared.set(asset.sha256, physical);
    } else if (physical.mediaType !== mediaType(asset.path)) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'Byte-identical shared assets declare conflicting image types.', {
        asset_id: artifactId
      });
    }
    physical.assetIds.push(artifactId);
    physical.assets.push({...structuredClone(asset), artifact_id: artifactId});
    sharedPaths[artifactId] = physical.archivePath;
  }

  const children = {};
  const physicalChildren = [];
  for (const sku of selectedSkus) {
    const main = scope.asset_map.child_main[sku];
    assertFrozenAsset(main?.artifact_id, main);
    const mainExtension = path.posix.extname(main.path).toLowerCase() || '.png';
    const mainPath = `children/${sku}/main${mainExtension}`;
    physicalChildren.push({
      archivePath: mainPath, sha256: main.sha256,
      mediaType: mediaType(main.path),
      assetIds: [main.artifact_id], assets: [main]
    });

    const secondaries = scope.asset_map.child_secondary[sku];
    if (!Array.isArray(secondaries)) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'Frozen Child secondary mapping is invalid.', {child_sku: sku});
    }
    const usedSecondaryNames = new Set();
    const secondaryPaths = [];
    for (const secondary of secondaries) {
      assertFrozenAsset(secondary.artifact_id, secondary);
      const filename = safeOutputName(secondary.path, secondary.artifact_id, usedSecondaryNames);
      const archivePath = `children/${sku}/secondary/${filename}`;
      physicalChildren.push({
        archivePath, sha256: secondary.sha256,
        mediaType: mediaType(secondary.path),
        assetIds: [secondary.artifact_id], assets: [secondary]
      });
      secondaryPaths.push(archivePath);
    }
    const sharedIds = Object.entries(scope.asset_map.shared)
      .filter(([, asset]) => asset.child_skus.includes(sku))
      .map(([artifactId]) => artifactId);
    children[sku] = {
      asset_ids: {
        main: main.artifact_id,
        child_secondary: secondaries.map(item => item.artifact_id),
        shared: sharedIds
      },
      asset_paths: [
        mainPath,
        ...secondaryPaths,
        ...new Set(sharedIds.map(id => sharedPaths[id]))
      ]
    };
  }
  return {
    children,
    physicalAssets: [...physicalChildren, ...physicalShared.values()]
  };
}

function listingArtifacts(prefix, snapshot) {
  const content = structuredClone(snapshot.content);
  const json = jsonBytes(content);
  const markdown = Buffer.from(renderListing(content), 'utf8');
  return [
    {
      relative_path: `${prefix}/listing.json`, archive_path: `${prefix}/listing.json`,
      media_type: 'application/json', byte_size: json.length, sha256: hash(json),
      version: snapshot.version, bytes: json
    },
    {
      relative_path: `${prefix}/listing.md`, archive_path: `${prefix}/listing.md`,
      media_type: 'text/markdown', byte_size: markdown.length, sha256: hash(markdown),
      version: snapshot.version, bytes: markdown
    }
  ];
}

function manifestArtifact(artifact, approval) {
  return {
    relative_path: artifact.relative_path,
    archive_path: artifact.archive_path,
    container: 'delivery.zip',
    media_type: artifact.media_type,
    byte_size: artifact.byte_size,
    sha256: artifact.sha256,
    version: artifact.version ?? 1,
    approval_id: approval.id,
    ...(artifact.asset_id ? {asset_id: artifact.asset_id} : {}),
    ...(artifact.asset_ids ? {asset_ids: [...artifact.asset_ids]} : {})
  };
}

async function outputExists(outputDir) {
  try {
    await access(outputDir);
    return true;
  } catch {
    return false;
  }
}

async function writeOutput({outputDir, manifest, artifacts, expectedScope}) {
  const manifestBytes = jsonBytes(manifest);
  const archive = Object.fromEntries(artifacts.map(artifact => [artifact.archive_path, artifact.bytes]));
  archive['delivery-manifest.json'] = manifestBytes;
  const zipBytes = Buffer.from(zipSync(archive, {level: 6}));
  const absoluteOutput = path.resolve(outputDir);
  await mkdir(path.dirname(absoluteOutput), {recursive: true});
  if (await outputExists(absoluteOutput)) throw invalid('OUTPUT_EXISTS', 'Delivery output path already exists.');
  const stage = await mkdtemp(path.join(path.dirname(absoluteOutput), `.${path.basename(absoluteOutput)}-${randomUUID()}-`));
  try {
    await writeFile(path.join(stage, 'delivery-manifest.json'), manifestBytes);
    await writeFile(path.join(stage, 'delivery.zip'), zipBytes);
    const verification = await verifyVariationDelivery({deliveryDir: stage, expectedScope});
    await rename(stage, absoluteOutput);
    return {
      outputDir: absoluteOutput,
      output_dir: absoluteOutput,
      manifest,
      manifestPath: path.join(absoluteOutput, 'delivery-manifest.json'),
      manifest_path: path.join(absoluteOutput, 'delivery-manifest.json'),
      zipPath: path.join(absoluteOutput, 'delivery.zip'),
      zip_path: path.join(absoluteOutput, 'delivery.zip'),
      verification
    };
  } catch (error) {
    await rm(stage, {recursive: true, force: true});
    throw error;
  }
}

export async function buildVariationDelivery({
  projectDir, outputDir, finalApproval, childSkus = null, hashFile = sha256File
}) {
  let state;
  try {
    state = JSON.parse(await readFile(path.join(path.resolve(projectDir), 'state.json'), 'utf8'));
  } catch (cause) {
    const error = invalid('MISSING_FILE', 'Variation project state cannot be read.');
    error.cause = cause;
    throw error;
  }
  const approval = requireFinalApproval(state, finalApproval);
  validateFrozenScopePaths(approval);
  const selected = selectChildren(approval, activeChildren(state.variation), childSkus);
  const selectedSkus = selected.map(child => child.sku);
  const {parentSnapshot} = validateCurrentScope(state, approval, new Set(selectedSkus));
  const deliveryScope = projectDeliveryScope(approval, selectedSkus);
  const layout = deriveAssetLayout(deliveryScope, selectedSkus);
  const artifacts = listingArtifacts('parent', parentSnapshot);
  const rows = [];

  for (const [artifactId, asset] of Object.entries(deliveryScope.asset_map.shared)) {
    if (!Array.isArray(asset.child_skus) || asset.child_skus.some(sku => !selectedSkus.includes(sku))) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'Shared asset has an invalid immutable Child mapping.', {artifact_id: artifactId});
    }
    approvalById(state, asset.approval_id, 'shared_image');
  }
  for (const sku of selectedSkus) {
    approvalById(state, deliveryScope.asset_map.child_main[sku].approval_id, 'child_main');
    for (const secondary of deliveryScope.asset_map.child_secondary[sku]) {
      approvalById(state, secondary.approval_id);
    }
  }
  for (const physical of layout.physicalAssets) {
    let delivered = null;
    for (const source of physical.assets) {
      const loaded = await loadImage(projectDir, source, physical.archivePath, hashFile);
      if (!delivered) delivered = loaded;
    }
    delivered.asset_id = physical.assetIds[0];
    delivered.asset_ids = [...physical.assetIds];
    artifacts.push(delivered);
  }

  for (const child of selected) {
    const version = approval.child_versions.find(item => item.child_sku === child.sku);
    const snapshot = latestApprovedListing(child);
    artifacts.push(...listingArtifacts(`children/${child.sku}`, snapshot));
    const childLayout = layout.children[child.sku];
    rows.push({
      parent_sku: state.variation.parent.sku,
      child_sku: child.sku,
      theme_dimensions: [...approval.theme_dimensions],
      variation_values: structuredClone(child.variation_values),
      listing_version: version.listing_version,
      product_master_version: version.product_master_version,
      asset_ids: structuredClone(childLayout.asset_ids),
      asset_paths: [...childLayout.asset_paths]
    });
  }

  const matrix = {
    schema_version: 1,
    parent_sku: state.variation.parent.sku,
    theme_dimensions: [...approval.theme_dimensions],
    children: rows
  };
  assertUniqueTuples(matrix.theme_dimensions, rows);
  const matrixContent = jsonBytes(matrix);
  artifacts.push({
    relative_path: 'variation-matrix.json', archive_path: 'variation-matrix.json',
    media_type: 'application/json', byte_size: matrixContent.length, sha256: hash(matrixContent),
    version: approval.variation_version, bytes: matrixContent
  });

  const manifest = {
    schema_version: 1,
    delivery_kind: 'variation',
    delivery_type: childSkus === null ? 'family' : 'child',
    approval_id: approval.id,
    variation_version: approval.variation_version,
    project_id: state.project.product_id,
    parent_sku: state.variation.parent.sku,
    marketplace: approval.marketplace,
    product_type: approval.product_type,
    approval_scope: deliveryScope,
    approval_provenance: {
      approval_id: approval.id,
      variation_version: approval.variation_version,
      final_scope_sha256: approval.scope_sha256,
      projection_sha256: projectionHash(deliveryScope)
    },
    delivery_scope: {
      type: childSkus === null ? 'family' : 'child',
      child_skus: selectedSkus
    },
    artifacts: artifacts.map(artifact => manifestArtifact(artifact, approval))
  };
  return writeOutput({outputDir, manifest, artifacts, expectedScope: approval});
}

function parseJsonMember(archive, member, reason = 'MANIFEST_INVALID') {
  if (!archive[member]) throw invalid(reason, `Delivery is missing ${member}.`, {path: member});
  try {
    return JSON.parse(Buffer.from(archive[member]).toString('utf8'));
  } catch (cause) {
    const error = invalid(reason, `Delivery ${member} is not valid JSON.`, {path: member});
    error.cause = cause;
    throw error;
  }
}

function exactRow(row, scope, manifest, expectedLayout) {
  const variation = scope.child_variations.find(item => item.child_sku === row.child_sku);
  const version = scope.child_versions.find(item => item.child_sku === row.child_sku);
  if (!variation || !version || row.parent_sku !== manifest.parent_sku
      || !isDeepStrictEqual(row.theme_dimensions, scope.theme_dimensions)
      || !isDeepStrictEqual(row.variation_values, variation.variation_values)
      || row.listing_version !== version.listing_version
      || row.product_master_version !== version.product_master_version) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Variation Matrix row does not match the immutable approval.', {
      child_sku: row.child_sku ?? null
    });
  }
  if (!expectedLayout
      || !isDeepStrictEqual(row.asset_ids, expectedLayout.asset_ids)
      || !isDeepStrictEqual(row.asset_paths, expectedLayout.asset_paths)) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Variation Matrix assets do not match the immutable approval.', {
      child_sku: row.child_sku
    });
  }
}

function listingRuleScopeMatches(content, scope) {
  const expected = scope.rule_scope ?? {
    rule_status: scope.rule_status,
    rules_unverified: scope.rules_unverified,
    upload_ready: scope.upload_ready
  };
  return content.rule_status === expected.rule_status
    && isDeepStrictEqual(content.rules_unverified ?? [], expected.rules_unverified ?? [])
    && content.upload_ready === expected.upload_ready;
}

function validManifestScope(manifest) {
  const scope = manifest.approval_scope;
  const delivery = manifest.delivery_scope;
  return manifest.approval_id && manifest.project_id && manifest.parent_sku
    && manifest.marketplace && manifest.product_type
    && Number.isInteger(manifest.variation_version) && manifest.variation_version > 0
    && Number.isInteger(scope.scope_version) && scope.scope_version === 1
    && scope.scope_type === 'variation_final'
    && scope.parent_sku === manifest.parent_sku
    && Number.isInteger(scope.parent_version) && scope.parent_version > 0
    && Number.isInteger(scope.family_identity_version) && scope.family_identity_version > 0
    && /^[a-f0-9]{64}$/.test(scope.parent_listing_content_sha256 ?? '')
    && Array.isArray(scope.theme_dimensions) && scope.theme_dimensions.length > 0
    && Array.isArray(scope.child_skus) && scope.child_skus.length > 0
    && Array.isArray(scope.child_variations) && scope.child_variations.length === scope.child_skus.length
    && Array.isArray(scope.child_versions) && scope.child_versions.length === scope.child_skus.length
    && scope.child_versions.every(item => /^[a-f0-9]{64}$/.test(item.listing_content_sha256 ?? ''))
    && record(scope.asset_map?.child_main) && record(scope.asset_map?.child_secondary)
    && record(scope.asset_map?.shared) && record(scope.rule_scope)
    && record(manifest.approval_provenance)
    && ['family', 'child'].includes(delivery.type)
    && delivery.type === manifest.delivery_type
    && Array.isArray(delivery.child_skus) && delivery.child_skus.length > 0
    && (delivery.type === 'family' || delivery.child_skus.length === 1);
}

export async function verifyVariationDelivery({deliveryDir, expectedScope = null}) {
  const root = path.resolve(deliveryDir);
  let manifestBytes;
  let manifest;
  let archive;
  try {
    manifestBytes = await readFile(path.join(root, 'delivery-manifest.json'));
    manifest = JSON.parse(manifestBytes.toString('utf8'));
    archive = unzipSync(await readFile(path.join(root, 'delivery.zip')));
  } catch (cause) {
    const error = invalid('DELIVERY_READ_FAILED', 'Variation delivery manifest or ZIP cannot be read.');
    error.cause = cause;
    throw error;
  }
  if (manifest.delivery_kind !== 'variation' || !record(manifest.approval_scope)
      || !record(manifest.delivery_scope) || !Array.isArray(manifest.artifacts)
      || manifest.artifacts.length === 0 || manifest.approval_scope.scope_type !== 'variation_final'
      || !validManifestScope(manifest)) {
    throw invalid('MANIFEST_INVALID', 'Variation delivery manifest is incomplete.');
  }
  validateFrozenScopePaths(manifest.approval_scope);
  const authenticityVerified = assertExpectedScope(manifest, expectedScope);
  if (!isDeepStrictEqual(manifest.delivery_scope.child_skus, manifest.approval_scope.child_skus)) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Delivered Child set does not equal the frozen delivery projection.');
  }
  if (!archive['variation-matrix.json']) {
    throw invalid('MANIFEST_INVALID', 'Variation delivery is missing variation-matrix.json.');
  }
  if (!archive['delivery-manifest.json'] || hash(archive['delivery-manifest.json']) !== hash(manifestBytes)) {
    throw invalid('HASH_MISMATCH', 'ZIP manifest does not match the external delivery manifest.');
  }
  if (manifest.artifacts.some(item => (
    !isSafeManifestPath(item.archive_path) || !isSafeManifestPath(item.relative_path)
  ))) {
    throw invalid('UNSAFE_PATH', 'Every Variation artifact path field must be independently safe.');
  }
  const archivePaths = manifest.artifacts.map(item => item.archive_path);
  if (new Set(archivePaths).size !== archivePaths.length) {
    throw invalid('UNSAFE_PATH', 'Variation manifest contains unsafe or duplicate archive paths.');
  }
  const scope = manifest.approval_scope;
  const selected = manifest.delivery_scope.child_skus;
  const layout = deriveAssetLayout(scope, selected);
  const expectedArtifacts = new Set(['parent/listing.json', 'parent/listing.md', 'variation-matrix.json']);
  for (const sku of selected) {
    expectedArtifacts.add(`children/${sku}/listing.json`);
    expectedArtifacts.add(`children/${sku}/listing.md`);
  }
  for (const physical of layout.physicalAssets) expectedArtifacts.add(physical.archivePath);
  const artifactSet = new Set(archivePaths);
  const missingArtifacts = [...expectedArtifacts].filter(item => !artifactSet.has(item));
  if (missingArtifacts.length > 0) {
    throw invalid('MISSING_FILE', 'Variation delivery is missing an approved artifact.', {paths: missingArtifacts});
  }
  const extraArtifacts = [...artifactSet].filter(item => !expectedArtifacts.has(item));
  if (extraArtifacts.length > 0) {
    const unrelatedChild = extraArtifacts.some(item => {
      const match = /^children\/([^/]+)\//.exec(item);
      return match && !selected.includes(match[1]);
    });
    throw invalid(
      unrelatedChild ? 'MANIFEST_INVALID' : 'APPROVAL_SCOPE_MISMATCH',
      'Variation delivery contains artifacts outside the frozen delivery projection.',
      {paths: extraArtifacts}
    );
  }
  const expectedImages = new Map(layout.physicalAssets.map(item => [item.archivePath, item]));
  const expectedMediaTypes = new Map([
    ['parent/listing.json', 'application/json'],
    ['parent/listing.md', 'text/markdown'],
    ['variation-matrix.json', 'application/json']
  ]);
  for (const sku of selected) {
    expectedMediaTypes.set(`children/${sku}/listing.json`, 'application/json');
    expectedMediaTypes.set(`children/${sku}/listing.md`, 'text/markdown');
  }
  for (const physical of layout.physicalAssets) {
    expectedMediaTypes.set(physical.archivePath, physical.mediaType);
  }
  for (const artifact of manifest.artifacts) {
    const archivePath = artifact.archive_path;
    if (artifact.container !== 'delivery.zip') {
      throw invalid('MANIFEST_INVALID', 'Variation artifact container is invalid.', {path: archivePath});
    }
    const bytes = archive[archivePath];
    if (!bytes) throw invalid('MISSING_FILE', 'Variation package is missing a manifest artifact.', {path: archivePath});
    if (bytes.length !== artifact.byte_size || hash(bytes) !== artifact.sha256) {
      throw invalid('HASH_MISMATCH', 'Variation artifact does not match its manifest hash.', {path: archivePath});
    }
    const frozen = expectedImages.get(archivePath);
    if (frozen && (artifact.sha256 !== frozen.sha256
          || artifact.asset_id !== frozen.assetIds[0]
          || !isDeepStrictEqual(artifact.asset_ids, frozen.assetIds))) {
        throw invalid('HASH_MISMATCH', 'Variation image does not match its frozen asset mapping.', {path: archivePath});
    }
    if (artifact.media_type !== expectedMediaTypes.get(archivePath)) {
      throw invalid('MANIFEST_INVALID', 'Variation artifact media type does not match its frozen archive role.', {
        path: archivePath,
        expected: expectedMediaTypes.get(archivePath),
        actual: artifact.media_type ?? null
      });
    }
    if (frozen) {
      try {
        const metadata = await sharp(bytes).metadata();
        if (!metadata.width || !metadata.height) throw new Error('missing raster dimensions');
      } catch (cause) {
        const error = invalid('CORRUPT_IMAGE', 'Variation image cannot be decoded.', {path: archivePath});
        error.cause = cause;
        throw error;
      }
    }
  }
  const expectedMembers = new Set(['delivery-manifest.json', ...archivePaths]);
  const actualMembers = Object.keys(archive);
  if (actualMembers.some(member => !isSafeManifestPath(member)) || actualMembers.some(member => !expectedMembers.has(member))) {
    throw invalid('UNSAFE_PATH', 'Variation ZIP contains an unsafe or unmanifested member.');
  }
  if (actualMembers.length !== expectedMembers.size) {
    throw invalid('MISSING_FILE', 'Variation ZIP is missing a manifest member.');
  }
  if (actualMembers.some(member => /\.(?:xlsx|xls|csv|tsv)$/i.test(member))) {
    throw invalid('MANIFEST_INVALID', 'Variation delivery must not contain an upload spreadsheet.');
  }

  const matrix = parseJsonMember(archive, 'variation-matrix.json');
  if (!Array.isArray(matrix.children)) {
    throw invalid('MANIFEST_INVALID', 'Variation Matrix Child rows are invalid.');
  }
  assertUniqueTuples(matrix.theme_dimensions, matrix.children);
  if (!Array.isArray(selected) || selected.length === 0 || new Set(selected).size !== selected.length
      || matrix.children.length !== selected.length
      || matrix.parent_sku !== manifest.parent_sku
      || !isDeepStrictEqual(matrix.theme_dimensions, scope.theme_dimensions)) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Variation delivery selection or Matrix scope is invalid.');
  }
  if (!isDeepStrictEqual(matrix.children.map(row => row.child_sku), selected)) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Variation Matrix does not contain the exact selected Child order.');
  }
  for (const row of matrix.children) exactRow(row, scope, manifest, layout.children[row.child_sku]);

  const parentListing = parseJsonMember(archive, 'parent/listing.json');
  if (parentListing.parent_sku !== manifest.parent_sku || parentListing.version !== scope.parent_version
      || parentListing.project_id !== manifest.project_id || parentListing.marketplace !== manifest.marketplace
      || parentListing.product_type !== manifest.product_type
      || !listingRuleScopeMatches(parentListing, scope)) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Delivered Parent Listing does not match the manifest scope.');
  }
  if (hash(archive['parent/listing.json']) !== scope.parent_listing_content_sha256) {
    throw invalid('HASH_MISMATCH', 'Delivered Parent Listing differs from its final approval.');
  }
  const expectedParentMarkdown = Buffer.from(renderListing(parentListing), 'utf8');
  if (!Buffer.from(archive['parent/listing.md']).equals(expectedParentMarkdown)) {
    throw invalid('HASH_MISMATCH', 'Delivered Parent Markdown is not derived from the approved Listing JSON.');
  }

  for (const row of matrix.children) {
    const prefix = `children/${row.child_sku}`;
    for (const required of [`${prefix}/listing.json`, `${prefix}/listing.md`, ...row.asset_paths]) {
      if (!artifactSet.has(required) || !archive[required]) {
        throw invalid('MISSING_FILE', 'Variation Matrix maps an absent member.', {path: required});
      }
    }
    const listing = parseJsonMember(archive, `${prefix}/listing.json`);
    if (listing.child_sku !== row.child_sku || listing.parent_sku !== manifest.parent_sku
        || listing.version !== row.listing_version || listing.product_master_version !== row.product_master_version
        || !isDeepStrictEqual(listing.variation_values, row.variation_values)
        || listing.project_id !== manifest.project_id || listing.marketplace !== manifest.marketplace
        || listing.product_type !== manifest.product_type
        || !listingRuleScopeMatches(listing, scope)) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'Delivered Child Listing does not match its Matrix row.', {
        child_sku: row.child_sku
      });
    }
    const version = scope.child_versions.find(item => item.child_sku === row.child_sku);
    if (hash(archive[`${prefix}/listing.json`]) !== version.listing_content_sha256) {
      throw invalid('HASH_MISMATCH', 'Delivered Child Listing differs from its final approval.', {
        child_sku: row.child_sku
      });
    }
    const expectedMarkdown = Buffer.from(renderListing(listing), 'utf8');
    if (!Buffer.from(archive[`${prefix}/listing.md`]).equals(expectedMarkdown)) {
      throw invalid('HASH_MISMATCH', 'Delivered Child Markdown is not derived from the approved Listing JSON.', {
        child_sku: row.child_sku
      });
    }
  }
  const verifiedImages = layout.physicalAssets.length;
  return {
    ok: true,
    manifest,
    matrix,
    verified_hashes: manifest.artifacts.length,
    verified_images: verifiedImages,
    verified_members: actualMembers.length,
    scope_verified: authenticityVerified,
    approval_authenticity_verified: authenticityVerified
  };
}
