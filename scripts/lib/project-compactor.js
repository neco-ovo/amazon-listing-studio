import {access, cp, mkdir, readFile, readdir, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {
  assertProjectPath, buildProductDocument, projectPaths, publishedAssetPath,
  validateProductDocument, writeProjectSnapshot
} from './project-layout.js';
import {validateProjectState} from './project-state.js';

const GENERATED = new Set(['node_modules', 'outputs', 'transactions', 'verification']);

async function exists(target) {
  try { await access(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function replaceStrings(value, replacements) {
  if (typeof value === 'string') return replacements.get(value.replaceAll('\\', '/')) ?? value;
  if (Array.isArray(value)) return value.map(item => replaceStrings(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceStrings(item, replacements)]));
  }
  return value;
}

function safe(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'item';
}

function formalDestinations(state) {
  const document = buildProductDocument(state);
  const replacements = new Map();
  const used = new Set();
  const unique = destination => {
    const extension = path.posix.extname(destination);
    const stem = destination.slice(0, -extension.length || undefined);
    let candidate = destination;
    let index = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${stem}-${index++}${extension}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
  for (const [index, asset] of document.assets.entries()) {
    let destination;
    if (asset.scope === 'subset') {
      destination = `assets/shared/${safe(asset.role)}-subset-${index + 1}${path.posix.extname(asset.path) || '.png'}`;
    } else {
      destination = publishedAssetPath({
        scope: asset.scope, childSku: asset.child_sku, role: asset.role, sourcePath: asset.path
      });
    }
    replacements.set(asset.path.replaceAll('\\', '/'), unique(destination));
  }
  if (document.listing?.product) replacements.set(document.listing.product.replaceAll('\\', '/'), 'listing/listing.json');
  if (document.listing?.parent) replacements.set(document.listing.parent.replaceAll('\\', '/'), 'listing/parent.json');
  for (const [sku, source] of Object.entries(document.listing?.children ?? {})) {
    replacements.set(source.replaceAll('\\', '/'), `listing/children/${safe(sku)}.json`);
  }
  return replacements;
}

async function loadLegacyState(projectDir) {
  const compact = projectPaths(projectDir).state;
  const source = await exists(compact) ? compact : path.join(projectDir, 'state.json');
  return {source, state: JSON.parse(await readFile(source, 'utf8'))};
}

export async function planProjectCompaction(projectDir) {
  const root = path.resolve(projectDir);
  const {source, state} = await loadLegacyState(root);
  const validation = validateProjectState(state);
  if (!validation.valid) throw new Error(`Invalid project state: ${validation.errors.join('; ')}`);
  const entries = await readdir(root, {withFileTypes: true});
  const replacements = formalDestinations(state);
  return {
    already_compact: source === projectPaths(root).state,
    formal: [...replacements.entries()].map(([from, to]) => ({from, to})),
    deleted: entries.filter(entry => GENERATED.has(entry.name)).map(entry => entry.name),
    preserved: entries
      .filter(entry => entry.name !== 'state.json' && entry.name !== 'delivery' && !GENERATED.has(entry.name))
      .map(entry => entry.name)
  };
}

async function validateCompactProject(projectDir) {
  const state = JSON.parse(await readFile(projectPaths(projectDir).state, 'utf8'));
  const stateResult = validateProjectState(state);
  if (!stateResult.valid) throw new Error(`Invalid compact state: ${stateResult.errors.join('; ')}`);
  const product = JSON.parse(await readFile(projectPaths(projectDir).product, 'utf8'));
  await validateProductDocument(product, {projectDir});
}

export async function compactProject(projectDir, {apply = false, operations = {}} = {}) {
  const root = path.resolve(projectDir);
  const plan = await planProjectCompaction(root);
  if (!apply || plan.already_compact) return {...plan, applied: false};

  const move = operations.rename ?? rename;
  const staging = `${root}.compact-staging`;
  const backup = `${root}.compact-backup`;
  if (await exists(staging) || await exists(backup)) throw new Error('Compaction staging or backup already exists');

  const {state} = await loadLegacyState(root);
  const replacements = new Map(plan.formal.map(item => [item.from, item.to]));
  const compactState = replaceStrings(state, replacements);
  await mkdir(staging);
  try {
    const publications = [];
    for (const {from, to} of plan.formal) {
      publications.push({target: assertProjectPath(staging, to), content: await readFile(assertProjectPath(root, from))});
    }
    for (const name of plan.preserved) {
      await cp(path.join(root, name), path.join(staging, '.studio', 'legacy', name), {recursive: true});
    }
    if (await exists(path.join(root, 'delivery'))) {
      await cp(path.join(root, 'delivery'), path.join(staging, 'delivery'), {recursive: true});
    }
    await writeProjectSnapshot(staging, compactState, {publications});
    await validateCompactProject(staging);

    await move(root, backup);
    try {
      await move(staging, root);
      await validateCompactProject(root);
    } catch (error) {
      if (await exists(root)) await move(root, staging);
      await move(backup, root);
      throw error;
    }
    await rm(backup, {recursive: true});
    return {...plan, applied: true};
  } catch (error) {
    await rm(staging, {recursive: true, force: true});
    throw error;
  }
}
