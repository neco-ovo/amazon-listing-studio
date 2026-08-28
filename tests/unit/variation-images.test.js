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

test('retains an immutable complete Child tuple and semantic fact snapshot', () => {
  const child = {
    sku: 'HORSE-12X16-M200',
    variation_values: {size_name: '12 x 16 in', pattern_name: 'Horse Crossing', model_name: 'M-200'},
    facts: {
      material: {value: 'aluminum', status: 'user_confirmed', publishable: true, conflicts: []},
      finish: 'matte'
    }
  };
  const brief = compileVariationImageBrief({
    scope: {type: 'child_specific', child_skus: ['HORSE-12X16-M200']},
    child,
    family,
    master,
    layoutSeed: null,
    userRequest: {},
    claims: {}
  });

  assert.deepEqual(brief.variation_binding.variation_values, child.variation_values);
  assert.deepEqual(brief.variation_binding.child_facts, {material: 'aluminum', finish: 'matte'});
  assert.equal(Object.isFrozen(brief.variation_binding.variation_values), true);
  assert.equal(Object.isFrozen(brief.variation_binding.child_facts), true);
});

test('binds and validates the compiled target orientation over the master orientation', () => {
  const brief = compileVariationImageBrief({
    scope: {type: 'child_specific', child_skus: ['HORSE-12X16']},
    child: horseChild,
    family,
    master,
    layoutSeed: null,
    userRequest: {target_orientation: 'portrait'},
    claims: {}
  });

  assert.equal(brief.output.target_orientation, 'portrait');
  assert.equal(brief.variation_binding.required_visible.orientation, 'portrait');
  assert.equal(validateVariationImageObservation({
    brief,
    observation: {
      visible_text: ['HORSE CROSSING'],
      pattern_name: 'Horse Crossing',
      size_name: '12 x 16 in',
      orientation: 'portrait'
    }
  }).ok, true);
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

test('rejects sibling wording or complete tuple values even when target wording is also visible', () => {
  const familyWithSiblings = {
    ...family,
    children: {
      'HORSE-12X16': horseChild,
      'KIDS-12X16': {
        sku: 'KIDS-12X16',
        active: true,
        variation_values: {size_name: '12', pattern_name: 'Kids at Play', model_name: 'KIDS-200'},
        product_master: {printed_copy: ['KIDS AT PLAY']}
      }
    }
  };
  const brief = compileVariationImageBrief({
    scope: {type: 'child_specific', child_skus: ['HORSE-12X16']},
    child: horseChild,
    family: familyWithSiblings,
    master,
    layoutSeed: null,
    userRequest: {},
    claims: {}
  });
  const baseObservation = {
    pattern_name: 'Horse Crossing',
    size_name: '12 x 16 in',
    orientation: 'landscape'
  };

  for (const visibleText of [['HORSE CROSSING', 'KIDS AT PLAY'], ['HORSE CROSSING', 'KIDS-200']]) {
    const result = validateVariationImageObservation({brief, observation: {...baseObservation, visible_text: visibleText}});
    assert.equal(result.ok, false);
    assert.ok(result.failures.some(item => item.code === 'CROSS_CHILD_CONTAMINATION'));
  }

  assert.equal(validateVariationImageObservation({
    brief,
    observation: {...baseObservation, visible_text: ['HORSE CROSSING']}
  }).ok, true);
});

test('rejects foreign residual wording when a sibling phrase extends the bound Child wording', () => {
  const familyWithExtendedSiblingWording = {
    ...family,
    children: {
      'HORSE-12X16': horseChild,
      'KIDS-12X16': {
        sku: 'KIDS-12X16',
        active: true,
        variation_values: {},
        product_master: {printed_copy: ['HORSE CROSSING - KIDS AT PLAY']}
      }
    }
  };
  const brief = compileVariationImageBrief({
    scope: {type: 'child_specific', child_skus: ['HORSE-12X16']},
    child: horseChild,
    family: familyWithExtendedSiblingWording,
    master,
    layoutSeed: null,
    userRequest: {},
    claims: {}
  });

  const result = validateVariationImageObservation({
    brief,
    observation: {
      visible_text: ['HORSE CROSSING', 'HORSE CROSSING - KIDS AT PLAY'],
      pattern_name: 'Horse Crossing',
      size_name: '12 x 16 in',
      orientation: 'landscape'
    }
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some(item => item.code === 'CROSS_CHILD_CONTAMINATION' && item.actual === 'KIDS AT PLAY'));
});

test('does not treat a wholly contained sibling phrase as foreign wording', () => {
  const redMaster = {...master, printed_copy: ['DARK RED']};
  const redChild = {
    sku: 'DARK-RED',
    variation_values: {color_name: 'Dark Red'},
    facts: {}
  };
  const brief = compileVariationImageBrief({
    scope: {type: 'child_specific', child_skus: ['DARK-RED']},
    child: redChild,
    family: {
      ...family,
      children: {
        'DARK-RED': redChild,
        RED: {sku: 'RED', active: true, variation_values: {}, product_master: {printed_copy: ['RED']}}
      }
    },
    master: redMaster,
    layoutSeed: null,
    userRequest: {},
    claims: {}
  });

  assert.equal(validateVariationImageObservation({
    brief,
    observation: {visible_text: ['DARK RED'], color_name: 'Dark Red', orientation: 'landscape'}
  }).ok, true);
});

test('removes every protected target phrase before retaining foreign sibling wording', () => {
  const sibling = {
    sku: 'KIDS-12X16',
    active: true,
    variation_values: {},
    product_master: {
      printed_copy: [
        'HORSE CROSSING + 12x16 + KIDS AT PLAY',
        'HORSE CROSSING + 12x16'
      ]
    }
  };
  const brief = compileVariationImageBrief({
    scope: {type: 'child_specific', child_skus: ['HORSE-12X16']},
    child: horseChild,
    family: {...family, children: {'HORSE-12X16': horseChild, 'KIDS-12X16': sibling}},
    master,
    layoutSeed: null,
    userRequest: {},
    claims: {}
  });

  const result = validateVariationImageObservation({
    brief,
    observation: {
      visible_text: ['HORSE CROSSING', '12 x 16 in', 'KIDS AT PLAY'],
      pattern_name: 'Horse Crossing',
      size_name: '12 x 16 in',
      orientation: 'landscape'
    }
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some(item => (
    item.code === 'CROSS_CHILD_CONTAMINATION' && item.actual === 'KIDS AT PLAY'
  )));
  assert.equal(brief.variation_binding.forbidden_sibling_visible.printed_wording.includes('HORSE CROSSING 12x16'), false);
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

test('requires factual dependencies before a shared or subset asset is applicable', () => {
  for (const asset of [{scope: 'shared_asset'}, {scope: 'subset_shared', child_skus: ['HORSE-12X16']}]) {
    const result = evaluateSharedAssetApplicability({
      asset,
      child: horseChild,
      commonFacts: {material: 'aluminum'}
    });
    assert.equal(result.applicable, false);
    assert.ok(result.reasons.includes('MISSING_FACT_DEPENDENCIES'));
  }
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

test('treats multiplication signs and unit aliases as the same visible size', () => {
  const result = validateVariationImageObservation({
    brief: horseBrief(),
    observation: {
      visible_text: ['HORSE CROSSING'],
      pattern_name: 'Horse Crossing',
      size_name: '12 × 16 INCHES',
      orientation: 'landscape'
    }
  });

  assert.equal(result.ok, true);
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
