import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOperation, validationPlan } from '../../scripts/lib/operations.js';

for (const [kind, mode] of [
  ['listing_field_edit', 'fast'],
  ['image_presentation_edit', 'fast'],
  ['approve_asset', 'fast'],
  ['knowledge_lookup', 'fast'],
  ['product_identity_change', 'full'],
  ['marketplace_change', 'full'],
  ['first_listing_draft', 'full'],
  ['finalize', 'full']
]) {
  test(`${kind} routes to ${mode}`, () => {
    const result = classifyOperation({kind});
    assert.equal(result.mode, mode);
    assert.ok(result.reasons.length > 0);
  });
}

test('unknown operations fail closed to full mode', () => {
  assert.deepEqual(classifyOperation({kind: 'mystery'}), {
    mode: 'full',
    reasons: ['UNKNOWN_OPERATION']
  });
});

test('routes local Child changes without widening the workflow', () => {
  for (const kind of ['add_child', 'child_listing_field_edit', 'remove_child']) {
    assert.equal(classifyOperation({kind}).mode, 'fast');
  }
  assert.deepEqual(classifyOperation({kind: 'child_fact_change'}), {
    mode: 'full', reasons: ['CHILD_FACT_DEPENDENCIES']
  });
  assert.equal(classifyOperation({kind: 'variation_theme_change'}).mode, 'full');
});

test('micro copy validation excludes network, image, and repository checks', () => {
  const plan = validationPlan({
    operation: {kind: 'listing_field_edit'},
    changedPaths: ['bullets.3.body']
  });

  assert.deepEqual(plan, {
    scope: 'changed',
    changed_paths: ['bullets.3.body'],
    checks: ['listing.changed-field', 'listing.fact-links', 'listing.affected-keywords']
  });
});

test('artifact approval and final delivery receive progressively wider checks', () => {
  assert.deepEqual(validationPlan({operation: {kind: 'approve_asset'}}).scope, 'artifact');
  assert.deepEqual(validationPlan({operation: {kind: 'finalize'}}).scope, 'final');
});
