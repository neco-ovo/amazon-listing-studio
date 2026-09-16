import path from 'node:path';
import {realpath} from 'node:fs/promises';

function invalid(message) {
  return Object.assign(new Error(message), {code: 'INVALID_PRODUCT_PROJECT'});
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${field} must be a non-empty string`);
  return value.trim();
}

export function projectPaths(projectDir) {
  const root = path.resolve(projectDir);
  return {
    root,
    summary: path.join(root, 'project.md'),
    product: path.join(root, 'product.json'),
    studio: path.join(root, '.studio'),
    state: path.join(root, '.studio', 'state.json'),
    work: path.join(root, '.studio', 'work'),
    assets: path.join(root, 'assets'),
    listing: path.join(root, 'listing'),
    delivery: path.join(root, 'delivery')
  };
}

export function assertProjectPath(projectDir, relativePath) {
  const value = requiredText(relativePath, 'path').replaceAll('\\', '/');
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) throw invalid('Path must be project-relative');
  const root = path.resolve(projectDir);
  const resolved = path.resolve(root, ...value.split('/'));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (!relative) return resolved;
    throw invalid('Path escapes the project root');
  }
  return resolved;
}

function factValue(record) {
  return record && typeof record === 'object' && Object.hasOwn(record, 'value') ? record.value : record;
}

function approvedListingPath(listing) {
  const approved = listing?.approved?.at?.(-1);
  return approved?.status === 'approved' ? approved.json_path : null;
}

export function buildProductDocument(state) {
  if (!object(state?.project)) throw invalid('Project state is missing project identity');
  const facts = {};
  for (const [id, fact] of Object.entries(state.facts ?? {})) {
    if (fact?.status === 'confirmed' && fact.publishable === true) facts[id] = structuredClone(factValue(fact));
  }
  const selected = new Set(state.gallery?.selected ?? []);
  const assets = Object.values(state.gallery?.assets ?? {})
    .filter(asset => selected.has(asset.id) && asset.status === 'approved' && asset.path)
    .map(asset => ({role: asset.kind, scope: 'product', path: asset.path}));
  const listingPath = approvedListingPath(state.listing);
  const document = {
    schema_version: 1,
    product_id: state.project.product_id,
    marketplace: state.project.marketplace,
    language: state.project.language,
    product_type: state.project.product_type,
    facts,
    approved_claims: structuredClone(state.project.approved_claims ?? []),
    excluded_claims: structuredClone(state.project.excluded_claims ?? []),
    assets,
    ...(listingPath ? {listing: {product: listingPath}} : {})
  };
  return document;
}

function validateStringArray(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw invalid(`${field} must be an array of non-empty strings`);
  }
}

export async function validateProductDocument(document, {
  projectDir = null,
  realpathFile = realpath
} = {}) {
  if (!object(document) || document.schema_version !== 1) throw invalid('schema_version must equal 1');
  for (const field of ['product_id', 'marketplace', 'language', 'product_type']) requiredText(document[field], field);
  if (!object(document.facts)) throw invalid('facts must be an object');
  validateStringArray(document.approved_claims, 'approved_claims');
  validateStringArray(document.excluded_claims, 'excluded_claims');
  if (!Array.isArray(document.assets)) throw invalid('assets must be an array');

  const children = document.variation?.children ?? [];
  if (document.variation !== undefined) {
    if (!object(document.variation)) throw invalid('variation must be an object');
    validateStringArray(document.variation.themes, 'variation.themes');
    if (!Array.isArray(children)) throw invalid('variation.children must be an array');
  }
  const childSkus = new Set();
  for (const child of children) {
    if (!object(child)) throw invalid('Every Child must be an object');
    const sku = requiredText(child.sku, 'Child SKU');
    if (childSkus.has(sku)) throw invalid(`Duplicate Child SKU: ${sku}`);
    childSkus.add(sku);
    if (!object(child.values) || !object(child.facts)) throw invalid(`Child ${sku} values and facts must be objects`);
  }

  const indexedPaths = [];
  for (const asset of document.assets) {
    if (!object(asset)) throw invalid('Every asset must be an object');
    requiredText(asset.role, 'asset.role');
    const scope = requiredText(asset.scope, 'asset.scope');
    indexedPaths.push(requiredText(asset.path, 'asset.path'));
    if (scope === 'product' && document.variation) throw invalid('Product scope is valid only without variation');
    if (scope === 'shared' && (asset.child_sku !== undefined || asset.child_skus !== undefined)) {
      throw invalid('Shared assets cannot declare Child references');
    }
    if (scope === 'child' && !childSkus.has(asset.child_sku)) throw invalid('Asset must reference a listed active Child');
    if (scope === 'subset') {
      if (!Array.isArray(asset.child_skus) || asset.child_skus.length === 0
          || asset.child_skus.some(sku => !childSkus.has(sku))) {
        throw invalid('Subset asset must reference listed active Children');
      }
    }
    if (!['product', 'shared', 'child', 'subset'].includes(scope)) throw invalid(`Unknown asset scope: ${scope}`);
  }

  if (document.listing !== undefined) {
    if (!object(document.listing)) throw invalid('listing must be an object');
    if (document.listing.product) indexedPaths.push(document.listing.product);
    if (document.listing.parent) indexedPaths.push(document.listing.parent);
    if (document.listing.children !== undefined) {
      if (!object(document.listing.children)) throw invalid('listing.children must be an object');
      for (const [sku, listingPath] of Object.entries(document.listing.children)) {
        if (!childSkus.has(sku)) throw invalid('Listing must reference a listed active Child');
        indexedPaths.push(requiredText(listingPath, `listing.children.${sku}`));
      }
    }
  }

  if (projectDir) {
    const realRoot = await realpathFile(path.resolve(projectDir));
    for (const relativePath of indexedPaths) {
      const absolute = assertProjectPath(projectDir, relativePath);
      const target = await realpathFile(absolute);
      const relative = path.relative(realRoot, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw invalid('Indexed file resolves outside the project root');
    }
  } else {
    for (const relativePath of indexedPaths) assertProjectPath('.', relativePath);
  }
  return {valid: true};
}
