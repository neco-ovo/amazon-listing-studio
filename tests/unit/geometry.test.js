import assert from 'node:assert/strict';
import test from 'node:test';

import {
  physicalRatio,
  selectCanvas,
  validateRenderedRatio,
} from '../../scripts/lib/geometry.js';

test('physicalRatio preserves the real product orientation', () => {
  assert.equal(physicalRatio({width: 12, length: 8}), 1.5);
  assert.equal(physicalRatio({width: 8, length: 12}), 2 / 3);
  assert.throws(() => physicalRatio({width: 0, length: 8}), /positive/i);
});

test('selectCanvas uses user choice, then category guidance, then Amazon square default', () => {
  assert.deepEqual(
    selectCanvas({user: null, category: null, marketplace: 'amazon.com'}),
    {ratio: '1:1'},
  );
  assert.deepEqual(
    selectCanvas({user: {ratio: '4:5'}, category: {ratio: '3:4'}, marketplace: 'amazon.com'}),
    {ratio: '4:5'},
  );
  assert.deepEqual(
    selectCanvas({user: null, category: {ratio: '3:4'}, marketplace: 'amazon.com'}),
    {ratio: '3:4'},
  );
});

test('validateRenderedRatio keeps physical ratio independent from canvas ratio', () => {
  assert.equal(validateRenderedRatio({
    physicalWidth: 12,
    physicalHeight: 8,
    renderedWidth: 1500,
    renderedHeight: 1000,
    tolerance: 0.01,
  }).ok, true);
  assert.equal(validateRenderedRatio({
    physicalWidth: 12,
    physicalHeight: 8,
    renderedWidth: 1000,
    renderedHeight: 1000,
    tolerance: 0.01,
  }).ok, false);
});
