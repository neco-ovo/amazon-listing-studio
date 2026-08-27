import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {createProjectState, renderProjectSummary} from '../../scripts/lib/project-state.js';
import {
  addVariationChild,
  removeVariationChild,
  reviseVariationChild
} from '../../scripts/lib/variation-project.js';
import {createVariationExtension} from '../../scripts/lib/variations.js';
import {runCli} from '../../scripts/studio.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const now = '2026-08-27T06:00:00.000Z';
const later = '2026-08-27T07:00:00.000Z';

function fact(value) {
  return {value, status: 'user_confirmed', publishable: true, sources: ['supplier'], conflicts: []};
}

function child({sku, size, title}) {
  return {
    sku,
    active: true,
    variation_values: {size_name: size},
    facts: {material: fact('aluminum'), size_name: fact(size)},
    product_master: {version: 1, status: 'locked', approved_main_id: `${sku}-main`},
    listing: {
      status: 'approved',
      draft: null,
      approved: [{id: `${sku}-listing-v1`, version: 1, status: 'approved', content: {title}}]
    },
    legacy_refs: {},
    history: []
  };
}

function variationState() {
  const first = child({sku: 'SKU-12X16', size: '12 x 16 in', title: 'Safety Sign 12 x 16 in'});
  return {
    schema_version: 2,
    project: {
      product_id: 'sign-family', product_name: 'Safety Sign Family', marketplace: 'amazon.com',
      language: 'en-US', product_type: 'METAL_SIGN', stage: 'listing', mode: 'variation_family', updated_at: now
    },
    facts: {},
    product_master: null,
    gallery: {plan: [], assets: {}, selected: []},
    listing: {draft: null, approved: []},
    approvals: [],
    stale_dependencies: [],
    delivery: null,
    metrics: [],
    variation: {
      schema_version: 1,
      mode: 'variation_family',
      family_identity: {version: 1, status: 'locked', facts: {material: 'aluminum'}, non_merge_boundaries: []},
      theme: {dimensions: ['size_name'], source: {kind: 'category_schema'}, verification_status: 'verified'},
      parent: {
        sku: 'SIGN-PARENT', version: 1, status: 'approved', common_facts: {material: 'aluminum'},
        listing: {status: 'approved', draft: null, approved: [{id: 'parent-listing-v1'}], promoted_fields: ['description']}
      },
      children: {'SKU-12X16': first},
      shared_assets: {
        'material-v1': {
          id: 'material-v1', status: 'approved', scope: 'shared_asset',
          fact_dependencies: {material: 'aluminum'}, applicable_child_skus: ['SKU-12X16'],
          approval_id: 'approval-material-v1'
        }
      },
      versions: [{id: 'family-v1', child_skus: ['SKU-12X16']}],
      updated_at: now
    }
  };
}

test('adding a light-difference Child preserves unrelated approvals', () => {
  const state = variationState();
  const next = addVariationChild(state, {
    sku: 'SKU-8X12',
    variation_values: {size_name: '8 x 12 in'},
    facts: {material: fact('aluminum'), size_name: fact('8 x 12 in')},
    product_master: {version: 9, status: 'locked'},
    listing: {status: 'approved', draft: null, approved: [{id: 'untrusted-approval'}]},
    now: later
  });

  assert.equal(next.variation.children['SKU-12X16'].product_master.status, 'locked');
  assert.equal(next.variation.children['SKU-12X16'].listing.status, 'approved');
  assert.equal(next.variation.parent.status, 'stale');
  assert.equal(next.variation.parent.stale_reason, 'ACTIVE_CHILD_SET_CHANGED');
  assert.deepEqual(next.variation.parent.affected_ids, ['SIGN-PARENT', 'SKU-8X12']);
  assert.deepEqual(next.variation.parent.common_facts, {material: 'aluminum'});
  assert.equal(next.variation.children['SKU-8X12'].product_master, null);
  assert.deepEqual(next.variation.children['SKU-8X12'].listing.approved, []);
  assert.deepEqual(next.variation.shared_asset_applicability['material-v1'].applicable_child_skus, [
    'SKU-12X16', 'SKU-8X12'
  ]);
  assert.deepEqual(next.variation.shared_assets['material-v1'].applicable_child_skus, ['SKU-12X16']);
  assert.deepEqual(next.variation.versions, state.variation.versions);
});

