import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {unzipSync, zipSync} from 'fflate';
import sharp from 'sharp';

import {DomainError} from './errors.js';
import {isSchemaAuthorizationCurrent} from './listing.js';
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
    artifacts: artifacts.map(artifact => ({
      version: artifact.version,
      relative_path: artifact.relative_path,
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
    const verified = unzipSync(await readFile(zipPath));
    for (const artifact of manifest.artifacts) {
      const bytes = verified[artifact.relative_path];
      if (!bytes || hash(bytes) !== artifact.sha256) throw invalid('ZIP_VERIFICATION_FAILED', 'ZIP artifact verification failed.', {path: artifact.relative_path});
    }
    if (hash(verified['delivery-manifest.json']) !== hash(manifestBytes)) throw invalid('ZIP_VERIFICATION_FAILED', 'ZIP manifest verification failed.');
    await rename(stage, absoluteOutput);
    return {
      outputDir: absoluteOutput,
      manifest,
      manifestPath: path.join(absoluteOutput, 'delivery-manifest.json'),
      zipPath: path.join(absoluteOutput, 'delivery.zip'),
    };
  } catch (error) {
    await rm(stage, {recursive: true, force: true});
    throw error;
  }
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
