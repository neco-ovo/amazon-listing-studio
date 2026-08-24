import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {unzipSync, zipSync} from 'fflate';
import sharp from 'sharp';

import {DomainError} from './errors.js';

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
    if (image.status !== 'approved' || image.approval_id !== approval.id || image.selected !== true) {
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
  if ((parsedListing.rules_unverified?.length ?? 0) > 0 || parsedListing.upload_ready !== true) {
    if (approval.upload_ready === true) throw invalid('SCHEMA_NOT_READY', 'Schema-unverified Listing cannot be labeled upload-ready.');
  }
  artifacts.push(listingJson, listingMarkdown);
  const manifest = buildManifest({approval, artifacts});
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
