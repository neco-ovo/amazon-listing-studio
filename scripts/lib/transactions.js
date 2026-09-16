import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fail } from './errors.js';
import { validateProjectState } from './project-state.js';
import { approveDraft } from './listing-drafts.js';
import {readProjectState, writeProjectSnapshot} from './project-layout.js';

const SHA256 = /^[a-f0-9]{64}$/i;

function resolveInside(projectDir, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) fail('BLOCKING_INPUT', 'Artifact path must be project-relative');
  const root = path.resolve(projectDir);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    fail('BLOCKING_INPUT', 'Artifact path escapes the project directory', {path: relativePath});
  }
  return resolved;
}

async function defaultHashFile(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export async function hashApprovalFile(relativePath, {
  projectDir,
  hashFile = defaultHashFile
} = {}) {
  if (!relativePath || path.isAbsolute(relativePath)
      || relativePath.replaceAll('\\', '/').split('/').some(part => part === '..')) {
    fail('BLOCKING_INPUT', 'Artifact path must be a safe project-relative path');
  }
  const filePath = projectDir ? resolveInside(projectDir, relativePath) : relativePath;
  const sha256 = String(await hashFile(filePath)).toLowerCase();
  if (!SHA256.test(sha256)) fail('CAPABILITY_FAILURE', 'Hasher did not return a SHA-256 value');
  return sha256;
}

function approvalId(type, artifactId, now) {
  const timestamp = now.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `approval-${type}-${artifactId}-${timestamp}`;
}

export async function approveArtifact(state, input, {
  projectDir,
  hashFile = defaultHashFile
} = {}) {
  if (input?.userAction !== 'approved') fail('BLOCKING_INPUT', 'Explicit approved user action is required');
  if (input.artifactType !== 'image') fail('BLOCKING_INPUT', 'Unsupported artifact type', {artifact_type: input.artifactType});

  const candidate = state.gallery?.assets?.[input.artifactId];
  if (!candidate || candidate.status !== 'candidate' || candidate.inspection_status !== 'pass') {
    fail('BLOCKING_INPUT', 'A passing current image candidate is required', {artifact_id: input.artifactId ?? null});
  }
  const isMain = candidate.kind === 'main';
  if (!isMain && state.product_master?.status !== 'locked') {
    fail('BLOCKING_INPUT', 'Secondary image approval requires a locked Product Master');
  }
  if (candidate.path !== input.path) fail('BLOCKING_INPUT', 'Approval path does not match the presented candidate');
  if (!isMain && candidate.product_master_version !== state.product_master.version) {
    fail('STALE_DEPENDENCY', 'Candidate is not bound to the current Product Master');
  }

  const sha256 = await hashApprovalFile(input.path, {projectDir, hashFile});

  const next = structuredClone(state);
  const id = approvalId('image', input.artifactId, input.now ?? new Date().toISOString());
  if (next.approvals.some(item => item.id === id)) fail('BLOCKING_INPUT', 'Approval ID already exists', {approval_id: id});
  const approvedAt = input.now ?? new Date().toISOString();
  const approval = {
    id,
    type: 'image',
    artifact_id: input.artifactId,
    path: input.path,
    sha256,
    product_master_version: isMain ? 0 : next.product_master.version,
    fact_ids: [...new Set(candidate.fact_ids ?? [])],
    approved_at: approvedAt,
    user_action: input.userAction
  };
  next.gallery.assets[input.artifactId] = {
    ...candidate,
    status: 'approved',
    sha256,
    approval_id: id,
    approved_at: approvedAt
  };
  next.gallery.selected = [...new Set([...next.gallery.selected, input.artifactId])];
  next.gallery.plan = next.gallery.plan.map(item => item.id === input.artifactId ? {...item, status: 'approved'} : item);
  next.approvals.push(approval);
  next.project.updated_at = approvedAt;

  const following = next.gallery.plan.find(item => !['approved', 'rejected', 'not_applicable'].includes(item.status));
  const nextAction = isMain
    ? {kind: 'lock_product_master', approved_main_id: input.artifactId}
    : following
      ? {kind: 'generate_gallery_item', gallery_item_id: following.id}
      : {kind: 'review_listing'};
  return {state: next, approval, next_action: nextAction};
}

export function approveListingDraft(state, input) {
  const next = approveDraft(state, input);
  return {
    state: next,
    approval: next.approvals.at(-1),
    next_action: {kind: 'finalize'}
  };
}

export async function updateProject(projectDir, mutator, {clock = () => Date.now()} = {}) {
  const started = clock();
  const current = await readProjectState(projectDir);
  const mutation = await mutator(structuredClone(current));
  const next = mutation?.state ?? mutation;
  const validation = validateProjectState(next);
  if (!validation.valid) fail('BLOCKING_INPUT', 'Mutation produced an invalid project state', {errors: validation.errors});

  const result = mutation?.state ? {...mutation, state: next} : {state: next};
  result.duration_ms = Math.max(0, clock() - started);
  await writeProjectSnapshot(projectDir, next);
  return result;
}
