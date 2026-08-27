import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {runCli} from '../../scripts/studio.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

async function project(root, mode) {
  const projectDir = path.join(root, mode);
  await mkdir(projectDir, {recursive: true});
  const finalApproval = {
    id: 'approval-variation-final-v1', finalized: true, scope_type: 'variation_final',
    variation_version: 1, scope_sha256: 'a'.repeat(64)
  };
  await writeFile(path.join(projectDir, 'state.json'), JSON.stringify({
    schema_version: 2,
    project: {mode},
    ...(mode === 'variation_family' ? {
      variation: {versions: [{
        version: 1, status: 'approved', approval_id: finalApproval.id,
        scope_sha256: finalApproval.scope_sha256
      }]},
      approvals: [finalApproval]
    } : {})
  }));
  const approvalPath = path.join(projectDir, 'approval.json');
  await writeFile(approvalPath, JSON.stringify(finalApproval));
  return {projectDir, approvalPath, finalApproval};
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
    const {projectDir, finalApproval} = await project(root, 'variation_family');
    const deliveryDir = path.join(root, 'delivery');
    await mkdir(deliveryDir);
    await writeFile(path.join(deliveryDir, 'delivery-manifest.json'), JSON.stringify({
      schema_version: 1, delivery_kind: 'variation'
    }));
    let variationCalls = 0;
    let legacyCalls = 0;
    let variationInput;
    const result = await runCli([
      'verify-delivery', '--delivery-dir', deliveryDir, '--project-dir', projectDir
    ], {
      verifyVariation: async input => { variationCalls += 1; variationInput = input; return {ok: true}; },
      verifyV2: async () => { legacyCalls += 1; return {ok: true}; }
    });
    assert.equal(result.ok, true);
    assert.equal(variationCalls, 1);
    assert.equal(legacyCalls, 0);
    assert.deepEqual(variationInput.expectedScope, finalApproval);
  });
});

test('Variation verify-delivery fails closed without a trusted project scope', async () => {
  await withTempWorkspace(async root => {
    const deliveryDir = path.join(root, 'delivery');
    await mkdir(deliveryDir);
    await writeFile(path.join(deliveryDir, 'delivery-manifest.json'), JSON.stringify({
      schema_version: 1, delivery_kind: 'variation'
    }));
    let calls = 0;
    const result = await runCli(['verify-delivery', '--delivery-dir', deliveryDir], {
      verifyVariation: async () => { calls += 1; return {ok: true}; }
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'BLOCKING_INPUT');
    assert.match(result.message, /project-dir.+trusted|trusted.+project/i);
    assert.equal(calls, 0);
  });
});
