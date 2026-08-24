import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

import {
  acceptGeneratedRaster,
  assertCapabilities,
} from '../../scripts/lib/capabilities.js';

const PNG_BYTES = await sharp({create: {width: 2, height: 2, channels: 3, background: '#ffffff'}}).png().toBuffer();

function fakeIo(overrides = {}) {
  return {
    readFile: async () => PNG_BYTES,
    inspectImage: async path => ({ok: true, path, width: 1200, height: 1200}),
    ...overrides,
  };
}

test('assertCapabilities accepts callable required capabilities', () => {
  assert.doesNotThrow(() => assertCapabilities({
    generateImage() {},
    inspectImage() {},
  }, ['generateImage', 'inspectImage']));
});

test('assertCapabilities rejects missing or non-callable capabilities', () => {
  assert.throws(
    () => assertCapabilities({generateImage() {}, inspectImage: true}, ['generateImage', 'inspectImage']),
    error => error.code === 'CAPABILITY_FAILURE'
      && error.details.missing.includes('inspectImage'),
  );
});

test('rejects a prompt-only provider result', async () => {
  await assert.rejects(
    acceptGeneratedRaster({prompt: 'use this prompt'}, fakeIo()),
    error => error.code === 'CAPABILITY_FAILURE' && /prompt-only/i.test(error.message),
  );
});

test('rejects an explicitly unsaved provider result', async () => {
  await assert.rejects(
    acceptGeneratedRaster({path: 'main.png', mediaType: 'image/png', saved: false}, fakeIo()),
    error => error.code === 'CAPABILITY_FAILURE' && /not saved/i.test(error.message),
  );
});

test('rejects a missing saved file', async () => {
  const io = fakeIo({
    readFile: async () => {
      const error = new Error('not found');
      error.code = 'ENOENT';
      throw error;
    },
  });

  await assert.rejects(
    acceptGeneratedRaster({path: 'missing.png', mediaType: 'image/png'}, io),
    error => error.code === 'CAPABILITY_FAILURE' && /read saved image/i.test(error.message),
  );
});

test('rejects zero-byte and corrupt raster files', async t => {
  await t.test('zero bytes', async () => {
    await assert.rejects(
      acceptGeneratedRaster(
        {path: 'empty.png', mediaType: 'image/png'},
        fakeIo({readFile: async () => Buffer.alloc(0)}),
      ),
      error => error.code === 'CAPABILITY_FAILURE' && /empty/i.test(error.message),
    );
  });

  await t.test('corrupt signature', async () => {
    await assert.rejects(
      acceptGeneratedRaster(
        {path: 'corrupt.png', mediaType: 'image/png'},
        fakeIo({readFile: async () => Buffer.from('not a png')}),
      ),
      error => error.code === 'CAPABILITY_FAILURE' && /signature/i.test(error.message),
    );
  });

  await t.test('valid signature but undecodable bytes', async () => {
    const truncated = Buffer.concat([PNG_BYTES.subarray(0, 8), Buffer.from('not-a-real-png')]);
    await assert.rejects(
      acceptGeneratedRaster(
        {path: 'truncated.png', mediaType: 'image/png'},
        fakeIo({readFile: async () => truncated}),
      ),
      error => error.code === 'CAPABILITY_FAILURE' && /decode/i.test(error.message),
    );
  });
});

test('rejects missing, failed, or negative saved-file inspection', async t => {
  await t.test('missing inspection capability', async () => {
    await assert.rejects(
      acceptGeneratedRaster(
        {path: 'main.png', mediaType: 'image/png'},
        {readFile: async () => PNG_BYTES},
      ),
      error => error.code === 'CAPABILITY_FAILURE' && /inspection capability/i.test(error.message),
    );
  });

  await t.test('inspection throws', async () => {
    await assert.rejects(
      acceptGeneratedRaster(
        {path: 'main.png', mediaType: 'image/png'},
        fakeIo({inspectImage: async () => { throw new Error('decoder unavailable'); }}),
      ),
      error => error.code === 'CAPABILITY_FAILURE' && /inspect saved image/i.test(error.message),
    );
  });

  await t.test('inspection is negative', async () => {
    await assert.rejects(
      acceptGeneratedRaster(
        {path: 'main.png', mediaType: 'image/png'},
        fakeIo({inspectImage: async path => ({ok: false, path, reason: 'decode failed'})}),
      ),
      error => error.code === 'CAPABILITY_FAILURE' && /inspection rejected/i.test(error.message),
    );
  });
});

test('accepts a saved PNG only after inspecting the same path', async () => {
  let inspectedPath;
  const inspection = {ok: true, width: 1200, height: 1200};
  const result = await acceptGeneratedRaster(
    {path: 'assets/main/v1.png', mediaType: 'image/png', saved: true},
    fakeIo({
      inspectImage: async path => {
        inspectedPath = path;
        return inspection;
      },
    }),
  );

  assert.equal(inspectedPath, 'assets/main/v1.png');
  assert.deepEqual(result, {
    path: 'assets/main/v1.png',
    mediaType: 'image/png',
    bytes: PNG_BYTES.length,
    width: 2,
    height: 2,
    inspection,
  });
});
