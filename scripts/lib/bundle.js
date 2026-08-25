import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {unzipSync, zipSync} from 'fflate';
import sharp from 'sharp';

import {DomainError} from './errors.js';
import {isSchemaAuthorizationCurrent} from './listing.js';
import {preflightListingScope} from './listing-audit.js';
import {renderListing} from './listing-drafts.js';

function invalid(reason, message, details = {}) {
  return new DomainError('BUNDLE_INVALID', message, {reason, ...details});
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256File(filePath) {
  return hash(await readFile(filePath));
}

export function validateApprovalScope(state, approval) {
  if (!approval?.id || approval.finalized !== true || approval.ambiguous === true) {
    throw invalid('AMBIGUOUS_APPROVAL', 'A single finalized, unambiguous approval is required.');
  }
  if (approval.product_master_version !== state.product_master?.version) {
    throw invalid('STALE_PRODUCT_MASTER', 'Approval does not match the current Product Master version.', {
      approved: approval.product_master_version,
      current: state.product_master?.version,
    });
  }
  if (approval.listing_version !== state.listing?.version) {
    throw invalid('LISTING_VERSION_MISMATCH', 'Approval does not match the selected Listing version.');
  }
  const expectedScope = {
    project_id: state.project_id,
    marketplace: state.listing?.marketplace,
    product_type: state.listing?.product_type,
    schema_status: state.listing?.schema_status,
  };
  if (Object.entries(expectedScope).some(([field, value]) => !value || approval[field] !== value)
      || approval.upload_ready !== state.listing?.upload_ready) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Approval marketplace, product type, Schema status, project, or readiness does not match the current Listing.', {
      expected: expectedScope,
    });
  }
  if (state.listing?.product_master_version !== state.product_master.version
    || state.listing?.status !== 'approved'
    || state.listing?.approval_id !== approval.id) {
    throw invalid('UNAPPROVED_LISTING', 'Listing approval scope does not match the current selection.');
  }

  const ids = Array.isArray(approval.artifact_ids) ? approval.artifact_ids : [];
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw invalid('AMBIGUOUS_APPROVAL', 'Approval must name a unique nonempty artifact selection.');
  }
  const selected = ids.map(id => state.images.find(image => image.id === id));
  if (selected.some(image => !image)) throw invalid('UNAPPROVED_ARTIFACT', 'Approval names an unknown image artifact.');
  for (const image of selected) {
    if (image.status !== 'approved' || image.approval_id !== approval.id || image.selected !== true
        || image.approval_explicit !== true || !image.approved_at) {
      throw invalid('UNAPPROVED_ARTIFACT', 'Selected image is not approved in this approval scope.', {id: image.id});
    }
    if (image.product_master_version !== state.product_master.version) {
      throw invalid('STALE_PRODUCT_MASTER', 'Selected image belongs to a stale Product Master.', {id: image.id});
    }
  }
  const otherSelected = state.images.filter(image => image.selected === true && !ids.includes(image.id));
  if (otherSelected.length > 0) {
    throw invalid('AMBIGUOUS_APPROVAL', 'Project contains selected images outside the final approval.', {ids: otherSelected.map(image => image.id)});
  }
  return {images: selected, listing: state.listing};
}

export function buildManifest({approval, artifacts}) {
  return {
    schema_version: 1,
    product_master_version: approval.product_master_version,
    approval_id: approval.id,
    listing_version: approval.listing_version ?? null,
    approval_scope: {
      project_id: approval.project_id ?? null,
      marketplace: approval.marketplace ?? null,
      product_type: approval.product_type ?? null,
      schema_status: approval.schema_status ?? null,
      upload_ready: approval.upload_ready ?? null
    },
    artifacts: artifacts.map(artifact => ({
      version: artifact.version,
      relative_path: artifact.relative_path,
      container: 'delivery.zip',
      archive_path: artifact.relative_path,
      media_type: artifact.media_type,
      byte_size: artifact.byte_size,
      sha256: artifact.sha256,
      product_master_version: approval.product_master_version,
      approval_id: approval.id,
      change_summary: artifact.change_summary ?? approval.change_summary ?? '',
    })),
  };
}

function resolveProjectFile(projectDir, relativePath) {
  const root = path.resolve(projectDir);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw invalid('UNSAFE_PATH', 'Artifact path escapes the project directory.', {relativePath});
  return resolved;
}

