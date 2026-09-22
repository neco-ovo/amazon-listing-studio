import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';

import {
  approveVariationArtifact,
  approveVariationListing,
  approveVariationVersion,
  hashVariationFinalScope,
  reverifyVariationRules
} from '../../scripts/lib/variation-approvals.js';
import {materializeChildListing} from '../../scripts/lib/variation-listing.js';

const now = '2026-08-27T08:00:00.000Z';
const hash = character => character.repeat(64);
const contentHash = content => createHash('sha256')
  .update(`${JSON.stringify(content, null, 2)}\n`, 'utf8')
  .digest('hex');

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
  const mainHash = sku === 'HORSE-12X16' ? hash('a') : hash('b');
  return {
    sku,
    active: true,
    variation_values: {color_name: color, size_name: size},
    facts: {material: fact('aluminum'), color_name: fact(color), size_name: fact(size)},
    product_master: {
      version: 1,
      status: 'locked',
      approved_main_id: `${sku.toLowerCase()}-main`,
      approved_main_path: `children/${sku}/assets/main.png`,
      approved_main_sha256: mainHash
    },
    assets: {
      [`${sku.toLowerCase()}-main`]: {
        id: `${sku.toLowerCase()}-main`,
        kind: 'main',
        child_sku: sku,
        status: 'candidate',
        inspection_status: 'pass',
        path: `children/${sku}/assets/main.png`,
        candidate_sha256: mainHash,
        inspection_binding: {
          scope_type: 'child_main', kind: 'main', path: `children/${sku}/assets/main.png`, child_sku: sku
        }
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
          scope: 'shared_asset', path: 'family/shared-assets/material.png', fact_dependencies: {material: 'aluminum'},
          candidate_sha256: hash('c'),
          inspection_binding: {
            scope_type: 'shared_image', kind: 'secondary', path: 'family/shared-assets/material.png',
            asset_scope: 'shared_asset'
          }
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
  for (const [sku, secondaryHash] of [['HORSE-12X16', hash('d')], ['KIDS-12X16', hash('e')]]) {
    const artifactId = `${sku.toLowerCase()}-size`;
    const path = `children/${sku}/assets/size.png`;
    const approvalId = `approval-${artifactId}`;
    state.variation.children[sku].assets[artifactId] = {
      id: artifactId, kind: 'size_spec', child_sku: sku, status: 'approved', inspection_status: 'pass',
      path, sha256: secondaryHash, approval_id: approvalId, approved_at: now, product_master_version: 1
    };
    state.approvals.push({
      id: approvalId, type: 'image', scope_version: 1, scope_type: 'child_secondary',
      artifact_id: artifactId, child_sku: sku, path,
      sha256: secondaryHash, product_master_version: 1, approved_at: now, user_action: 'approved'
    });
  }
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

function reopenMainAsPromotedLegacy(state, sku) {
  const childRecord = state.variation.children[sku];
  const artifactId = childRecord.product_master.approved_main_id;
  const asset = childRecord.assets[artifactId];
  const approval = state.approvals.find(item => item.id === asset.approval_id);
  childRecord.legacy_refs = {
    ...childRecord.legacy_refs,
    main_image: asset.path,
    product_master_version: childRecord.product_master.version,
    gallery_asset_ids: [artifactId],
    approval_ids: [approval.id]
  };
  for (const field of [
    'scope_version', 'scope_type', 'child_sku', 'product_master_version',
    'approved_main_path', 'approved_main_sha256', 'variation_values'
  ]) delete approval[field];
  approval.product_master_version = 0;
  return {state, childRecord, asset, approval};
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

test('Child secondary approval binds the exact Child and locked Product Master', async () => {
  const state = variationState();
  state.variation.versions.push({id: 'variation-v1', version: 1, status: 'approved', approval_id: 'final-v1'});
  const childRecord = state.variation.children['HORSE-12X16'];
  const artifactId = 'horse-12x16-size';
  const candidateHash = hash('d');
  const candidatePath = '.studio/work/secondary/horse-12x16-size.png';
  childRecord.assets[artifactId] = {
    id: artifactId, kind: 'size_spec', child_sku: childRecord.sku,
    status: 'candidate', inspection_status: 'pass', path: candidatePath,
    candidate_sha256: candidateHash,
    inspection_binding: {
      scope_type: 'child_secondary', kind: 'size_spec', path: candidatePath, child_sku: childRecord.sku
    }
  };

  const next = await approveVariationArtifact(state, {
    artifactId, artifactType: 'child_secondary', childSku: childRecord.sku,
    path: candidatePath, userAction: 'approved', now
  }, {hashFile: async () => candidateHash});

  const approval = next.approvals.at(-1);
  assert.equal(approval.scope_type, 'child_secondary');
  assert.equal(approval.child_sku, childRecord.sku);
  assert.equal(approval.product_master_version, 1);
  assert.deepEqual(approval.variation_values, childRecord.variation_values);
  assert.equal(next.variation.children[childRecord.sku].assets[artifactId].status, 'approved');
  assert.equal(next.variation.versions[0].status, 'stale');
  assert.equal(next.variation.versions[0].stale_reason, 'CHILD_SECONDARY_APPROVED');
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
  assert.equal(next.approvals.at(-1).candidate_sha256, hash('a'));
  assert.deepEqual(next.approvals.at(-1).inspection_binding, {
    scope_type: 'child_main', kind: 'main',
    path: 'children/HORSE-12X16/assets/main.png', child_sku: 'HORSE-12X16'
  });
  assert.equal(next.variation.children['HORSE-12X16'].assets['horse-12x16-main'].approval_id, next.approvals.at(-1).id);
  assert.equal(state.variation.children['HORSE-12X16'].assets['horse-12x16-main'].status, 'candidate');
});

test('stale Child Product Master refresh creates the next version and stales direct dependents', async () => {
  const state = await fullyApprovedState();
  const childRecord = state.variation.children['HORSE-12X16'];
  const priorApprovals = structuredClone(state.approvals);
  childRecord.product_master.status = 'stale';
  childRecord.product_master.stale_reason = 'CHILD_FACTS_CHANGED';
  childRecord.assets['horse-12x16-main-v2'] = {
    id: 'horse-12x16-main-v2', kind: 'main', child_sku: 'HORSE-12X16', status: 'candidate',
    inspection_status: 'pass', path: 'children/HORSE-12X16/assets/main-v2.png',
    candidate_sha256: hash('f'),
    inspection_binding: {
      scope_type: 'child_main', kind: 'main',
      path: 'children/HORSE-12X16/assets/main-v2.png', child_sku: 'HORSE-12X16'
    }
  };

  const next = await approveVariationArtifact(state, {
    artifactId: 'horse-12x16-main-v2', artifactType: 'child_main', childSku: 'HORSE-12X16',
    path: 'children/HORSE-12X16/assets/main-v2.png', userAction: 'approved', now
  }, {hashFile: async () => hash('f')});

  const refreshed = next.variation.children['HORSE-12X16'];
  assert.deepEqual(next.approvals.slice(0, priorApprovals.length), priorApprovals);
  assert.equal(refreshed.product_master.version, 2);
  assert.equal(refreshed.product_master.status, 'locked');
  assert.equal(refreshed.product_master.approved_main_id, 'horse-12x16-main-v2');
  assert.equal(refreshed.product_master.approved_main_path, 'children/HORSE-12X16/assets/main-v2.png');
  assert.equal(refreshed.product_master.approved_main_sha256, hash('f'));
  assert.equal(next.approvals.at(-1).product_master_version, 2);
  assert.equal(refreshed.assets['horse-12x16-size'].status, 'stale');
  assert.equal(refreshed.listing.status, 'stale');
  assert.equal(state.variation.children['HORSE-12X16'].product_master.status, 'stale');
});

test('locked Child Product Master still rejects a different main artifact', async () => {
  const state = variationState();
  const childRecord = state.variation.children['HORSE-12X16'];
  childRecord.assets['horse-12x16-main-v2'] = {
    id: 'horse-12x16-main-v2', kind: 'main', child_sku: 'HORSE-12X16', status: 'candidate',
    inspection_status: 'pass', path: 'children/HORSE-12X16/assets/main-v2.png',
    candidate_sha256: hash('f'),
    inspection_binding: {
      scope_type: 'child_main', kind: 'main',
      path: 'children/HORSE-12X16/assets/main-v2.png', child_sku: 'HORSE-12X16'
    }
  };

  await assert.rejects(
    approveVariationArtifact(state, {
      artifactId: 'horse-12x16-main-v2', artifactType: 'child_main', childSku: 'HORSE-12X16',
      path: 'children/HORSE-12X16/assets/main-v2.png', userAction: 'approved', now
    }, {hashFile: async () => hash('f')}),
    error => error.code === 'BLOCKING_INPUT' && /cannot replace/.test(error.message)
  );
});

test('stale Product Master refresh does not stale an unbound empty Listing', async () => {
  const state = variationState();
  const childRecord = state.variation.children['HORSE-12X16'];
  childRecord.product_master.status = 'stale';
  childRecord.listing = {status: 'draft', draft: null, approved: []};
  childRecord.assets['horse-12x16-main-v2'] = {
    id: 'horse-12x16-main-v2', kind: 'main', child_sku: 'HORSE-12X16', status: 'candidate',
    inspection_status: 'pass', path: 'children/HORSE-12X16/assets/main-v2.png',
    candidate_sha256: hash('f'),
    inspection_binding: {
      scope_type: 'child_main', kind: 'main',
      path: 'children/HORSE-12X16/assets/main-v2.png', child_sku: 'HORSE-12X16'
    }
  };

  const next = await approveVariationArtifact(state, {
    artifactId: 'horse-12x16-main-v2', artifactType: 'child_main', childSku: 'HORSE-12X16',
    path: 'children/HORSE-12X16/assets/main-v2.png', userAction: 'approved', now
  }, {hashFile: async () => hash('f')});

  assert.deepEqual(next.variation.children['HORSE-12X16'].listing, childRecord.listing);
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
  assert.equal(next.approvals.at(-1).asset_scope, 'shared_asset');
  assert.deepEqual(next.approvals.at(-1).declared_child_skus, []);
  assert.equal(next.approvals.at(-1).candidate_sha256, hash('c'));
  assert.deepEqual(next.approvals.at(-1).inspection_binding, {
    scope_type: 'shared_image', kind: 'secondary',
    path: 'family/shared-assets/material.png', asset_scope: 'shared_asset'
  });

  next.variation.shared_assets['material-v1'].applicable_child_skus.push('FUTURE-CHILD');
  assert.deepEqual(next.approvals.at(-1).applicable_child_skus, ['HORSE-12X16', 'KIDS-12X16']);
});

test('subset shared approval freezes its declared subset and mappings ignore mutable live scope', async () => {
  let state = variationState();
  state.variation.shared_assets['material-v1'].scope = {
    type: 'subset_shared', child_skus: ['HORSE-12X16']
  };
  state.variation.shared_assets['material-v1'].inspection_binding.asset_scope = {
    type: 'subset_shared', child_skus: ['HORSE-12X16']
  };
  state = await approveVariationArtifact(state, {
    artifactId: 'material-v1', artifactType: 'shared_image', childSkus: ['HORSE-12X16'],
    factDependencies: {material: 'aluminum'}, path: 'family/shared-assets/material.png',
    userAction: 'approved', now
  }, {hashFile: async () => hash('c')});
  const approval = state.approvals.at(-1);
  assert.equal(approval.asset_scope, 'subset_shared');
  assert.deepEqual(approval.declared_child_skus, ['HORSE-12X16']);

  state.variation.shared_assets['material-v1'].scope = 'shared_asset';
  state.variation.shared_assets['material-v1'].child_skus = ['HORSE-12X16', 'KIDS-12X16'];
  const frozen = structuredClone(approval);
  const ready = await fullyApprovedState();
  ready.approvals = ready.approvals.filter(item => item.scope_type !== 'shared_image');
  ready.approvals.push(frozen);
  ready.variation.shared_assets['material-v1'] = structuredClone(state.variation.shared_assets['material-v1']);
  ready.variation.shared_assets['material-v1'].approval_id = frozen.id;
  ready.variation.shared_assets['material-v1'].sha256 = frozen.sha256;

  const next = approveVariationVersion(ready, {userAction: 'approved', now});
  assert.deepEqual(next.approvals.at(-1).asset_map.shared['material-v1'].child_skus, ['HORSE-12X16']);
  assert.equal(next.variation.shared_asset_mappings?.length ?? 0, 0);
  assert.deepEqual(next.approvals.find(item => item.id === frozen.id), frozen);
});

test('subset shared approval accepts Child-only Variation facts without Family-common matches', async () => {
  const state = variationState();
  const asset = state.variation.shared_assets['material-v1'];
  const scope = {type: 'subset_shared', child_skus: ['HORSE-12X16']};
  const dependencies = {color_name: 'Horse Crossing', size_name: '12 x 16 in'};
  asset.scope = scope;
  asset.fact_dependencies = dependencies;
  asset.inspection_binding.asset_scope = scope;

  const next = await approveVariationArtifact(state, {
    artifactId: 'material-v1', artifactType: 'shared_image', childSkus: ['HORSE-12X16'],
    factDependencies: dependencies, path: 'family/shared-assets/material.png',
    userAction: 'approved', now
  }, {hashFile: async () => hash('c')});

  assert.deepEqual(next.approvals.at(-1).applicable_child_skus, ['HORSE-12X16']);
});

test('shared approval reports per-Child dependency mismatches', async () => {
  const state = variationState();
  const asset = state.variation.shared_assets['material-v1'];
  const scope = {type: 'subset_shared', child_skus: ['HORSE-12X16']};
  const dependencies = {color_name: 'Kids at Play'};
  asset.scope = scope;
  asset.fact_dependencies = dependencies;
  asset.inspection_binding.asset_scope = scope;

  await assert.rejects(
    approveVariationArtifact(state, {
      artifactId: 'material-v1', artifactType: 'shared_image', childSkus: ['HORSE-12X16'],
      factDependencies: dependencies, path: 'family/shared-assets/material.png',
      userAction: 'approved', now
    }, {hashFile: async () => hash('c')}),
    error => error.code === 'BLOCKING_INPUT'
      && error.details?.mismatches?.[0]?.child_sku === 'HORSE-12X16'
      && error.details.mismatches[0].reasons?.[0] === 'CHILD_FACT_MISMATCH:color_name'
  );
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
  assert.deepEqual(state.approvals.at(-2).theme_dimensions, ['color_name', 'size_name']);
  assert.deepEqual(state.approvals.at(-1).theme_dimensions, ['color_name', 'size_name']);
  assert.equal(state.approvals.at(-1).parent_listing_approval_id, state.approvals.at(-2).id);
  assert.match(state.approvals.at(-1).content_sha256, /^[a-f0-9]{64}$/);
});

test('Listing approval rejects an incoherent verified rule tuple', () => {
  const state = variationState();
  assert.throws(
    () => approveVariationListing(state, {
      scopeType: 'parent_listing',
      content: {...parentContent, rules_unverified: ['title'], upload_ready: false},
      userAction: 'approved', now
    }),
    error => error.code === 'BLOCKING_INPUT'
  );
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

test('final approval accepts an unchanged promoted legacy Child main without reapproval', async () => {
  const reopened = reopenMainAsPromotedLegacy(await fullyApprovedState(), 'HORSE-12X16');

  const next = approveVariationVersion(reopened.state, {userAction: 'approved', now});
  const frozen = next.approvals.at(-1).asset_map.child_main['HORSE-12X16'];

  assert.deepEqual(frozen, {
    artifact_id: reopened.asset.id,
    path: reopened.asset.path,
    sha256: reopened.asset.sha256,
    approval_id: reopened.approval.id,
    approval_scope_type: 'legacy_image',
    child_sku: 'HORSE-12X16',
    product_master_version: 1
  });
  assert.equal(reopened.approval.scope_type, undefined);
  assert.equal(reopened.approval.scope_version, undefined);
});

test('final approval rejects mismatched promoted legacy Child-main bindings', async t => {
  for (const [name, mutate] of [
    ['Child owner', reopened => { reopened.approval.child_sku = 'KIDS-12X16'; }],
    ['nonzero Product Master version', reopened => { reopened.approval.product_master_version = 99; }],
    ['approval path', reopened => { reopened.approval.path = 'images/candidates/other.png'; }],
    ['legacy main reference', reopened => { reopened.childRecord.legacy_refs.main_image = 'images/candidates/other.png'; }]
  ]) {
    await t.test(name, async () => {
      const reopened = reopenMainAsPromotedLegacy(await fullyApprovedState(), 'HORSE-12X16');
      mutate(reopened);
      assert.throws(
        () => approveVariationVersion(reopened.state, {userAction: 'approved', now}),
        error => error.code === 'BLOCKING_INPUT'
      );
    });
  }
});

test('final approval rejects Listing content changed after its scoped approval', async () => {
  const state = await fullyApprovedState();
  state.variation.children['HORSE-12X16'].listing.approved.at(-1).content.title = 'Changed after approval';

  assert.throws(
    () => approveVariationVersion(state, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('final approval requires each Child Listing to bind the current Parent approval', async () => {
  const state = await fullyApprovedState();
  const childApproval = state.approvals.find(item => (
    item.scope_type === 'child_listing' && item.child_sku === 'HORSE-12X16'
  ));
  childApproval.parent_listing_version = 99;
  childApproval.parent_listing_approval_id = 'approval-parent-stale';

  assert.throws(
    () => approveVariationVersion(state, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('final approval validates each Listing approval ordered Variation theme', async () => {
  const state = await fullyApprovedState();
  const childApproval = state.approvals.find(item => item.scope_type === 'child_listing');
  childApproval.theme_dimensions = ['size_name', 'color_name'];

  assert.throws(
    () => approveVariationVersion(state, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('final approval rejects a false verified rule tuple and freezes full rule detail', async () => {
  const falseVerified = await fullyApprovedState();
  const childApproval = falseVerified.approvals.find(item => item.scope_type === 'child_listing');
  childApproval.rules_unverified = ['title'];
  assert.throws(
    () => approveVariationVersion(falseVerified, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );

  const state = await fullyApprovedState();
  const next = approveVariationVersion(state, {userAction: 'approved', now});
  assert.deepEqual(next.approvals.at(-1).rule_scope, {
    rule_status: 'verified', rules_unverified: [], upload_ready: true
  });
});

test('final rule scope must match each immutable Listing snapshot rule tuple', async () => {
  const state = await fullyApprovedState();
  const listingApprovals = state.approvals.filter(item => (
    item.scope_type === 'parent_listing' || item.scope_type === 'child_listing'
  ));
  const snapshots = [
    state.variation.parent.listing.approved.at(-1),
    ...Object.values(state.variation.children).map(child => child.listing.approved.at(-1))
  ];
  for (const snapshot of snapshots) {
    snapshot.content.rule_status = 'rules_partially_verified';
    snapshot.content.rules_unverified = ['title'];
    snapshot.content.upload_ready = false;
    snapshot.content_sha256 = contentHash(snapshot.content);
    snapshot.json_sha256 = snapshot.content_sha256;
    const approval = listingApprovals.find(item => item.id === snapshot.approval_id);
    approval.content_sha256 = snapshot.content_sha256;
    approval.rule_status = 'verified';
    approval.rules_unverified = [];
    approval.upload_ready = true;
  }

  assert.throws(
    () => approveVariationVersion(state, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('final approval conservatively combines valid per-Listing rule scopes', async () => {
  const state = await fullyApprovedState();
  const child = state.variation.children['HORSE-12X16'];
  const snapshot = child.listing.approved.at(-1);
  const approval = state.approvals.find(item => item.id === snapshot.approval_id);
  snapshot.content.rule_status = 'rules_unverified';
  snapshot.content.rules_unverified = ['color_size_variation_values'];
  snapshot.content.upload_ready = false;
  snapshot.content_sha256 = contentHash(snapshot.content);
  snapshot.json_sha256 = snapshot.content_sha256;
  approval.rule_status = snapshot.content.rule_status;
  approval.rules_unverified = [...snapshot.content.rules_unverified];
  approval.upload_ready = false;
  approval.content_sha256 = snapshot.content_sha256;

  const next = approveVariationVersion(state, {userAction: 'approved', now});
  assert.deepEqual(next.approvals.at(-1).rule_scope, {
    rule_status: 'rules_unverified',
    rules_unverified: ['color_size_variation_values'],
    upload_ready: false
  });
});

test('template rule reverification creates new Listing approvals and a new upload-ready Final', async () => {
  const state = await fullyApprovedState();
  for (const snapshot of [
    state.variation.parent.listing.approved.at(-1),
    ...Object.values(state.variation.children).map(child => child.listing.approved.at(-1))
  ]) {
    snapshot.content.rule_status = 'rules_unverified';
    snapshot.content.rules_unverified = ['amazon_us_signage_schema', 'color_size_variation_values'];
    snapshot.content.upload_ready = false;
    snapshot.content_sha256 = contentHash(snapshot.content);
    snapshot.json_sha256 = snapshot.content_sha256;
    const approval = state.approvals.find(item => item.id === snapshot.approval_id);
    approval.rule_status = snapshot.content.rule_status;
    approval.rules_unverified = [...snapshot.content.rules_unverified];
    approval.upload_ready = false;
    approval.content_sha256 = snapshot.content_sha256;
  }
  const firstFinal = approveVariationVersion(state, {userAction: 'approved', now});

  const next = reverifyVariationRules(firstFinal, {
    userAction: 'approved',
    verifiedRuleIds: ['amazon_us_signage_schema', 'color_size_variation_values'],
    now: '2026-08-27T09:00:00.000Z'
  });

  assert.equal(next.variation.parent.listing.approved.at(-1).version, 2);
  assert.ok(Object.values(next.variation.children).every(child => child.listing.approved.at(-1).version === 2));
  assert.deepEqual(next.approvals.at(-1).rule_scope, {
    rule_status: 'verified', rules_unverified: [], upload_ready: true
  });
  assert.equal(next.approvals.at(-1).variation_version, 2);
});

test('final approval validates and freezes locked Product Master main path and hash', async () => {
  const state = await fullyApprovedState();
  state.variation.children['HORSE-12X16'].product_master.approved_main_sha256 = hash('f');
  assert.throws(
    () => approveVariationVersion(state, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );

  const valid = await fullyApprovedState();
  const next = approveVariationVersion(valid, {userAction: 'approved', now});
  const horse = next.approvals.at(-1).child_versions.find(item => item.child_sku === 'HORSE-12X16');
  assert.equal(horse.approved_main_path, 'children/HORSE-12X16/assets/main.png');
  assert.equal(horse.approved_main_sha256, hash('a'));
});

test('final asset map includes approved Child-specific secondary assets', async () => {
  const substituted = await fullyApprovedState();
  const asset = substituted.variation.children['HORSE-12X16'].assets['horse-12x16-size'];
  const approval = substituted.approvals.find(item => item.id === asset.approval_id);
  asset.path = 'children/KIDS-12X16/assets/size.png';
  approval.path = asset.path;
  assert.throws(
    () => approveVariationVersion(substituted, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );

  const state = await fullyApprovedState();
  const next = approveVariationVersion(state, {userAction: 'approved', now});
  assert.deepEqual(next.approvals.at(-1).asset_map.child_secondary['HORSE-12X16'], [{
    artifact_id: 'horse-12x16-size',
    path: 'children/HORSE-12X16/assets/size.png',
    sha256: hash('d'),
    approval_id: 'approval-horse-12x16-size',
    approval_scope_type: 'child_secondary',
    child_sku: 'HORSE-12X16',
    product_master_version: 1
  }]);
});

test('approving a revised Child secondary supersedes the prior asset for the same role', async () => {
  const state = await fullyApprovedState();
  const childRecord = state.variation.children['HORSE-12X16'];
  const prior = childRecord.assets['horse-12x16-size'];
  const priorApproval = structuredClone(state.approvals.find(item => item.id === prior.approval_id));
  const artifactId = 'horse-12x16-size-v2';
  const candidatePath = '.studio/work/secondary/horse-12x16-size-v2.png';
  childRecord.assets[artifactId] = {
    id: artifactId, kind: 'size_spec', child_sku: childRecord.sku,
    status: 'candidate', inspection_status: 'pass', path: candidatePath,
    candidate_sha256: hash('f'),
    inspection_binding: {
      scope_type: 'child_secondary', kind: 'size_spec', path: candidatePath, child_sku: childRecord.sku
    }
  };

  const approved = await approveVariationArtifact(state, {
    artifactId, artifactType: 'child_secondary', childSku: childRecord.sku,
    path: candidatePath, userAction: 'approved', now: '2026-08-27T09:00:00.000Z'
  }, {hashFile: async () => hash('f')});

  assert.equal(approved.variation.children[childRecord.sku].assets['horse-12x16-size'].status, 'superseded');
  assert.equal(approved.variation.children[childRecord.sku].assets[artifactId].status, 'approved');
  assert.deepEqual(approved.approvals.find(item => item.id === prior.approval_id), priorApproval);
});

test('final approval selects the newest approved asset from a legacy duplicate role', async () => {
  const state = await fullyApprovedState();
  const childRecord = state.variation.children['HORSE-12X16'];
  childRecord.assets['horse-12x16-size-v2'] = {
    id: 'horse-12x16-size-v2', kind: 'size_spec', child_sku: childRecord.sku,
    status: 'approved', inspection_status: 'pass',
    path: 'children/HORSE-12X16/assets/size-v2.png', sha256: hash('f'),
    approval_id: 'approval-horse-12x16-size-v2', approved_at: '2026-08-27T09:00:00.000Z',
    product_master_version: 1
  };
  state.approvals.push({
    id: 'approval-horse-12x16-size-v2', type: 'image', scope_version: 1,
    scope_type: 'child_secondary', artifact_id: 'horse-12x16-size-v2', child_sku: childRecord.sku,
    path: 'children/HORSE-12X16/assets/size-v2.png', sha256: hash('f'), product_master_version: 1,
    approved_at: '2026-08-27T09:00:00.000Z', user_action: 'approved'
  });

  const final = approveVariationVersion(state, {userAction: 'approved', now: '2026-08-27T09:01:00.000Z'});
  assert.deepEqual(
    final.approvals.at(-1).asset_map.child_secondary[childRecord.sku].map(item => item.artifact_id),
    ['horse-12x16-size-v2']
  );
});

test('final approval ignores historical legacy secondaries bound to an older Product Master', async () => {
  const state = await fullyApprovedState();
  const childRecord = state.variation.children['HORSE-12X16'];
  const artifactId = 'legacy-horse-size';
  const approvalId = 'approval-legacy-horse-size';
  state.gallery ??= {assets: {}};
  state.gallery.assets ??= {};
  state.gallery.assets[artifactId] = {
    id: artifactId, kind: 'size_spec', status: 'approved', path: 'assets/legacy-horse-size.png',
    sha256: hash('e'), approval_id: approvalId, product_master_version: 0
  };
  childRecord.legacy_refs ??= {};
  childRecord.legacy_refs.gallery_asset_ids = [artifactId];
  state.approvals.push({
    id: approvalId, type: 'image', artifact_id: artifactId, path: 'assets/legacy-horse-size.png',
    sha256: hash('e'), product_master_version: 0, approved_at: '2026-08-26T09:00:00.000Z',
    user_action: 'approved'
  });

  const final = approveVariationVersion(state, {userAction: 'approved', now});
  assert.deepEqual(
    final.approvals.at(-1).asset_map.child_secondary[childRecord.sku].map(item => item.artifact_id),
    ['horse-12x16-size']
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

test('shared approval can atomically narrow an approved asset to an explicit Child subset', async () => {
  const state = await fullyApprovedState();
  const asset = state.variation.shared_assets['material-v1'];
  asset.fact_dependencies = {material: 'aluminum', color_name: 'Horse Crossing'};
  const before = structuredClone(state);

  const next = await approveVariationArtifact(state, {
    artifactId: 'material-v1', artifactType: 'shared_image',
    scope: {type: 'subset_shared', child_skus: ['HORSE-12X16']},
    childSkus: ['HORSE-12X16'], factDependencies: {material: 'aluminum'},
    path: 'family/shared-assets/material.png', userAction: 'approved',
    now: '2026-08-27T08:01:00.000Z'
  }, {hashFile: async () => hash('c')});

  assert.deepEqual(state, before);
  assert.deepEqual(next.variation.shared_assets['material-v1'].scope, {
    type: 'subset_shared', child_skus: ['HORSE-12X16']
  });
  assert.deepEqual(next.approvals.at(-1).declared_child_skus, ['HORSE-12X16']);
  assert.deepEqual(next.approvals.at(-1).applicable_child_skus, ['HORSE-12X16']);
});

test('final approval atomically locks a current draft Family identity', async () => {
  const state = await fullyApprovedState();
  state.variation.family_identity.status = 'draft';

  const next = approveVariationVersion(state, {userAction: 'approved', now});

  assert.equal(state.variation.family_identity.status, 'draft');
  assert.equal(next.variation.family_identity.status, 'locked');
  assert.equal(next.variation.versions.at(-1).status, 'approved');
  assert.match(next.variation.versions.at(-1).scope_sha256, /^[a-f0-9]{64}$/);
});

test('first final approval atomically promotes a valid draft Family identity from version zero', async () => {
  const state = await fullyApprovedState();
  state.variation.family_identity.status = 'draft';
  state.variation.family_identity.version = 0;
  const parentApproval = state.approvals.find(item => item.scope_type === 'parent_listing');
  parentApproval.family_identity_version = 0;

  const next = approveVariationVersion(state, {userAction: 'approved', now});

  assert.equal(state.variation.family_identity.version, 0);
  assert.equal(parentApproval.family_identity_version, 0);
  assert.equal(next.variation.family_identity.status, 'locked');
  assert.equal(next.variation.family_identity.version, 1);
  assert.equal(next.approvals.at(-1).family_identity_version, 1);
  assert.equal(next.variation.versions.at(-1).version, 1);
});

test('final approval rejects unsupported facts already placed in a draft Family identity', async () => {
  const state = await fullyApprovedState();
  state.variation.family_identity.status = 'draft';
  state.variation.family_identity.facts.material = {
    value: 'aluminum', status: 'conflicted', publishable: true, conflicts: ['steel']
  };
  const before = structuredClone(state);

  assert.throws(
    () => approveVariationVersion(state, {userAction: 'approved', now}),
    error => error.code === 'BLOCKING_INPUT'
  );
  assert.deepEqual(state, before);
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
  assert.deepEqual(approval.family_identity_facts, {material: fact('aluminum')});
  assert.match(approval.parent_listing_content_sha256, /^[a-f0-9]{64}$/);
  assert.match(approval.scope_sha256, /^[a-f0-9]{64}$/);
  assert.ok(approval.child_versions.every(item => item.product_master_version > 0 && item.listing_version > 0));
  assert.ok(approval.child_versions.every(item => /^[a-f0-9]{64}$/.test(item.listing_content_sha256)));
  assert.equal(Object.keys(approval.asset_map.child_main).length, 2);
  assert.equal(Object.keys(approval.asset_map.child_secondary).length, 2);
  assert.equal(Object.keys(approval.asset_map.shared).length, 1);
  assert.equal(approval.asset_map.shared['material-v1'].asset_scope, 'shared_asset');
  assert.deepEqual(approval.asset_map.shared['material-v1'].declared_child_skus, []);
  assert.deepEqual(approval.child_variations[0], {
    child_sku: 'HORSE-12X16',
    variation_values: {color_name: 'Horse Crossing', size_name: '12 x 16 in'},
    display_values: {color_name: 'Horse Crossing', size_name: '12 x 16 in'}
  });
  assert.equal(next.variation.versions.at(-1).approval_id, approval.id);
  assert.equal(next.variation.versions.at(-1).scope_sha256, approval.scope_sha256);

  const changedIdentity = structuredClone(approval);
  changedIdentity.family_identity_facts.material.value = 'steel';
  assert.notEqual(hashVariationFinalScope(changedIdentity), approval.scope_sha256);

  next.variation.children['HORSE-12X16'].variation_values.color_name = 'Changed';
  assert.equal(approval.child_variations[0].variation_values.color_name, 'Horse Crossing');
});
