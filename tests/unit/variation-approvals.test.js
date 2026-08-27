import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approveVariationArtifact,
  approveVariationListing,
  approveVariationVersion
} from '../../scripts/lib/variation-approvals.js';
import {materializeChildListing} from '../../scripts/lib/variation-listing.js';

const now = '2026-08-27T08:00:00.000Z';
const hash = character => character.repeat(64);

function fact(value) {
  return {value, status: 'user_confirmed', publishable: true, conflicts: []};
}

const parentContent = {
  parent_sku: 'SIGN-PARENT',
  project_id: 'sign-family',
  marketplace: 'amazon.com',
  language: 'en-US',
  product_type: 'METAL_SIGN',
  title: 'Aluminum Safety Sign',
  item_highlights: 'Weather-resistant aluminum safety sign.',
  bullets: [{heading: 'CLEAR MESSAGE', body: 'Direct safety message for work areas.'}],
  description: 'A clear aluminum sign for workplace safety messaging.',
  backend_search_terms: 'aluminum safety workplace sign',
  special_features: ['Weather resistant'],
  attributes: {material: 'Aluminum'},
  claim_refs: {title: ['material'], attributes: {material: ['material']}},
  rule_status: 'verified',
  rules_unverified: [],
  upload_ready: true
};

function child(sku, color) {
  const size = '12 x 16 in';
  return {
    sku,
    active: true,
    variation_values: {color_name: color, size_name: size},
    facts: {material: fact('aluminum'), color_name: fact(color), size_name: fact(size)},
    product_master: {
      version: 1,
      status: 'locked',
      approved_main_id: `${sku.toLowerCase()}-main`,
      approved_main_path: `children/${sku}/assets/main.png`
    },
    assets: {
      [`${sku.toLowerCase()}-main`]: {
        id: `${sku.toLowerCase()}-main`,
        kind: 'main',
        child_sku: sku,
        status: 'candidate',
        inspection_status: 'pass',
        path: `children/${sku}/assets/main.png`
      }
    },
    listing: {status: 'draft', draft: null, approved: []},
    legacy_refs: {}
  };
}

function variationState() {
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
      family_identity: {version: 1, status: 'locked', facts: {material: fact('aluminum')}, non_merge_boundaries: []},
      theme: {
        dimensions: ['color_name', 'size_name'],
        source: {kind: 'category_schema', id: 'METAL_SIGN', allowed_themes: [['color_name', 'size_name']]},
        verification_status: 'verified'
      },
      parent: {sku: 'SIGN-PARENT', version: 0, status: 'draft', listing: {status: 'draft', draft: null, approved: []}},
      children: {
        'HORSE-12X16': child('HORSE-12X16', 'Horse Crossing'),
        'KIDS-12X16': child('KIDS-12X16', 'Kids at Play')
      },
      shared_assets: {
        'material-v1': {
          id: 'material-v1', kind: 'secondary', status: 'candidate', inspection_status: 'pass',
          scope: 'shared_asset', path: 'family/shared-assets/material.png', fact_dependencies: {material: 'aluminum'}
        }
      },
      versions: [],
      updated_at: now
    }
  };
}

function childContent(state, sku) {
  const childRecord = state.variation.children[sku];
  return materializeChildListing({
    parentContent,
    childOverrides: {
      title: `Aluminum Safety Sign ${childRecord.variation_values.color_name} 12 x 16 Inch`,
      attributes: structuredClone(childRecord.variation_values)
    },
    child: childRecord,
    dimensions: state.variation.theme.dimensions
  });
}

