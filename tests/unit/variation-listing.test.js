import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditVariationListings,
  buildChildTitle,
  materializeChildListing
} from '../../scripts/lib/variation-listing.js';

const validParentListing = {
  parent_sku: 'SIGN-PARENT',
  project_id: 'hard-hat-signs',
  version: 1,
  marketplace: 'amazon.com',
  language: 'en-US',
  product_type: 'METAL_SIGN',
  product_master_version: 1,
  title: 'Hard Hat Required Aluminum Safety Sign',
  item_highlights: 'Weather-resistant aluminum safety sign.',
  bullets: [
    {heading: 'CLEAR MESSAGE', body: 'Direct safety message for work areas.'},
    {heading: 'ALUMINUM BUILD', body: 'Lightweight aluminum construction.'}
  ],
  description: 'A clear aluminum sign for workplace safety messaging.',
  backend_search_terms: 'hard hat required safety workplace sign',
  special_features: ['Weather resistant'],
  attributes: {material: 'Aluminum'},
  claim_refs: {title: ['purpose', 'material'], attributes: {material: ['material']}}
};

const variation = {
  parent: {sku: 'SIGN-PARENT'},
  theme: {dimensions: ['size_name']},
  children: {
    'SKU-8X12': {
      sku: 'SKU-8X12',
      active: true,
      variation_values: {size_name: '8 x 12 in'},
      facts: {
        material: {value: 'aluminum', status: 'user_confirmed', publishable: true, conflicts: []},
        size_name: {value: '8 x 12 in', status: 'user_confirmed', publishable: true, conflicts: []},
        graphic: {value: 'blue icon', status: 'user_confirmed', publishable: true, conflicts: []}
      }
    },
    'SKU-12X16': {
      sku: 'SKU-12X16',
      active: true,
      variation_values: {size_name: '12 x 16 in'},
      facts: {
        material: {value: 'aluminum', status: 'user_confirmed', publishable: true, conflicts: []},
        size_name: {value: '12 x 16 in', status: 'user_confirmed', publishable: true, conflicts: []},
        graphic: {value: 'red icon', status: 'user_confirmed', publishable: true, conflicts: []}
      }
    },
    'SKU-INACTIVE': {
      sku: 'SKU-INACTIVE',
      active: false,
      variation_values: {size_name: '18 x 24 in'},
      facts: {material: 'steel', graphic: 'green icon'}
    }
  }
};

function childListing(sku) {
  const child = variation.children[sku];
  return materializeChildListing({
    parentContent: validParentListing,
    childOverrides: {
      title: `Hard Hat Required Aluminum Safety Sign ${child.variation_values.size_name}`,
      attributes: {size_name: child.variation_values.size_name}
    },
    child,
    dimensions: variation.theme.dimensions
  });
}

test('materializes complete Child content from a shared Parent baseline', () => {
  const child = materializeChildListing({
    parentContent: validParentListing,
    childOverrides: {
      title: 'Hard Hat Required Aluminum Sign 12 x 16 Inch',
      attributes: {size_name: '12 x 16 in'},
      claim_refs: {attributes: {size_name: ['size_name']}},
      parent_sku: 'UNTRUSTED-PARENT'
    },
    child: {sku: 'SKU-12X16', variation_values: {size_name: '12 x 16 in'}},
    dimensions: ['size_name']
  });

  assert.equal(child.title, 'Hard Hat Required Aluminum Sign 12 x 16 Inch');
  assert.deepEqual(child.bullets, validParentListing.bullets);
  assert.notEqual(child.bullets, validParentListing.bullets);
  assert.notEqual(child.attributes, validParentListing.attributes);
  assert.deepEqual(child.attributes, {material: 'Aluminum', size_name: '12 x 16 in'});
  assert.deepEqual(child.claim_refs.attributes, {material: ['material'], size_name: ['size_name']});
  assert.equal(child.parent_sku, 'SIGN-PARENT');
  assert.equal(child.child_sku, 'SKU-12X16');
  assert.deepEqual(child.variation_theme, ['size_name']);
  assert.deepEqual(child.variation_values, {size_name: '12 x 16 in'});
});

test('Child title keeps core search identity and required variation values within the limit', () => {
  const title = buildChildTitle({
    coreTerms: ['hard hat required sign'],
    identity: ['aluminum'],
    attributes: ['commercial grade weather resistant finish'],
    variationValues: ['12 x 16 inch'],
    limit: 55
  });

  assert.ok(title.length <= 55);
  assert.match(title, /^Hard Hat Required Sign Aluminum/i);
  assert.match(title, /12 x 16 inch/i);
  assert.doesNotMatch(title, /commercial grade/i);
  assert.equal(title.endsWith(' '), false);
});

