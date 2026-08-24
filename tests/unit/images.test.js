import assert from 'node:assert/strict';
import path from 'node:path';
import test, {before} from 'node:test';

import {measureNonWhiteBounds, validateMainImage} from '../../scripts/lib/images.js';
import {createMainImageFixtures} from '../helpers/png-fixtures.js';

const fixtureRoot = path.resolve('tests/fixtures');
let fixtures;

before(async () => {
  fixtures = await createMainImageFixtures(fixtureRoot);
});

test('measureNonWhiteBounds uses white threshold and reports the exact product box', () => {
  const width = 10;
  const height = 10;
  const data = Buffer.alloc(width * height * 3, 255);
  for (let y = 2; y < 8; y += 1) {
    for (let x = 1; x < 9; x += 1) {
      const offset = (y * width + x) * 3;
      data.fill(0, offset, offset + 3);
    }
  }

  assert.deepEqual(measureNonWhiteBounds({data, width, height, channels: 3}), {
    x: 1,
    y: 2,
    width: 8,
    height: 6,
    right: 8,
    bottom: 7,
  });
});

test('validates a white, fully visible, 3:2 product at 96% dominant occupancy', async () => {
  const result = await validateMainImage(fixtures.valid, {
    physicalWidth: 12,
    physicalHeight: 8,
    minOccupancy: 0.95,
  });

  assert.equal(result.ok, true);
  assert.equal(result.width, 1000);
  assert.equal(result.height, 1000);
  assert.equal(result.occupancy, 0.96);
  assert.equal(result.background.ok, true);
  assert.deepEqual(result.failures, []);
});

test('uses Amazon base 85% occupancy unless a category or user sets a stricter target', async () => {
  const amazonBase = await validateMainImage(fixtures.undersized, {
    physicalWidth: 12,
    physicalHeight: 8,
  });
  assert.equal(amazonBase.occupancy, 0.9);
  assert.equal(amazonBase.ok, true);

  const strictSignProject = await validateMainImage(fixtures.undersized, {
    physicalWidth: 12,
    physicalHeight: 8,
    minOccupancy: 0.95,
  });
  assert.equal(strictSignProject.ok, false);
  assert.ok(strictSignProject.failures.some(failure => failure.code === 'LOW_OCCUPANCY' && failure.minimum === 0.95));
});

test('reports stretch, clipping, nonwhite background, and low occupancy without cropping', async t => {
  await t.test('stretched product', async () => {
    const result = await validateMainImage(fixtures.stretched, {
      physicalWidth: 12,
      physicalHeight: 8,
      minOccupancy: 0.95,
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some(failure => failure.code === 'PHYSICAL_RATIO_MISMATCH'));
  });

  await t.test('product crossing an edge', async () => {
    const result = await validateMainImage(fixtures.clipped, {
      physicalWidth: 12,
      physicalHeight: 8,
      minOccupancy: 0.95,
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some(failure => failure.code === 'NOT_FULLY_VISIBLE'));
  });

  await t.test('nonwhite background', async () => {
    const result = await validateMainImage(fixtures.nonwhite, {
      physicalWidth: 12,
      physicalHeight: 8,
      minOccupancy: 0.95,
    });
    assert.equal(result.background.ok, false);
    assert.ok(result.failures.some(failure => failure.code === 'NONWHITE_BACKGROUND'));
  });

  await t.test('less than 95% dominant occupancy', async () => {
    const result = await validateMainImage(fixtures.undersized, {
      physicalWidth: 12,
      physicalHeight: 8,
      minOccupancy: 0.95,
    });
    assert.equal(result.occupancy, 0.9);
    assert.ok(result.failures.some(failure => failure.code === 'LOW_OCCUPANCY'));
  });
});
