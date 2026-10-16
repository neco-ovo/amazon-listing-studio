import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUploadObjectKey,
  deriveUploadSlug,
  preflightUploadObject
} from '../../scripts/lib/upload-names.js';

test('derives a short distinctive upload slug from the stable project id', () => {
  assert.equal(
    deriveUploadSlug('slow-down-kids-pets-at-play-sign-12x16'),
    'slow-kids-pets'
  );
  assert.equal(deriveUploadSlug('danger-hard-hat-sign-12x8'), 'danger-hard-hat');
});

test('builds a flat collision-resistant cloud object name', () => {
  assert.equal(buildUploadObjectKey({
    projectId: 'slow-down-kids-pets-at-play-sign-12x16',
    size: '12 x 16 inch',
    purpose: 'main',
    extension: '.PNG'
  }), 'slow-kids-pets-12x16-main.png');

  assert.equal(buildUploadObjectKey({
    projectId: 'slow-down-kids-pets-at-play-sign-12x16',
    purpose: 'weather'
  }), 'slow-kids-pets-weather.png');
});

test('rejects unrecognized upload purposes instead of inventing unstable names', () => {
  assert.throws(
    () => buildUploadObjectKey({projectId: 'danger-hard-hat-sign', purpose: 'random-card'}),
    error => error.code === 'INVALID_UPLOAD_PURPOSE'
  );
});

test('preflight stops when the upload target cannot be checked', async () => {
  await assert.rejects(
    preflightUploadObject({objectKey: 'danger-hard-hat-12x8-main.png'}),
    error => error.code === 'UPLOAD_TARGET_UNAVAILABLE'
  );
});

test('preflight stops on an existing object until this overwrite is approved', async () => {
  const objectExists = async key => key === 'danger-hard-hat-12x8-main.png';

  await assert.rejects(
    preflightUploadObject({objectKey: 'danger-hard-hat-12x8-main.png', objectExists}),
    error => error.code === 'UPLOAD_COLLISION'
  );

  assert.deepEqual(await preflightUploadObject({
    objectKey: 'danger-hard-hat-12x8-main.png',
    objectExists,
    overwriteApproved: true
  }), {
    object_key: 'danger-hard-hat-12x8-main.png',
    status: 'overwrite_approved'
  });
});

test('preflight permits a new object name without extra approval', async () => {
  assert.deepEqual(await preflightUploadObject({
    objectKey: 'danger-hard-hat-12x8-size.png',
    objectExists: async () => false
  }), {
    object_key: 'danger-hard-hat-12x8-size.png',
    status: 'available'
  });
});
