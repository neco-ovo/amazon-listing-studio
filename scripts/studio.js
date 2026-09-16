#!/usr/bin/env node
import {createHash} from 'node:crypto';
import { access, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import sharp from 'sharp';
import { classifyChildFactImpact, classifyOperation, validateChangedListing } from './lib/operations.js';
import { createProjectState, renderProjectSummary, validateProjectState } from './lib/project-state.js';
import {projectPaths, readProjectState, writeProjectSnapshot} from './lib/project-layout.js';
import { approveArtifact, approveListingDraft, updateProject } from './lib/transactions.js';
import { migrateLegacyProject } from './lib/migration.js';
import { validateMainImage } from './lib/images.js';
import { renderListing, reviseDraft } from './lib/listing-drafts.js';
import {keywordProfileErrors} from './lib/listing.js';
import { buildV2Delivery, verifyDelivery } from './lib/bundle.js';
import {buildVariationDelivery, verifyVariationDelivery} from './lib/variation-bundle.js';
import {
  approveVariationArtifact,
  approveVariationListing,
  approveVariationVersion
} from './lib/variation-approvals.js';
import {
  addVariationChild,
  promoteToVariation,
  removeVariationChild,
  resolveVariationFactConflicts,
  reviseVariationChild
} from './lib/variation-project.js';
import {parseSellerSpriteWorkbook} from './lib/sellersprite-workbooks.js';
import {resolveRules} from './lib/rule-cache.js';
import {
  attachHostedUrls,
  projectUploadPreparation,
  readVerifiedDelivery
} from './lib/upload-preparation.js';
import {
  inspectUploadTemplate,
  rangeAffectsRows,
  requiredForRow,
  validateRestrictedValues,
  writeUploadWorkbook
} from './lib/upload-workbooks.js';
import {
  buildKeywordProfile,
  isCompatibleKeywordProfile,
  keywordFactConflict,
  mergeKeywordProfileReports,
  normalizeKeywordPhrase,
  projectKeywordProfilePath,
  reusableKeywordProfilePath
} from './lib/keyword-profiles.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    if (!flag?.startsWith('--') || rest[index + 1] === undefined) throw new Error(`Invalid argument: ${flag ?? ''}`);
    options[flag.slice(2)] = rest[index + 1];
  }
  return {command, options};
}

function requireOption(options, key) {
  if (!options[key]) throw Object.assign(new Error(`--${key} is required`), {code: 'BLOCKING_INPUT'});
  return options[key];
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function currentVariationFinalApproval(state) {
  if (state?.project?.mode !== 'variation_family'
      || !Array.isArray(state.variation?.versions) || !Array.isArray(state.approvals)) {
    throw blocking('Trusted Variation verification requires a Variation Family project');
  }
  const currentVersion = state.variation.versions
    .filter(item => item?.status === 'approved' && Number.isInteger(item.version))
    .sort((left, right) => left.version - right.version)
    .at(-1);
  const approval = state.approvals.find(item => item.id === currentVersion?.approval_id);
  if (!currentVersion || !approval || approval.scope_type !== 'variation_final'
      || approval.finalized !== true || approval.variation_version !== currentVersion.version
      || approval.scope_sha256 !== currentVersion.scope_sha256) {
    throw blocking('Trusted Variation verification requires the current immutable final approval');
  }
  return approval;
}

function currentSingleFinalApproval(state) {
  if (state?.schema_version !== 2 || state?.project?.mode === 'variation_family'
      || !Array.isArray(state?.approvals) || !Array.isArray(state?.gallery?.selected)) {
    throw blocking('Finalization requires a single current immutable final approval');
  }
  const listing = state.listing?.approved?.at(-1);
  const selected = state.gallery.selected;
  const matches = state.approvals.filter(approval => {
    const artifactIds = approval?.artifact_ids;
    return approval?.type === 'final'
      && approval.finalized === true
      && approval.status !== 'stale'
      && approval.project_id === state.project?.product_id
      && approval.marketplace === state.project?.marketplace
      && approval.product_type === state.project?.product_type
      && approval.product_master_version === state.product_master?.version
      && approval.listing_version === listing?.version
      && Array.isArray(artifactIds)
      && artifactIds.length === selected.length
      && artifactIds.every(id => selected.includes(id));
  });
  if (matches.length > 1) {
    const first = matches[0];
    const sameScope = matches.every(item => (
      item.product_master_version === first.product_master_version
      && item.listing_version === first.listing_version
      && [...item.artifact_ids].sort().join('\0') === [...first.artifact_ids].sort().join('\0')
      && item.marketplace === first.marketplace
      && item.product_type === first.product_type
      && isDeepStrictEqual(item.rule_scope ?? null, first.rule_scope ?? null)
    ));
    if (sameScope) return matches.reduce((latest, item) => (
      Date.parse(item.approved_at ?? '') >= Date.parse(latest.approved_at ?? '') ? item : latest
    ));
  }
  if (matches.length !== 1) {
    throw blocking('Finalization requires a single current immutable final approval', {
      matching_approval_ids: matches.map(item => item.id)
    });
  }
  return matches[0];
}

function currentFinalApproval(state) {
  return state?.project?.mode === 'variation_family'
    ? currentVariationFinalApproval(state)
    : currentSingleFinalApproval(state);
}

function hasVariationDeliveryShape(manifest) {
  return manifest && (
    ['family', 'child'].includes(manifest.delivery_type)
    || Number.isInteger(manifest.variation_version)
    || manifest.approval_scope?.scope_type === 'variation_final'
    || manifest.approval_provenance !== undefined
  );
}

async function writeJsonAtomically(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {encoding: 'utf8', flag: 'wx'});
  await rename(temporary, filePath);
}

function blocking(message, details = {}) {
  return Object.assign(new Error(message), {code: 'BLOCKING_INPUT', details});
}

