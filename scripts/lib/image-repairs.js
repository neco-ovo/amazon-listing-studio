const DETERMINISTIC = new Set([
  'OFF_CENTER',
  'DIMENSION_ANCHOR',
  'TEXT_SIZE',
  'LABEL_POSITION',
  'SAFE_CROP',
  'SPACING',
  'VISUAL_BALANCE'
]);

const TARGETED_AI = new Set([
  'LOCAL_PIXEL_DEFECT',
  'TYPOGRAPHY_STYLE',
  'LOCAL_TEXT_RENDER',
  'SCENE_IDENTITY'
]);

const REGENERATE = new Set([
  'WHOLE_COMPOSITION',
  'PRODUCT_IDENTITY',
  'UNUSABLE_BASE'
]);

export function selectRepair({defectCodes = [], candidate = {}, automaticAttempts = 0}) {
  if (Number(automaticAttempts) >= 1) {
    return {action: 'ask_user', reason: 'AUTOMATIC_CORRECTION_LIMIT'};
  }
  const defects = [...new Set(defectCodes)];
  if (defects.length === 0) return {action: 'ask_user', reason: 'NO_DIAGNOSED_DEFECT'};
  if (defects.some(code => !DETERMINISTIC.has(code) && !TARGETED_AI.has(code) && !REGENERATE.has(code))) {
    return {action: 'ask_user', reason: 'UNKNOWN_DEFECT'};
  }
  if (defects.some(code => REGENERATE.has(code))) {
    return {action: 'regenerate', reason: candidate.accepted_base === true ? 'WHOLE_IMAGE_REBUILD_REQUIRED' : 'NO_ACCEPTED_BASE'};
  }
  if (defects.some(code => TARGETED_AI.has(code))) {
    return {action: 'targeted_ai_edit', reason: 'LOCALIZED_GENERATIVE_DEFECT'};
  }
  return {action: 'deterministic_edit', reason: 'PRESENTATION_ONLY_DEFECT'};
}
