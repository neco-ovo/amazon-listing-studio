import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fail } from './errors.js';
import { createProjectState, renderProjectSummary, validateProjectState } from './project-state.js';

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJson(filePath, name) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    fail('BLOCKING_INPUT', `Cannot read legacy ${name}`, {path: filePath, reason: error.message});
  }
}

function productName(projectMarkdown, projectId) {
  const heading = projectMarkdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || projectId;
}

function migrateState({facts, assets, projectMarkdown, now}) {
  if (facts.schema_version !== 1 || assets.schema_version !== 1 || facts.project_id !== assets.project_id) {
    fail('BLOCKING_INPUT', 'Legacy facts and assets must be matching schema version 1 files');
  }
  const productType = assets.listing?.product_type ?? assets.product_master?.identity?.product_type;
  if (!productType) fail('BLOCKING_INPUT', 'Legacy product type is required for migration');
  const state = createProjectState({
    projectId: assets.project_id,
    productName: productName(projectMarkdown, assets.project_id),
    marketplace: assets.listing?.marketplace ?? 'amazon.com',
    language: assets.listing?.language ?? 'en-US',
    productType,
    now
  });

  state.facts = Object.fromEntries((facts.facts ?? []).map(fact => [fact.id, structuredClone(fact)]));
  state.product_master = assets.product_master?.status === 'locked' ? structuredClone(assets.product_master) : null;
  state.gallery.plan = structuredClone(assets.storyboard ?? []);
  state.gallery.assets = Object.fromEntries((assets.images ?? []).map(image => [image.id, structuredClone(image)]));
  state.gallery.selected = (assets.images ?? []).filter(image => image.selected === true).map(image => image.id);
  state.listing = {
    draft: assets.listing?.status === 'approved' ? null : structuredClone(assets.listing ?? null),
    approved: assets.listing?.status === 'approved' ? [structuredClone(assets.listing)] : []
  };
  state.approvals = structuredClone(assets.approvals ?? []);
  state.stale_dependencies = [
    ...(assets.images ?? []).filter(image => image.status === 'stale').map(image => image.id),
    ...(assets.listing?.status === 'stale' ? [assets.listing.id] : [])
  ];
  state.delivery = assets.final_bundle?.status === 'built' ? structuredClone(assets.final_bundle) : null;
  state.project.stage = state.delivery ? 'delivery' : state.listing.approved.length ? 'listing' : state.product_master ? 'secondary_images' : 'intake';
  state.project.updated_at = assets.updated_at ?? facts.updated_at ?? now;
  return state;
}

export async function migrateLegacyProject({sourceDir, destinationDir, now = new Date().toISOString()}) {
  const source = path.resolve(sourceDir);
  const destination = path.resolve(destinationDir);
  if (source === destination) fail('BLOCKING_INPUT', 'Migration destination must differ from source');
  if (await exists(destination)) fail('BLOCKING_INPUT', 'Migration destination already exists', {destination});

  const projectMarkdown = await readFile(path.join(source, 'project.md'), 'utf8');
  const facts = await readJson(path.join(source, 'facts.json'), 'facts.json');
  const assets = await readJson(path.join(source, 'assets.json'), 'assets.json');
  const state = migrateState({facts, assets, projectMarkdown, now});
  const validation = validateProjectState(state);
  if (!validation.valid) fail('BLOCKING_INPUT', 'Migrated state is invalid', {errors: validation.errors});

  const parent = path.dirname(destination);
  const temporary = path.join(parent, `${path.basename(destination)}.tmp-${process.pid}-${Date.now()}`);
  await mkdir(parent, {recursive: true});
  await mkdir(temporary, {recursive: false});
  try {
    for (const name of ['references', 'images', 'listing', 'delivery']) {
      const from = path.join(source, name);
      if (await exists(from)) await cp(from, path.join(temporary, name), {recursive: true, errorOnExist: true});
    }
    await mkdir(path.join(temporary, 'legacy'));
    await cp(path.join(source, 'project.md'), path.join(temporary, 'legacy', 'project.md'));
    await cp(path.join(source, 'facts.json'), path.join(temporary, 'legacy', 'facts.json'));
    await cp(path.join(source, 'assets.json'), path.join(temporary, 'legacy', 'assets.json'));
    await writeFile(path.join(temporary, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(temporary, 'project.md'), renderProjectSummary(state));
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, {recursive: true, force: true});
    throw error;
  }
  return state;
}