test('Child title blocks instead of dropping required identity when the budget is impossible', () => {
  assert.throws(() => buildChildTitle({
    coreTerms: ['hard hat required sign'],
    identity: ['aluminum'],
    attributes: ['weather resistant'],
    variationValues: ['12 x 16 inch'],
    limit: 40
  }), error => error.code === 'BLOCKING_INPUT');
});

test('flags a Parent title containing one Child size', () => {
  const result = auditVariationListings({
    parentContent: {...validParentListing, title: 'Aluminum Safety Sign 12 x 16 Inch'},
    childContents: {'SKU-8X12': childListing('SKU-8X12'), 'SKU-12X16': childListing('SKU-12X16')},
    variation
  });

  assert.equal(result.ok, false);
  assert.ok(result.findings.some(item => item.code === 'PARENT_CHILD_ONLY_ATTRIBUTE' && item.sku === 'SIGN-PARENT'));
  assert.deepEqual(result.affectedSkus, ['SIGN-PARENT']);
});

test('Parent leakage audit uses only supported facts from active Children', () => {
  const factsVariation = structuredClone(variation);
  factsVariation.children['SKU-8X12'].facts.finish = {
    value: 'matte finish', status: 'unknown', publishable: false, conflicts: []
  };
  factsVariation.children['SKU-12X16'].facts.finish = {
    value: 'matte finish', status: 'user_confirmed', publishable: true, conflicts: []
  };
  const result = auditVariationListings({
    parentContent: {...validParentListing, description: 'Aluminum and steel sign with a matte finish.'},
    childContents: {'SKU-8X12': childListing('SKU-8X12'), 'SKU-12X16': childListing('SKU-12X16')},
    variation: factsVariation
  });

  assert.equal(result.findings.some(item => item.code === 'PARENT_CHILD_ONLY_ATTRIBUTE' && /steel|matte/i.test(item.value ?? '')), false);
});

test('blocks Parent facts from an unresolved family fact group and reports the conflict', () => {
  const factsVariation = structuredClone(variation);
  factsVariation.children['SKU-8X12'].facts.material = {
    value: 'aluminum', status: 'unknown', publishable: false, conflicts: []
  };
  const result = auditVariationListings({
    parentContent: validParentListing,
    childContents: {'SKU-8X12': childListing('SKU-8X12'), 'SKU-12X16': childListing('SKU-12X16')},
    variation: factsVariation
  });

  assert.equal(result.ok, false);
  assert.ok(result.findings.some(item => item.code === 'VARIATION_FACT_CONFLICT' && item.field === 'material'));
  assert.ok(result.findings.some(item => item.code === 'PARENT_UNRESOLVED_ATTRIBUTE'
    && item.field === 'material' && item.value === 'aluminum'));
  assert.deepEqual(result.affectedSkus, ['SIGN-PARENT', 'SKU-8X12', 'SKU-12X16']);
});

test('requires complete effective Child content even when tuple metadata is correct', () => {
  const child = variation.children['SKU-8X12'];
  const incomplete = {
    parent_sku: 'SIGN-PARENT',
    child_sku: child.sku,
    variation_theme: ['size_name'],
    variation_values: structuredClone(child.variation_values),
    title: 'Hard Hat Required Aluminum Safety Sign 8 x 12 in',
    attributes: {material: 'Aluminum', size_name: '8 x 12 in'}
  };
  const result = auditVariationListings({
    parentContent: validParentListing,
    childContents: {'SKU-8X12': incomplete, 'SKU-12X16': childListing('SKU-12X16')},
    variation
  });

  for (const path of ['item_highlights', 'bullets', 'description', 'backend_search_terms', 'special_features', 'claim_refs']) {
    assert.ok(result.findings.some(item => item.code === 'MISSING_CHILD_CONTENT'
      && item.sku === 'SKU-8X12' && item.path === path), path);
  }
  assert.deepEqual(result.affectedSkus, ['SKU-8X12']);
});

test('flags missing Child listings and mismatched Child tuples and titles', () => {
  const wrong = childListing('SKU-8X12');
  wrong.variation_values = {size_name: '12 x 16 in'};
  wrong.attributes.size_name = '12 x 16 in';
  wrong.title = 'Hard Hat Required Aluminum Safety Sign 12 x 16 in';
  const result = auditVariationListings({
    parentContent: validParentListing,
    childContents: {'SKU-8X12': wrong},
    variation
  });

  assert.ok(result.findings.some(item => item.code === 'CHILD_VARIATION_TUPLE_MISMATCH' && item.sku === 'SKU-8X12'));
  assert.ok(result.findings.some(item => item.code === 'CHILD_VARIATION_ATTRIBUTE_MISMATCH' && item.sku === 'SKU-8X12'));
  assert.ok(result.findings.some(item => item.code === 'CHILD_TITLE_VARIATION_MISMATCH' && item.sku === 'SKU-8X12'));
  assert.ok(result.findings.some(item => item.code === 'MISSING_CHILD_LISTING' && item.sku === 'SKU-12X16'));
  assert.deepEqual(result.affectedSkus, ['SKU-8X12', 'SKU-12X16']);
});

