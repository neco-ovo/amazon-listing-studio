import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {runCli} from '../../scripts/studio.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

async function project(root, mode) {
  const projectDir = path.join(root, mode);
  await mkdir(projectDir, {recursive: true});
  await writeFile(path.join(projectDir, 'state.json'), JSON.stringify({
    schema_version: 2,
    project: {mode}
  }));
  const approvalPath = path.join(projectDir, 'approval.json');
  await writeFile(approvalPath, JSON.stringify({
    id: 'approval-variation-final-v1', finalized: true, scope_type: 'variation_final'
  }));
  return {projectDir, approvalPath};
}

test('finalize dispatches Variation projects and forwards a single Child selection', async () => {
  await withTempWorkspace(async root => {
    const {projectDir, approvalPath} = await project(root, 'variation_family');
    let variationInput;
    let legacyCalls = 0;
    const result = await runCli([
      'finalize', '--project-dir', projectDir, '--output', 'delivery/horse-v1',
      '--approval', approvalPath, '--child-sku', 'HORSE-12X16'
    ], {
      buildVariation: async input => { variationInput = input; return {zipPath: 'variation.zip'}; },
      buildV2: async () => { legacyCalls += 1; return {zipPath: 'legacy.zip'}; }
    });

    assert.equal(result.ok, true);
    assert.equal(legacyCalls, 0);
    assert.deepEqual(variationInput.childSkus, ['HORSE-12X16']);
    assert.equal(variationInput.projectDir, projectDir);
    assert.equal(variationInput.outputDir, path.join(projectDir, 'delivery', 'horse-v1'));
  });
});

test('finalize preserves the legacy single-product route', async () => {
  await withTempWorkspace(async root => {
    const {projectDir, approvalPath} = await project(root, 'single_product');
    let legacyCalls = 0;
    let variationCalls = 0;
    const result = await runCli([
      'finalize', '--project-dir', projectDir, '--output', 'delivery/final-v1', '--approval', approvalPath
    ], {
      buildVariation: async () => { variationCalls += 1; return {zipPath: 'variation.zip'}; },
      buildV2: async () => { legacyCalls += 1; return {zipPath: 'legacy.zip'}; }
    });

    assert.equal(result.ok, true);
    assert.equal(legacyCalls, 1);
    assert.equal(variationCalls, 0);
  });
});

test('verify-delivery dispatches by manifest delivery kind', async () => {
  await withTempWorkspace(async root => {
    const deliveryDir = path.join(root, 'delivery');
    await mkdir(deliveryDir);
    await writeFile(path.join(deliveryDir, 'delivery-manifest.json'), JSON.stringify({
      schema_version: 1, delivery_kind: 'variation'
    }));
    let variationCalls = 0;
    let legacyCalls = 0;
    const result = await runCli(['verify-delivery', '--delivery-dir', deliveryDir], {
      verifyVariation: async () => { variationCalls += 1; return {ok: true}; },
      verifyV2: async () => { legacyCalls += 1; return {ok: true}; }
    });
    assert.equal(result.ok, true);
    assert.equal(variationCalls, 1);
    assert.equal(legacyCalls, 0);
  });
});
