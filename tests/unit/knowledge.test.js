import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  applyFamilyClaimConfirmation,
  evaluateFamilyClaims,
  loadKnowledge,
  matchSellerFamily,
  mergeKnowledge
} from '../../scripts/lib/knowledge.js';

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/knowledge');

test('category claims remain observations while family facts are publishable', async () => {
  const loaded = await loadKnowledge({
    libraryDir: fixtureRoot,
    marketplace: 'amazon.com',
    categoryId: 'safety-signs',
    familyId: 'aluminum-signs'
  });
  const merged = mergeKnowledge({
    category: loaded.category,
    family: loaded.family,
    projectFacts: {
      reflective: {value: false, status: 'user_confirmed', source_ids: ['user-project-1']}
    }
  });

  assert.equal(merged.weatherproof.publishable, false);
  assert.equal(merged.weatherproof.authority, 'category');
  assert.equal(merged.rust_resistant.publishable, true);
  assert.equal(merged.rust_resistant.authority, 'seller_family');
  assert.equal(merged.reflective.value, false);
  assert.equal(merged.reflective.authority, 'project');
  assert.deepEqual(loaded.marketLanguage, ['jobsite', 'PPE area', 'construction site']);
});

test('rejects a seller-family file without explicit confirmation scope', () => {
  assert.throws(
    () => mergeKnowledge({
      category: null,
      family: {
        family_id: 'unsafe',
        confirmed_by: 'user',
        confirmed_at: '2026-08-24T00:00:00.000Z',
        facts: {waterproof: {value: true}}
      },
      projectFacts: {}
    }),
    error => error.code === 'BLOCKING_INPUT' && /scope/i.test(error.message)
  );
});

const broadAluminumFamily = {
  family_id: 'aluminum-signs',
  match: {
    required_traits: {
      material: ['aluminum'],
      product_form: ['rigid_sign', 'metal_sign', 'aluminum_plate_sign']
    },
    category_hints: ['yard_sign', 'store_sign', 'safety_sign'],
    excluded_traits: {
      material: ['corrugated_plastic', 'vinyl'],
      product_form: ['decal', 'digital_sign']
    }
  },
  facts: {
    rust_resistant: {value: true, inheritance: 'structural'},
    fade_resistant: {value: true, inheritance: 'process'},
    reflective: {value: true, inheritance: 'process'}
  },
  marketing_expressions: {
    color_stays_bright: {
      text: 'COLOR STAYS BRIGHT',
      related_fact_ids: ['fade_resistant'],
      allowed_scopes: ['image', 'bullet', 'description'],
      non_derivable_facts: ['ink_chemistry', 'service_life'],
      status: 'confirmation_required'
    }
  }
};

test('matches one aluminum sign family across yard and store categories', () => {
  const yard = matchSellerFamily(broadAluminumFamily, {
    material: 'Aluminum', product_form: 'rigid sign', amazon_category: 'yard sign'
  });
  const store = matchSellerFamily(broadAluminumFamily, {
    material: 'aluminum', product_form: 'metal sign', amazon_category: 'store sign'
  });
  const plastic = matchSellerFamily(broadAluminumFamily, {
    material: 'corrugated plastic', product_form: 'rigid sign', amazon_category: 'yard sign'
  });

  assert.equal(yard.status, 'matched');
  assert.equal(store.status, 'matched');
  assert.equal(yard.family_id, store.family_id);
  assert.equal(plastic.status, 'not_matched');
});

test('knowledge loading automatically selects a matching family across Amazon categories', async () => {
  const loaded = await loadKnowledge({
    libraryDir: fixtureRoot,
    marketplace: 'amazon.com',
    categoryId: 'safety-signs',
    candidateTraits: {
      material: 'aluminum', product_form: 'rigid sign', amazon_category: 'yard sign'
    }
  });

  assert.equal(loaded.family.family_id, 'aluminum-signs');
  assert.equal(loaded.familyMatch.status, 'matched');
  assert.equal(loaded.familyMatch.category_hint_matched, true);
});

test('inherits structural claims and asks one consolidated process question', () => {
  const result = evaluateFamilyClaims({
    family: broadAluminumFamily,
    candidateFacts: {material: 'aluminum', product_form: 'rigid_sign'},
    projectFacts: {}
  });

  assert.deepEqual(Object.keys(result.inherited), ['rust_resistant']);
  assert.deepEqual(
    result.confirmation_required.filter(item => item.kind === 'fact').map(item => item.fact_id),
    ['fade_resistant', 'reflective']
  );
  assert.equal(result.questions.length, 1);
  assert.match(result.questions[0], /fade-resistant/i);
  assert.match(result.questions[0], /reflective/i);
});

test('merge does not publish process-dependent claims before applicability confirmation', () => {
  const family = {
    ...structuredClone(broadAluminumFamily),
    scope: {product_family: 'aluminum signs'},
    confirmed_at: '2026-08-24T00:00:00.000Z',
    confirmed_by: 'user'
  };
  const merged = mergeKnowledge({family, projectFacts: {}});
  assert.equal(merged.rust_resistant.publishable, true);
  assert.equal(merged.fade_resistant, undefined);
  assert.equal(merged.reflective, undefined);
});

test('records process confirmation at project or seller-family scope', () => {
  const project = applyFamilyClaimConfirmation({
    family: broadAluminumFamily,
    factIds: ['fade_resistant', 'reflective'],
    confirmed: true,
    scope: 'project',
    projectFacts: {},
    now: '2026-08-25T08:00:00.000Z'
  });
  assert.equal(project.projectFacts.fade_resistant.status, 'user_confirmed');
  assert.equal(project.projectFacts.reflective.authority, 'project');
  assert.equal(project.family.facts.fade_resistant.inheritance, 'process');

  const family = applyFamilyClaimConfirmation({
    family: broadAluminumFamily,
    factIds: ['fade_resistant'],
    confirmed: true,
    scope: 'seller_family',
    projectFacts: {},
    now: '2026-08-25T08:00:00.000Z'
  });
  assert.equal(family.family.facts.fade_resistant.inheritance, 'family_confirmed');
  assert.equal(family.family.facts.fade_resistant.applicability_confirmed_at, '2026-08-25T08:00:00.000Z');
});

test('asks once for process claims and related marketing expressions', () => {
  const result = evaluateFamilyClaims({
    family: broadAluminumFamily,
    candidateFacts: {material: 'aluminum', product_form: 'rigid_sign'},
    projectFacts: {},
    projectExpressions: {}
  });

  assert.equal(result.questions.length, 1);
  assert.deepEqual(result.confirmation_required.map(item => item.kind), ['fact', 'fact', 'expression']);
  assert.equal(result.marketing_expressions.color_stays_bright.status, 'confirmation_required');
});

test('declined competitor expression remains observation-only and never becomes a fact', () => {
  const result = applyFamilyClaimConfirmation({
    family: broadAluminumFamily,
    factIds: [],
    expressionIds: ['color_stays_bright'],
    confirmed: false,
    scope: 'project',
    projectFacts: {},
    projectExpressions: {},
    now: '2026-08-25T08:00:00.000Z'
  });

  assert.equal(result.projectExpressions.color_stays_bright.status, 'market_observation');
  assert.equal(result.projectExpressions.color_stays_bright.publishable, false);
  assert.equal(result.projectFacts.color_stays_bright, undefined);
});