async function readArtifact(projectDir, relativePath, expectedHash) {
  const filePath = resolveProjectFile(projectDir, relativePath);
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch (cause) {
    const error = invalid('MISSING_FILE', 'Approved artifact file is missing.', {relativePath});
    error.cause = cause;
    throw error;
  }
  const actualHash = hash(bytes);
  if (expectedHash && actualHash !== expectedHash) {
    throw invalid('HASH_MISMATCH', 'Approved artifact bytes changed after approval.', {relativePath, expectedHash, actualHash});
  }
  return {bytes, actualHash};
}

async function imageArtifact(projectDir, image) {
  const {bytes, actualHash} = await readArtifact(projectDir, image.path, image.sha256);
  try {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) throw new Error('missing raster dimensions');
  } catch (cause) {
    const error = invalid('CORRUPT_IMAGE', 'Approved image cannot be decoded.', {id: image.id, path: image.path});
    error.cause = cause;
    throw error;
  }
  return {
    relative_path: `images/${path.basename(image.path)}`,
    media_type: image.media_type,
    byte_size: bytes.length,
    sha256: actualHash,
    version: image.version,
    change_summary: image.change_summary,
    bytes,
  };
}

async function listingArtifact(projectDir, listing, kind) {
  const relativePath = listing[`${kind}_path`];
  const expectedHash = listing[`${kind}_sha256`];
  const {bytes, actualHash} = await readArtifact(projectDir, relativePath, expectedHash);
  return {
    relative_path: `listing/${path.basename(relativePath)}`,
    media_type: kind === 'json' ? 'application/json' : 'text/markdown',
    byte_size: bytes.length,
    sha256: actualHash,
    version: listing.version,
    change_summary: `Approved Listing ${kind.toUpperCase()} version ${listing.version}`,
    bytes,
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

async function writeDeliveryOutput({outputDir, manifest, artifacts}) {
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const archiveEntries = Object.fromEntries(artifacts.map(artifact => [artifact.relative_path, artifact.bytes]));
  archiveEntries['delivery-manifest.json'] = manifestBytes;
  const archiveBytes = Buffer.from(zipSync(archiveEntries, {level: 6}));

  const absoluteOutput = path.resolve(outputDir);
  const outputParent = path.dirname(absoluteOutput);
  await mkdir(outputParent, {recursive: true});
  if (await outputExists(absoluteOutput)) throw invalid('OUTPUT_EXISTS', 'Delivery output path already exists.', {outputDir: absoluteOutput});
  const stage = await mkdtemp(path.join(outputParent, `.${path.basename(absoluteOutput)}-staging-`));
  try {
    const manifestPath = path.join(stage, 'delivery-manifest.json');
    const zipPath = path.join(stage, 'delivery.zip');
    await writeFile(manifestPath, manifestBytes);
    await writeFile(zipPath, archiveBytes);
    const verification = await verifyDelivery({deliveryDir: stage});
    await rename(stage, absoluteOutput);
    return {
      outputDir: absoluteOutput,
      manifest,
      manifestPath: path.join(absoluteOutput, 'delivery-manifest.json'),
      zipPath: path.join(absoluteOutput, 'delivery.zip'),
      verification
    };
  } catch (error) {
    await rm(stage, {recursive: true, force: true});
    throw error;
  }
}

export async function verifyDelivery({deliveryDir, expectedScope = null}) {
  const root = path.resolve(deliveryDir);
  let manifestBytes;
  let archive;
  let manifest;
  try {
    manifestBytes = await readFile(path.join(root, 'delivery-manifest.json'));
    manifest = JSON.parse(manifestBytes.toString('utf8'));
    archive = unzipSync(await readFile(path.join(root, 'delivery.zip')));
  } catch (cause) {
    const error = invalid('DELIVERY_READ_FAILED', 'Delivery manifest or ZIP cannot be read.');
    error.cause = cause;
    throw error;
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw invalid('MANIFEST_INVALID', 'Delivery manifest artifacts are invalid.');
  }
  const scope = expectedScope ?? manifest.approval_scope;
  if (!scope || !scope.project_id || !scope.marketplace || !scope.product_type || manifest.listing_version === null) {
    throw invalid('MANIFEST_INVALID', 'Delivery manifest approval scope is incomplete.');
  }
  const archivePaths = manifest.artifacts.map(item => item.archive_path ?? item.relative_path);
  const safeArchivePath = value => {
    if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')
      || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value)) return false;
    const parts = value.split('/');
    return parts.every(part => part && part !== '.' && part !== '..') && path.posix.normalize(value) === value;
  };
  if (archivePaths.some(item => !safeArchivePath(item)) || new Set(archivePaths).size !== archivePaths.length) {
    throw invalid('MANIFEST_INVALID', 'Delivery manifest artifact paths must be unique safe archive-relative paths.');
  }
  if (archivePaths.filter(item => item === 'listing/listing.json').length !== 1
    || archivePaths.filter(item => item === 'listing/listing.md').length !== 1) {
    throw invalid('MANIFEST_INVALID', 'Delivery manifest requires exactly one Listing JSON and Markdown artifact.');
  }
  const expectedMembers = new Set(['delivery-manifest.json', ...archivePaths]);
  const actualMembers = Object.keys(archive);
  if (actualMembers.length !== expectedMembers.size || actualMembers.some(member => !expectedMembers.has(member))) {
    throw invalid('ZIP_MEMBER_MISMATCH', 'ZIP members do not match the delivery manifest.', {expected: [...expectedMembers], actual: actualMembers});
  }
  if (!archive['delivery-manifest.json'] || hash(archive['delivery-manifest.json']) !== hash(manifestBytes)) {
    throw invalid('ZIP_VERIFICATION_FAILED', 'ZIP manifest verification failed.');
  }

  let verifiedImages = 0;
  let listing = null;
  for (const artifact of manifest.artifacts) {
    if (artifact.container !== 'delivery.zip') throw invalid('MANIFEST_INVALID', 'Artifact container is not explicit.', {path: artifact.relative_path});
    const archivePath = artifact.archive_path ?? artifact.relative_path;
    const bytes = archive[archivePath];
    if (!bytes || bytes.length !== artifact.byte_size || hash(bytes) !== artifact.sha256) {
      throw invalid('ZIP_VERIFICATION_FAILED', 'ZIP artifact length or hash verification failed.', {path: archivePath});
    }
    if (String(artifact.media_type).startsWith('image/')) {
      try {
        const metadata = await sharp(bytes).metadata();
        if (!metadata.width || !metadata.height) throw new Error('missing raster dimensions');
      } catch (cause) {
        const error = invalid('CORRUPT_IMAGE', 'ZIP image cannot be decoded.', {path: archivePath});
        error.cause = cause;
        throw error;
      }
      verifiedImages += 1;
    }
    if (archivePath === 'listing/listing.json') {
      try {
        listing = JSON.parse(Buffer.from(bytes).toString('utf8'));
      } catch (cause) {
        const error = invalid('CORRUPT_LISTING', 'ZIP Listing JSON cannot be decoded.');
        error.cause = cause;
        throw error;
      }
    }
  }

  if (listing) {
    for (const field of ['project_id', 'marketplace', 'product_type']) {
      if (scope[field] && listing[field] !== scope[field]) {
        throw invalid('APPROVAL_SCOPE_MISMATCH', 'ZIP Listing does not match manifest scope.', {field, expected: scope[field], actual: listing[field]});
      }
    }
    if (manifest.listing_version !== null && listing.version !== manifest.listing_version) {
      throw invalid('LISTING_VERSION_MISMATCH', 'ZIP Listing version does not match the manifest.');
    }
    if (scope.upload_ready !== null && scope.upload_ready !== undefined && listing.upload_ready !== scope.upload_ready) {
      throw invalid('APPROVAL_SCOPE_MISMATCH', 'ZIP Listing readiness does not match manifest scope.');
    }
  }
  if (!listing) throw invalid('MANIFEST_INVALID', 'Delivery ZIP is missing the required Listing JSON.');
  return {
    ok: true,
    manifest,
    verified_hashes: manifest.artifacts.length,
    verified_images: verifiedImages,
    verified_members: actualMembers.length,
    scope_verified: true
  };
}

