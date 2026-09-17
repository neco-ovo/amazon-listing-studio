import path from 'node:path';
import {access, mkdir, readFile, realpath, rename, rm, unlink, writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {renderProjectSummary} from './project-state.js';
import {computeCommonFacts} from './variations.js';

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

function safeSegment(value, field) {
  const segment = requiredText(value, field);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(segment)) throw invalid(`${field} is not a safe path segment`);
  return segment;
}

export function publishedAssetPath({scope, childSku, role, sourcePath}) {
  const extension = path.extname(requiredText(sourcePath, 'sourcePath')).toLowerCase() || '.png';
  const name = safeSegment(role, 'role');
  if (scope === 'product') return `assets/${name}${extension}`;
  if (scope === 'shared') return `assets/shared/${name}${extension}`;
  if (scope === 'child') return `assets/children/${safeSegment(childSku, 'childSku')}/${name}${extension}`;
  throw invalid(`Unknown publication scope: ${scope}`);
}

export async function publishApprovedFile(projectDir, sourceRelativePath, destinationRelativePath) {
  const source = assertProjectPath(projectDir, sourceRelativePath);
  const destination = assertProjectPath(projectDir, destinationRelativePath);
  return {target: destination, content: await readFile(source)};
}

export async function promoteVerifiedDirectory(stage, destination) {
  const backup = `${destination}.previous-${process.pid}-${Date.now()}`;
  let backedUp = false;
  try {
    await access(destination);
    await rename(destination, backup);
    backedUp = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await rename(stage, destination);
    if (backedUp) await rm(backup, {recursive: true, force: true});
  } catch (error) {
    if (backedUp) await rename(backup, destination);
    throw error;
  }
}

function factValue(record) {
  return record && typeof record === 'object' && Object.hasOwn(record, 'value') ? record.value : record;
}

function approvedListingPath(listing) {
  const approved = listing?.approved?.at?.(-1);
  return approved?.status === 'approved' ? approved.json_path : null;
}

function confirmedFactValue(record) {
  if (!object(record) || record.publishable !== true
      || !['confirmed', 'user_confirmed'].includes(record.status)
      || (record.conflicts?.length ?? 0) > 0) return undefined;
  return factValue(record);
}

function variationProjection(state) {
  const dimensions = state.variation.theme?.dimensions ?? [];
  const children = Object.values(state.variation.children ?? {}).filter(child => child.active !== false);
  const activeSkus = children.map(child => child.sku);
  const common = computeCommonFacts(children).common;
  const projectedChildren = children.map(child => {
    const facts = {};
    for (const [id, record] of Object.entries(child.facts ?? {})) {
      const value = confirmedFactValue(record);
      if (value !== undefined && !dimensions.includes(id) && !isDeepStrictEqual(value, common[id])) facts[id] = structuredClone(value);
    }
    return {sku: child.sku, values: structuredClone(child.variation_values ?? {}), facts};
  });

  const assets = [];
  for (const asset of Object.values(state.variation.shared_assets ?? {})) {
    if (asset.status !== 'approved' || !asset.path) continue;
    const applicable = (asset.applicable_child_skus ?? []).filter(sku => activeSkus.includes(sku));
    if (applicable.length === 0) continue;
    const base = {role: asset.kind, path: asset.path};
    if (applicable.length === activeSkus.length) assets.push({...base, scope: 'shared'});
    else if (applicable.length === 1) assets.push({...base, scope: 'child', child_sku: applicable[0]});
    else assets.push({...base, scope: 'subset', child_skus: applicable});
  }
  for (const child of children) {
    if (child.product_master?.status !== 'locked') continue;
    const records = {...(child.gallery?.assets ?? {}), ...(child.assets ?? {})};
    for (const asset of Object.values(records)) {
      if (asset.status === 'approved' && asset.path) {
        assets.push({role: asset.kind, scope: 'child', child_sku: child.sku, path: asset.path});
      }
    }
    if (!Object.keys(records).length && child.main_image?.path && child.main_image.approval_id) {
      assets.push({role: 'main', scope: 'child', child_sku: child.sku, path: child.main_image.path});
    }
  }

  const listing = {};
  const parentPath = approvedListingPath(state.variation.parent?.listing);
  if (parentPath) listing.parent = parentPath;
  const childListings = Object.fromEntries(children.flatMap(child => {
    const listingPath = approvedListingPath(child.listing);
    return listingPath ? [[child.sku, listingPath]] : [];
  }));
  if (Object.keys(childListings).length) listing.children = childListings;
  return {dimensions, children: projectedChildren, common, assets, listing};
}

