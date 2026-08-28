import test from 'node:test';
import assert from 'node:assert/strict';
import { compileImageBrief } from '../../scripts/lib/image-briefs.js';

const fixtureInput = {
  kind: 'main',
  master: {
    version: 1,
    status: 'locked',
    identity: {product_type: 'safety sign', shape: 'rounded rectangle', mounting_holes: 4},
    printed_copy: ['DANGER', 'HARD HAT', 'PROTECTION REQUIRED'],
    palette: ['red', 'black', 'white'],
    warning_semantics: 'hard hat required',
    orientation: 'portrait'
  },
  userRequest: {target_orientation: 'portrait', emphasis_fields: ['DANGER']},
  references: {
    product: ['product-front.png'],
    layout: ['layout-example.png'],
    competitor_links: ['https://example.com/competitor']
  },
  claims: {
    rust_resistant: {value: true, publishable: true},
    weatherproof: {value: true, publishable: false}
  },
  galleryItem: {id: 'main-v2', goal: 'Amazon main image'}
};

test('portrait adaptation creates two presentation differences without changing identity', () => {
  const brief = compileImageBrief(fixtureInput);

  assert.deepEqual(brief.identity.printed_copy, fixtureInput.master.printed_copy);
  assert.deepEqual(brief.identity.palette, fixtureInput.master.palette);
  assert.ok(brief.difference_plan.length >= 2);
  assert.equal(brief.text_strategy, 'one_pass_complete');
  assert.equal(brief.source_roles.competitor_links, 'market_data_only');
  assert.deepEqual(brief.permitted_claims, {rust_resistant: true});
});

test('explicit redesign authority marks locked master replacement', () => {
  const brief = compileImageBrief({
    ...fixtureInput,
    userRequest: {allow_identity_redesign: true, change_palette: true, target_orientation: 'portrait'}
  });

  assert.equal(brief.output.requires_new_product_master, true);
  assert.ok(brief.output.authorized_identity_changes.includes('palette'));
});

test('rejects an identity change that the user did not authorize', () => {
  assert.throws(
    () => compileImageBrief({...fixtureInput, userRequest: {change_printed_copy: true}}),
    error => error.code === 'BLOCKING_INPUT' && /identity redesign/i.test(error.message)
  );
});

test('uses traceable typography only when explicitly requested', () => {
  const brief = compileImageBrief({
    ...fixtureInput,
    userRequest: {font_traceability: true, preferred_font_source: 'local'}
  });

  assert.equal(brief.text_strategy, 'deterministic_traceable');
});

test('merchant seed reuse keeps its approved fixed layout without anti-copy changes', () => {
  const brief = compileImageBrief({
    ...fixtureInput,
    layoutSeed: {
      id: 'merchant-sign-front-back',
      reference_role: 'MERCHANT_LAYOUT_SEED',
      reuse_policy: 'FIXED_LAYOUT_ALLOWED'
    }
  });

  assert.equal(brief.layout_seed.id, 'merchant-sign-front-back');
  assert.deepEqual(brief.difference_requirements, []);
});

test('copies a merchant layout seed so callers can safely bind it to a specific Child', () => {
  const layoutSeed = {
    id: 'merchant-sign-front-back',
    reference_role: 'MERCHANT_LAYOUT_SEED',
    reuse_policy: 'FIXED_LAYOUT_ALLOWED'
  };
  const brief = compileImageBrief({...fixtureInput, layoutSeed});
  layoutSeed.id = 'mutated-after-compilation';

  assert.equal(brief.layout_seed.id, 'merchant-sign-front-back');
  assert.deepEqual(brief.difference_requirements, []);
});

test('third-party product design reference keeps differentiation requirements', () => {
  const brief = compileImageBrief({
    ...fixtureInput,
    references: {...fixtureInput.references, product_design: ['competitor-design.png']}
  });

  assert.ok(brief.difference_requirements.length >= 2);
});