test('flags a Child title that also contains a sibling variation value', () => {
  const contaminated = childListing('SKU-8X12');
  contaminated.title += ' 12 x 16 in';
  const result = auditVariationListings({
    parentContent: validParentListing,
    childContents: {'SKU-8X12': contaminated, 'SKU-12X16': childListing('SKU-12X16')},
    variation
  });

  assert.ok(result.findings.some(item => item.code === 'CHILD_TITLE_VARIATION_MISMATCH'
    && item.sku === 'SKU-8X12' && item.value === '12 x 16 in'));
});

test('does not treat an overlapping sibling value inside the own complete value as contamination', () => {
  const colorVariation = structuredClone(variation);
  colorVariation.theme.dimensions = ['color_name'];
  colorVariation.children = {
    'SKU-RED': {sku: 'SKU-RED', active: true, variation_values: {color_name: 'Red'}, facts: {color_name: 'Red'}},
    'SKU-DARK-RED': {sku: 'SKU-DARK-RED', active: true, variation_values: {color_name: 'Dark Red'}, facts: {color_name: 'Dark Red'}}
  };
  const makeColorChild = (sku, title) => materializeChildListing({
    parentContent: validParentListing,
    childOverrides: {title, attributes: {color_name: colorVariation.children[sku].variation_values.color_name}},
    child: colorVariation.children[sku],
    dimensions: ['color_name']
  });
  const clean = makeColorChild('SKU-DARK-RED', 'Hard Hat Required Aluminum Safety Sign Dark Red');
  const red = makeColorChild('SKU-RED', 'Hard Hat Required Aluminum Safety Sign Red');

  const cleanResult = auditVariationListings({
    parentContent: validParentListing,
    childContents: {'SKU-RED': red, 'SKU-DARK-RED': clean},
    variation: colorVariation
  });
  assert.equal(cleanResult.findings.some(item => item.code === 'CHILD_TITLE_VARIATION_MISMATCH'
    && item.sku === 'SKU-DARK-RED'), false);

  clean.title += ' Red';
  const contaminatedResult = auditVariationListings({
    parentContent: validParentListing,
    childContents: {'SKU-RED': red, 'SKU-DARK-RED': clean},
    variation: colorVariation
  });
  assert.ok(contaminatedResult.findings.some(item => item.code === 'CHILD_TITLE_VARIATION_MISMATCH'
    && item.sku === 'SKU-DARK-RED' && item.value === 'Red'));
});

test('requires exact ordered tuple keys and exact stored values', async t => {
  await t.test('rejects extra tuple keys', () => {
    const content = childListing('SKU-8X12');
    content.variation_values.extra = 'ignored';
    const result = auditVariationListings({
      parentContent: validParentListing,
      childContents: {'SKU-8X12': content, 'SKU-12X16': childListing('SKU-12X16')},
      variation
    });
    assert.ok(result.findings.some(item => item.code === 'CHILD_VARIATION_TUPLE_MISMATCH'
      && item.sku === 'SKU-8X12'));
  });

  for (const value of ['8 X 12 in', ' 8 x 12 in ']) {
    await t.test(`rejects tuple drift: ${JSON.stringify(value)}`, () => {
      const content = childListing('SKU-8X12');
      content.variation_values.size_name = value;
      const result = auditVariationListings({
        parentContent: validParentListing,
        childContents: {'SKU-8X12': content, 'SKU-12X16': childListing('SKU-12X16')},
        variation
      });
      assert.ok(result.findings.some(item => item.code === 'CHILD_VARIATION_TUPLE_MISMATCH'
        && item.sku === 'SKU-8X12'));
    });
  }
});

test('delegates bounded retail-language audit for Parent and Child content', () => {
  const badChild = childListing('SKU-8X12');
  badChild.description = 'Guaranteed to last forever.';
  const result = auditVariationListings({
    parentContent: validParentListing,
    childContents: {'SKU-8X12': badChild, 'SKU-12X16': childListing('SKU-12X16')},
    variation
  });

  assert.ok(result.findings.some(item => item.code === 'UNSUPPORTED_ABSOLUTE' && item.sku === 'SKU-8X12'));
  assert.deepEqual(result.affectedSkus, ['SKU-8X12']);
});
