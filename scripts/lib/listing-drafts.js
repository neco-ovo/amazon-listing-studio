import { createHash } from 'node:crypto';
import { fail } from './errors.js';

const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function cleanDraftContent(listing) {
  const content = structuredClone(listing ?? {});
  for (const field of ['version', 'status', 'approval_id', 'approved_at', 'json_sha256', 'markdown_sha256']) {
    delete content[field];
  }
  return content;
}

export function createDraft(state, listing, {now = new Date().toISOString()} = {}) {
  if (!state?.listing || !Array.isArray(state.listing.approved)) {
    fail('BLOCKING_INPUT', 'Project listing state is invalid');
  }
  const next = structuredClone(state);
  next.listing.draft = {
    revision: 1,
    content: cleanDraftContent(listing),
    created_at: now,
    updated_at: now,
    changed_fields: []
  };
  next.project.updated_at = now;
  return next;
}

function parsePath(fieldPath) {
  if (typeof fieldPath !== 'string' || !fieldPath.trim()) fail('BLOCKING_INPUT', 'Revision field path is required');
  const parts = fieldPath.split('.');
  if (parts.some(part => !part || FORBIDDEN_PATH_PARTS.has(part))) {
    fail('BLOCKING_INPUT', 'Revision field path is invalid', {field: fieldPath});
  }
  return parts;
}

function setExistingPath(root, fieldPath, value) {
  const parts = parsePath(fieldPath);
  let target = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = Array.isArray(target) ? Number(parts[index]) : parts[index];
    if ((Array.isArray(target) && !Number.isInteger(part)) || !Object.hasOwn(target, part)) {
      fail('BLOCKING_INPUT', 'Revision targets an unknown field', {field: fieldPath});
    }
    target = target[part];
    if (target === null || typeof target !== 'object') {
      fail('BLOCKING_INPUT', 'Revision targets an unknown field', {field: fieldPath});
    }
  }
  const last = Array.isArray(target) ? Number(parts.at(-1)) : parts.at(-1);
  if ((Array.isArray(target) && !Number.isInteger(last)) || !Object.hasOwn(target, last)) {
    fail('BLOCKING_INPUT', 'Revision targets an unknown field', {field: fieldPath});
  }
  target[last] = structuredClone(value);
}

export function reviseDraft(state, patch, {now = new Date().toISOString()} = {}) {
  const draft = state?.listing?.draft;
  if (!draft) fail('BLOCKING_INPUT', 'A working Listing draft is required');
  if (patch?.expectedDraftRevision !== draft.revision) {
    fail('STALE_DEPENDENCY', 'Listing draft revision has changed', {
      expected: patch?.expectedDraftRevision ?? null,
      actual: draft.revision
    });
  }
  const fields = patch?.fields;
  if (!fields || Array.isArray(fields) || Object.keys(fields).length === 0) {
    fail('BLOCKING_INPUT', 'At least one Listing field revision is required');
  }

  const next = structuredClone(state);
  for (const [fieldPath, value] of Object.entries(fields)) {
    setExistingPath(next.listing.draft.content, fieldPath, value);
  }
  next.listing.draft.revision += 1;
  next.listing.draft.updated_at = now;
  next.listing.draft.changed_fields = Object.keys(fields);
  next.project.updated_at = now;
  return next;
}

function bulletLine(bullet) {
  if (typeof bullet === 'string') return bullet;
  const heading = String(bullet?.heading ?? '').trim();
  const body = String(bullet?.body ?? '').trim();
  return heading ? `**${heading}** — ${body}` : body;
}

export function renderListing(draft) {
  const listing = draft?.content ?? draft;
  if (!listing || typeof listing !== 'object') fail('BLOCKING_INPUT', 'Listing content is required');
  const bullets = (listing.bullets ?? []).map(item => `- ${bulletLine(item)}`).join('\n');
  const features = (listing.special_features ?? []).map(item => `- ${item}`).join('\n');
  const attributes = Object.entries(listing.attributes ?? {}).map(([key, value]) => `- ${key}: ${value}`).join('\n');
  return `# ${listing.title ?? ''}\n\n` +
    `## Item Highlights\n\n${listing.item_highlights ?? ''}\n\n` +
    `## Key Product Features\n\n${bullets}\n\n` +
    `## Description\n\n${listing.description ?? ''}\n\n` +
    `## Backend Search Terms\n\n${listing.backend_search_terms ?? ''}\n\n` +
    `## Special Features\n\n${features}\n\n` +
    `## Product Details\n\n${attributes}\n`;
}

export function approveDraft(state, approval) {
  if (approval?.userAction !== 'approved') fail('BLOCKING_INPUT', 'Explicit approved user action is required');
  const draft = state?.listing?.draft;
  if (!draft) fail('BLOCKING_INPUT', 'A working Listing draft is required');
  const now = approval.now ?? new Date().toISOString();
  const version = (state.listing.approved.at(-1)?.version ?? 0) + 1;
  const content = {...structuredClone(draft.content), version};
  const jsonText = `${JSON.stringify(content, null, 2)}\n`;
  const markdownText = renderListing(content);
  const approvalId = `approval-listing-v${version}-${now.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  if (state.approvals.some(item => item.id === approvalId)) {
    fail('BLOCKING_INPUT', 'Approval ID already exists', {approval_id: approvalId});
  }

  const snapshot = {
    id: `listing-v${version}`,
    version,
    status: 'approved',
    approval_id: approvalId,
    approved_at: now,
    draft_revision: draft.revision,
    content,
    json_sha256: hashText(jsonText),
    markdown_sha256: hashText(markdownText)
  };
  const next = structuredClone(state);
  next.listing.approved.push(snapshot);
  next.listing.draft = null;
  next.approvals.push({
    id: approvalId,
    type: 'listing',
    artifact_id: snapshot.id,
    listing_version: version,
    product_master_version: content.product_master_version ?? null,
    json_sha256: snapshot.json_sha256,
    markdown_sha256: snapshot.markdown_sha256,
    approved_at: now,
    user_action: approval.userAction
  });
  next.project.updated_at = now;
  return next;
}