async function fullyApprovedState() {
  let state = variationState();
  state = await approveVariationArtifact(state, {
    artifactId: 'horse-12x16-main', artifactType: 'child_main', childSku: 'HORSE-12X16',
    path: 'children/HORSE-12X16/assets/main.png', userAction: 'approved', now
  }, {hashFile: async () => hash('a')});
  state = await approveVariationArtifact(state, {
    artifactId: 'kids-12x16-main', artifactType: 'child_main', childSku: 'KIDS-12X16',
    path: 'children/KIDS-12X16/assets/main.png', userAction: 'approved', now
  }, {hashFile: async () => hash('b')});
  state = await approveVariationArtifact(state, {
    artifactId: 'material-v1', artifactType: 'shared_image',
    childSkus: ['HORSE-12X16', 'KIDS-12X16'], factDependencies: {material: 'aluminum'},
    path: 'family/shared-assets/material.png', userAction: 'approved', now
  }, {hashFile: async () => hash('c')});
  state = approveVariationListing(state, {
    scopeType: 'parent_listing', content: parentContent, userAction: 'approved', now
  });
  for (const sku of ['HORSE-12X16', 'KIDS-12X16']) {
    state = approveVariationListing(state, {
      scopeType: 'child_listing', childSku: sku, content: childContent(state, sku), userAction: 'approved', now
    });
  }
  return state;
}

test('Child main approval cannot approve another Child', async () => {
  const state = variationState();
  await assert.rejects(
    approveVariationArtifact(state, {
      artifactId: 'horse-12x16-main', artifactType: 'child_main', childSku: 'KIDS-12X16',
      path: 'children/HORSE-12X16/assets/main.png', userAction: 'approved', now
    }, {hashFile: async () => hash('a')}),
    error => error.code === 'BLOCKING_INPUT'
  );
  assert.equal(state.approvals.length, 0);
});

test('Child main approval hashes and freezes the exact Child scope', async () => {
  const state = variationState();
  const next = await approveVariationArtifact(state, {
    artifactId: 'horse-12x16-main', artifactType: 'child_main', childSku: 'HORSE-12X16',
    path: 'children/HORSE-12X16/assets/main.png', userAction: 'approved', now
  }, {hashFile: async path => {
    assert.equal(path, 'children/HORSE-12X16/assets/main.png');
    return hash('a');
  }});

  assert.equal(next.approvals.at(-1).scope_type, 'child_main');
  assert.equal(next.approvals.at(-1).scope_version, 1);
  assert.equal(next.approvals.at(-1).child_sku, 'HORSE-12X16');
  assert.equal(next.approvals.at(-1).sha256, hash('a'));
  assert.equal(next.variation.children['HORSE-12X16'].assets['horse-12x16-main'].approval_id, next.approvals.at(-1).id);
  assert.equal(state.variation.children['HORSE-12X16'].assets['horse-12x16-main'].status, 'candidate');
});

test('shared approval freezes dependencies and applicable Children', async () => {
  const state = variationState();
  const next = await approveVariationArtifact(state, {
    artifactId: 'material-v1', artifactType: 'shared_image',
    childSkus: ['HORSE-12X16', 'KIDS-12X16'], factDependencies: {material: 'aluminum'},
    path: 'family/shared-assets/material.png', userAction: 'approved', now
  }, {hashFile: async () => hash('c')});
  assert.deepEqual(next.variation.shared_assets['material-v1'].applicable_child_skus, ['HORSE-12X16', 'KIDS-12X16']);
  assert.deepEqual(next.approvals.at(-1).fact_dependencies, {material: 'aluminum'});
  assert.deepEqual(next.approvals.at(-1).applicable_child_skus, ['HORSE-12X16', 'KIDS-12X16']);

  next.variation.shared_assets['material-v1'].applicable_child_skus.push('FUTURE-CHILD');
  assert.deepEqual(next.approvals.at(-1).applicable_child_skus, ['HORSE-12X16', 'KIDS-12X16']);
});

