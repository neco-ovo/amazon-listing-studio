import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runApprove, runListingRevision } from '../../scripts/studio.js';
import { createProjectState, renderProjectSummary } from '../../scripts/lib/project-state.js';
import { createDraft } from '../../scripts/lib/listing-drafts.js';
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
    patchDraft: (state, patch) => {
      calls.push('patch-draft');
      assert.equal(state, draftState);
      assert.deepEqual(patch.fields, {title: 'After'});
      return revisedState;
    },
    validateChanged: (state, paths) => {
      calls.push('validate-changed');
      assert.equal(state, revisedState);
      assert.deepEqual(paths, ['title']);
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

  assert.deepEqual(calls, ['load-state', 'patch-draft', 'validate-changed', 'render-markdown', 'write-transaction']);
  assert.equal(result.mode, 'fast');
  assert.deepEqual(result.changed_paths, ['title']);
  assert.ok(!calls.includes('market-research'));
  assert.ok(!calls.includes('rule-refresh'));
  assert.ok(!calls.includes('image-generation'));
  assert.ok(!calls.includes('repository-tests'));
});

test('Listing approval freezes the current draft without image-path arguments', async () => {
  await withTempWorkspace(async projectDir => {
    const base = createProjectState({projectId: 'sign-1', productType: 'METAL_SIGN'});
    const state = createDraft(base, {
      project_id: 'sign-1', product_master_version: 1, title: 'Approved title', bullets: [],
      item_highlights: '', description: '', backend_search_terms: '', special_features: [], attributes: {}
    });
    await writeFile(path.join(projectDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(path.join(projectDir, 'project.md'), renderProjectSummary(state));

    const result = await runApprove({
      projectDir,
      artifactType: 'listing',
      now: '2026-08-25T05:10:00.000Z'
    });

    assert.equal(result.state.listing.approved[0].version, 1);
    assert.equal(result.state.listing.draft, null);
    assert.equal(result.next_action.kind, 'finalize');
  });
});