function resolveInitProjectDir(options) {
  if (!options['projects-root']) return path.resolve(requireOption(options, 'project-dir'));
  const projectsRoot = path.resolve(options['projects-root']);
  const projectId = requireOption(options, 'project-id');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId)) {
    throw blocking('Project ID must be a safe single-directory slug', {project_id: projectId});
  }
  const projectDir = path.resolve(projectsRoot, projectId);
  if (path.dirname(projectDir) !== projectsRoot) {
    throw blocking('Project path escapes the selected projects root', {project_id: projectId});
  }
  return projectDir;
}

function allowedPlanningPath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return ['docs', 'docs/superpowers', 'docs/superpowers/specs', 'docs/superpowers/plans'].includes(normalized)
    || normalized.startsWith('docs/superpowers/specs/')
    || normalized.startsWith('docs/superpowers/plans/');
}

async function assertPlanningOnly(directory, current = directory) {
  for (const entry of await readdir(current, {withFileTypes: true})) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(directory, absolute);
    if (!allowedPlanningPath(relative) || entry.isSymbolicLink()) {
      throw blocking('Pre-existing project directory contains unexpected content', {path: relative});
    }
    if (entry.isDirectory()) await assertPlanningOnly(directory, absolute);
  }
}

async function initProject(options) {
  const projectDir = resolveInitProjectDir(options);
  const exists = await pathExists(projectDir);
  if (exists) {
    if (!options['projects-root']) throw blocking('Project directory already exists');
    await assertPlanningOnly(projectDir);
  }
  const state = createProjectState({
    projectId: requireOption(options, 'project-id'),
    productName: requireOption(options, 'product-name'),
    marketplace: options.marketplace ?? 'amazon.com',
    language: options.language ?? 'en-US',
    productType: requireOption(options, 'product-type')
  });
  await mkdir(projectDir, {recursive: true});
  await writeProjectSnapshot(projectDir, state);
  return {project_dir: projectDir, created: ['project.md', 'product.json', '.studio/state.json']};
}

async function learnCategory(options) {
  const libraryDir = path.resolve(requireOption(options, 'library-dir'));
  const marketplace = requireOption(options, 'marketplace');
  const categoryId = requireOption(options, 'category-id');
  if (!/^[a-z0-9.-]+$/i.test(marketplace) || !/^[a-z0-9][a-z0-9-]*$/i.test(categoryId)) {
    throw Object.assign(new Error('Marketplace or category ID is invalid'), {code: 'BLOCKING_INPUT'});
  }
  const input = JSON.parse(await readFile(path.resolve(requireOption(options, 'input')), 'utf8'));
  const directory = path.join(libraryDir, 'categories', marketplace);
  const outputPath = path.join(directory, `${categoryId}.json`);
  await mkdir(directory, {recursive: true});
  let existing = {};
  if (await pathExists(outputPath)) existing = JSON.parse(await readFile(outputPath, 'utf8'));
  const output = {
    schema_version: 1,
    marketplace,
    category_id: categoryId,
    observations: {...(existing.observations ?? {}), ...(input.observations ?? {})},
    market_language: [...new Set([...(existing.market_language ?? []), ...(input.market_language ?? [])])]
  };
  await writeJsonAtomically(outputPath, output);
  return {path: outputPath, observation_count: Object.keys(output.observations).length};
}

async function withFileLock(lockPath, operation) {
  await mkdir(path.dirname(lockPath), {recursive: true});
  let lock;
  try {
    lock = await open(lockPath, 'wx');
    return await operation();
  } finally {
    await lock?.close();
    if (lock) await unlink(lockPath).catch(() => {});
  }
}

function assertCurrentKeywordProfile(profile, state) {
  if (!profile) return;
  const currentFacts = publishableFacts(state);
  const compatibility = isCompatibleKeywordProfile(profile, {
    marketplace: state.project.marketplace,
    locale: state.project.language,
    product_type: state.project.product_type,
    intent: profile.normalized_intent,
    product_fact_conflict: keywordFactConflict(profile, currentFacts)
  });
  if (!compatibility.compatible) throw blocking('Saved keyword profile is stale; rerun keyword analysis.', {reasons: compatibility.reasons});
}

function publishableFacts(state) {
  return Object.fromEntries(Object.entries(state?.facts ?? {})
    .filter(([, fact]) => fact?.status === 'confirmed' && fact?.publishable === true)
    .map(([field, fact]) => [field, fact.value]));
}