test('adding rejects a reused SKU or active variation tuple', () => {
  const state = variationState();
  for (const input of [
    {sku: 'SKU-12X16', variation_values: {size_name: '8 x 12 in'}, facts: {}},
    {sku: 'SKU-NEW', variation_values: {size_name: '12 X 16 IN'}, facts: {}}
  ]) {
    assert.throws(
      () => addVariationChild(state, {...input, now: later}),
      error => error.code === 'BLOCKING_INPUT'
    );
  }
});

test('adding does not reuse a preserved inactive Child tuple', () => {
  const state = variationState();
  state.variation.children['SKU-12X16'].active = false;
  state.variation.children['SKU-8X12'] = child({
    sku: 'SKU-8X12', size: '8 x 12 in', title: 'Safety Sign 8 x 12 in'
  });

  assert.throws(
    () => addVariationChild(state, {
      sku: 'SKU-NEW', variation_values: {size_name: '12 x 16 in'}, facts: {}, now: later
    }),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('revising one Child title does not stale another Child or the Parent', () => {
  const state = variationState();
  state.variation.children['SKU-8X12'] = child({
    sku: 'SKU-8X12', size: '8 x 12 in', title: 'Safety Sign 8 x 12 in'
  });

  const next = reviseVariationChild(state, {
    sku: 'SKU-8X12', listingPatch: {title: 'Updated Child Title'}, now: later
  });

  assert.equal(next.variation.children['SKU-8X12'].listing.status, 'draft');
  assert.equal(next.variation.children['SKU-8X12'].listing.draft.content.title, 'Updated Child Title');
  assert.equal(next.variation.children['SKU-8X12'].listing.stale_reason, 'CHILD_LISTING_FIELDS_CHANGED');
  assert.deepEqual(next.variation.children['SKU-8X12'].listing.affected_ids, ['SKU-8X12']);
  assert.equal(next.variation.children['SKU-12X16'].listing.status, 'approved');
  assert.equal(next.variation.parent.status, 'approved');
});

test('revising a promoted Parent field marks only the Parent and target Child stale', () => {
  const state = variationState();

  const next = reviseVariationChild(state, {
    sku: 'SKU-12X16', listingPatch: {description: 'Updated common description'}, now: later
  });

  assert.equal(next.variation.parent.status, 'stale');
  assert.equal(next.variation.parent.stale_reason, 'PROMOTED_CHILD_LISTING_FIELD_CHANGED');
  assert.deepEqual(next.variation.parent.affected_ids, ['SIGN-PARENT', 'SKU-12X16']);
  assert.equal(next.variation.children['SKU-12X16'].listing.status, 'draft');
});

test('revising a Child fact invalidates direct dependents and Parent only when common facts change', () => {
  const state = variationState();
  state.variation.children['SKU-8X12'] = child({
    sku: 'SKU-8X12', size: '8 x 12 in', title: 'Safety Sign 8 x 12 in'
  });

  const next = reviseVariationChild(state, {
    sku: 'SKU-8X12', factPatch: {material: fact('steel')}, now: later
  });

  assert.equal(next.variation.children['SKU-8X12'].product_master.status, 'stale');
  assert.equal(next.variation.children['SKU-8X12'].product_master.stale_reason, 'CHILD_FACTS_CHANGED');
  assert.equal(next.variation.children['SKU-8X12'].listing.status, 'stale');
  assert.equal(next.variation.children['SKU-12X16'].product_master.status, 'locked');
  assert.equal(next.variation.children['SKU-12X16'].listing.status, 'approved');
  assert.equal(next.variation.parent.status, 'stale');
  assert.equal(next.variation.parent.stale_reason, 'COMMON_FACTS_CHANGED');
  assert.deepEqual(next.variation.parent.common_facts, {});
});

test('removing a Child retains its record and history while recalculating applicability', () => {
  const state = variationState();
  state.variation.children['SKU-8X12'] = child({
    sku: 'SKU-8X12', size: '8 x 12 in', title: 'Safety Sign 8 x 12 in'
  });

  const next = removeVariationChild(state, {sku: 'SKU-8X12', now: later});

  assert.equal(next.variation.children['SKU-8X12'].active, false);
  assert.equal(next.variation.children['SKU-8X12'].removed_at, later);
  assert.deepEqual(next.variation.children['SKU-8X12'].listing.approved, state.variation.children['SKU-8X12'].listing.approved);
  assert.deepEqual(next.variation.children['SKU-8X12'].history.at(-1), {kind: 'removed', at: later});
  assert.equal(next.variation.children['SKU-12X16'].listing.status, 'approved');
  assert.equal(next.variation.parent.stale_reason, 'ACTIVE_CHILD_SET_CHANGED');
  assert.deepEqual(next.variation.shared_asset_applicability['material-v1'].applicable_child_skus, ['SKU-12X16']);
  assert.deepEqual(next.variation.shared_assets['material-v1'].applicable_child_skus, ['SKU-12X16']);
});

test('JSON-file Child CLI commands persist add, revise, and soft removal', async () => {
  await withTempWorkspace(async projectDir => {
    const state = createProjectState({projectId: 'sign-family', productType: 'METAL_SIGN', now});
    state.project.mode = 'variation_family';
    state.variation = createVariationExtension({
      parentSku: 'SIGN-PARENT', dimensions: ['size_name'], firstChildSku: 'SKU-12X16',
      firstChildFacts: {size_name: '12 x 16 in'}, now
    });
    state.variation.theme.source = {
      kind: 'category_schema', id: 'METAL_SIGN', allowed_themes: [['size_name']]
    };
    state.variation.theme.verification_status = 'verified';
    state.variation.children['SKU-12X16'].facts = {
      material: fact('aluminum'), size_name: fact('12 x 16 in')
    };
    await writeFile(path.join(projectDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));

    const addPath = path.join(projectDir, 'add.json');
    const revisePath = path.join(projectDir, 'revise.json');
    const removePath = path.join(projectDir, 'remove.json');
    await writeFile(addPath, JSON.stringify({
      sku: 'SKU-8X12', variation_values: {size_name: '8 x 12 in'},
      facts: {material: fact('aluminum'), size_name: fact('8 x 12 in')}, now: later
    }));
    await writeFile(revisePath, JSON.stringify({
      sku: 'SKU-8X12', listingPatch: {title: 'Updated Child Title'}, now: later
    }));
    await writeFile(removePath, JSON.stringify({sku: 'SKU-8X12', now: later}));

    const added = await runCli(['add-child', '--project-dir', projectDir, '--input', addPath]);
    const revised = await runCli(['revise-child', '--project-dir', projectDir, '--input', revisePath]);
    const removed = await runCli(['remove-child', '--project-dir', projectDir, '--input', removePath]);

    assert.equal(added.ok, true);
    assert.equal(added.mode, 'fast');
    assert.equal(revised.ok, true);
    assert.equal(revised.mode, 'fast');
    assert.equal(removed.ok, true);
    assert.equal(removed.mode, 'fast');
    const saved = JSON.parse(await readFile(path.join(projectDir, 'state.json'), 'utf8'));
    assert.equal(saved.variation.children['SKU-8X12'].active, false);
    assert.equal(saved.variation.children['SKU-8X12'].listing.draft.content.title, 'Updated Child Title');
  });
});
