import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyChildDifferences,
  computeCommonFacts,
  createVariationExtension,
  selectVariationTheme,
  validateVariationExtension,
  variationTupleKey
} from '../../scripts/lib/variations.js';

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

test('selects only an exact category-permitted compound theme', () => {
  assert.deepEqual(selectVariationTheme({
    allowedThemes: [['size_name'], ['color_name', 'size_name']],
    requestedDimensions: ['color_name', 'size_name']
  }).dimensions, ['color_name', 'size_name']);
  assert.throws(() => selectVariationTheme({
    allowedThemes: [['size_name']], requestedDimensions: ['color_name', 'size_name']
  }), error => error.code === 'BLOCKING_INPUT');
});

test('computes common facts from active Children only', () => {
  const result = computeCommonFacts([
    {active: true, facts: {material: 'aluminum', purpose: 'safety sign', color_name: 'red'}},
    {active: false, facts: {material: 'steel', purpose: 'safety sign'}},
    {active: true, facts: {material: 'aluminum', purpose: 'safety sign', color_name: 'blue'}}
  ]);

  assert.deepEqual(result.common, {material: 'aluminum', purpose: 'safety sign'});
  assert.deepEqual(result.child_only, {color_name: ['blue', 'red']});
  assert.deepEqual(result.conflicts, {});
});

test('uses confirmed publishable record values without treating provenance as a difference', () => {
  const children = [
    {facts: {
      material: {value: 'aluminum', status: 'user_confirmed', publishable: true, sources: ['supplier-a'], dependents: [], conflicts: []},
      size_name: {value: '8 x 12 in', status: 'user_confirmed', publishable: true, sources: ['supplier-a'], dependents: [], conflicts: []}
    }},
    {facts: {
      material: {value: 'aluminum', status: 'user_confirmed', publishable: true, sources: ['supplier-b'], dependents: ['listing-1'], conflicts: []},
      size_name: {value: '12 x 16 in', status: 'user_confirmed', publishable: true, sources: ['supplier-b'], dependents: ['listing-2'], conflicts: []}
    }}
  ];

  assert.deepEqual(computeCommonFacts(children).common, {material: 'aluminum'});
  assert.equal(classifyChildDifferences({children, identityFields: ['material']}).mode, 'light');
});

test('excludes conflicted or unknown record facts from common facts and reports them', () => {
  const result = computeCommonFacts([
    {facts: {material: {value: 'aluminum', status: 'conflicted', publishable: false, sources: ['supplier-a'], conflicts: [{value: 'steel'}]}}},
    {facts: {material: {value: 'aluminum', status: 'user_confirmed', publishable: true, sources: ['supplier-b'], conflicts: []}}},
    {facts: {purpose: {value: 'safety sign', status: 'unknown', publishable: false, sources: [], conflicts: []}}}
  ]);

  assert.deepEqual(result.common, {});
  assert.deepEqual(Object.keys(result.child_only), []);
  assert.equal(result.conflicts.material.length, 1);
  assert.equal(result.conflicts.material[0].status, 'conflicted');
  assert.equal(result.conflicts.purpose[0].status, 'unknown');
});

test('excludes unknown records even when malformed input marks them publishable', () => {
  const result = computeCommonFacts([
    {facts: {material: {value: 'aluminum', status: 'unknown', publishable: true, conflicts: []}}},
    {facts: {material: {value: 'aluminum', status: 'user_confirmed', publishable: true, conflicts: []}}}
  ]);

  assert.deepEqual(result.common, {});
  assert.equal(result.conflicts.material[0].status, 'unknown');
});

test('classifies unresolved high-impact facts as large differences', () => {
  const children = [
    {facts: {warning_semantics: {value: 'horse crossing', status: 'conflicted', publishable: false, conflicts: [{value: 'kids at play'}]}}},
    {facts: {warning_semantics: {value: 'horse crossing', status: 'user_confirmed', publishable: true, conflicts: []}}}
  ];

  const result = classifyChildDifferences({children, identityFields: []});
  assert.equal(result.mode, 'large');
  assert.deepEqual(result.reasons, ['conflict:warning_semantics']);
});

test('classifies unresolved non-variation facts as large without identity fields', () => {
  const children = [
    {facts: {material: {value: 'aluminum', status: 'unknown', publishable: false, conflicts: []}}},
    {facts: {material: {value: 'aluminum', status: 'user_confirmed', publishable: true, conflicts: []}}}
  ];

  const result = classifyChildDifferences({children, identityFields: []});
  assert.equal(result.mode, 'large');
  assert.deepEqual(result.reasons, ['conflict:material']);
});

test('classifies size-only Children as light difference', () => {
  const result = classifyChildDifferences({children: [
    {facts: {material: 'aluminum', purpose: 'safety sign', size_name: '8 x 12 in'}},
    {facts: {material: 'aluminum', purpose: 'safety sign', size_name: '12 x 16 in'}}
  ], identityFields: ['material', 'purpose']});
  assert.equal(result.mode, 'light');
});

test('classifies different warning meaning as large difference and honors override', () => {
  const children = [
    {facts: {material: 'aluminum', warning_semantics: 'horse crossing'}},
    {facts: {material: 'aluminum', warning_semantics: 'kids at play'}}
  ];
  assert.equal(classifyChildDifferences({children, identityFields: ['material']}).mode, 'large');
  assert.equal(classifyChildDifferences({children, identityFields: ['material'], override: 'light'}).mode, 'light');
});