export async function buildDelivery({projectDir, outputDir, approval}) {
  const state = JSON.parse(await readFile(path.join(projectDir, 'assets.json'), 'utf8'));
  const selection = validateApprovalScope(state, approval);
  const artifacts = [];
  for (const image of selection.images) artifacts.push(await imageArtifact(projectDir, image));
  const listingJson = await listingArtifact(projectDir, selection.listing, 'json');
  const listingMarkdown = await listingArtifact(projectDir, selection.listing, 'markdown');
  let parsedListing;
  try {
    parsedListing = JSON.parse(listingJson.bytes.toString('utf8'));
  } catch (cause) {
    const error = invalid('CORRUPT_LISTING', 'Approved Listing JSON cannot be decoded.');
    error.cause = cause;
    throw error;
  }
  if (parsedListing.version !== approval.listing_version || parsedListing.product_master_version !== approval.product_master_version) {
    throw invalid('LISTING_VERSION_MISMATCH', 'Listing file content does not match approved versions.');
  }
  if (parsedListing.project_id !== approval.project_id || parsedListing.marketplace !== approval.marketplace
      || parsedListing.product_type !== approval.product_type) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Listing file content does not match the approved project, marketplace, or product type.');
  }
  if ((parsedListing.rules_unverified?.length ?? 0) > 0 || parsedListing.upload_ready !== true) {
    if (approval.upload_ready === true) throw invalid('SCHEMA_NOT_READY', 'Schema-unverified Listing cannot be labeled upload-ready.');
    const scope = {
      project_id: parsedListing.project_id,
      marketplace: parsedListing.marketplace,
      product_type: parsedListing.product_type,
      product_master_version: parsedListing.product_master_version,
      listing_version: parsedListing.version,
    };
    if (approval.schema_status !== 'unverified' || !isSchemaAuthorizationCurrent(parsedListing.schema_authorization, scope)) {
      throw invalid('SCHEMA_AUTHORIZATION_REQUIRED', 'Schema-unverified delivery requires current version-bound authorization.', {scope});
    }
  } else if (approval.schema_status !== 'verified') {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Schema-verified Listing requires a verified approval scope.');
  } else if (approval.upload_ready !== parsedListing.upload_ready) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Listing readiness does not match the approval scope.');
  }
  artifacts.push(listingJson, listingMarkdown);
  const manifest = buildManifest({approval, artifacts});
  return writeDeliveryOutput({outputDir, manifest, artifacts});
}

