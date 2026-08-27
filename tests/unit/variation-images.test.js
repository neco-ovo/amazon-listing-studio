import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileVariationImageBrief,
  evaluateSharedAssetApplicability,
  validateVariationImageObservation
} from '../../scripts/lib/variation-images.js';

const master = {
  version: 1,
  status: 'locked',
  identity: {product_type: 'aluminum sign'},
  printed_copy: ['HORSE CROSSING'],
  palette: ['black', 'yellow'],
  orientation: 'landscape'
};

const family = {
  references: {product: ['horse-sign.png']},
  gallery_item: {id: 'main', goal: 'Amazon main image'}
};

const horseChild = {
  sku: 'HORSE-12X16',
  variation_values: {size_name: '12 x 16 in', pattern_name: 'Horse Crossing'},
  facts: {material: 'aluminum'}
};

function horseBrief() {
  return compileVariationImageBrief({
    scope: {type: 'child_specific', child_skus: ['HORSE-12X16']},
    child: horseChild,
    family,
    master,
    layoutSeed: null,
    userRequest: {},
    claims: {}
  });
}

test('binds a Child main brief to exact visible attributes', () => {
  const brief = horseBrief();

  assert.equal(brief.variation_binding.child_sku, 'HORSE-12X16');
  assert.equal(brief.variation_binding.required_visible.pattern_name, 'Horse Crossing');
  assert.equal(brief.variation_binding.required_visible.size_name, '12 x 16 in');
  assert.equal(brief.variation_binding.required_visible.orientation, 'landscape');
  assert.deepEqual(brief.variation_binding.required_visible.printed_wording, ['HORSE CROSSING']);
  assert.equal(brief.text_strategy, 'one_pass_complete');
});

test('freezes Variation binding data after compiling the brief', () => {
  const brief = horseBrief();

  assert.equal(Object.isFrozen(brief.variation_binding), true);
  assert.equal(Object.isFrozen(brief.variation_binding.required_visible), true);
  assert.throws(() => {
    brief.variation_binding.required_visible.pattern_name = 'Kids at Play';
  }, TypeError);
});

test('unwraps confirmed Child fact records before binding visible attributes', () => {
  const brief = compileVariationImageBrief({
    scope: {type: 'child_specific', child_skus: ['HORSE-12X16']},
    child: {
      sku: 'HORSE-12X16',
      variation_values: {size_name: '12 x 16 in'},
      facts: {pattern_name: {value: 'Horse Crossing', status: 'user_confirmed', publishable: true}}
    },
    family,
    master,
    layoutSeed: null,
    userRequest: {},
    claims: {}
  });

  assert.equal(brief.variation_binding.required_visible.pattern_name, 'Horse Crossing');
  assert.equal(validateVariationImageObservation({
    brief,
    observation: {
      visible_text: ['HORSE CROSSING'],
      pattern_name: 'Horse Crossing',
      size_name: '12 x 16 in',
      orientation: 'landscape'
    }
  }).ok, true);
});

test('rejects another Child pattern in the saved-image observation', () => {
  const result = validateVariationImageObservation({
    brief: horseBrief(),
    observation: {
      visible_text: ['KIDS AT PLAY'],
      pattern_name: 'Kids at Play',
      size_name: '12 x 16 in',
      orientation: 'landscape'
    }
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some(item => item.code === 'CROSS_CHILD_CONTAMINATION'));
});

test('reuses a rigid-aluminum merchant layout without requiring a new family image', () => {
  const result = evaluateSharedAssetApplicability({
    asset: {scope: 'shared_asset', fact_dependencies: {material: 'aluminum'}},
    child: {facts: {material: 'aluminum'}},
    commonFacts: {material: 'aluminum'}
  });

  assert.equal(result.applicable, true);
  assert.deepEqual(result.reasons, []);
});

test('requires explicit Child scope and explicit subset SKU membership', () => {
  assert.throws(
    () => compileVariationImageBrief({
      child: horseChild, family, master, userRequest: {}, claims: {}
    }),
    error => error.code === 'BLOCKING_INPUT'
  );
  assert.throws(
    () => compileVariationImageBrief({
      scope: {type: 'child_specific', child_skus: []}, child: horseChild, family, master, userRequest: {}, claims: {}
    }),
    error => error.code === 'BLOCKING_INPUT'
  );
  assert.throws(
    () => compileVariationImageBrief({
      scope: {type: 'subset_shared'}, child: horseChild, family, master, userRequest: {}, claims: {}
    }),
    error => error.code === 'BLOCKING_INPUT'
  );
  const familyRange = compileVariationImageBrief({
    scope: {type: 'family_range_asset'}, child: null, family, master, userRequest: {}, claims: {}
  });
  assert.equal(familyRange.variation_binding.scope.type, 'family_range_asset');
});

test('does not report visual distortion without an explicit inspection finding', () => {
  const result = validateVariationImageObservation({
    brief: horseBrief(),
    observation: {
      visible_text: ['HORSE CROSSING'],
      pattern_name: 'Horse Crossing',
      size_name: '12 x 16 in',
      orientation: 'landscape',
      rendered_width: 1600,
      rendered_height: 400
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.failures.some(item => item.code === 'VISIBLE_DISTORTION'), false);
});

test('reports visible distortion only from an explicit inspection finding', () => {
  const result = validateVariationImageObservation({
    brief: horseBrief(),
    observation: {
      visible_text: ['HORSE CROSSING'],
      pattern_name: 'Horse Crossing',
      size_name: '12 x 16 in',
      orientation: 'landscape',
      inspection_findings: [{code: 'VISIBLE_DISTORTION', note: 'Sign lettering is visibly stretched.'}]
    }
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some(item => item.code === 'VISIBLE_DISTORTION'));
});

test('limits subset-shared assets to their named Children', () => {
  const result = evaluateSharedAssetApplicability({
    asset: {
      scope: {type: 'subset_shared', child_skus: ['HORSE-12X16']},
      fact_dependencies: {material: 'aluminum'}
    },
    child: {sku: 'KIDS-12X16', facts: {material: 'aluminum'}},
    commonFacts: {material: 'aluminum'}
  });

  assert.equal(result.applicable, false);
  assert.ok(result.reasons.includes('CHILD_OUTSIDE_ASSET_SCOPE'));
});

test('uses a top-level Child list when a subset asset declares string scope', () => {
  const result = evaluateSharedAssetApplicability({
    asset: {
      scope: 'subset_shared',
      child_skus: ['HORSE-12X16'],
      fact_dependencies: {material: 'aluminum'}
    },
    child: horseChild,
    commonFacts: {material: 'aluminum'}
  });

  assert.equal(result.applicable, true);
  assert.deepEqual(result.reasons, []);
});
