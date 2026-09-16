import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runApprove, runListingRevision } from '../../scripts/studio.js';
import { createProjectState, renderProjectSummary } from '../../scripts/lib/project-state.js';
import { createDraft } from '../../scripts/lib/listing-drafts.js';
import {validateChangedListing} from '../../scripts/lib/operations.js';
import { withTempWorkspace } from '../helpers/temp-workspace.js';

function recordingDependencies(calls) {
  const draftState = {
    listing: {draft: {revision: 1, content: {title: 'Before'}}, approved: []}
  };
  const revisedState = {
    listing: {draft: {revision: 2, content: {title: 'After'}}, approved: []}
  };
  const expansive = name => async () => { calls.push(name); throw new Error(`${name} must not run`); };
  return {
    loadState: async () => { calls.push('load-state'); return draftState; },
    loadKeywordProfile: async () => { calls.push('load-keyword-profile'); return null; },
    patchDraft: (state, patch) => {
      calls.push('patch-draft');
      assert.equal(state, draftState);
      assert.deepEqual(patch.fields, {title: 'After'});
      return revisedState;
    },
    validateChanged: (state, paths, {keywordProfile}) => {
      calls.push('validate-changed');
      assert.equal(state, revisedState);
      assert.deepEqual(paths, ['title']);
      assert.equal(keywordProfile, null);
      return {ok: true};
    },
    renderMarkdown: draft => {
      calls.push('render-markdown');
      assert.equal(draft.revision, 2);
      return '# After\n';
    },
    writeTransaction: async transaction => {
      calls.push('write-transaction');
      assert.equal(transaction.state, revisedState);
      assert.equal(transaction.markdown, '# After\n');
      return {state: revisedState};
    },
    marketResearch: expansive('market-research'),
    ruleRefresh: expansive('rule-refresh'),
    imageGeneration: expansive('image-generation'),
    repositoryTests: expansive('repository-tests')
  };
}

test('single-field revision calls only patch, changed validation, render, and write', async () => {
  const calls = [];
  const result = await runListingRevision({
    projectDir: 'fixture-project',
    patch: {fields: {title: 'After'}, expectedDraftRevision: 1},
    now: '2026-08-25T05:00:00.000Z'
  }, recordingDependencies(calls));

  assert.deepEqual(calls, ['load-state', 'load-keyword-profile', 'patch-draft', 'validate-changed', 'render-markdown', 'write-transaction']);
  assert.equal(result.mode, 'fast');
  assert.deepEqual(result.changed_paths, ['title']);
  assert.ok(!calls.includes('market-research'));
  assert.ok(!calls.includes('rule-refresh'));
  assert.ok(!calls.includes('image-generation'));
  assert.ok(!calls.includes('repository-tests'));
});

test('single-field revision leaves the saved keyword profile untouched', async () => {
  await withTempWorkspace(async projectDir => {
    const profilePath = path.join(projectDir, 'references', 'keyword-profile.json');
    await mkdir(path.dirname(profilePath), {recursive: true});
    await writeFile(profilePath, '{"groups":{"core":[]}}\n');
    const beforeBytes = await readFile(profilePath);
    const beforeTime = (await stat(profilePath)).mtimeMs;
    await runListingRevision({
      projectDir,
      patch: {fields: {title: 'After'}, expectedDraftRevision: 1}
    }, recordingDependencies([]));
    assert.deepEqual(await readFile(profilePath), beforeBytes);
    assert.equal((await stat(profilePath)).mtimeMs, beforeTime);
  });
});