function validateV2Scope(state, approval) {
  if (state?.schema_version !== 2 || !approval?.id || approval.finalized !== true) {
    throw invalid('AMBIGUOUS_APPROVAL', 'A v2 project and explicit final approval are required.');
  }
  const listing = state.listing?.approved?.at(-1);
  if (!listing || listing.status !== 'approved' || listing.version !== approval.listing_version) {
    throw invalid('LISTING_VERSION_MISMATCH', 'Final approval does not match the approved Listing snapshot.');
  }
  if (state.product_master?.status !== 'locked' || state.product_master.version !== approval.product_master_version) {
    throw invalid('STALE_PRODUCT_MASTER', 'Final approval does not match the locked Product Master.');
  }
  if (approval.project_id !== state.project.product_id || approval.marketplace !== state.project.marketplace
      || approval.product_type !== state.project.product_type) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Final approval does not match project, marketplace, or product type.');
  }
  const listingApproval = state.approvals.find(item => item.id === listing.approval_id && item.type === 'listing');
  if (!listingApproval) throw invalid('UNAPPROVED_LISTING', 'Approved Listing approval record is missing.');
  if (listingApproval.scope_version === 1) {
    const sameSelection = Array.isArray(listingApproval.artifact_ids)
      && listingApproval.artifact_ids.length === state.gallery.selected.length
      && listingApproval.artifact_ids.every(id => state.gallery.selected.includes(id));
    const content = listing.content;
    const scopeMatches = sameSelection
      && listingApproval.project_id === state.project.product_id
      && listingApproval.marketplace === state.project.marketplace
      && listingApproval.product_type === state.project.product_type
      && listingApproval.product_master_version === state.product_master.version
      && listingApproval.draft_revision === listing.draft_revision
      && listingApproval.content_sha256 === listing.json_sha256
      && listingApproval.rule_status === content.rule_status
      && JSON.stringify(listingApproval.rules_unverified ?? []) === JSON.stringify(content.rules_unverified ?? [])
      && listingApproval.upload_ready === content.upload_ready;
    if (!scopeMatches) {
      throw invalid('LISTING_SCOPE_STALE', 'Gallery, project, Product Master, content, or rule scope changed after Listing approval.');
    }
  }
  try {
    preflightListingScope(state, listing.content);
  } catch (cause) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Approved Listing does not satisfy the shared finalization preflight.', {cause: cause.message});
  }
  const ids = approval.artifact_ids ?? [];
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length
      || ids.length !== state.gallery.selected.length || ids.some(id => !state.gallery.selected.includes(id))) {
    throw invalid('AMBIGUOUS_APPROVAL', 'Final approval must name the exact selected image set.');
  }
  const images = ids.map(id => state.gallery.assets[id]);
  for (const image of images) {
    if (!image || image.status !== 'approved' || !image.sha256 || !image.approval_id) {
      throw invalid('UNAPPROVED_ARTIFACT', 'Selected image is not approved.', {id: image?.id ?? null});
    }
    const artifactApproval = state.approvals.find(item => item.id === image.approval_id && item.artifact_id === image.id);
    if (!artifactApproval || artifactApproval.sha256 !== image.sha256 || artifactApproval.user_action !== 'approved') {
      throw invalid('UNAPPROVED_ARTIFACT', 'Selected image approval binding is invalid.', {id: image.id});
    }
    const isMain = image.id === state.product_master.approved_main_id;
    if (!isMain && image.product_master_version !== state.product_master.version) {
      throw invalid('STALE_PRODUCT_MASTER', 'Selected secondary belongs to a stale Product Master.', {id: image.id});
    }
  }
  return {images, listing};
}

