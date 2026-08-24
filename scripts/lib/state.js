import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DomainError, fail } from './errors.js';
import { isSchemaAuthorizationCurrent } from './listing.js';

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
  if (!existing) return {conflicts: [], sources: [], publishable: false, dependents: [], ...structuredClone(incoming)};
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
  if (!approvedMain.approval_id || approvedMain.approval_explicit !== true || !approvedMain.approved_at) {
    fail('BLOCKING_INPUT', 'Explicit approval evidence is required for the exact saved main image', {
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
    master_version: version,
    product_master_version: version
  };
  const existingIndex = next.images.findIndex(image => image.id === approvedMain.id);
  if (existingIndex >= 0) next.images[existingIndex] = masterImage;
  else next.images.push(masterImage);
  next.updated_at = input.now || new Date().toISOString();
  return next;
}

export function planImageCorrection(image, { maxAutomaticCorrections = 2 } = {}) {
  const attempts = Number(image?.correction_attempts ?? 0);
  if (attempts >= maxAutomaticCorrections) {
    fail('BLOCKING_INPUT', 'Automatic image correction limit reached; user direction is required', {
      image_id: image?.id ?? null,
      correction_attempts: attempts,
      limit: maxAutomaticCorrections
    });
  }
  return {
    ...structuredClone(image),
    parent_id: image?.id ?? null,
    status: 'planned',
    correction_attempts: attempts + 1
  };
}

export function approveSecondaryImage(assets, input) {
  const next = structuredClone(assets);
  const image = input?.image;
  const currentVersion = next.product_master?.version;
  if (next.product_master?.status !== 'locked' || input?.product_master_version !== currentVersion) {
    fail('BLOCKING_INPUT', 'Secondary approval requires the current locked Product Master', {
      requested: input?.product_master_version ?? null,
      current: currentVersion ?? null
    });
  }
  if (!image?.id || image.kind === 'main' || !image.path || !sha256Pattern.test(image.sha256 || '') || image.inspection_status !== 'pass') {
    fail('BLOCKING_INPUT', 'A saved, hashed, inspected secondary image is required');
  }
  if (!input.approval_id || input.approval_explicit !== true || !input.approved_at) {
    fail('BLOCKING_INPUT', 'Explicit approval evidence is required for the exact saved secondary image', {image_id: image.id});
  }
  const unresolved = next.images.find(candidate => candidate.kind !== 'main'
    && !['approved', 'rejected', 'stale'].includes(candidate.status));
  if (unresolved) fail('BLOCKING_INPUT', 'Approve or reject the current secondary before starting another', { image_id: unresolved.id });
  if (next.images.some(candidate => candidate.id === image.id)) fail('BLOCKING_INPUT', 'Image ID already exists', { image_id: image.id });
  next.images.push({
    ...structuredClone(image),
    status: 'approved',
    approval_id: input.approval_id,
    approval_explicit: true,
    approved_at: input.approved_at,
    product_master_version: currentVersion,
    selected: false
  });
  next.updated_at = input.now || new Date().toISOString();
  return next;
}

export function recordListingApproval(assets, listing) {
  const next = structuredClone(assets);
  if (next.product_master?.status !== 'locked' || listing?.product_master_version !== next.product_master.version) {
    fail('BLOCKING_INPUT', 'Listing approval requires the current Product Master');
  }
  if (!listing?.id || !(Number(listing.version) > 0) || listing.status !== 'approved'
      || !['PASS', 'PASS_WITH_WARNINGS'].includes(listing.validation_status)
      || !listing.json_path || !sha256Pattern.test(listing.json_sha256 || '')
      || !listing.markdown_path || !sha256Pattern.test(listing.markdown_sha256 || '')
      || listing.project_id !== next.project_id || !listing.marketplace || !listing.product_type || !listing.schema_status
      || typeof listing.upload_ready !== 'boolean') {
    fail('BLOCKING_INPUT', 'A validated, versioned Listing with saved file hashes is required');
  }
  if (listing.schema_status === 'unverified') {
    const scope = {
      project_id: listing.project_id,
      marketplace: listing.marketplace,
      product_type: listing.product_type,
      product_master_version: listing.product_master_version,
      listing_version: listing.version
    };
    if (!isSchemaAuthorizationCurrent(listing.schema_authorization, scope)) {
      fail('BLOCKING_INPUT', 'Schema-unverified Listing requires current version-bound authorization', { scope });
    }
  }
  next.listing = structuredClone(listing);
  next.updated_at = listing.approved_at || new Date().toISOString();
  return next;
}

export function recordFinalApproval(assets, input) {
  const next = structuredClone(assets);
  if (!input?.id || input.finalized !== true || input.product_master_version !== next.product_master?.version
      || input.listing_version !== next.listing?.version || next.listing?.status !== 'approved') {
    fail('BLOCKING_INPUT', 'Final approval must match the current Product Master and Listing');
  }
  if (input.project_id !== next.project_id || !input.marketplace || !input.product_type || !input.schema_status) {
    fail('BLOCKING_INPUT', 'Marketplace, product type, and Schema status are required in final approval');
  }
  if (input.marketplace !== next.listing.marketplace || input.product_type !== next.listing.product_type
      || input.schema_status !== next.listing.schema_status || input.upload_ready !== next.listing.upload_ready) {
    fail('BLOCKING_INPUT', 'Final approval scope must match the current Listing');
  }
  if (input.upload_ready === true && input.schema_status !== 'verified') {
    fail('BLOCKING_INPUT', 'Schema-unverified approval cannot be upload-ready');
  }
  const ids = Array.isArray(input.artifact_ids) ? input.artifact_ids : [];
  if (!ids.length || new Set(ids).size !== ids.length) fail('BLOCKING_INPUT', 'Final approval requires a unique image selection');
  for (const id of ids) {
    const image = next.images.find(candidate => candidate.id === id);
    if (!image || image.status !== 'approved' || image.product_master_version !== next.product_master.version) {
      fail('BLOCKING_INPUT', 'Final approval includes an unapproved or stale image', { image_id: id });
    }
  }
  next.images = next.images.map(image => ({
    ...image,
    selected: ids.includes(image.id),
    approval_id: ids.includes(image.id) ? input.id : image.approval_id
  }));
  next.listing = { ...next.listing, approval_id: input.id };
  const approval = {
    ...structuredClone(input),
    ambiguous: false,
    approved_at: input.now || new Date().toISOString()
  };
  next.approvals = [...(next.approvals || []), approval];
  next.updated_at = approval.approved_at;
  return { assets: next, approval };
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
  if (dependentIds.size > 0 && Array.isArray(next.assets.approvals)) {
    next.assets.approvals = next.assets.approvals.map(approval => approval.finalized === true
      ? { ...approval, status: 'stale', stale_at: now, stale_reason: reason }
      : approval);
  }
  if (dependentIds.size > 0 && next.assets.final_bundle?.status === 'built') {
    next.assets.final_bundle = { ...next.assets.final_bundle, status: 'stale', stale_at: now, stale_reason: reason };
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
  if (facts?.facts) {
    const ids = new Set();
    for (const [index, fact] of facts.facts.entries()) {
      if (!fact?.id || ids.has(fact.id) || !fact.field || !Object.hasOwn(FACT_AUTHORITY, fact.status)
          || !Array.isArray(fact.sources) || !Array.isArray(fact.conflicts)
          || typeof fact.publishable !== 'boolean' || !Array.isArray(fact.dependents ?? [])) {
        errors.push(`fact record ${index} is invalid`);
      }
      if (fact?.id) ids.add(fact.id);
    }
  }
  if (assets?.images) {
    const ids = new Set();
    for (const [index, image] of assets.images.entries()) {
      const basicInvalid = !image?.id || ids.has(image.id) || !image.status || !(Number(image.version) > 0);
      const approvedInvalid = image?.status === 'approved' && (!image.path || !sha256Pattern.test(image.sha256 || '')
        || !(Number(image.product_master_version) > 0) || !image.approval_id || image.approval_explicit !== true || !image.approved_at);
      if (basicInvalid || approvedInvalid) errors.push(`image record ${index} is invalid`);
      if (image?.id) ids.add(image.id);
    }
  }
  if (assets?.product_master?.status === 'locked') {
    const master = assets.product_master;
    if (!(Number(master.version) > 0) || !master.approved_main_id || !master.approved_main_path || !sha256Pattern.test(master.approved_main_sha256 || '')) {
      errors.push('locked Product Master record is invalid');
    }
  }
  if (assets?.listing?.status === 'approved') {
    const listing = assets.listing;
    if (!listing.id || !(Number(listing.version) > 0) || !(Number(listing.product_master_version) > 0)
        || !listing.approval_id || !listing.project_id || !listing.marketplace || !listing.product_type || !listing.schema_status
        || typeof listing.upload_ready !== 'boolean' || !listing.json_path || !sha256Pattern.test(listing.json_sha256 || '')
        || !listing.markdown_path || !sha256Pattern.test(listing.markdown_sha256 || '')) {
      errors.push('approved Listing record is invalid');
    }
  }
  return { valid: errors.length === 0, errors, project, facts, assets };
}