test('keyword profiles ignore unrelated facts but honor declared keyword facts', async () => {
  const state = {
    project: {marketplace: 'amazon.com', language: 'en-US', product_type: 'METAL_SIGN'},
    facts: {
      purpose: {status: 'confirmed', publishable: true, value: 'warn drivers'},
      item_weight: {status: 'confirmed', publishable: true, value: '0.13 kg'},
      included_components: {status: 'confirmed', publishable: true, value: ['sign']}
    },
    listing: {draft: {revision: 1, content: {title: 'Before'}}, approved: []}
  };
  const dependencies = recordingDependencies([]);
  dependencies.loadState = async () => state;
  dependencies.patchDraft = () => ({...state, listing: {draft: {revision: 2, content: {title: 'After'}}, approved: []}});
  dependencies.validateChanged = () => ({ok: true});
  dependencies.renderMarkdown = () => '# After\n';
  dependencies.writeTransaction = async transaction => ({state: transaction.state});
  dependencies.loadKeywordProfile = async () => ({
    marketplace: 'amazon.com', locale: 'en-US', product_type: 'METAL_SIGN',
    normalized_intent: 'safety sign',
    product_facts: {purpose: 'warn drivers', item_weight: '0.2 kg'}
  });
  await runListingRevision({projectDir: 'fixture', patch: {fields: {title: 'After'}}}, dependencies);

  dependencies.loadKeywordProfile = async () => ({
    marketplace: 'amazon.com', locale: 'en-US', product_type: 'METAL_SIGN',
    normalized_intent: 'safety sign', keyword_fact_fields: ['included_components'],
    product_facts: {included_components: ['sign', 'screws']}
  });
  await assert.rejects(
    () => runListingRevision({projectDir: 'fixture', patch: {fields: {title: 'After'}}}, dependencies),
    error => error.code === 'BLOCKING_INPUT' && /stale/i.test(error.message)
  );
});

test('fast Listing validation blocks saved exclusions and changed backend duplicates', () => {
  const profile = {groups: {excluded: [{phrase: 'vinyl kids decal'}]}};
  assert.throws(
    () => validateChangedListing({listing: {draft: {content: {title: 'Vinyl kids decal', bullets: []}}}}, ['title'], {keywordProfile: profile}),
    error => error.code === 'BLOCKING_INPUT'
  );
  assert.throws(
    () => validateChangedListing({listing: {draft: {content: {title: 'Aluminum sign', bullets: [], backend_search_terms: 'aluminum jobsite'}}}}, ['backend_search_terms'], {keywordProfile: {groups: {excluded: [], backend: [{phrase: 'aluminum'}]}}}),
    error => error.code === 'BLOCKING_INPUT'
  );
});

test('Listing approval blocks content excluded by the saved keyword profile', async () => {
  await withTempWorkspace(async projectDir => {
    const base = createProjectState({projectId: 'sign-1', productType: 'METAL_SIGN'});
    base.product_master = {version: 1, status: 'locked', approved_main_id: 'main-v1'};
    const state = createDraft(base, {project_id: 'sign-1', product_master_version: 1, title: 'Vinyl kids decal', bullets: [], item_highlights: '', description: '', backend_search_terms: '', special_features: [], attributes: {}});
    await mkdir(path.join(projectDir, '.studio'), {recursive: true});
    await writeFile(path.join(projectDir, '.studio', 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));
    await mkdir(path.join(projectDir, 'references'), {recursive: true});
    await writeFile(path.join(projectDir, 'references', 'keyword-profile.json'), JSON.stringify({groups: {excluded: [{phrase: 'vinyl kids decal'}]}}));
    await assert.rejects(
      () => runApprove({projectDir, artifactType: 'listing'}),
      error => error.code === 'BLOCKING_INPUT'
    );
  });
});

test('Listing approval freezes the current draft without image-path arguments', async () => {
  await withTempWorkspace(async projectDir => {
    const base = createProjectState({projectId: 'sign-1', productType: 'METAL_SIGN'});
    base.product_master = {version: 1, status: 'locked', approved_main_id: 'main-v1'};
    const state = createDraft(base, {
      project_id: 'sign-1', product_master_version: 1, title: 'Approved title', bullets: [],
      item_highlights: '', description: '', backend_search_terms: '', special_features: [], attributes: {}
    });
    await mkdir(path.join(projectDir, '.studio'), {recursive: true});
    await writeFile(path.join(projectDir, '.studio', 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));

    const result = await runApprove({
      projectDir,
      artifactType: 'listing',
      now: '2026-08-25T05:10:00.000Z'
    });

    assert.equal(result.state.listing.approved[0].version, 1);
    assert.equal(result.state.listing.draft, null);
    assert.equal(result.next_action.kind, 'finalize');
    assert.equal(JSON.parse(await readFile(path.join(projectDir, 'listing', 'listing.json'), 'utf8')).title, 'Approved title');
    assert.match(await readFile(path.join(projectDir, 'listing', 'listing.md'), 'utf8'), /^# Approved title/m);
    const product = JSON.parse(await readFile(path.join(projectDir, 'product.json'), 'utf8'));
    assert.equal(product.listing.product, 'listing/listing.json');
  });
});