async function readAllV2Images(projectDir, images, hashFile) {
  const loaded = [];
  let firstError = null;
  for (const image of images) {
    try {
      const filePath = resolveProjectFile(projectDir, image.path);
      const bytes = await readFile(filePath);
      const actualHash = await hashFile(filePath);
      let metadata;
      try {
        metadata = await sharp(bytes).metadata();
        if (!metadata.width || !metadata.height) throw new Error('missing raster dimensions');
      } catch (cause) {
        const error = invalid('CORRUPT_IMAGE', 'Approved image cannot be decoded.', {id: image.id, path: image.path});
        error.cause = cause;
        throw error;
      }
      loaded.push({image, bytes, actualHash, metadata});
    } catch (cause) {
      if (!firstError) {
        firstError = cause instanceof DomainError
          ? cause
          : invalid('MISSING_FILE', 'Approved artifact file is missing.', {id: image.id, path: image.path});
      }
    }
  }
  if (firstError) throw firstError;
  const mismatch = loaded.find(item => item.actualHash !== item.image.sha256);
  if (mismatch) {
    throw invalid('HASH_MISMATCH', 'Approved artifact bytes changed after approval.', {
      id: mismatch.image.id,
      relativePath: mismatch.image.path,
      expectedHash: mismatch.image.sha256,
      actualHash: mismatch.actualHash
    });
  }
  return loaded;
}

export async function buildV2Delivery({projectDir, outputDir, finalApproval, hashFile = sha256File}) {
  const state = JSON.parse(await readFile(path.join(projectDir, 'state.json'), 'utf8'));
  const selection = validateV2Scope(state, finalApproval);
  const loadedImages = await readAllV2Images(projectDir, selection.images, hashFile);
  const artifacts = loadedImages.map(({image, bytes, actualHash}) => ({
    relative_path: `images/${path.basename(image.path)}`,
    media_type: image.media_type ?? 'image/png',
    byte_size: bytes.length,
    sha256: actualHash,
    version: image.version ?? 1,
    change_summary: image.change_summary ?? `Approved ${image.kind} image`,
    bytes
  }));

  const content = structuredClone(selection.listing.content);
  const jsonBytes = Buffer.from(`${JSON.stringify(content, null, 2)}\n`);
  const markdownBytes = Buffer.from(renderListing(content));
  if (hash(jsonBytes) !== selection.listing.json_sha256 || hash(markdownBytes) !== selection.listing.markdown_sha256) {
    throw invalid('HASH_MISMATCH', 'Approved Listing content changed after approval.', {listing_version: selection.listing.version});
  }
  if (content.version !== finalApproval.listing_version || content.product_master_version !== finalApproval.product_master_version
      || content.project_id !== finalApproval.project_id || content.marketplace !== finalApproval.marketplace
      || content.product_type !== finalApproval.product_type) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Approved Listing content does not match final scope.');
  }
  const unverified = (content.rules_unverified?.length ?? 0) > 0 || content.upload_ready !== true;
  if (finalApproval.upload_ready !== content.upload_ready
      || finalApproval.schema_status !== (unverified ? 'unverified' : 'verified')) {
    throw invalid('APPROVAL_SCOPE_MISMATCH', 'Listing rule status does not match final approval.');
  }
  artifacts.push(
    {relative_path: 'listing/listing.json', media_type: 'application/json', byte_size: jsonBytes.length, sha256: hash(jsonBytes), version: selection.listing.version, change_summary: `Approved Listing JSON version ${selection.listing.version}`, bytes: jsonBytes},
    {relative_path: 'listing/listing.md', media_type: 'text/markdown', byte_size: markdownBytes.length, sha256: hash(markdownBytes), version: selection.listing.version, change_summary: `Approved Listing Markdown version ${selection.listing.version}`, bytes: markdownBytes}
  );
  const manifest = buildManifest({approval: finalApproval, artifacts});
  return writeDeliveryOutput({outputDir, manifest, artifacts});
}
