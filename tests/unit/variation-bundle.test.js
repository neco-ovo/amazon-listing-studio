import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {unzipSync, zipSync} from 'fflate';
import sharp from 'sharp';

import {
  approveVariationArtifact,
  approveVariationListing,
  approveVariationVersion,
  hashVariationFinalScope
} from '../../scripts/lib/variation-approvals.js';
import {buildVariationDelivery, verifyVariationDelivery} from '../../scripts/lib/variation-bundle.js';
import {materializeChildListing} from '../../scripts/lib/variation-listing.js';
import {reviseVariationChild} from '../../scripts/lib/variation-project.js';
import {sha256File} from '../../scripts/lib/bundle.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const now = '2026-08-27T08:00:00.000Z';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

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
  return {
    sku,
    active: true,
    variation_values: {color_name: color, size_name: '12 x 16 in'},
    facts: {
      material: fact('aluminum'),
      color_name: fact(color),
      size_name: fact('12 x 16 in')
    },
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
        path: `children/${sku}/assets/main.png`,
        media_type: 'image/png'
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
      language: 'en-US', product_type: 'METAL_SIGN', stage: 'delivery', mode: 'variation_family', updated_at: now
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
      family_identity: {
        version: 1,
        status: 'locked',
        facts: {material: fact('aluminum')},
        non_merge_boundaries: []
      },
      theme: {
        dimensions: ['color_name', 'size_name'],
        source: {
          kind: 'category_schema', id: 'METAL_SIGN',
          allowed_themes: [['color_name', 'size_name']]
        },
        verification_status: 'verified'
      },
      parent: {
        sku: 'SIGN-PARENT', version: 0, status: 'draft',
        listing: {status: 'draft', draft: null, approved: []}
      },
      children: {
        'HORSE-12X16': child('HORSE-12X16', 'Horse Crossing'),
        'KIDS-12X16': child('KIDS-12X16', 'Kids at Play')
      },
      shared_assets: {
        'material-v1': {
          id: 'material-v1', kind: 'secondary', status: 'candidate', inspection_status: 'pass',
          scope: 'shared_asset', path: 'family/shared-assets/material.png', media_type: 'image/png',
          fact_dependencies: {material: 'aluminum'}
        },
        'material-copy-v1': {
          id: 'material-copy-v1', kind: 'secondary', status: 'candidate', inspection_status: 'pass',
          scope: 'shared_asset', path: 'family/shared-assets/material-copy.png', media_type: 'image/png',
          fact_dependencies: {material: 'aluminum'}
        },
        'kids-scene-v1': {
          id: 'kids-scene-v1', kind: 'secondary', status: 'candidate', inspection_status: 'pass',
          scope: {type: 'subset_shared', child_skus: ['KIDS-12X16']},
          path: 'family/shared-assets/kids-scene.png', media_type: 'image/png',
          fact_dependencies: {material: 'aluminum'}
        }
      },
      versions: [],
      updated_at: now
    }
  };
}

function childContent(state, sku) {
  const record = state.variation.children[sku];
  return materializeChildListing({
    parentContent,
    childOverrides: {
      title: `Aluminum Safety Sign ${record.variation_values.color_name} 12 x 16 Inch`,
      attributes: structuredClone(record.variation_values)
    },
    child: record,
    dimensions: state.variation.theme.dimensions
  });
}

async function png(filePath, color) {
  await mkdir(path.dirname(filePath), {recursive: true});
  await sharp({create: {width: 32, height: 32, channels: 3, background: color}}).png().toFile(filePath);
}