test('artifact approval requires explicit user action and a valid SHA-256 result', async () => {
  const state = variationState();
  await assert.rejects(
    approveVariationArtifact(state, {
      artifactId: 'material-v1', artifactType: 'shared_image', childSkus: ['HORSE-12X16', 'KIDS-12X16'],
      factDependencies: {material: 'aluminum'}, path: 'family/shared-assets/material.png', now
    }, {hashFile: async () => hash('a')}),
    error => error.code === 'BLOCKING_INPUT'
  );
  await assert.rejects(
    approveVariationArtifact(state, {
      artifactId: 'material-v1', artifactType: 'shared_image', childSkus: ['HORSE-12X16', 'KIDS-12X16'],
      factDependencies: {material: 'aluminum'}, path: 'family/shared-assets/material.png', userAction: 'approved', now
    }, {hashFile: async () => 'not-a-hash'}),
    error => error.code === 'CAPABILITY_FAILURE'
  );
});

test('approval inputs reject fields belonging to another scope contract', async () => {
  const state = variationState();
  await assert.rejects(
    approveVariationArtifact(state, {
      artifactId: 'material-v1', artifactType: 'shared_image', childSku: 'HORSE-12X16',
      childSkus: ['HORSE-12X16', 'KIDS-12X16'], factDependencies: {material: 'aluminum'},
      path: 'family/shared-assets/material.png', userAction: 'approved', now
    }, {hashFile: async () => hash('a')}),
    error => error.code === 'BLOCKING_INPUT'
  );
  assert.throws(
    () => approveVariationListing(state, {
      scopeType: 'parent_listing', childSku: 'HORSE-12X16', content: parentContent,
      userAction: 'approved', now
    }),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('Parent approval rejects a Child-only size token', () => {
  const state = variationState();
  assert.throws(() => approveVariationListing(state, {
    scopeType: 'parent_listing', content: {...parentContent, title: 'Safety Sign 12 x 16 Inch'},
    userAction: 'approved', now
  }), error => error.code === 'BLOCKING_INPUT');
});

test('Parent and Child Listings receive non-substitutable approval scopes', () => {
  let state = variationState();
  state = approveVariationListing(state, {
    scopeType: 'parent_listing', content: parentContent, userAction: 'approved', now
  });
  state = approveVariationListing(state, {
    scopeType: 'child_listing', childSku: 'HORSE-12X16', content: childContent(state, 'HORSE-12X16'),
    userAction: 'approved', now
  });

  assert.equal(state.variation.parent.listing.approved.at(-1).version, 1);
  assert.equal(state.variation.children['HORSE-12X16'].listing.approved.at(-1).version, 1);
  assert.deepEqual(state.approvals.slice(-2).map(item => item.scope_type), ['parent_listing', 'child_listing']);
  assert.equal(state.approvals.at(-1).child_sku, 'HORSE-12X16');
  assert.match(state.approvals.at(-1).content_sha256, /^[a-f0-9]{64}$/);
});

test('Listing approval rejects caller metadata for a different Parent or Child', () => {
  let state = variationState();
  assert.throws(
    () => approveVariationListing(state, {
      scopeType: 'parent_listing', content: {...parentContent, parent_sku: 'OTHER-PARENT'},
      userAction: 'approved', now
    }),
    error => error.code === 'BLOCKING_INPUT'
  );
  state = approveVariationListing(state, {
    scopeType: 'parent_listing', content: parentContent, userAction: 'approved', now
  });
  assert.throws(
    () => approveVariationListing(state, {
      scopeType: 'child_listing', childSku: 'HORSE-12X16',
      content: {...childContent(state, 'HORSE-12X16'), child_sku: 'KIDS-12X16'},
      userAction: 'approved', now
    }),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('final approval rejects cross-scope substitution for a Child main', async () => {
  const state = await fullyApprovedState();
  const childMain = state.approvals.find(item => item.scope_type === 'child_main' && item.child_sku === 'HORSE-12X16');
  childMain.scope_type = 'shared_image';

  assert.throws(
    () => approveVariationVersion(state, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('final approval rejects Listing content changed after its scoped approval', async () => {
  const state = await fullyApprovedState();
  state.variation.children['HORSE-12X16'].listing.approved.at(-1).content.title = 'Changed after approval';

  assert.throws(
    () => approveVariationVersion(state, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('final approval rejects stale identity and Child-main versions', async () => {
  const identityChanged = await fullyApprovedState();
  identityChanged.variation.family_identity.version = 2;
  assert.throws(
    () => approveVariationVersion(identityChanged, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );

  const mainChanged = await fullyApprovedState();
  const mainApproval = mainChanged.approvals.find(item => item.scope_type === 'child_main');
  mainApproval.product_master_version = 0;
  assert.throws(
    () => approveVariationVersion(mainChanged, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('final approval rejects stale current Child records and marketplace bindings', async () => {
  const listingStale = await fullyApprovedState();
  listingStale.variation.children['HORSE-12X16'].listing.status = 'stale';
  assert.throws(
    () => approveVariationVersion(listingStale, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );

  const mainStale = await fullyApprovedState();
  mainStale.variation.children['HORSE-12X16'].assets['horse-12x16-main'].status = 'stale';
  assert.throws(
    () => approveVariationVersion(mainStale, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );

  const listingScopeChanged = await fullyApprovedState();
  const listingApproval = listingScopeChanged.approvals.find(item => (
    item.scope_type === 'child_listing' && item.child_sku === 'HORSE-12X16'
  ));
  listingApproval.marketplace = 'amazon.ca';
  assert.throws(
    () => approveVariationVersion(listingScopeChanged, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('final approval maps a newly compatible Child without mutating the old shared approval', async () => {
  const state = await fullyApprovedState();
  const sharedApproval = state.approvals.find(item => item.scope_type === 'shared_image');
  sharedApproval.applicable_child_skus = ['HORSE-12X16'];
  state.variation.shared_assets['material-v1'].applicable_child_skus = ['HORSE-12X16'];
  const frozen = structuredClone(sharedApproval);

  const next = approveVariationVersion(state, {userAction: 'approved', now});

  assert.deepEqual(next.approvals.find(item => item.id === sharedApproval.id), frozen);
  assert.deepEqual(next.variation.shared_asset_mappings.at(-1).child_skus, ['KIDS-12X16']);
  assert.equal(next.variation.shared_asset_mappings.at(-1).approval_id, sharedApproval.id);
  assert.deepEqual(next.approvals.at(-1).asset_map.shared['material-v1'].child_skus, [
    'HORSE-12X16', 'KIDS-12X16'
  ]);
});

test('final approval freezes the complete Variation scope', async () => {
  const state = await fullyApprovedState();
  const next = approveVariationVersion(state, {userAction: 'approved', now});
  const approval = next.approvals.at(-1);
  assert.equal(approval.scope_type, 'variation_final');
  assert.equal(approval.scope_version, 1);
  assert.deepEqual(approval.theme_dimensions, ['color_name', 'size_name']);
  assert.deepEqual(approval.child_skus, ['HORSE-12X16', 'KIDS-12X16']);
  assert.equal(approval.marketplace, 'amazon.com');
  assert.equal(approval.rule_status, 'verified');
  assert.ok(approval.child_versions.every(item => item.product_master_version > 0 && item.listing_version > 0));
  assert.equal(Object.keys(approval.asset_map.child_main).length, 2);
  assert.equal(Object.keys(approval.asset_map.shared).length, 1);
  assert.deepEqual(approval.child_variations[0], {
    child_sku: 'HORSE-12X16',
    variation_values: {color_name: 'Horse Crossing', size_name: '12 x 16 in'}
  });
  assert.equal(next.variation.versions.at(-1).approval_id, approval.id);

  next.variation.children['HORSE-12X16'].variation_values.color_name = 'Changed';
  assert.equal(approval.child_variations[0].variation_values.color_name, 'Horse Crossing');
});
