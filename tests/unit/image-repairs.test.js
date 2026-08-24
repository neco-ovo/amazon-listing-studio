import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRepair } from '../../scripts/lib/image-repairs.js';

test('centering and dimension geometry choose deterministic repair', () => {
  assert.equal(selectRepair({defectCodes: ['OFF_CENTER'], automaticAttempts: 0}).action, 'deterministic_edit');
  assert.equal(selectRepair({defectCodes: ['DIMENSION_ANCHOR'], automaticAttempts: 0}).action, 'deterministic_edit');
});

test('localized generated pixels choose one targeted AI edit', () => {
  assert.deepEqual(selectRepair({defectCodes: ['LOCAL_PIXEL_DEFECT'], automaticAttempts: 0}), {
    action: 'targeted_ai_edit',
    reason: 'LOCALIZED_GENERATIVE_DEFECT'
  });
});

test('whole-composition failure without an accepted base requires regeneration', () => {
  assert.equal(selectRepair({
    defectCodes: ['WHOLE_COMPOSITION'],
    candidate: {accepted_base: false},
    automaticAttempts: 0
  }).action, 'regenerate');
});

test('a second hidden correction stops for user review', () => {
  assert.equal(selectRepair({
    defectCodes: ['SCENE_IDENTITY'],
    candidate: {accepted_base: false},
    automaticAttempts: 1
  }).action, 'ask_user');
});

test('unknown or empty defect codes stop instead of spending generation', () => {
  assert.equal(selectRepair({defectCodes: [], automaticAttempts: 0}).action, 'ask_user');
  assert.equal(selectRepair({defectCodes: ['MYSTERY_DEFECT'], automaticAttempts: 0}).action, 'ask_user');
});
