import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {buildDelivery} from '../../scripts/lib/bundle.js';
import {acceptGeneratedRaster} from '../../scripts/lib/capabilities.js';
import {validateMainImage} from '../../scripts/lib/images.js';
import {validateListing} from '../../scripts/lib/listing.js';
import * as state from '../../scripts/lib/state.js';
import {fakeImageCapabilities} from '../helpers/fake-capabilities.js';
import {createMainImageFixtures} from '../helpers/png-fixtures.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const now = '2026-08-24T12:00:00.000Z';

test('runs the complete file-first launch workflow without a server', async () => {
  await withTempWorkspace(async root => {
    for (const name of ['approveSecondaryImage', 'recordListingApproval', 'recordFinalApproval']) {
      assert.equal(typeof state[name], 'function', `${name} orchestration helper is required`);
    }

    const initialized = await state.initializeProject(root, {
      projectId: 'fixture-sign', productName: 'Fixture Aluminum Sign', now,
    });
    const projectDir = initialized.projectDir;
    const facts = JSON.parse(await readFile(path.join(projectDir, 'facts.json'), 'utf8'));
    facts.facts.push(state.resolveFact(
      {id: 'size', field: 'dimensions', value: '12x8 in', status: 'user_confirmed', publishable: true, sources: ['user'], conflicts: []},
      {id: 'size', field: 'dimensions', value: '10x7 in', status: 'source_observed', publishable: false, sources: ['link'], conflicts: []},
      {now},
    ));
    assert.equal(facts.facts[0].value, '12x8 in');
    assert.equal(facts.facts[0].conflicts.length, 1);

    const assetDir = path.join(projectDir, 'assets');
    const fixtures = await createMainImageFixtures(assetDir);
    const mainCapabilities = fakeImageCapabilities({path: fixtures.valid});
    const generated = await mainCapabilities.generateImage();
    const accepted = await acceptGeneratedRaster(generated, {
      readFile: mainCapabilities.readFile, inspectImage: mainCapabilities.inspectImage,
    });
    const geometry = await validateMainImage(accepted.path, {physicalWidth: 12, physicalHeight: 8, minOccupancy: 0.95});
    assert.equal(geometry.ok, true);
    const mainBytes = await readFile(fixtures.valid);
    const initialAssets = JSON.parse(await readFile(path.join(projectDir, 'assets.json'), 'utf8'));
    let assets = state.lockProductMaster(initialAssets, {
      now,
      identity: {product_type: 'aluminum sign'},
      dimensions: {width: 12, length: 8, unit: 'in'},
      color: 'brushed silver', material: 'aluminum', variant: 'default', count: 1,
      confirmed_visible_components: ['sign face'],
      canonical_reference_hashes: [hash(mainBytes)], dependency_ids: ['size', 'material', 'color', 'count'],
      approved_main: {id: 'main-v1', version: 1, status: 'approved', path: 'assets/main-valid.png', media_type: 'image/png', sha256: hash(mainBytes), inspection_status: 'pass'},
    });

    const secondaryBytes = await readFile(fixtures.undersized);
    assets = state.approveSecondaryImage(assets, {
      now, approval_id: 'secondary-approval-1',
      image: {id: 'secondary-size-v1', version: 1, kind: 'size-spec', path: 'assets/main-undersized.png', media_type: 'image/png', sha256: hash(secondaryBytes), inspection_status: 'pass'},
      product_master_version: 1,
    });

    const listingInput = JSON.parse(await readFile('tests/fixtures/listing/valid.json', 'utf8'));
    listingInput.version = 1;
    listingInput.product_master_version = 1;
    delete listingInput.validation_context;
    const listingResult = validateListing(listingInput, {
      publishableFactIds: new Set(['type', 'size', 'material', 'shape', 'use_context']),
      currentProductMasterVersion: 1, schemaVerified: true,
    });
    assert.equal(listingResult.ok, true, JSON.stringify(listingResult.errors));
    const listingJson = Buffer.from(`${JSON.stringify(listingResult.listing, null, 2)}\n`);
    const listingMarkdown = Buffer.from(`# ${listingResult.listing.title}\n\n${listingResult.listing.description}\n`);
    await writeFile(path.join(projectDir, 'listing.json'), listingJson);
    await writeFile(path.join(projectDir, 'listing.md'), listingMarkdown);
    assets = state.recordListingApproval(assets, {
      id: 'listing-v1', version: 1, product_master_version: 1, status: 'approved',
      json_path: 'listing.json', json_sha256: hash(listingJson),
      markdown_path: 'listing.md', markdown_sha256: hash(listingMarkdown),
      validation_status: listingResult.status,
    });
    const final = state.recordFinalApproval(assets, {
      id: 'final-approval-1', finalized: true, product_master_version: 1, listing_version: 1,
      artifact_ids: ['main-v1', 'secondary-size-v1'], marketplace: 'amazon.com', product_type: 'METAL_SIGN',
      schema_status: 'verified', upload_ready: true, change_summary: 'Fixture final selection', now,
    });
    await writeFile(path.join(projectDir, 'assets.json'), `${JSON.stringify(final.assets, null, 2)}\n`);
    const delivery = await buildDelivery({projectDir, outputDir: path.join(root, 'delivery-v1'), approval: final.approval});
    assert.equal(delivery.manifest.artifacts.length, 4);

    const moduleNames = await readdir(path.resolve('scripts/lib'));
    const source = (await Promise.all(moduleNames.map(name => readFile(path.resolve('scripts/lib', name), 'utf8')))).join('\n');
    assert.doesNotMatch(source, /server\.js|task-worker\.js|\.listen\s*\(/i);
  });
});