function profileSegment(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function writeKeywordProfileLocked(filePath, profile, expected, conflictCode) {
  await mkdir(path.dirname(filePath), {recursive: true});
  const lockPath = `${filePath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, 'wx');
    const current = await readJsonIfExists(filePath);
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      throw Object.assign(new Error('Keyword profile changed during analysis.'), {code: conflictCode});
    }
    await writeJsonAtomically(filePath, profile);
  } finally {
    await lock?.close();
    if (lock) await unlink(lockPath).catch(() => {});
  }
}

async function defaultWriteKeywordCache(filePath, profile, {expected = null} = {}) {
  await writeKeywordProfileLocked(filePath, profile, expected, 'KEYWORD_CACHE_CHANGED');
}

async function analyzeKeywords(options, dependencies = {}) {
  const projectDir = path.resolve(requireOption(options, 'project-dir'));
  const input = JSON.parse(await readFile(path.resolve(requireOption(options, 'input')), 'utf8'));
  if (!normalizeKeywordPhrase(input.intent)) throw blocking('Keyword purchase intent is required');
  if (!Array.isArray(input.reports) || input.reports.length === 0) {
    throw blocking('At least one SellerSprite report is required');
  }
  const statePath = projectPaths(projectDir).state;
  const stateSnapshot = await readFile(statePath, 'utf8');
  const state = JSON.parse(stateSnapshot);
  const productFacts = publishableFacts(state);
  const context = {
    marketplace: state.project.marketplace,
    locale: state.project.language,
    product_type: state.project.product_type,
    intent: input.intent
  };
  const outputPath = projectKeywordProfilePath(projectDir);
  let cachePath = null;
  let cacheCollision = false;
  const warnings = [];
  if (options['library-dir']) {
    cachePath = reusableKeywordProfilePath(path.resolve(options['library-dir']), {
      marketplace: profileSegment(context.marketplace),
      locale: profileSegment(context.locale),
      product_type: profileSegment(context.product_type),
      intent_slug: profileSegment(input.intent)
    });
  }
  const projectSnapshot = await readJsonIfExists(outputPath);
  let existing = projectSnapshot;
  let cached = null;
  if (cachePath) {
    try {
      cached = await readJsonIfExists(cachePath);
      if (cached) {
        const compatibility = isCompatibleKeywordProfile(cached, {
          ...context, product_fact_conflict: keywordFactConflict(cached, productFacts)
        }, input.now);
        if (!compatibility.compatible) {
          cacheCollision = true;
          warnings.push({code: 'KEYWORD_CACHE_COLLISION'});
        }
      }
    } catch {
      warnings.push({code: 'KEYWORD_CACHE_NOT_READ'});
    }
  }
  if (existing) {
    const compatibility = isCompatibleKeywordProfile(existing, {
      ...context, product_fact_conflict: keywordFactConflict(existing, productFacts)
    }, input.now);
    if (!compatibility.compatible) existing = null;
  }
  if (!existing && cached && !cacheCollision) existing = cached;
  const incomingReports = [];
  for (const item of input.reports) {
    if (!item?.path) throw blocking('Every SellerSprite report requires a path');
    incomingReports.push(await parseSellerSpriteWorkbook(path.resolve(item.path), {
      sampleScope: input.sample_scope,
      scopeProvenance: input.scope_provenance,
      referenceAsin: item.reference_asin,
      seedQuery: item.seed_query,
      exportDate: item.export_date,
      marketplace: state.project.marketplace
    }));
  }
  let mergedProfile = existing ?? {marketplace: state.project.marketplace, reports: []};
  for (const report of incomingReports) {
    mergedProfile = mergeKeywordProfileReports(mergedProfile, report, input.now);
  }
  const reports = mergedProfile.reports;
  const inheritedAssessments = {};
  for (const group of Object.values(existing?.groups ?? {})) {
    for (const item of group ?? []) {
      inheritedAssessments[item.normalized_phrase] = {
        fit: item.fit, reason: item.reason, reason_code: item.reason_code
      };
    }
  }
  const suppliedAssessments = Object.fromEntries(Object.entries(input.fit_assessments ?? {})
    .map(([phrase, assessment]) => [normalizeKeywordPhrase(phrase), assessment]));
  const sameProfileIdentity = profile => profile
    && profile.marketplace === context.marketplace
    && profile.locale === context.locale
    && profile.product_type === context.product_type
    && profile.normalized_intent === normalizeKeywordPhrase(input.intent);
  const settingsProfile = sameProfileIdentity(projectSnapshot)
    ? projectSnapshot
    : (sameProfileIdentity(existing) ? existing : null);
  const profile = buildKeywordProfile({
    project: {
      marketplace: state.project.marketplace,
      locale: state.project.language,
      product_type: state.project.product_type,
      product_facts: productFacts,
      keyword_fact_fields: input.keyword_fact_fields ?? settingsProfile?.keyword_fact_fields
    },
    intent: input.intent,
    reports,
    fitAssessments: {...inheritedAssessments, ...suppliedAssessments},
    listingStrategy: input.listing_strategy ?? settingsProfile?.listing_strategy,
    now: input.now
  });
  if (existing?.generated_at) profile.generated_at = existing.generated_at;
  if (await readFile(statePath, 'utf8') !== stateSnapshot) throw blocking('Project facts changed during keyword analysis; rerun analysis.');
  await writeKeywordProfileLocked(outputPath, profile, projectSnapshot, 'KEYWORD_PROJECT_CHANGED');
  if (cacheCollision) cachePath = null;
  if (cachePath) {
    try {
      await (dependencies.writeCache ?? defaultWriteKeywordCache)(cachePath, profile, {expected: cached});
    } catch {
      cachePath = null;
      warnings.push({code: 'KEYWORD_CACHE_NOT_WRITTEN'});
    }
  }
  return {
    profile_path: outputPath,
    cache_path: cachePath,
    report_count: reports.length,
    analysis_passes: 1,
    web_research_used: false,
    market_size_complete: false,
    warnings
  };
}

function candidatePath(projectDir, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw Object.assign(new Error('Candidate path must be project-relative'), {code: 'BLOCKING_INPUT'});
  }
  const root = path.resolve(projectDir);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error('Candidate path escapes the project directory'), {code: 'BLOCKING_INPUT'});
  }
  return resolved;
}

function projectOutputPath(projectDir, requestedPath, label) {
  const root = path.resolve(projectDir);
  const resolved = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(root, requestedPath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw blocking(`${label} must remain inside the product root`, {path: requestedPath, product_root: root});
  }
  return resolved;
}

async function defaultDecode(_filePath, _candidate, {fileBytes} = {}) {
  const metadata = await sharp(fileBytes ?? _filePath).metadata();
  if (!(metadata.width > 0) || !(metadata.height > 0)) {
    throw Object.assign(new Error('Candidate raster has invalid dimensions'), {code: 'CAPABILITY_FAILURE'});
  }
  return {width: metadata.width, height: metadata.height, format: metadata.format};
}

async function defaultCheck({filePath, fileBytes, candidate}) {
  if (candidate.kind !== 'main') return {ok: true, failures: []};
  return validateMainImage(fileBytes ?? filePath, candidate.check_options ?? {});
}

async function defaultInspect({candidate}) {
  if (!candidate.inspection_status) {
    throw Object.assign(new Error('Saved-file inspection evidence is required'), {code: 'BLOCKING_INPUT'});
  }
  return {
    status: candidate.inspection_status,
    findings: candidate.inspection_findings ?? [],
    reason_codes: candidate.inspection_reason_codes ?? []
  };
}

export async function runRecordCandidate({projectDir, candidate}, {
  decode = defaultDecode,
  check = defaultCheck,
  inspect = defaultInspect
} = {}) {
  if (!candidate?.id || !candidate.kind || !candidate.path) {
    throw Object.assign(new Error('Candidate ID, kind, and path are required'), {code: 'BLOCKING_INPUT'});
  }
  const filePath = candidatePath(projectDir, candidate.path);
  const decoded = await decode(filePath, candidate);
  const deterministic = await check({filePath, candidate, decoded});
  const inspection = await inspect({filePath, candidate, decoded, deterministic});
  const passed = deterministic?.ok === true && inspection?.status === 'pass';
  const reasonCodes = [...new Set([
    ...(deterministic?.failures ?? []).map(failure => failure.code).filter(Boolean),
    ...(inspection?.reason_codes ?? []),
    ...(!passed && inspection?.status !== 'pass' ? ['SAVED_FILE_INSPECTION_FAILED'] : [])
  ])];

  const transaction = await updateProject(projectDir, state => {
    const next = structuredClone(state);
    if (candidate.kind !== 'main' && (
      next.product_master?.status !== 'locked'
      || candidate.product_master_version !== next.product_master.version
    )) {
      throw Object.assign(new Error('Candidate is not bound to the current Product Master'), {code: 'STALE_DEPENDENCY'});
    }
    const automaticAttempts = Number(candidate.automatic_attempts ?? 0);
    next.gallery.assets[candidate.id] = passed
      ? {
          id: candidate.id,
          kind: candidate.kind,
          status: 'candidate',
          path: candidate.path,
          dimensions: {width: decoded.width, height: decoded.height},
          format: decoded.format ?? null,
          inspection_status: 'pass',
          inspection_findings: inspection.findings ?? [],
          product_master_version: candidate.kind === 'main' ? 0 : candidate.product_master_version,
          fact_ids: [...new Set(candidate.fact_ids ?? [])],
          automatic_attempts: automaticAttempts
        }
      : {
          id: candidate.id,
          kind: candidate.kind,
          status: 'rejected',
          reason_codes: reasonCodes,
          automatic_attempts: automaticAttempts
        };
    const planIndex = next.gallery.plan.findIndex(item => item.id === candidate.id);
    const planItem = {id: candidate.id, kind: candidate.kind, status: passed ? 'candidate' : 'rejected'};
    if (planIndex >= 0) next.gallery.plan[planIndex] = {...next.gallery.plan[planIndex], ...planItem};
    else next.gallery.plan.push(planItem);
    return next;
  });
  return {...transaction, candidate: transaction.state.gallery.assets[candidate.id]};
}

export async function runApprove(input, {hashFile} = {}) {
  if (input.artifactType === 'listing') {
    const profilePath = projectKeywordProfilePath(input.projectDir);
    return withFileLock(`${profilePath}.lock`, () => updateProject(input.projectDir, async state => {
      const keywordProfile = await readJsonIfExists(profilePath);
      assertCurrentKeywordProfile(keywordProfile, state);
      const errors = keywordProfileErrors(state?.listing?.draft?.content, keywordProfile);
      if (errors.length) throw blocking('Listing conflicts with the saved keyword profile', {errors});
      return approveListingDraft(state, {userAction: 'approved', now: input.now});
    }));
  }
  return updateProject(input.projectDir, state => approveArtifact(state, {
      artifactId: input.artifactId,
      artifactType: input.artifactType ?? 'image',
      path: input.path,
      userAction: 'approved',
      now: input.now
    }, {projectDir: input.projectDir, hashFile}));
}

async function defaultLoadState(projectDir) {
  return readProjectState(projectDir);
}

function variationCandidateKind(candidate) {
  if (candidate.scopeType === 'child_main') return 'main';
  return candidate.kind ?? 'secondary';
}

function assertVariationCandidateScope(state, candidate) {
  if (state?.project?.mode !== 'variation_family' || !state.variation) {
    throw blocking('A Variation Family project is required');
  }
  if (!['child_main', 'shared_image'].includes(candidate?.scopeType)
      || !candidate.artifactId || !candidate.path) {
    throw blocking('Variation candidate requires an explicit supported scope, artifact ID, and path');
  }
  const normalizedPath = candidate.path.replaceAll('\\', '/');
  if (candidate.scopeType === 'child_main') {
    const child = state.variation.children?.[candidate.childSku];
    if (!child || child.active === false) throw blocking('Variation candidate requires an active exact Child SKU');
    if (candidate.childSkus !== undefined || candidate.factDependencies !== undefined || candidate.scope !== undefined
        || (candidate.kind !== undefined && candidate.kind !== 'main')) {
      throw blocking('Variation candidate fields do not match the Child main scope');
    }
    const canonical = normalizedPath.startsWith(`children/${candidate.childSku}/assets/`);
    const preserved = child.legacy_refs?.main_image === candidate.path
      || child.product_master?.approved_main_path === candidate.path;
    if (!canonical && !preserved) {
      throw blocking('Child main candidate path does not belong to the exact Child scope');
    }
  } else {
    if (candidate.childSku !== undefined || variationCandidateKind(candidate) === 'main'
        || !normalizedPath.startsWith('family/shared-assets/')
        || !candidate.scope || !candidate.factDependencies) {
      throw blocking('Shared image candidate fields do not match the shared scope');
    }
  }
}

function variationArtifactExists(state, artifactId) {
  if (state.variation.shared_assets?.[artifactId]) return true;
  return Object.values(state.variation.children ?? {}).some(child => (
    child.assets?.[artifactId] || child.gallery?.assets?.[artifactId]
  ));
}

export async function runRecordVariationCandidate({projectDir, candidate}, {
  decode = defaultDecode,
  check = defaultCheck,
  inspect = defaultInspect
} = {}) {
  const current = await defaultLoadState(projectDir);
  assertVariationCandidateScope(current, candidate);
  if (variationArtifactExists(current, candidate.artifactId)) {
    throw blocking('Variation artifact ID already exists', {artifact_id: candidate.artifactId});
  }
  const filePath = candidatePath(projectDir, candidate.path);
  const fileBytes = await readFile(filePath);
  const snapshotSha256 = createHash('sha256').update(fileBytes).digest('hex');
  const normalizedCandidate = {...candidate, kind: variationCandidateKind(candidate)};
  const decoded = await decode(filePath, normalizedCandidate, {fileBytes: Buffer.from(fileBytes)});
  const deterministic = await check({
    filePath, fileBytes: Buffer.from(fileBytes), candidate: normalizedCandidate, decoded
  });
  const inspection = await inspect({
    filePath, fileBytes: Buffer.from(fileBytes), candidate: normalizedCandidate, decoded, deterministic
  });
  const passed = deterministic?.ok === true && inspection?.status === 'pass';
  const candidateSha256 = passed ? snapshotSha256 : null;
  const reasonCodes = [...new Set([
    ...(deterministic?.failures ?? []).map(failure => failure.code).filter(Boolean),
    ...(inspection?.reason_codes ?? []),
    ...(!passed && inspection?.status !== 'pass' ? ['SAVED_FILE_INSPECTION_FAILED'] : [])
  ])];

  const transaction = await updateProject(projectDir, state => {
    assertVariationCandidateScope(state, candidate);
    if (variationArtifactExists(state, candidate.artifactId)) {
      throw blocking('Variation artifact ID already exists', {artifact_id: candidate.artifactId});
    }
    const next = structuredClone(state);
    const saved = passed ? {
      id: candidate.artifactId,
      kind: normalizedCandidate.kind,
      status: 'candidate',
      path: candidate.path,
      dimensions: {width: decoded.width, height: decoded.height},
      format: decoded.format ?? null,
      media_type: decoded.format ? `image/${decoded.format === 'jpg' ? 'jpeg' : decoded.format}` : null,
      inspection_status: 'pass',
      inspection_findings: inspection.findings ?? [],
      candidate_sha256: candidateSha256,
      inspection_binding: {
        scope_type: candidate.scopeType,
        kind: normalizedCandidate.kind,
        path: candidate.path,
        ...(candidate.scopeType === 'child_main'
          ? {child_sku: candidate.childSku}
          : {asset_scope: structuredClone(candidate.scope)})
      },
      automatic_attempts: Number(candidate.automatic_attempts ?? 0),
      ...(candidate.scopeType === 'child_main' ? {child_sku: candidate.childSku} : {
        scope: structuredClone(candidate.scope),
        fact_dependencies: structuredClone(candidate.factDependencies)
      })
    } : {
      id: candidate.artifactId,
      kind: normalizedCandidate.kind,
      status: 'rejected',
      reason_codes: reasonCodes,
      automatic_attempts: Number(candidate.automatic_attempts ?? 0)
    };
    if (candidate.scopeType === 'child_main') {
      const child = next.variation.children[candidate.childSku];
      child.assets = {...(child.assets ?? {}), [candidate.artifactId]: saved};
    } else {
      next.variation.shared_assets = {...(next.variation.shared_assets ?? {}), [candidate.artifactId]: saved};
    }
    const now = candidate.now ?? new Date().toISOString();
    next.variation.updated_at = now;
    next.project.updated_at = now;
    return next;
  });
  return {...transaction, candidate: candidate.scopeType === 'child_main'
    ? transaction.state.variation.children[candidate.childSku].assets[candidate.artifactId]
    : transaction.state.variation.shared_assets[candidate.artifactId]};
}

function validateVariationApprovalInput(approval) {
  const scopeType = approval?.scopeType;
  if (!['child_main', 'shared_image', 'parent_listing', 'child_listing', 'variation_final'].includes(scopeType)) {
    throw blocking('Variation approval requires an explicit supported scope');
  }
  if (scopeType === 'variation_final' && [
    'artifactId', 'childSku', 'childSkus', 'content', 'path', 'factDependencies'
  ].some(field => approval[field] !== undefined)) {
    throw blocking('Final Variation approval fields cannot substitute for another scope');
  }
  return scopeType;
}

async function applyVariationApproval(state, approval, {projectDir, hashFile} = {}) {
  const scopeType = validateVariationApprovalInput(approval);
  if (scopeType === 'child_main' || scopeType === 'shared_image') {
    return approveVariationArtifact(state, {...approval, artifactType: scopeType}, {projectDir, hashFile});
  }
  if (scopeType === 'parent_listing' || scopeType === 'child_listing') {
    return approveVariationListing(state, approval);
  }
  return approveVariationVersion(state, approval);
}

export async function runApproveVariation({projectDir, approval}, {hashFile} = {}) {
  return updateProject(projectDir, async state => {
    const next = await applyVariationApproval(state, approval, {projectDir, hashFile});
    return {state: next, approval: next.approvals.at(-1)};
  });
}

export async function runApproveVariationBatch({projectDir, approvals, userAction}, {hashFile} = {}) {
  if (!Array.isArray(approvals) || approvals.length < 2) {
    throw blocking('Variation batch approval requires at least two approvals');
  }
  const normalized = approvals.map(item => ({...item, userAction: item.userAction ?? userAction}));
  normalized.forEach(validateVariationApprovalInput);
  if (normalized.some(item => item.userAction !== 'approved')) {
    throw blocking('Every batch item requires the same explicit approved user action');
  }
  const finalIndexes = normalized.map((item, index) => item.scopeType === 'variation_final' ? index : -1)
    .filter(index => index >= 0);
  if (finalIndexes.length > 1 || (finalIndexes.length === 1 && finalIndexes[0] !== normalized.length - 1)) {
    throw blocking('Variation final approval may appear only once and last');
  }
  return updateProject(projectDir, async state => {
    let next = state;
    const created = [];
    for (const approval of normalized) {
      const before = next.approvals.length;
      next = await applyVariationApproval(next, approval, {projectDir, hashFile});
      created.push(...next.approvals.slice(before));
    }
    return {state: next, approvals: created};
  });
}

async function ensureChildWorkspace(projectDir, childSku) {
  for (const relative of [`children/${childSku}/assets`, `children/${childSku}/listing`]) {
    const target = path.join(projectDir, ...relative.split('/'));
    try {
      const entry = await stat(target);
      if (!entry.isDirectory()) throw blocking('Child workspace path is occupied by a file', {path: relative});
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await mkdir(target, {recursive: true});
      } catch (mkdirError) {
        if (['EEXIST', 'ENOTDIR'].includes(mkdirError.code)) {
          throw blocking('Child workspace path is occupied by a file', {path: relative});
        }
        throw mkdirError;
      }
    }
  }
}

async function defaultWriteListingTransaction({projectDir, state, markdown}) {
  const result = await updateProject(projectDir, () => state);
  const listingDir = path.join(path.resolve(projectDir), 'listing');
  await mkdir(listingDir, {recursive: true});
  const outputPath = path.join(listingDir, 'draft.md');
  const temporary = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, markdown, {encoding: 'utf8', flag: 'wx'});
  await rename(temporary, outputPath);
  return result;
}

export async function runListingRevision(input, dependencies = {}) {
  const route = classifyOperation({kind: 'listing_field_edit'});
  const changedPaths = Object.keys(input?.patch?.fields ?? {});
  const loadState = dependencies.loadState ?? defaultLoadState;
  const patchDraft = dependencies.patchDraft ?? ((state, patch) => reviseDraft(state, patch, {now: input.now}));
  const validateChanged = dependencies.validateChanged ?? validateChangedListing;
  const renderMarkdown = dependencies.renderMarkdown ?? renderListing;
  const writeTransaction = dependencies.writeTransaction ?? defaultWriteListingTransaction;
  const loadKeywordProfile = dependencies.loadKeywordProfile
    ?? (() => readJsonIfExists(projectKeywordProfilePath(input.projectDir)));

  const execute = async () => {
    const [current, keywordProfile] = await Promise.all([loadState(input.projectDir), loadKeywordProfile()]);
    assertCurrentKeywordProfile(keywordProfile, current);
    const next = patchDraft(current, input.patch);
    const validation = validateChanged(next, changedPaths, {keywordProfile});
    const markdown = renderMarkdown(next.listing.draft);
    const transaction = await writeTransaction({projectDir: input.projectDir, state: next, markdown});
    return {...transaction, mode: route.mode, changed_paths: changedPaths, validation};
  };
  if (dependencies.loadKeywordProfile) return execute();
  const profilePath = projectKeywordProfilePath(input.projectDir);
  return withFileLock(`${profilePath}.lock`, execute);
}

function operationFor(command, input = null) {
  if (command === 'revise-child' && Object.keys(input?.factPatch ?? {}).length > 0) {
    return classifyOperation({kind: input.factImpact ?? 'child_fact_identity'});
  }
  const kinds = {
    init: 'new_project',
    'learn-category': 'learn_category',
    'analyze-keywords': 'keyword_analysis',
    'record-candidate': 'record_candidate',
    'record-variation-candidate': 'record_candidate',
    'revise-listing': 'listing_field_edit',
    approve: 'approve_asset',
    'approve-variation': 'approve_asset',
    'approve-variation-batch': 'approve_asset',
    validate: 'knowledge_lookup',
    migrate: 'migrate',
    'promote-variation': 'product_identity_change',
    'add-child': 'add_child',
    'revise-child': 'child_listing_field_edit',
    'remove-child': 'remove_child',
    'resolve-variation-facts': 'resolve_fact_conflicts',
    'verify-delivery': 'finalize',
    'prepare-upload': 'finalize'
  };
  return classifyOperation({kind: kinds[command] ?? command});
}

function uploadRows(projection, input) {
  const urls = new Map(projection.proposed_images.map(image => [image.source, image.url]));
  return projection.rows.map(row => {
    const listing = row.listing ?? {};
    const overrides = input.rows?.[row.seller_sku] ?? {};
    return {
      ...listing.attributes,
      ...listing,
      ...row,
      ...overrides,
      bullet_points: listing.bullets,
      main_and_other_image_urls: row.gallery_slots?.map(slot => urls.get(slot.source)).filter(Boolean)
    };
  });
}

function uploadFindings({inspection, rules, rows, checkRules = true}) {
  const mappedColumns = Object.keys(inspection.columns);
  const conditions = inspection.unsupported_conditions
    .map(item => ({code: 'UNSUPPORTED_TEMPLATE_CONDITION', ...item}));
  const validations = inspection.unsupported_validations
    .map(item => ({code: 'UNSUPPORTED_TEMPLATE_VALIDATION', ...item}));
  const templateFindings = [...conditions, ...validations];
  const findings = [
    ...templateFindings.filter(item => rangeAffectsRows(item.cells, mappedColumns, rows.length)),
    ...validateRestrictedValues({inspection, rows})
  ];
  if (checkRules && (!rules || rules.status !== 'fresh' || rules.refresh_required)) {
    findings.push({code: rules?.status === 'stale' ? 'RULES_STALE' : 'RULES_UNAVAILABLE'});
  }
  for (const row of rows) {
    for (const column of requiredForRow(inspection, row)) {
      const field = inspection.columns[column];
      if (field && (row[field] === undefined || row[field] === null || row[field] === '')) {
        findings.push({code: 'REQUIRED_FIELD_MISSING', field, column, seller_sku: row.seller_sku});
      }
    }
    if (row.parentage_level === 'Child' && inspection.validations.shipping_template && !row.shipping_template) {
      findings.push({code: 'REQUIRED_FIELD_MISSING', field: 'shipping_template', seller_sku: row.seller_sku});
    }
  }
  return {
    findings,
    diagnostics: templateFindings.filter(item => !rangeAffectsRows(item.cells, mappedColumns, rows.length))
  };
}

export async function prepareUpload({
  projectDir,
  deliveryDir,
  templatePath,
  inputPath,
  outputDir,
  rulesLibrary,
  verifySingle = verifyDelivery,
  verifyVariation = verifyVariationDelivery,
  resolveCurrentRules = resolveRules,
  now = new Date().toISOString()
}) {
  const [state, input, seed, templateBytes] = await Promise.all([
    readProjectState(projectDir),
    readJsonIfExists(inputPath),
    readJsonIfExists(new URL('../assets/rule-seeds/amazon-us-signage-upload-fields.json', import.meta.url)),
    readFile(templatePath)
  ]);
  const expectedScope = currentFinalApproval(state);
  const delivery = await readVerifiedDelivery({deliveryDir, expectedScope, verifySingle, verifyVariation});
  const inspection = inspectUploadTemplate(templateBytes, seed);
  const marketplace = delivery.manifest.marketplace ?? delivery.manifest.approval_scope?.marketplace ?? state.project.marketplace;
  const productType = delivery.manifest.product_type ?? delivery.manifest.approval_scope?.product_type ?? state.project.product_type;
  const base = projectUploadPreparation({delivery, input});
  const preliminaryRows = uploadRows(base, input);
  const preliminary = uploadFindings({inspection, rules: null, rows: preliminaryRows, checkRules: false});
  const preliminaryFindings = [...base.findings, ...preliminary.findings];
  if (!input.image_urls) {
    return {
      status: 'hosting_required',
      delivery_identity: base.delivery_identity,
      proposed_images: base.proposed_images,
      unresolved: [...preliminaryFindings, {code: 'RULES_CHECK_DEFERRED'}],
      diagnostics: preliminary.diagnostics
    };
  }
  const hosted = attachHostedUrls(base, input.image_urls);
  const rows = uploadRows(hosted, input);
  const local = uploadFindings({inspection, rules: null, rows, checkRules: false});
  const localFindings = [...hosted.findings, ...local.findings];
  const rules = localFindings.length ? null : await resolveCurrentRules({
    libraryDir: rulesLibrary,
    marketplace,
    productType,
    compatibleProductTypes: input.compatible_product_types ?? [],
    purpose: 'upload_ready',
    now
  });
  const checked = uploadFindings({inspection, rules, rows, checkRules: Boolean(rules)});
  const findings = [...hosted.findings, ...checked.findings];
  const diagnostics = [...checked.diagnostics, ...(!rules ? [{code: 'RULES_CHECK_DEFERRED'}] : [])];
  if (await pathExists(outputDir)) throw Object.assign(new Error('Upload output already exists'), {code: 'OUTPUT_EXISTS'});
  const stage = `${outputDir}.tmp-${process.pid}-${Date.now()}`;
  const extension = path.extname(templatePath).toLowerCase();
  const workbookName = `amazon-upload${extension}`;
  await mkdir(path.dirname(outputDir), {recursive: true});
  await mkdir(stage, {recursive: false});
  try {
    const workbook = writeUploadWorkbook({templateBytes, inspection, rows});
    const workbookPath = path.join(stage, workbookName);
    await writeFile(workbookPath, workbook, {flag: 'wx'});
    inspectUploadTemplate(await readFile(workbookPath), seed);
    const status = findings.length ? 'manual-prep' : 'upload-ready';
    const manifest = {
      delivery_identity: hosted.delivery_identity,
      findings,
      diagnostics,
      image_urls: Object.fromEntries(hosted.proposed_images.map(item => [item.object_key, item.url])),
      marketplace,
      seller_account: input.seller_account ?? null,
      status,
      template: path.basename(templatePath)
    };
    await writeFile(path.join(stage, 'upload-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {flag: 'wx'});
    await rename(stage, outputDir);
    return {
      status,
      workbook_path: path.join(outputDir, workbookName),
      manifest_path: path.join(outputDir, 'upload-manifest.json'),
      findings,
      diagnostics,
      rows
    };
  } catch (error) {
    await unlink(path.join(stage, workbookName)).catch(() => {});
    await unlink(path.join(stage, 'upload-manifest.json')).catch(() => {});
    throw error;
  }
}

export async function runCli(argv, {
  clock = Date.now,
  candidateDependencies,
  listingDependencies,
  keywordDependencies,
  hashFile,
  buildV2 = buildV2Delivery,
  verifyV2 = verifyDelivery,
  buildVariation = buildVariationDelivery,
  verifyVariation = verifyVariationDelivery,
  uploadDependencies = {}
} = {}) {
  const started = clock();
  let parsed;
  try {
    parsed = parseArgs(argv);
    const {command, options} = parsed;
    let result;
    let routeInput = null;
    if (command === 'init') result = await initProject(options);
    else if (command === 'learn-category') result = await learnCategory(options);
    else if (command === 'analyze-keywords') result = await analyzeKeywords(options, keywordDependencies);
    else if (command === 'promote-variation') {
      const theme = JSON.parse(await readFile(path.resolve(requireOption(options, 'theme')), 'utf8'));
      result = await promoteToVariation({
        projectDir: path.resolve(requireOption(options, 'project-dir')),
        parentSku: requireOption(options, 'parent-sku'),
        childSku: requireOption(options, 'child-sku'),
        theme: {dimensions: theme.dimensions, values: theme.values},
        themeSource: theme.source,
        now: options.now
      });
    }
    else if (['add-child', 'revise-child', 'remove-child', 'resolve-variation-facts'].includes(command)) {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      const input = JSON.parse(await readFile(path.resolve(requireOption(options, 'input')), 'utf8'));
      const operationInput = {...input, ...(options.now ? {now: options.now} : {})};
      routeInput = operationInput;
      const mutate = command === 'add-child'
        ? addVariationChild
        : command === 'revise-child'
          ? reviseVariationChild
          : command === 'remove-child'
            ? removeVariationChild
            : resolveVariationFactConflicts;
      if (command === 'add-child') {
        const current = await defaultLoadState(projectDir);
        mutate(current, operationInput);
        await ensureChildWorkspace(projectDir, operationInput.sku);
      } else if (command === 'revise-child' && Object.keys(operationInput.factPatch ?? {}).length > 0) {
        const current = await defaultLoadState(projectDir);
        routeInput.factImpact = classifyChildFactImpact(current, operationInput.factPatch);
      }
      result = await updateProject(projectDir, state => mutate(state, operationInput));
    }
    else if (command === 'record-candidate') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      const candidate = JSON.parse(await readFile(path.resolve(requireOption(options, 'input')), 'utf8'));
      result = await runRecordCandidate({projectDir, candidate}, candidateDependencies);
    }
    else if (command === 'record-variation-candidate') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      const candidate = JSON.parse(await readFile(path.resolve(requireOption(options, 'input')), 'utf8'));
      result = await runRecordVariationCandidate({projectDir, candidate}, {
        ...(candidateDependencies ?? {}), hashFile
      });
    }
    else if (command === 'approve') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      const artifactType = options.type ?? 'image';
      result = await runApprove({
        projectDir,
        artifactId: artifactType === 'listing' ? null : requireOption(options, 'artifact-id'),
        artifactType,
        path: artifactType === 'listing' ? null : requireOption(options, 'path'),
        now: options.now
      }, {hashFile});
    } else if (command === 'approve-variation') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      const approval = JSON.parse(await readFile(path.resolve(requireOption(options, 'input')), 'utf8'));
      result = await runApproveVariation({projectDir, approval}, {hashFile});
    } else if (command === 'approve-variation-batch') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      const batch = JSON.parse(await readFile(path.resolve(requireOption(options, 'input')), 'utf8'));
      result = await runApproveVariationBatch({
        projectDir, approvals: batch.approvals, userAction: batch.userAction
      }, {hashFile});
    } else if (command === 'revise-listing') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      const patch = JSON.parse(await readFile(path.resolve(requireOption(options, 'patch')), 'utf8'));
      result = await runListingRevision({projectDir, patch, now: options.now}, listingDependencies);
    } else if (command === 'validate') {
      const state = await readProjectState(requireOption(options, 'project-dir'));
      result = validateProjectState(state);
    } else if (command === 'migrate') {
      result = await migrateLegacyProject({
        sourceDir: requireOption(options, 'source-dir'),
        destinationDir: requireOption(options, 'destination-dir')
      });
    } else if (command === 'finalize') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      const outputDir = projectOutputPath(projectDir, requireOption(options, 'output'), 'Delivery output');
      const state = await readProjectState(projectDir);
      const finalApproval = options.approval
        ? JSON.parse(await readFile(path.resolve(options.approval), 'utf8'))
        : currentFinalApproval(state);
      if (state?.project?.mode === 'variation_family') {
        result = await buildVariation({
          projectDir,
          outputDir,
          finalApproval,
          childSkus: options['child-sku'] ? [options['child-sku']] : null
        });
      } else {
        if (options['child-sku']) throw blocking('--child-sku requires a Variation Family project');
        result = await buildV2({projectDir, outputDir, finalApproval});
      }
    } else if (command === 'verify-delivery') {
      const deliveryDir = path.resolve(requireOption(options, 'delivery-dir'));
      const manifest = await readJsonIfExists(path.join(deliveryDir, 'delivery-manifest.json'));
      if (options['project-dir']) {
        const projectDir = path.resolve(options['project-dir']);
        const state = await readProjectState(projectDir);
        if (state?.project?.mode === 'variation_family') {
          if (manifest?.delivery_kind !== 'variation') {
            throw blocking('Delivery manifest kind does not match trusted Variation project mode');
          }
          result = await verifyVariation({
            deliveryDir,
            expectedScope: currentVariationFinalApproval(state)
          });
        } else if (state?.schema_version === 2 && !Object.hasOwn(state, 'variation')
            && (state?.project?.mode === undefined || state?.project?.mode === 'single_product')) {
          if (manifest?.delivery_kind !== undefined && manifest?.delivery_kind !== null) {
            throw blocking('Delivery manifest kind does not match trusted single-product project mode');
          }
          result = await verifyV2({deliveryDir});
        } else {
          throw blocking('Trusted delivery verification requires a recognized persisted project mode');
        }
      } else if (manifest?.delivery_kind === 'variation' || hasVariationDeliveryShape(manifest)) {
        throw blocking('--project-dir is required for trusted Variation verification');
      } else if (manifest?.delivery_kind === undefined || manifest?.delivery_kind === null) {
        result = await verifyV2({deliveryDir});
      } else {
        throw blocking('Delivery manifest kind is unsupported without a trusted project mode');
      }
    } else if (command === 'prepare-upload') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      result = await prepareUpload({
        projectDir,
        deliveryDir: path.resolve(requireOption(options, 'delivery-dir')),
        templatePath: path.resolve(requireOption(options, 'template')),
        inputPath: path.resolve(requireOption(options, 'input')),
        outputDir: projectOutputPath(projectDir, requireOption(options, 'output'), 'Upload output'),
        rulesLibrary: path.resolve(requireOption(options, 'rules-library')),
        verifySingle: uploadDependencies.verifySingle ?? verifyV2,
        verifyVariation: uploadDependencies.verifyVariation ?? verifyVariation,
        resolveCurrentRules: uploadDependencies.resolveRules ?? resolveRules,
        now: options.now
      });
    } else {
      return {ok: false, code: 'UNKNOWN_COMMAND', message: `Unknown command: ${command ?? ''}`};
    }
    const route = operationFor(command, routeInput);
    return {ok: true, operation: command, mode: route.mode, duration_ms: Math.max(0, clock() - started), result};
  } catch (error) {
    return {
      ok: false,
      operation: parsed?.command ?? null,
      code: error.code ?? 'UNEXPECTED_ERROR',
      message: error.message
    };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = await runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.ok) process.exitCode = 1;
}