async function approvedProject(root) {
  const projectDir = path.join(root, 'project');
  let state = variationState();
  const images = [
    ['children/HORSE-12X16/assets/main.png', '#ff0000'],
    ['children/HORSE-12X16/assets/size.png', '#00ff00'],
    ['children/KIDS-12X16/assets/main.png', '#0000ff'],
    ['children/KIDS-12X16/assets/size.png', '#ffff00'],
    ['family/shared-assets/material.png', '#cccccc'],
    ['family/shared-assets/kids-scene.png', '#999999']
  ];
  for (const [relative, color] of images) await png(path.join(projectDir, relative), color);
  await writeFile(
    path.join(projectDir, 'family/shared-assets/material-copy.png'),
    await readFile(path.join(projectDir, 'family/shared-assets/material.png'))
  );

  const hashRelative = relative => sha256File(path.join(projectDir, relative));
  for (const sku of ['HORSE-12X16', 'KIDS-12X16']) {
    const mainPath = `children/${sku}/assets/main.png`;
    const mainHash = await hashRelative(mainPath);
    state.variation.children[sku].product_master.approved_main_sha256 = mainHash;
    state.variation.children[sku].assets[`${sku.toLowerCase()}-main`].candidate_sha256 = mainHash;
    state.variation.children[sku].assets[`${sku.toLowerCase()}-main`].inspection_binding = {
      scope_type: 'child_main', kind: 'main', path: mainPath, child_sku: sku
    };
    state = await approveVariationArtifact(state, {
      artifactId: `${sku.toLowerCase()}-main`, artifactType: 'child_main', childSku: sku,
      path: mainPath, userAction: 'approved', now
    }, {hashFile: hashRelative});

    const secondaryId = `${sku.toLowerCase()}-size`;
    const secondaryPath = `children/${sku}/assets/size.png`;
    const secondaryHash = await hashRelative(secondaryPath);
    const approvalId = `approval-${secondaryId}`;
    state.variation.children[sku].assets[secondaryId] = {
      id: secondaryId, kind: 'size_spec', child_sku: sku, status: 'approved',
      inspection_status: 'pass', path: secondaryPath, media_type: 'image/png',
      sha256: secondaryHash, approval_id: approvalId, approved_at: now, product_master_version: 1
    };
    state.approvals.push({
      id: approvalId, type: 'image', scope_version: 1, scope_type: 'child_secondary',
      artifact_id: secondaryId, child_sku: sku,
      path: secondaryPath, sha256: secondaryHash, product_master_version: 1,
      approved_at: now, user_action: 'approved'
    });
  }

  for (const artifactId of ['material-v1', 'material-copy-v1', 'kids-scene-v1']) {
    const asset = state.variation.shared_assets[artifactId];
    asset.candidate_sha256 = await hashRelative(asset.path);
    asset.inspection_binding = {
      scope_type: 'shared_image', kind: asset.kind, path: asset.path,
      asset_scope: structuredClone(asset.scope)
    };
  }

  state = await approveVariationArtifact(state, {
    artifactId: 'material-v1', artifactType: 'shared_image',
    childSkus: ['HORSE-12X16', 'KIDS-12X16'], factDependencies: {material: 'aluminum'},
    path: 'family/shared-assets/material.png', userAction: 'approved', now
  }, {hashFile: hashRelative});
  state = await approveVariationArtifact(state, {
    artifactId: 'material-copy-v1', artifactType: 'shared_image',
    childSkus: ['HORSE-12X16', 'KIDS-12X16'], factDependencies: {material: 'aluminum'},
    path: 'family/shared-assets/material-copy.png', userAction: 'approved', now
  }, {hashFile: hashRelative});
  state = await approveVariationArtifact(state, {
    artifactId: 'kids-scene-v1', artifactType: 'shared_image',
    childSkus: ['KIDS-12X16'], factDependencies: {material: 'aluminum'},
    path: 'family/shared-assets/kids-scene.png', userAction: 'approved', now
  }, {hashFile: hashRelative});
  state = approveVariationListing(state, {
    scopeType: 'parent_listing', content: parentContent, userAction: 'approved', now
  });
  for (const sku of ['HORSE-12X16', 'KIDS-12X16']) {
    state = approveVariationListing(state, {
      scopeType: 'child_listing', childSku: sku, content: childContent(state, sku),
      userAction: 'approved', now
    });
  }
  state = approveVariationVersion(state, {userAction: 'approved', now});
  const finalApproval = structuredClone(state.approvals.at(-1));
  await writeFile(path.join(projectDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  return {projectDir, state, finalApproval};
}

function reopenWithPromotedLegacySecondary(project) {
  const state = structuredClone(project.state);
  state.approvals = state.approvals.filter(item => item.scope_type !== 'variation_final');
  state.variation.versions = [];
  const child = state.variation.children['HORSE-12X16'];
  const artifactId = 'horse-12x16-size';
  const asset = child.assets[artifactId];
  delete child.assets[artifactId];
  delete asset.child_sku;
  delete asset.product_master_version;
  state.gallery.assets[artifactId] = asset;
  child.legacy_refs.gallery_asset_ids = [artifactId];
  const approval = state.approvals.find(item => item.id === asset.approval_id);
  delete approval.scope_version;
  delete approval.scope_type;
  delete approval.child_sku;
  delete approval.product_master_version;
  return {state, child, asset, approval};
}

function textEntry(archive, name) {
  return Buffer.from(archive[name]).toString('utf8');
}

async function rewriteVariationPackage(sourceDir, outputDir, mutate) {
  const manifest = JSON.parse(await readFile(path.join(sourceDir, 'delivery-manifest.json'), 'utf8'));
  const files = unzipSync(await readFile(path.join(sourceDir, 'delivery.zip')));
  const matrix = JSON.parse(textEntry(files, 'variation-matrix.json'));
  await mutate({files, matrix, manifest});
  if (files['variation-matrix.json']) {
    files['variation-matrix.json'] = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`);
    const matrixArtifact = manifest.artifacts.find(item => item.archive_path === 'variation-matrix.json');
    if (matrixArtifact) {
      matrixArtifact.byte_size = files['variation-matrix.json'].length;
      matrixArtifact.sha256 = digest(files['variation-matrix.json']);
    }
  }
  files['delivery-manifest.json'] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(outputDir, {recursive: true});
  await writeFile(path.join(outputDir, 'delivery-manifest.json'), files['delivery-manifest.json']);
  await writeFile(path.join(outputDir, 'delivery.zip'), Buffer.from(zipSync(files, {level: 6})));
}

test('builds a Family package with complete Listings and one copy of each physical shared image', async () => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const result = await buildVariationDelivery({
      ...project,
      outputDir: path.join(project.projectDir, 'delivery', 'family-v1')
    });
    const archive = unzipSync(await readFile(result.zipPath));

    assert.ok(archive['parent/listing.json']);
    assert.ok(archive['parent/listing.md']);
    assert.ok(archive['children/HORSE-12X16/listing.json']);
    assert.ok(archive['children/KIDS-12X16/listing.json']);
    assert.ok(archive['children/HORSE-12X16/main.png']);
    assert.ok(archive['children/HORSE-12X16/secondary/size.png']);
    assert.ok(archive['shared/material.png']);
    assert.equal(archive['shared/material-copy.png'], undefined);
    assert.ok(archive['shared/kids-scene.png']);
    assert.ok(archive['variation-matrix.json']);
    assert.equal(Object.keys(archive).filter(name => name.endsWith('/material.png')).length, 1);
    assert.equal(Object.keys(archive).filter(name => name.endsWith('/kids-scene.png')).length, 1);
    assert.equal(Object.keys(archive).some(name => /\.(?:xlsx|xls|csv|tsv)$/i.test(name)), false);

    const childListing = JSON.parse(textEntry(archive, 'children/HORSE-12X16/listing.json'));
    assert.equal(childListing.child_sku, 'HORSE-12X16');
    assert.equal(childListing.product_master_version, 1);
    assert.equal(childListing.description, parentContent.description);

    const matrix = JSON.parse(textEntry(archive, 'variation-matrix.json'));
    assert.deepEqual(matrix.theme_dimensions, ['color_name', 'size_name']);
    assert.deepEqual(matrix.children[0], {
      parent_sku: 'SIGN-PARENT',
      child_sku: 'HORSE-12X16',
      theme_dimensions: ['color_name', 'size_name'],
      variation_values: {color_name: 'Horse Crossing', size_name: '12 x 16 in'},
      listing_version: 1,
      product_master_version: 1,
      asset_ids: {
        main: 'horse-12x16-main',
        child_secondary: ['horse-12x16-size'],
        shared: ['material-v1', 'material-copy-v1']
      },
      asset_paths: [
        'children/HORSE-12X16/main.png',
        'children/HORSE-12X16/secondary/size.png',
        'shared/material.png'
      ]
    });
    assert.equal(result.verification.ok, true);
  });
});

test('promoted legacy secondary finalizes and delivers with normalized immutable ownership', async () => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const legacy = reopenWithPromotedLegacySecondary(project);
    const state = approveVariationVersion(legacy.state, {
      userAction: 'approved', now: '2026-08-27T08:01:00.000Z'
    });
    const finalApproval = state.approvals.at(-1);
    assert.deepEqual(finalApproval.asset_map.child_secondary['HORSE-12X16'], [{
      artifact_id: 'horse-12x16-size',
      path: 'children/HORSE-12X16/assets/size.png',
      sha256: legacy.asset.sha256,
      approval_id: legacy.approval.id,
      approval_scope_type: null,
      child_sku: 'HORSE-12X16',
      product_master_version: 1
    }]);
    await writeFile(
      path.join(project.projectDir, 'state.json'),
      `${JSON.stringify(state, null, 2)}\n`
    );

    const result = await buildVariationDelivery({
      projectDir: project.projectDir,
      outputDir: path.join(project.projectDir, 'delivery', 'promoted-legacy'),
      finalApproval
    });
    assert.equal(result.verification.ok, true);
  });
});

test('promoted legacy secondary rejects any present mismatched ownership binding', async t => {
  for (const [name, mutate] of [
    ['Child owner', approval => { approval.child_sku = 'KIDS-12X16'; }],
    ['Product Master version', approval => { approval.product_master_version = 99; }]
  ]) {
    await t.test(name, async () => {
      await withTempWorkspace(async root => {
        const project = await approvedProject(root);
        const legacy = reopenWithPromotedLegacySecondary(project);
        mutate(legacy.approval);

        assert.throws(
          () => approveVariationVersion(legacy.state, {
            userAction: 'approved', now: '2026-08-27T08:01:00.000Z'
          }),
          error => error.code === 'BLOCKING_INPUT'
        );
      });
    });
  }
});

test('Child-only delivery excludes unrelated Child artifacts and rows', async () => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const result = await buildVariationDelivery({
      ...project,
      childSkus: ['HORSE-12X16'],
      outputDir: path.join(project.projectDir, 'delivery', 'horse-v1')
    });
    const archive = unzipSync(await readFile(result.zipPath));
    const matrix = JSON.parse(textEntry(archive, 'variation-matrix.json'));

    assert.ok(archive['parent/listing.json']);
    assert.ok(archive['children/HORSE-12X16/listing.json']);
    assert.equal(archive['children/KIDS-12X16/listing.json'], undefined);
    assert.equal(archive['children/KIDS-12X16/main.png'], undefined);
    assert.ok(archive['shared/material.png']);
    assert.equal(archive['shared/material-copy.png'], undefined);
    assert.equal(archive['shared/kids-scene.png'], undefined);
    assert.deepEqual(matrix.children.map(row => row.child_sku), ['HORSE-12X16']);
    assert.deepEqual(result.manifest.delivery_scope, {
      type: 'child', child_skus: ['HORSE-12X16']
    });
    assert.deepEqual(result.manifest.approval_scope.child_skus, ['HORSE-12X16']);
    assert.deepEqual(result.manifest.approval_scope.child_versions.map(item => item.child_sku), ['HORSE-12X16']);
    assert.deepEqual(result.manifest.approval_scope.child_variations.map(item => item.child_sku), ['HORSE-12X16']);
    assert.deepEqual(Object.keys(result.manifest.approval_scope.asset_map.child_main), ['HORSE-12X16']);
    assert.deepEqual(Object.keys(result.manifest.approval_scope.asset_map.child_secondary), ['HORSE-12X16']);
    assert.match(result.manifest.approval_provenance.final_scope_sha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result.manifest.approval_scope).includes('KIDS-12X16'), false);
  });
});

test('build rejects stale approval, unsafe paths, and incomplete selections', async t => {
  await t.test('stale immutable approval', async () => {
    await withTempWorkspace(async root => {
      const project = await approvedProject(root);
      project.finalApproval.child_versions[0].listing_version = 99;
      await assert.rejects(
        buildVariationDelivery({...project, outputDir: path.join(project.projectDir, 'delivery', 'stale')}),
        error => error.code === 'BUNDLE_INVALID' && error.details?.reason === 'APPROVAL_SCOPE_MISMATCH'
      );
    });
  });

  await t.test('unsafe approved asset path', async () => {
    await withTempWorkspace(async root => {
      const project = await approvedProject(root);
      const finalRecord = project.state.approvals.find(item => item.id === project.finalApproval.id);
      project.finalApproval.asset_map.shared['material-v1'].path = '../outside.png';
      finalRecord.asset_map.shared['material-v1'].path = '../outside.png';
      const version = project.state.variation.versions.at(-1);
      version.scope.asset_map.shared['material-v1'].path = '../outside.png';
      const scopeHash = hashVariationFinalScope(project.finalApproval);
      project.finalApproval.scope_sha256 = scopeHash;
      finalRecord.scope_sha256 = scopeHash;
      version.scope_sha256 = scopeHash;
      await writeFile(path.join(project.projectDir, 'state.json'), `${JSON.stringify(project.state, null, 2)}\n`);
      await assert.rejects(
        buildVariationDelivery({...project, outputDir: path.join(project.projectDir, 'delivery', 'unsafe')}),
        error => error.code === 'BUNDLE_INVALID' && error.details?.reason === 'UNSAFE_PATH'
      );
    });
  });

  await t.test('unknown or duplicate Child selection', async () => {
    await withTempWorkspace(async root => {
      const project = await approvedProject(root);
      for (const childSkus of [
        ['MISSING'],
        ['HORSE-12X16', 'HORSE-12X16'],
        ['HORSE-12X16', 'KIDS-12X16'],
        []
      ]) {
        await assert.rejects(
          buildVariationDelivery({
            ...project, childSkus,
            outputDir: path.join(project.projectDir, 'delivery', `bad-${childSkus.length}-${childSkus[0] ?? 'none'}`)
          }),
          error => error.code === 'BUNDLE_INVALID' && error.details?.reason === 'APPROVAL_SCOPE_MISMATCH'
        );
      }
    });
  });
});

test('build rejects an old final approval after a Child revision leaves versions unchanged', async () => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const revised = reviseVariationChild(project.state, {
      sku: 'HORSE-12X16',
      factPatch: {finish: fact('matte')},
      now: '2026-08-27T09:00:00.000Z'
    });
    assert.equal(revised.variation.children['HORSE-12X16'].product_master.version, 1);
    assert.equal(revised.variation.children['HORSE-12X16'].listing.approved.at(-1).version, 1);
    await writeFile(path.join(project.projectDir, 'state.json'), `${JSON.stringify(revised, null, 2)}\n`);

    await assert.rejects(
      buildVariationDelivery({
        projectDir: project.projectDir,
        outputDir: path.join(project.projectDir, 'delivery', 'stale-after-revision'),
        finalApproval: project.finalApproval
      }),
      error => error.code === 'BUNDLE_INVALID'
        && error.details?.reason === 'APPROVAL_SCOPE_MISMATCH'
    );
  });
});

test('Child-only build still accepts an unaffected selected Child after a sibling-only revision', async () => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const revised = reviseVariationChild(project.state, {
      sku: 'HORSE-12X16',
      factPatch: {finish: fact('matte')},
      now: '2026-08-27T09:00:00.000Z'
    });
    await writeFile(path.join(project.projectDir, 'state.json'), `${JSON.stringify(revised, null, 2)}\n`);

    const result = await buildVariationDelivery({
      projectDir: project.projectDir,
      outputDir: path.join(project.projectDir, 'delivery', 'unaffected-kids'),
      finalApproval: project.finalApproval,
      childSkus: ['KIDS-12X16']
    });
    assert.equal(result.verification.ok, true);
    assert.deepEqual(result.manifest.delivery_scope.child_skus, ['KIDS-12X16']);
  });
});

test('build rejects drift in a currently approved shared asset dependency binding', async () => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    project.state.variation.shared_assets['material-v1'].fact_dependencies = {material: 'steel'};
    await writeFile(path.join(project.projectDir, 'state.json'), `${JSON.stringify(project.state, null, 2)}\n`);

    await assert.rejects(
      buildVariationDelivery({
        projectDir: project.projectDir,
        outputDir: path.join(project.projectDir, 'delivery', 'stale-shared-dependency'),
        finalApproval: project.finalApproval
      }),
      error => error.code === 'BUNDLE_INVALID'
        && error.details?.reason === 'APPROVAL_SCOPE_MISMATCH'
    );
  });
});

test('build rejects coordinated shared scope mutation against the frozen final scope', async () => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const approval = project.state.approvals.find(item => (
      item.scope_type === 'shared_image' && item.artifact_id === 'material-v1'
    ));
    const declared = ['HORSE-12X16', 'KIDS-12X16'];
    approval.asset_scope = 'subset_shared';
    approval.declared_child_skus = declared;
    project.state.variation.shared_assets['material-v1'].scope = {
      type: 'subset_shared', child_skus: declared
    };
    await writeFile(
      path.join(project.projectDir, 'state.json'),
      `${JSON.stringify(project.state, null, 2)}\n`
    );

    await assert.rejects(
      buildVariationDelivery({
        projectDir: project.projectDir,
        outputDir: path.join(project.projectDir, 'delivery', 'coordinated-shared-scope'),
        finalApproval: project.finalApproval
      }),
      error => error.code === 'BUNDLE_INVALID'
        && error.details?.reason === 'APPROVAL_SCOPE_MISMATCH'
    );
  });
});

test('build rejects mutated scoped approval identity with unchanged IDs, paths, and hashes', async t => {
  const cases = [
    ['Child main owner', state => {
      state.approvals.find(item => item.scope_type === 'child_main' && item.child_sku === 'HORSE-12X16').child_sku
        = 'KIDS-12X16';
    }],
    ['Child secondary Product Master binding', state => {
      state.approvals.find(item => item.id === 'approval-horse-12x16-size').product_master_version = 99;
    }],
    ['Child secondary scope changed to Child main', state => {
      state.approvals.find(item => item.id === 'approval-horse-12x16-size').scope_type = 'child_main';
    }],
    ['Child secondary scope changed to shared image', state => {
      state.approvals.find(item => item.id === 'approval-horse-12x16-size').scope_type = 'shared_image';
    }],
    ['shared immutable scope', state => {
      state.approvals.find(item => item.scope_type === 'shared_image' && item.artifact_id === 'material-v1').asset_scope
        = 'subset_shared';
    }],
    ['shared applicable Child members', state => {
      state.approvals.find(item => item.scope_type === 'shared_image' && item.artifact_id === 'material-v1')
        .applicable_child_skus = ['HORSE-12X16'];
    }],
    ['shared current applicable Child members', state => {
      state.variation.shared_assets['material-v1'].applicable_child_skus = ['HORSE-12X16'];
    }],
    ['shared approval type', state => {
      state.approvals.find(item => item.scope_type === 'shared_image' && item.artifact_id === 'material-v1').type
        = 'listing';
    }]
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      await withTempWorkspace(async root => {
        const project = await approvedProject(root);
        mutate(project.state);
        await writeFile(path.join(project.projectDir, 'state.json'), `${JSON.stringify(project.state, null, 2)}\n`);

        await assert.rejects(
          buildVariationDelivery({
            projectDir: project.projectDir,
            outputDir: path.join(project.projectDir, 'delivery', name.replaceAll(' ', '-')),
            finalApproval: project.finalApproval
          }),
          error => error.code === 'BUNDLE_INVALID'
            && error.details?.reason === 'APPROVAL_SCOPE_MISMATCH'
        );
      });
    });
  }
});

test('verification rejects incomplete, stale, conflicting, or changed Variation packages', async t => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const valid = await buildVariationDelivery({
      ...project,
      outputDir: path.join(project.projectDir, 'delivery', 'valid')
    });
    const cases = [
      ['duplicate tuple', ({matrix}) => matrix.children.push(structuredClone(matrix.children[0])), 'DUPLICATE_VARIATION_TUPLE'],
      ['missing Child main', ({files}) => { delete files['children/HORSE-12X16/main.png']; }, 'MISSING_FILE'],
      ['stale Child Listing', ({matrix}) => { matrix.children[0].listing_version = 99; }, 'APPROVAL_SCOPE_MISMATCH'],
      ['changed Child rule scope', ({files, manifest}) => {
        const archivePath = 'children/HORSE-12X16/listing.json';
        const listing = JSON.parse(Buffer.from(files[archivePath]).toString('utf8'));
        listing.rule_status = 'rules_unverified';
        listing.rules_unverified = ['title'];
        listing.upload_ready = false;
        files[archivePath] = Buffer.from(`${JSON.stringify(listing, null, 2)}\n`);
        const artifact = manifest.artifacts.find(item => item.archive_path === archivePath);
        artifact.byte_size = files[archivePath].length;
        artifact.sha256 = digest(files[archivePath]);
      }, 'APPROVAL_SCOPE_MISMATCH'],
      ['changed shared asset', ({files}) => { files['shared/material.png'] = Buffer.from('changed'); }, 'HASH_MISMATCH'],
      ['rehashed changed shared asset', ({files, manifest}) => {
        const archivePath = 'shared/material.png';
        files[archivePath] = Buffer.from(files['shared/kids-scene.png']);
        const artifact = manifest.artifacts.find(item => item.archive_path === archivePath);
        artifact.byte_size = files[archivePath].length;
        artifact.sha256 = digest(files[archivePath]);
      }, 'HASH_MISMATCH'],
      ['image media type downgrade', ({manifest}) => {
        const artifact = manifest.artifacts.find(item => item.archive_path === 'shared/material.png');
        artifact.media_type = 'application/octet-stream';
      }, 'MANIFEST_INVALID'],
      ['changed image hidden by media type downgrade', ({files, manifest}) => {
        const archivePath = 'shared/material.png';
        files[archivePath] = Buffer.from(files['shared/kids-scene.png']);
        const artifact = manifest.artifacts.find(item => item.archive_path === archivePath);
        artifact.media_type = 'application/octet-stream';
        artifact.byte_size = files[archivePath].length;
        artifact.sha256 = digest(files[archivePath]);
      }, 'HASH_MISMATCH'],
      ['rehashed changed Child Listing JSON', ({files, manifest}) => {
        const archivePath = 'children/HORSE-12X16/listing.json';
        const listing = JSON.parse(Buffer.from(files[archivePath]).toString('utf8'));
        listing.description = 'Substituted after final approval.';
        files[archivePath] = Buffer.from(`${JSON.stringify(listing, null, 2)}\n`);
        const artifact = manifest.artifacts.find(item => item.archive_path === archivePath);
        artifact.byte_size = files[archivePath].length;
        artifact.sha256 = digest(files[archivePath]);
      }, 'HASH_MISMATCH'],
      ['rehashed changed Parent Listing JSON', ({files, manifest}) => {
        const archivePath = 'parent/listing.json';
        const listing = JSON.parse(Buffer.from(files[archivePath]).toString('utf8'));
        listing.description = 'Substituted Parent content after final approval.';
        files[archivePath] = Buffer.from(`${JSON.stringify(listing, null, 2)}\n`);
        const artifact = manifest.artifacts.find(item => item.archive_path === archivePath);
        artifact.byte_size = files[archivePath].length;
        artifact.sha256 = digest(files[archivePath]);
      }, 'HASH_MISMATCH'],
      ['rehashed changed Child Listing Markdown', ({files, manifest}) => {
        const archivePath = 'children/HORSE-12X16/listing.md';
        files[archivePath] = Buffer.from('# Substituted markdown\n');
        const artifact = manifest.artifacts.find(item => item.archive_path === archivePath);
        artifact.byte_size = files[archivePath].length;
        artifact.sha256 = digest(files[archivePath]);
      }, 'HASH_MISMATCH'],
      ['rehashed changed Parent Listing Markdown', ({files, manifest}) => {
        const archivePath = 'parent/listing.md';
        files[archivePath] = Buffer.from('# Substituted Parent markdown\n');
        const artifact = manifest.artifacts.find(item => item.archive_path === archivePath);
        artifact.byte_size = files[archivePath].length;
        artifact.sha256 = digest(files[archivePath]);
      }, 'HASH_MISMATCH'],
      ['missing matrix', ({files}) => { delete files['variation-matrix.json']; }, 'MANIFEST_INVALID'],
      ['incomplete immutable scope', ({manifest}) => { delete manifest.approval_scope.child_skus; }, 'MANIFEST_INVALID'],
      ['absent mapped member', ({matrix}) => { matrix.children[0].asset_paths.push('children/HORSE-12X16/missing.png'); }, 'APPROVAL_SCOPE_MISMATCH'],
      ['missing shared row mapping', ({matrix}) => {
        matrix.children[0].asset_paths = matrix.children[0].asset_paths.filter(item => item !== 'shared/material.png');
      }, 'APPROVAL_SCOPE_MISMATCH'],
      ['injected mapped asset', ({files, matrix, manifest}) => {
        const archivePath = 'shared/injected.png';
        const source = manifest.artifacts.find(item => item.archive_path === 'shared/material.png');
        files[archivePath] = Buffer.from(files[source.archive_path]);
        manifest.artifacts.push({
          ...structuredClone(source), relative_path: archivePath, archive_path: archivePath,
          asset_id: 'injected-v1', asset_ids: ['injected-v1']
        });
        matrix.children[0].asset_paths.push(archivePath);
      }, 'APPROVAL_SCOPE_MISMATCH'],
      ['unrelated Child artifact', ({files, manifest}) => {
        const source = manifest.artifacts.find(item => item.archive_path === 'children/HORSE-12X16/main.png');
        const archivePath = 'children/UNRELATED/main.png';
        files[archivePath] = Buffer.from(files[source.archive_path]);
        manifest.artifacts.push({...structuredClone(source), relative_path: archivePath, archive_path: archivePath});
      }, 'MANIFEST_INVALID'],
      ['unsafe relative traversal hidden by safe archive path', ({manifest}) => {
        manifest.artifacts.find(item => item.archive_path === 'shared/material.png').relative_path = '../outside.png';
      }, 'UNSAFE_PATH'],
      ['unsafe absolute archive path hidden by safe relative path', ({manifest}) => {
        manifest.artifacts.find(item => item.archive_path === 'shared/material.png').archive_path = 'C:/outside.png';
      }, 'UNSAFE_PATH'],
      ['unsafe backslash relative path', ({manifest}) => {
        manifest.artifacts.find(item => item.archive_path === 'shared/material.png').relative_path = 'shared\\material.png';
      }, 'UNSAFE_PATH'],
      ['encoded traversal relative path', ({manifest}) => {
        manifest.artifacts.find(item => item.archive_path === 'shared/material.png').relative_path = 'shared/%2e%2e/outside.png';
      }, 'UNSAFE_PATH']
    ];
    for (const [name, mutate, reason] of cases) {
      await t.test(name, async () => {
        const deliveryDir = path.join(root, `mutated-${name.replaceAll(' ', '-')}`);
        await rewriteVariationPackage(valid.outputDir, deliveryDir, mutate);
        await assert.rejects(
          verifyVariationDelivery({deliveryDir, expectedScope: project.finalApproval}),
          error => error.code === 'BUNDLE_INVALID' && error.details?.reason === reason
        );
        await rm(deliveryDir, {recursive: true, force: true});
      });
    }
  });
});

test('Family verification rejects a package that consistently drops one approved Child', async () => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const valid = await buildVariationDelivery({
      ...project,
      outputDir: path.join(project.projectDir, 'delivery', 'valid-family')
    });
    const deliveryDir = path.join(root, 'family-with-one-child-dropped');
    await rewriteVariationPackage(valid.outputDir, deliveryDir, ({files, matrix, manifest}) => {
      manifest.delivery_scope.child_skus = ['HORSE-12X16'];
      matrix.children = matrix.children.filter(row => row.child_sku === 'HORSE-12X16');
      for (const artifact of [...manifest.artifacts]) {
        if (!artifact.archive_path.startsWith('children/KIDS-12X16/')) continue;
        delete files[artifact.archive_path];
        manifest.artifacts.splice(manifest.artifacts.indexOf(artifact), 1);
      }
      delete files['shared/kids-scene.png'];
      manifest.artifacts = manifest.artifacts.filter(item => item.archive_path !== 'shared/kids-scene.png');
    });
    await assert.rejects(
      verifyVariationDelivery({deliveryDir}),
      error => error.code === 'BUNDLE_INVALID' && error.details?.reason === 'APPROVAL_SCOPE_MISMATCH'
    );
  });
});

test('Child projection provenance must descend from the expected Family final approval', async () => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const result = await buildVariationDelivery({
      ...project,
      childSkus: ['HORSE-12X16'],
      outputDir: path.join(project.projectDir, 'delivery', 'horse-projection')
    });
    const deliveryDir = path.join(root, 'wrong-provenance');
    await rewriteVariationPackage(result.outputDir, deliveryDir, ({manifest}) => {
      manifest.approval_provenance.final_scope_sha256 = 'f'.repeat(64);
    });
    await assert.rejects(
      verifyVariationDelivery({deliveryDir, expectedScope: project.finalApproval}),
      error => error.code === 'BUNDLE_INVALID' && error.details?.reason === 'APPROVAL_SCOPE_MISMATCH'
    );
  });
});

test('standalone verification never treats self-hashed approval provenance as authentic', async () => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const result = await buildVariationDelivery({
      ...project,
      outputDir: path.join(project.projectDir, 'delivery', 'self-hashed')
    });
    const standalone = await verifyVariationDelivery({deliveryDir: result.outputDir});
    assert.equal(standalone.ok, true);
    assert.equal(standalone.scope_verified, false);
    assert.equal(standalone.approval_authenticity_verified, false);

    const deliveryDir = path.join(root, 'consistently-rewritten-scope');
    await rewriteVariationPackage(result.outputDir, deliveryDir, ({manifest}) => {
      manifest.approval_scope.family_identity_version = 99;
      manifest.approval_provenance.final_scope_sha256 = hashVariationFinalScope(manifest.approval_scope);
      manifest.approval_provenance.projection_sha256 = digest(Buffer.from(
        `${JSON.stringify(manifest.approval_scope, null, 2)}\n`
      ));
    });
    const structurallyValid = await verifyVariationDelivery({deliveryDir});
    assert.equal(structurallyValid.scope_verified, false);
    assert.equal(structurallyValid.approval_authenticity_verified, false);
    await assert.rejects(
      verifyVariationDelivery({deliveryDir, expectedScope: project.finalApproval}),
      error => error.code === 'BUNDLE_INVALID' && error.details?.reason === 'APPROVAL_SCOPE_MISMATCH'
    );
  });
});

test('standalone verification rejects every unsafe duplicated final-scope path', async t => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const result = await buildVariationDelivery({
      ...project,
      outputDir: path.join(project.projectDir, 'delivery', 'scope-paths')
    });
    for (const [name, unsafePath] of [
      ['traversal', '../outside.png'],
      ['encoded traversal', 'children/HORSE-12X16/%2e%2e/outside.png']
    ]) {
      await t.test(name, async () => {
        const deliveryDir = path.join(root, `unsafe-scope-${name.replaceAll(' ', '-')}`);
        await rewriteVariationPackage(result.outputDir, deliveryDir, ({manifest}) => {
          manifest.approval_scope.child_versions[0].approved_main_path = unsafePath;
          manifest.approval_provenance.final_scope_sha256 = hashVariationFinalScope(manifest.approval_scope);
          manifest.approval_provenance.projection_sha256 = digest(Buffer.from(
            `${JSON.stringify(manifest.approval_scope, null, 2)}\n`
          ));
        });
        await assert.rejects(
          verifyVariationDelivery({deliveryDir}),
          error => error.code === 'BUNDLE_INVALID' && error.details?.reason === 'UNSAFE_PATH'
        );
      });
    }
  });
});

test('verification enforces an externally supplied immutable approval scope', async () => {
  await withTempWorkspace(async root => {
    const project = await approvedProject(root);
    const result = await buildVariationDelivery({
      ...project,
      outputDir: path.join(project.projectDir, 'delivery', 'family')
    });
    await assert.rejects(
      verifyVariationDelivery({
        deliveryDir: result.outputDir,
        expectedScope: {...project.finalApproval, variation_version: 99}
      }),
      error => error.code === 'BUNDLE_INVALID' && error.details?.reason === 'APPROVAL_SCOPE_MISMATCH'
    );
  });
});