export function buildProductDocument(state) {
  if (!object(state?.project)) throw invalid('Project state is missing project identity');
  const variation = state.project.mode === 'variation_family' && state.variation
    ? variationProjection(state)
    : null;
  const facts = variation ? variation.common : {};
  if (!variation) {
    for (const [id, fact] of Object.entries(state.facts ?? {})) {
      if (fact?.status === 'confirmed' && fact.publishable === true) facts[id] = structuredClone(factValue(fact));
    }
  }
  const selected = new Set(state.gallery?.selected ?? []);
  const assets = variation ? variation.assets : Object.values(state.gallery?.assets ?? {})
    .filter(asset => selected.has(asset.id) && asset.status === 'approved' && asset.path)
    .map(asset => ({role: asset.kind, scope: 'product', path: asset.path}));
  const listingPath = variation ? null : approvedListingPath(state.listing);
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
    ...(variation ? {
      variation: {themes: variation.dimensions, children: variation.children},
      ...(Object.keys(variation.listing).length ? {listing: variation.listing} : {})
    } : listingPath ? {listing: {product: listingPath}} : {})
  };
  return document;
}

export async function readProjectState(projectDir) {
  return JSON.parse(await readFile(projectPaths(projectDir).state, 'utf8'));
}

export async function writeProjectSnapshot(projectDir, state, {publications = []} = {}) {
  const paths = projectPaths(projectDir);
  const nonce = `${process.pid}-${Date.now()}`;
  const productText = `${JSON.stringify(buildProductDocument(state), null, 2)}\n`;
  const history = [];
  for (const publication of publications) {
    try {
      const previous = await readFile(publication.target);
      if (!previous.equals(Buffer.from(publication.content))) {
        history.push({
          target: path.join(paths.studio, 'history', path.relative(paths.root, publication.target)),
          content: previous
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  try {
    const previousProduct = await readFile(paths.product);
    if (!previousProduct.equals(Buffer.from(productText))) {
      history.push({target: path.join(paths.studio, 'history', 'product.json'), content: previousProduct});
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const files = [
    [paths.state, `${JSON.stringify(state, null, 2)}\n`],
    [paths.product, productText],
    [paths.summary, renderProjectSummary(state)],
    ...publications.map(({target, content}) => [target, content]),
    ...history.map(({target, content}) => [target, content])
  ].map(([target, content]) => ({
    target,
    content,
    temporary: `${target}.tmp-${nonce}`,
    backup: `${target}.bak-${nonce}`,
    backedUp: false,
    installed: false
  }));
  if (new Set(files.map(file => file.target.toLowerCase())).size !== files.length) {
    throw invalid('Snapshot contains duplicate output paths');
  }

  for (const file of files) {
    await mkdir(path.dirname(file.target), {recursive: true});
    await writeFile(file.temporary, file.content, {encoding: 'utf8', flag: 'wx'});
  }
  try {
    for (const file of files) {
      try {
        await rename(file.target, file.backup);
        file.backedUp = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    for (const file of files) {
      await rename(file.temporary, file.target);
      file.installed = true;
    }
  } catch (error) {
    for (const file of files.toReversed()) {
      if (file.installed) await unlink(file.target).catch(() => {});
      if (file.backedUp) await rename(file.backup, file.target);
    }
    throw error;
  } finally {
    for (const file of files) {
      await unlink(file.temporary).catch(() => {});
      await unlink(file.backup).catch(() => {});
    }
  }
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
