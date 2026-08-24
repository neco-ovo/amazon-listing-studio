import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProjectState,
  renderProjectSummary,
  validateProjectState
} from '../../scripts/lib/project-state.js';

const input = {
  projectId: 'sign-1',
  marketplace: 'amazon.com',
  language: 'en-US',
  productType: 'METAL_SIGN',
  now: '2026-08-25T00:00:00.000Z'
};

test('creates one v2 state source and renders only current status', () => {
  const state = createProjectState(input);

  assert.equal(state.schema_version, 2);
  assert.deepEqual(Object.keys(state.facts), []);
  assert.match(renderProjectSummary(state), /Current stage: intake/);
  assert.doesNotMatch(renderProjectSummary(state), /Change history/);
});

test('validates the required v2 project identity and top-level collections', () => {
  assert.deepEqual(validateProjectState(createProjectState(input)), {valid: true, errors: []});

  const invalid = createProjectState(input);
  delete invalid.project.product_id;
  const result = validateProjectState(invalid);

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('project.product_id is required'));
});
