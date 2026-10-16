import path from 'node:path';

import {fail} from './errors.js';

const LOW_INFORMATION_TERMS = new Set([
  'a', 'an', 'and', 'at', 'down', 'for', 'in', 'inch', 'inches', 'of', 'play',
  'product', 'sign', 'signage', 'the', 'to', 'with'
]);
const PURPOSES = new Set(['main', 'size', 'weather', 'front-back', 'application']);

function tokens(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\d+(?:[._-]?x[._-]?\d+)(?:[._-]?(?:in|inch|inches))?/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function deriveUploadSlug(projectId) {
  const distinctive = [...new Set(tokens(projectId).filter(term => !LOW_INFORMATION_TERMS.has(term)))];
  if (distinctive.length < 2) {
    fail('INVALID_UPLOAD_SLUG', 'Project id must contain at least two distinctive words for a safe upload name.', {project_id: projectId});
  }
  return distinctive.slice(0, 4).join('-');
}

function normalizeSize(size) {
  if (size == null || String(size).trim() === '') return null;
  const match = String(size).toLowerCase().match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
  if (!match) fail('INVALID_UPLOAD_SIZE', 'Upload size must use a width x height form.', {size});
  return `${match[1]}x${match[2]}`;
}

export function buildUploadObjectKey({projectId, uploadSlug, size, purpose, extension = '.png'} = {}) {
  const slug = uploadSlug ? deriveUploadSlug(uploadSlug) : deriveUploadSlug(projectId);
  const normalizedPurpose = String(purpose ?? '').toLowerCase();
  if (!PURPOSES.has(normalizedPurpose)) {
    fail('INVALID_UPLOAD_PURPOSE', 'Use a stable upload purpose: main, size, weather, front-back, or application.', {purpose});
  }
  const normalizedExtension = path.extname(`file${extension}`).toLowerCase() || '.png';
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(normalizedExtension)) {
    fail('INVALID_UPLOAD_EXTENSION', 'Upload image extension must be png, jpg, jpeg, or webp.', {extension});
  }
  return [slug, normalizeSize(size), normalizedPurpose].filter(Boolean).join('-') + normalizedExtension;
}

export async function preflightUploadObject({objectKey, objectExists, overwriteApproved = false} = {}) {
  if (typeof objectExists !== 'function') {
    fail('UPLOAD_TARGET_UNAVAILABLE', 'Cannot verify the target object name; stop the upload without blocking local delivery.', {object_key: objectKey});
  }
  const exists = await objectExists(objectKey);
  if (exists && !overwriteApproved) {
    fail('UPLOAD_COLLISION', 'The target object already exists; stop and ask the user whether to overwrite this exact object.', {object_key: objectKey});
  }
  return {object_key: objectKey, status: exists ? 'overwrite_approved' : 'available'};
}
