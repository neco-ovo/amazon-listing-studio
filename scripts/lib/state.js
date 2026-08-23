import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DomainError, fail } from './errors.js';

export const FACT_AUTHORITY = Object.freeze({
  unknown: 0,
  ai_suggested: 1,
  source_observed: 2,
  conflicted: 2,
  not_applicable: 3,
  user_confirmed: 4
});

const sha256Pattern = /^[a-f0-9]{64}$/i;

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function conflictFrom(fact, observedAt) {
  return {
    value: structuredClone(fact.value),
    status: fact.status,
    sources: unique(fact.sources),
    observed_at: observedAt
  };
}

function projectMarkdown({ projectId, productName, marketplace, language, now }) {
  return `# ${productName}\n\n` +
    `- Project ID: ${projectId}\n` +
    `- Marketplace: ${marketplace}\n` +
    `- Language: ${language}\n` +
    `- Stage: intake\n` +
    `- Current Product Master: unlocked\n` +
    `- Current bundle: none\n` +
    `- Updated: ${now}\n\n` +
    `## Open questions\n\nNone recorded.\n\n` +
    `## Approvals and changes\n\nNone recorded.\n`;
}

export function createInitialState({
  projectId,
  productName,
  marketplace = 'amazon.com',
  language = 'en-US',
  now = new Date().toISOString()
}) {
  if (!projectId || !productName) fail('BLOCKING_INPUT', 'projectId and productName are required');

  return {
    projectMarkdown: projectMarkdown({ projectId, productName, marketplace, language, now }),
    facts: {
      schema_version: 1,
      version: 1,
      project_id: projectId,
      updated_at: now,
      facts: []
    },
    assets: {
      schema_version: 1,
      version: 1,
      project_id: projectId,
      updated_at: now,
      product_master: {
        version: 0,
        status: 'unlocked',
        dependency_ids: []
      },
      storyboard: [],
      images: [],
      listing: { id: null, version: 0, status: 'not_started' },
      approvals: [],
      final_bundle: { version: 0, status: 'not_built' }
    }
  };
}

export function resolveFact(existing, incoming, { now = new Date().toISOString() } = {}) {
  if (!existing) return structuredClone(incoming);
  if (!incoming) return structuredClone(existing);
  if (existing.id !== incoming.id || existing.field !== incoming.field) {
    fail('BLOCKING_INPUT', 'Only matching fact IDs and fields can be resolved', {
      existing_id: existing.id,
      incoming_id: incoming.id
    });
  }

  const current = { conflicts: [], sources: [], publishable: false, ...structuredClone(existing) };
  const candidate = { conflicts: [], sources: [], publishable: false, ...structuredClone(incoming) };
  if (sameValue(current.value, candidate.value)) {
    const candidateRank = FACT_AUTHORITY[candidate.status] ?? -1;
    const currentRank = FACT_AUTHORITY[current.status] ?? -1;
    return {
      ...current,
      status: candidateRank > currentRank ? candidate.status : current.status,
      publishable: Boolean(current.publishable || candidate.publishable),
      sources: unique([...current.sources, ...candidate.sources]),
      conflicts: [...current.conflicts, ...candidate.conflicts]
    };
  }

  if (current.status === 'user_confirmed' && candidate.status === 'user_confirmed') {
    throw new DomainError('BLOCKING_INPUT', 'Conflicting user confirmations require a new question', {
      fact_id: current.id,
      existing_value: current.value,
      incoming_value: candidate.value
    });
  }

  const currentRank = FACT_AUTHORITY[current.status] ?? -1;
  const candidateRank = FACT_AUTHORITY[candidate.status] ?? -1;
  if (candidateRank > currentRank) {
    return {
      ...candidate,
      conflicts: [...candidate.conflicts, ...current.conflicts, conflictFrom(current, now)]
    };
  }
  if (candidateRank === currentRank) {
    return {
      ...current,
      status: 'conflicted',
      publishable: false,
      conflicts: [...current.conflicts, ...candidate.conflicts, conflictFrom(candidate, now)]
    };
  }
  return {
    ...current,
    conflicts: [...current.conflicts, ...candidate.conflicts, conflictFrom(candidate, now)]
  };
}

