#!/usr/bin/env node
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { classifyOperation, validateChangedListing } from './lib/operations.js';
import { createProjectState, renderProjectSummary, validateProjectState } from './lib/project-state.js';
import { approveArtifact, approveListingDraft, updateProject } from './lib/transactions.js';
import { migrateLegacyProject } from './lib/migration.js';
import { validateMainImage } from './lib/images.js';
import { renderListing, reviseDraft } from './lib/listing-drafts.js';
import { buildV2Delivery } from './lib/bundle.js';

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

async function writeJsonAtomically(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {encoding: 'utf8', flag: 'wx'});
  await rename(temporary, filePath);
}

async function initProject(options) {
  const projectDir = path.resolve(requireOption(options, 'project-dir'));
  if (await pathExists(projectDir)) throw Object.assign(new Error('Project directory already exists'), {code: 'BLOCKING_INPUT'});
  const state = createProjectState({
    projectId: requireOption(options, 'project-id'),
    productName: requireOption(options, 'product-name'),
    marketplace: options.marketplace ?? 'amazon.com',
    language: options.language ?? 'en-US',
    productType: requireOption(options, 'product-type')
  });
  await mkdir(projectDir, {recursive: true});
  await writeFile(path.join(projectDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, {flag: 'wx'});
  await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state), {flag: 'wx'});
  for (const directory of ['references', 'images', 'listing', 'delivery']) await mkdir(path.join(projectDir, directory));
  return {project_dir: projectDir, created: ['project.md', 'state.json', 'references', 'images', 'listing', 'delivery']};
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

async function defaultDecode(filePath) {
  const metadata = await sharp(filePath).metadata();
  if (!(metadata.width > 0) || !(metadata.height > 0)) {
    throw Object.assign(new Error('Candidate raster has invalid dimensions'), {code: 'CAPABILITY_FAILURE'});
  }
  return {width: metadata.width, height: metadata.height, format: metadata.format};
}

async function defaultCheck({filePath, candidate}) {
  if (candidate.kind !== 'main') return {ok: true, failures: []};
  return validateMainImage(filePath, candidate.check_options ?? {});
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
    return updateProject(input.projectDir, state => approveListingDraft(state, {
      userAction: 'approved',
      now: input.now
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
  return JSON.parse(await readFile(path.join(path.resolve(projectDir), 'state.json'), 'utf8'));
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

  const current = await loadState(input.projectDir);
  const next = patchDraft(current, input.patch);
  const validation = validateChanged(next, changedPaths);
  const markdown = renderMarkdown(next.listing.draft);
  const transaction = await writeTransaction({projectDir: input.projectDir, state: next, markdown});
  return {...transaction, mode: route.mode, changed_paths: changedPaths, validation};
}

function operationFor(command) {
  const kinds = {
    init: 'new_project',
    'learn-category': 'learn_category',
    'record-candidate': 'record_candidate',
    'revise-listing': 'listing_field_edit',
    approve: 'approve_asset',
    validate: 'knowledge_lookup',
    migrate: 'migrate'
  };
  return classifyOperation({kind: kinds[command] ?? command});
}

export async function runCli(argv, {clock = Date.now, candidateDependencies, listingDependencies, hashFile, buildV2 = buildV2Delivery} = {}) {
  const started = clock();
  let parsed;
  try {
    parsed = parseArgs(argv);
    const {command, options} = parsed;
    let result;
    if (command === 'init') result = await initProject(options);
    else if (command === 'learn-category') result = await learnCategory(options);
    else if (command === 'record-candidate') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      const candidate = JSON.parse(await readFile(path.resolve(requireOption(options, 'input')), 'utf8'));
      result = await runRecordCandidate({projectDir, candidate}, candidateDependencies);
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
    } else if (command === 'revise-listing') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      const patch = JSON.parse(await readFile(path.resolve(requireOption(options, 'patch')), 'utf8'));
      result = await runListingRevision({projectDir, patch, now: options.now}, listingDependencies);
    } else if (command === 'validate') {
      const state = JSON.parse(await readFile(path.join(path.resolve(requireOption(options, 'project-dir')), 'state.json'), 'utf8'));
      result = validateProjectState(state);
    } else if (command === 'migrate') {
      result = await migrateLegacyProject({
        sourceDir: requireOption(options, 'source-dir'),
        destinationDir: requireOption(options, 'destination-dir')
      });
    } else if (command === 'finalize') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      const outputDir = path.resolve(requireOption(options, 'output'));
      const finalApproval = JSON.parse(await readFile(path.resolve(requireOption(options, 'approval')), 'utf8'));
      result = await buildV2({projectDir, outputDir, finalApproval});
    } else {
      return {ok: false, code: 'UNKNOWN_COMMAND', message: `Unknown command: ${command ?? ''}`};
    }
    const route = operationFor(command);
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
