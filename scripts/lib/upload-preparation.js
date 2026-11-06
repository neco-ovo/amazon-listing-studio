import {readFile} from 'node:fs/promises';
import path from 'node:path';

import {unzipSync, zipSync} from 'fflate';

import {DomainError} from './errors.js';

function invalid(code, message, details = {}) {
  return new DomainError(code, message, details);
}

function parseJson(archive, member) {
  const bytes = archive[member];
  if (!bytes) throw invalid('MISSING_FILE', `Verified delivery is missing ${member}.`, {member});
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (cause) {
    const error = invalid('CORRUPT_LISTING', `Verified delivery member ${member} is not valid JSON.`, {member});
    error.cause = cause;
    throw error;
  }
}

function compactCode(value, maxTokens = 4) {
  const tokens = String(value ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (tokens.length === 1) return tokens[0].slice(0, 4) || 'item';
  return tokens.slice(0, maxTokens).map(token => token[0]).join('') || 'item';
}

function purposeFor(source, index, assetId = '') {
  const identity = `${assetId} ${path.posix.basename(source)}`;
  if (index === 0 || /(?:^|-)main(?:-|$)/i.test(identity)) return 'main';
  for (const role of ['readability', 'size-construction', 'durability', 'front-back', 'application', 'mounting-package']) {
    if (identity.toLowerCase().includes(role)) return role;
  }
  const stem = path.posix.basename(source, path.posix.extname(source)).replace(/-\d+$/, '');
  const match = /(?:^|-)(scene|application|size|detail|back|front)(?:-|$)/i.exec(stem);
  return match?.[1].toLowerCase() ?? 'image';
}

function slotsFor(paths, artifacts) {
  const purposes = paths.map((source, index) => purposeFor(source, index, artifacts.get(source)?.asset_id));
  const totals = purposes.reduce((result, purpose) => result.set(purpose, (result.get(purpose) ?? 0) + 1), new Map());
  const seen = new Map();
  return paths.map((source, index) => {
    const purpose = purposes[index];
    const ordinal = (seen.get(purpose) ?? 0) + 1;
    seen.set(purpose, ordinal);
    return {
      source,
      media_type: artifacts.get(source)?.media_type ?? null,
      role: purpose,
      slot_id: totals.get(purpose) > 1 ? `${purpose}-${ordinal}` : purpose
    };
  });
}

function parseVerifiedMembers({manifest, matrix, archive}) {
  const artifacts = new Map((manifest.artifacts ?? []).map(artifact => [
    artifact.archive_path ?? artifact.relative_path,
    artifact
  ]));
  if (manifest.delivery_kind === 'variation') {
    const verifiedMatrix = matrix ?? parseJson(archive, 'variation-matrix.json');
    const children = Object.fromEntries(verifiedMatrix.children.map(row => [
      row.child_sku,
      parseJson(archive, `children/${row.child_sku}/listing.json`)
    ]));
    return {
      delivery_identity: `variation:${manifest.approval_id}:${manifest.variation_version}`,
      manifest,
      matrix: verifiedMatrix,
      listings: {parent: parseJson(archive, 'parent/listing.json'), children},
      image_slots: Object.fromEntries(verifiedMatrix.children.map(row => [
        row.child_sku,
        slotsFor(row.asset_paths, artifacts)
      ]))
    };
  }
  const imagePaths = (manifest.artifacts ?? [])
    .filter(artifact => String(artifact.media_type).startsWith('image/'))
    .map(artifact => artifact.archive_path ?? artifact.relative_path);
  return {
    delivery_identity: `single:${manifest.approval_id}:${manifest.listing_version}`,
    manifest,
    matrix: null,
    listings: {single: parseJson(archive, 'listing/listing.json')},
    image_slots: slotsFor(imagePaths, artifacts)
  };
}

function orderedGallery(slots, requestedOrder) {
  if (!Array.isArray(requestedOrder) || requestedOrder.length === 0) return slots;
  const rank = new Map(requestedOrder.map((role, index) => [role, index]));
  return slots.map((slot, index) => ({slot, index})).sort((left, right) => (
    (rank.get(left.slot.role ?? left.slot.slot_id) ?? requestedOrder.length)
      - (rank.get(right.slot.role ?? right.slot.slot_id) ?? requestedOrder.length)
      || left.index - right.index
  )).map(item => item.slot);
}

function imageRoleFindings(sellerSku, slots, requestedOrder) {
  if (!Array.isArray(requestedOrder) || requestedOrder.length === 0) return [];
  const roles = new Set(slots.map(slot => slot.role ?? slot.slot_id));
  const missing = requestedOrder.filter(role => !roles.has(role));
  return missing.length ? [{code: 'IMAGE_ROLE_MISSING', seller_sku: sellerSku, roles: missing}] : [];
}

export async function readVerifiedDelivery({deliveryDir, expectedScope, verifySingle, verifyVariation}) {
  const manifestPath = path.join(path.resolve(deliveryDir), 'delivery-manifest.json');
  const [manifestBytes, archiveBytes] = await Promise.all([
    readFile(manifestPath), readFile(path.join(path.resolve(deliveryDir), 'delivery.zip'))
  ]);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const verificationInput = {deliveryDir, expectedScope, manifestBytes, archiveBytes};
  const verified = manifest.delivery_kind === 'variation'
    ? await verifyVariation(verificationInput)
    : await verifySingle(verificationInput);
  const archive = unzipSync(archiveBytes);
  return parseVerifiedMembers({manifest: verified.manifest ?? manifest, matrix: verified.matrix, archive});
}

function singleObjectKey(delivery, slot) {
  const extension = path.posix.extname(slot.source) || '.png';
  return `${compactCode(delivery.listings.single.project_id)}-${slot.slot_id}${extension.toLowerCase()}`;
}

export function projectUploadPreparation({delivery, input = {}}) {
  const proposed = new Map();
  if (delivery.manifest.delivery_kind === 'variation') {
    const parent = {
      seller_sku: delivery.matrix.parent_sku,
      parentage_level: 'Parent',
      listing: structuredClone(delivery.listings.parent),
      gallery_slots: []
    };
    const roleFindings = [];
    const children = delivery.matrix.children.map(child => {
      const slots = orderedGallery(delivery.image_slots[child.child_sku], input.image_role_order);
      roleFindings.push(...imageRoleFindings(child.child_sku, slots, input.image_role_order));
      const gallerySlots = slots.map(slot => {
        const objectKey = path.posix.basename(slot.source);
        proposed.set(slot.source, {...slot, object_key: objectKey});
        return {...slot, object_key: objectKey};
      });
      return {
        seller_sku: child.child_sku,
        parentage_level: 'Child',
        parent_sku: child.parent_sku,
        variation_values: structuredClone(child.variation_values),
        listing: structuredClone(delivery.listings.children[child.child_sku]),
        gallery_slots: gallerySlots,
        ...(input.offers?.[child.child_sku] ?? {})
      };
    });
    return {
      delivery_identity: delivery.delivery_identity,
      rows: [parent, ...children],
      proposed_images: [...proposed.values()],
      findings: [...validateRelationshipNamespaces([parent, ...children]), ...roleFindings]
    };
  }
  const gallerySlots = delivery.image_slots.map((slot, index) => ({...slot, slot_id: slot.slot_id ?? purposeFor(slot.source, index)})).map(slot => {
    const objectKey = singleObjectKey(delivery, slot);
    proposed.set(slot.source, {...slot, object_key: objectKey});
    return {...slot, object_key: objectKey};
  });
  const row = {
    seller_sku: delivery.listings.single.seller_sku ?? delivery.listings.single.sku ?? delivery.listings.single.project_id,
    listing: structuredClone(delivery.listings.single),
    gallery_slots: gallerySlots,
    ...(input.offer ?? {})
  };
  return {
    delivery_identity: delivery.delivery_identity,
    rows: [row],
    proposed_images: [...proposed.values()],
    findings: validateRelationshipNamespaces([row])
  };
}

export function attachHostedUrls(projection, mapping) {
  if (mapping?.delivery_identity !== projection.delivery_identity) {
    throw invalid('URL_MAPPING_STALE', 'Hosted URL mapping uses another delivery identity.');
  }
  const expected = projection.proposed_images.map(item => item.object_key);
  const actual = Object.keys(mapping.images ?? {});
  if (new Set(expected).size !== expected.length
      || actual.length !== expected.length
      || actual.some(key => !expected.includes(key))) {
    throw invalid('URL_MAPPING_MISMATCH', 'Hosted URL mapping must contain the exact proposed object keys.');
  }
  for (const key of expected) {
    let url;
    try {
      url = new URL(mapping.images[key]);
    } catch {
      throw invalid('URL_MAPPING_INVALID', 'Every hosted image URL must be a valid HTTPS URL.', {object_key: key});
    }
    if (url.protocol !== 'https:') {
      throw invalid('URL_MAPPING_INVALID', 'Every hosted image URL must be a valid HTTPS URL.', {object_key: key});
    }
  }
  return {
    ...projection,
    proposed_images: projection.proposed_images.map(item => ({...item, url: mapping.images[item.object_key]}))
  };
}

export function createImageUploadArchive({archiveBytes, proposedImages}) {
  const archive = unzipSync(archiveBytes);
  const selected = {};
  for (const image of proposedImages) {
    if (!String(image.media_type ?? '').startsWith('image/') || !archive[image.source]) {
      throw invalid('IMAGE_UPLOAD_SOURCE_INVALID', 'Image upload ZIP requires verified image members.', {
        source: image.source
      });
    }
    selected[image.source] = archive[image.source];
  }
  const expected = [...new Set(proposedImages.map(image => image.source))].sort();
  const bytes = Buffer.from(zipSync(selected, {level: 0}));
  const actual = Object.keys(unzipSync(bytes)).sort();
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw invalid('IMAGE_UPLOAD_ARCHIVE_INVALID', 'Image upload ZIP member verification failed.');
  }
  return bytes;
}

export function validateRelationshipNamespaces(rows) {
  return rows.flatMap(row => {
    if (row.parentage_level && row.package_contains_sku) {
      return [{
        code: 'RELATIONSHIP_CONFLICT',
        field: 'package_contains_sku',
        seller_sku: row.seller_sku,
        message: 'A Variation row cannot also contain package relationship fields.'
      }];
    }
    if (row.seller_sku && row.seller_sku === row.package_contains_sku) {
      return [{
        code: 'RELATIONSHIP_CONFLICT',
        field: 'package_contains_sku',
        seller_sku: row.seller_sku,
        message: 'A row cannot contain its own seller SKU.'
      }];
    }
    return [];
  });
}