export function lockProductMaster(assets, input) {
  const approvedMain = input?.approved_main;
  if (!approvedMain || approvedMain.status !== 'approved' || !approvedMain.path ||
      !sha256Pattern.test(approvedMain.sha256 || '') || approvedMain.inspection_status !== 'pass') {
    fail('BLOCKING_INPUT', 'A real approved main raster with a passing saved-file inspection is required', {
      main_asset_id: approvedMain?.id || null
    });
  }
  if (!input.identity?.product_type) fail('BLOCKING_INPUT', 'Product identity is required before Product Master lock');
  const width = Number(input.dimensions?.width);
  const length = Number(input.dimensions?.length);
  if (!(width > 0) || !(length > 0) || !input.dimensions?.unit) {
    fail('BLOCKING_INPUT', 'Confirmed physical dimensions and unit are required before Product Master lock');
  }
  if (!input.color || !input.variant || !(Number(input.count) > 0)) {
    fail('BLOCKING_INPUT', 'Confirmed color, variant, and count are required before Product Master lock');
  }
  const referenceHashes = unique(input.canonical_reference_hashes);
  if (!referenceHashes.length || referenceHashes.some(hash => !sha256Pattern.test(hash))) {
    fail('BLOCKING_INPUT', 'Canonical reference SHA-256 hashes are required before Product Master lock');
  }

  const next = structuredClone(assets);
  const version = Number(next.product_master?.version || 0) + 1;
  next.product_master = {
    version,
    status: 'locked',
    locked_at: input.now || new Date().toISOString(),
    identity: structuredClone(input.identity),
    dimensions: structuredClone(input.dimensions),
    physical_ratio: width / length,
    color: input.color,
    material: input.material || null,
    variant: input.variant,
    count: Number(input.count),
    confirmed_visible_components: unique(input.confirmed_visible_components),
    canonical_reference_hashes: referenceHashes,
    approved_main_id: approvedMain.id,
    approved_main_path: approvedMain.path,
    approved_main_sha256: approvedMain.sha256.toLowerCase(),
    dependency_ids: unique(input.dependency_ids)
  };
  const masterImage = {
    ...structuredClone(approvedMain),
    sha256: approvedMain.sha256.toLowerCase(),
    status: 'approved',
    kind: 'main',
    is_product_master: true,
    master_version: version
  };
  const existingIndex = next.images.findIndex(image => image.id === approvedMain.id);
  if (existingIndex >= 0) next.images[existingIndex] = masterImage;
  else next.images.push(masterImage);
  next.updated_at = input.now || new Date().toISOString();
  return next;
}

export function invalidateDependents(state, changedFactIds, {
  now = new Date().toISOString(),
  reason = 'fact changed'
} = {}) {
  const next = structuredClone(state);
  const changed = new Set(changedFactIds);
  const dependentIds = new Set(
    next.facts.facts
      .filter(fact => changed.has(fact.id))
      .flatMap(fact => fact.dependents || [])
  );
  next.assets.images = next.assets.images.map(image => dependentIds.has(image.id)
    ? { ...image, status: 'stale', stale_at: now, stale_reason: reason }
    : image);
  if (next.assets.listing?.id && dependentIds.has(next.assets.listing.id)) {
    next.assets.listing = { ...next.assets.listing, status: 'stale', stale_at: now, stale_reason: reason };
  }
  next.assets.updated_at = now;
  return next;
}

function safeProjectPath(root, projectId) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(projectId || '')) {
    fail('BLOCKING_INPUT', 'Project ID must use letters, numbers, and hyphens', { project_id: projectId });
  }
  const resolvedRoot = path.resolve(root);
  const projectDir = path.resolve(resolvedRoot, projectId);
  if (path.dirname(projectDir) !== resolvedRoot) fail('BLOCKING_INPUT', 'Project path escapes the selected root');
  return projectDir;
}

export async function initializeProject(root, input, { resume = false } = {}) {
  const projectDir = safeProjectPath(root, input.projectId);
  try {
    await access(projectDir);
    if (!resume) fail('BLOCKING_INPUT', 'Project already exists; use resume after validation', { project_dir: projectDir });
    const validation = await validateState(projectDir);
    if (!validation.valid) fail('BLOCKING_INPUT', 'Existing project state is invalid', { project_dir: projectDir, errors: validation.errors });
    return { projectDir, created: [], resumed: true };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (error.code !== 'ENOENT') throw error;
  }

  const initial = createInitialState(input);
  await mkdir(path.dirname(projectDir), { recursive: true });
  await mkdir(projectDir, { recursive: false });
  const outputs = [
    ['project.md', initial.projectMarkdown],
    ['facts.json', `${JSON.stringify(initial.facts, null, 2)}\n`],
    ['assets.json', `${JSON.stringify(initial.assets, null, 2)}\n`]
  ];
  await Promise.all(outputs.map(([name, content]) => writeFile(path.join(projectDir, name), content, { encoding: 'utf8', flag: 'wx' })));
  return { projectDir, created: outputs.map(([name]) => name), resumed: false };
}

export async function validateState(projectDir) {
  const errors = [];
  let project = '';
  let facts;
  let assets;
  try { project = await readFile(path.join(projectDir, 'project.md'), 'utf8'); } catch (error) { errors.push(`project.md: ${error.message}`); }
  try { facts = JSON.parse(await readFile(path.join(projectDir, 'facts.json'), 'utf8')); } catch (error) { errors.push(`facts.json: ${error.message}`); }
  try { assets = JSON.parse(await readFile(path.join(projectDir, 'assets.json'), 'utf8')); } catch (error) { errors.push(`assets.json: ${error.message}`); }

  if (project && (!project.startsWith('# ') || !project.includes('## Open questions'))) errors.push('project.md is not a readable project dossier');
  if (facts && (!Array.isArray(facts.facts) || !facts.project_id || facts.schema_version !== 1)) errors.push('facts.json structure is invalid');
  if (assets && (!Array.isArray(assets.images) || !assets.product_master || assets.schema_version !== 1)) errors.push('assets.json structure is invalid');
  if (facts && assets && facts.project_id !== assets.project_id) errors.push('facts.json and assets.json project IDs differ');
  return { valid: errors.length === 0, errors, project, facts, assets };
}
