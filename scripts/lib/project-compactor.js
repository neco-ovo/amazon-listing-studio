import {access, cp, mkdir, readFile, readdir, rename, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import {
  assertProjectPath, buildProductDocument, projectPaths, publishedAssetPath,
  validateProductDocument, writeProjectSnapshot
} from './project-layout.js';
import {validateProjectState} from './project-state.js';

const GENERATED = new Set(['node_modules']);

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
  const addListing = (listing, directory) => {
    const approved = listing?.approved?.at(-1);
    if (approved?.status !== 'approved') return;
    if (approved.json_path) replacements.set(approved.json_path.replaceAll('\\', '/'), `${directory}/listing.json`);
    if (approved.markdown_path) replacements.set(approved.markdown_path.replaceAll('\\', '/'), `${directory}/listing.md`);
  };
  addListing(state.listing, 'listing');
  addListing(state.variation?.parent?.listing, 'listing/parent');
  for (const child of Object.values(state.variation?.children ?? {}).filter(item => item.active !== false)) {
    addListing(child.listing, `listing/children/${safe(child.sku)}`);
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
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const records = new Map();
  const indexRecords = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.path === 'string') records.set(value.path, value.sha256);
    if (typeof value.json_path === 'string') records.set(value.json_path, value.json_sha256);
    if (typeof value.markdown_path === 'string') records.set(value.markdown_path, value.markdown_sha256);
    for (const child of Object.values(value)) indexRecords(child);
  };
  indexRecords(state);
  const readChecked = async relative => {
    const bytes = await readFile(assertProjectPath(projectDir, relative));
    const expected = records.get(relative);
    if (expected && hash(bytes) !== expected) throw new Error(`Hash mismatch: ${relative}`);
    return bytes;
  };
  for (const asset of product.assets) await sharp(await readChecked(asset.path)).metadata();
  const listingPaths = [
    product.listing?.product, product.listing?.parent,
    ...Object.values(product.listing?.children ?? {})
  ].filter(Boolean);
  for (const listingPath of listingPaths) JSON.parse((await readChecked(listingPath)).toString('utf8'));
  for (const [relative] of records) {
    if (relative.startsWith('listing/') && relative.endsWith('.md')) await readChecked(relative);
  }
}

export async function compactProject(projectDir, {apply = false, operations = {}} = {}) {
  const root = path.resolve(projectDir);
  const plan = await planProjectCompaction(root);
  if (!apply || plan.already_compact) return {...plan, applied: false};

  const move = operations.rename ?? rename;
  const removeBackup = operations.rm ?? rm;
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
    try {
      await removeBackup(backup, {recursive: true});
      return {...plan, applied: true, backup_retained: false};
    } catch {
      return {...plan, applied: true, backup_retained: true, backup_path: backup};
    }
  } catch (error) {
    await rm(staging, {recursive: true, force: true});
    throw error;
  }
}
