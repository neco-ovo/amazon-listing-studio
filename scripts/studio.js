#!/usr/bin/env node
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyOperation } from './lib/operations.js';
import { createProjectState, renderProjectSummary, validateProjectState } from './lib/project-state.js';
import { approveArtifact, updateProject } from './lib/transactions.js';
import { migrateLegacyProject } from './lib/migration.js';

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

async function recordCandidate(options) {
  const projectDir = path.resolve(requireOption(options, 'project-dir'));
  const candidate = JSON.parse(await readFile(path.resolve(requireOption(options, 'input')), 'utf8'));
  return updateProject(projectDir, state => {
    const next = structuredClone(state);
    next.gallery.assets[candidate.id] = {...candidate, status: 'candidate'};
    if (!next.gallery.plan.some(item => item.id === candidate.id)) {
      next.gallery.plan.push({id: candidate.id, kind: candidate.kind, status: 'candidate'});
    }
    return next;
  });
}

function operationFor(command) {
  const kinds = {
    init: 'new_project',
    'learn-category': 'learn_category',
    'record-candidate': 'next_gallery_item',
    approve: 'approve_asset',
    validate: 'knowledge_lookup',
    migrate: 'migrate'
  };
  return classifyOperation({kind: kinds[command] ?? command});
}

export async function runCli(argv, {clock = Date.now} = {}) {
  const started = clock();
  let parsed;
  try {
    parsed = parseArgs(argv);
    const {command, options} = parsed;
    let result;
    if (command === 'init') result = await initProject(options);
    else if (command === 'learn-category') result = await learnCategory(options);
    else if (command === 'record-candidate') result = await recordCandidate(options);
    else if (command === 'approve') {
      const projectDir = path.resolve(requireOption(options, 'project-dir'));
      result = await updateProject(projectDir, state => approveArtifact(state, {
        artifactId: requireOption(options, 'artifact-id'),
        artifactType: options.type ?? 'image',
        path: requireOption(options, 'path'),
        userAction: 'approved',
        now: options.now
      }, {projectDir}));
    } else if (command === 'validate') {
      const state = JSON.parse(await readFile(path.join(path.resolve(requireOption(options, 'project-dir')), 'state.json'), 'utf8'));
      result = validateProjectState(state);
    } else if (command === 'migrate') {
      result = await migrateLegacyProject({
        sourceDir: requireOption(options, 'source-dir'),
        destinationDir: requireOption(options, 'destination-dir')
      });
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
