import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadKnowledge, mergeKnowledge } from '../../scripts/lib/knowledge.js';

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
