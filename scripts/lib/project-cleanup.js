import {readdir, rmdir, unlink} from 'node:fs/promises';
import path from 'node:path';

import {assertProjectPath, projectPaths} from './project-layout.js';

const TEMPORARY = name => name.startsWith('~$')
  || name.endsWith('.inspect.ndjson')
  || name.endsWith('.preview.png')
  || name.endsWith('.preview.webp');

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, {withFileTypes: true});
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

async function removeEmpty(directory, stop) {
  let entries;
  try {
    entries = await readdir(directory, {withFileTypes: true});
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) if (entry.isDirectory()) await removeEmpty(path.join(directory, entry.name), stop);
  if (directory !== stop && (await readdir(directory)).length === 0) await rmdir(directory);
}

export async function cleanupAfterApproval(projectDir, {candidatePaths = [], keepPath = null} = {}) {
  const {root, studio, work} = projectPaths(projectDir);
  const kept = keepPath ? assertProjectPath(root, keepPath) : null;
  const removed = [];
  for (const relativePath of candidatePaths) {
    const absolute = assertProjectPath(root, relativePath);
    if (absolute !== kept && absolute.startsWith(`${work}${path.sep}`)) {
      await unlink(absolute).catch(error => { if (error.code !== 'ENOENT') throw error; });
      removed.push(relativePath.replaceAll('\\', '/'));
    }
  }
  const preserved = [];
  for (const absolute of await walk(work)) {
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    if (TEMPORARY(path.basename(absolute))) {
      await unlink(absolute);
      removed.push(relative);
    } else preserved.push(relative);
  }
  await removeEmpty(work, studio);
  return {removed: [...new Set(removed)].sort(), preserved_unknown: preserved.sort()};
}
