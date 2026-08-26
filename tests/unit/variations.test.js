import test from 'node:test';
import assert from 'node:assert/strict';
import {createVariationExtension, validateVariationExtension, variationTupleKey} from '../../scripts/lib/variations.js';

test('creates a sparse compound Variation without inventing combinations', () => {
  const variation = createVariationExtension({
    parentSku: 'SIGN-PARENT',
    dimensions: ['color_name', 'size_name'],
    firstChildSku: 'SIGN-DEER-12X16',
    firstChildFacts: {color_name: 'Deer Crossing', size_name: '12 x 16 in'},
    now: '2026-08-27T00:00:00.000Z'
  });

  assert.deepEqual(variation.theme.dimensions, ['color_name', 'size_name']);
  assert.deepEqual(Object.keys(variation.children), ['SIGN-DEER-12X16']);
  assert.equal(
    variationTupleKey(variation.theme.dimensions, variation.children['SIGN-DEER-12X16'].variation_values),
    'deer crossing\u001f12 x 16 in'
  );
  assert.equal(validateVariationExtension(variation).valid, true);
});

test('rejects duplicate Child tuples', () => {
  const variation = createVariationExtension({
    parentSku: 'SIGN-PARENT', dimensions: ['size_name'], firstChildSku: 'SKU-A',
    firstChildFacts: {size_name: '12 x 16 in'}
  });
  variation.children['SKU-B'] = structuredClone(variation.children['SKU-A']);
  variation.children['SKU-B'].sku = 'SKU-B';

  assert.match(validateVariationExtension(variation).errors.join('\n'), /duplicate variation tuple/i);
});

test('rejects a variation family with no children', () => {
  const variation = createVariationExtension({
    parentSku: 'SIGN-PARENT', dimensions: ['size_name'], firstChildSku: 'SKU-A',
    firstChildFacts: {size_name: '12 x 16 in'}
  });
  variation.children = {};

  assert.equal(validateVariationExtension(variation).valid, false);
});

test('rejects whitespace-padded child SKU keys', () => {
  const variation = createVariationExtension({
    parentSku: 'SIGN-PARENT', dimensions: ['size_name'], firstChildSku: 'SKU-A',
    firstChildFacts: {size_name: '12 x 16 in'}
  });
  variation.children[' SKU-A '] = variation.children['SKU-A'];
  delete variation.children['SKU-A'];
  variation.children[' SKU-A '].sku = ' SKU-A ';

  assert.equal(validateVariationExtension(variation).valid, false);
});
