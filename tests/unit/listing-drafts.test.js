import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectState } from '../../scripts/lib/project-state.js';
import { approveDraft, createDraft, renderListing, reviseDraft } from '../../scripts/lib/listing-drafts.js';

const now = '2026-08-25T04:00:00.000Z';

function listing() {
  return {
    project_id: 'sign-1',
    marketplace: 'amazon.com',
    language: 'en-US',
    product_type: 'METAL_SIGN',
    product_master_version: 1,
    title: 'Hard Hat Required Sign',
    item_highlights: 'Clear PPE warning for jobsites and work areas.',
    bullets: [
      {heading: 'VISIBLE WARNING', body: 'Clear safety message for active work areas.'},
      {heading: 'ALUMINUM BUILD', body: 'Lightweight aluminum construction.'},
      {heading: 'INDOOR OR OUTDOOR', body: 'Built for common workplace settings.'},
      {heading: 'EASY TO MOUNT', body: 'Four corner holes simplify mounting.'},
      {heading: 'COMPACT FORMAT', body: 'Portrait format fits practical surfaces.'}
    ],
    description: 'A compact aluminum warning sign for workplace display.',
    backend_search_terms: 'jobsite ppe head protection work area',
    special_features: ['Rounded corners'],
    attributes: {material: 'Aluminum'}
  };
}

function stateWithDraft() {
  const state = createProjectState({projectId: 'sign-1', productType: 'METAL_SIGN', now});
  state.product_master = {version: 1, status: 'locked', approved_main_id: 'main-v1'};
  return createDraft(state, listing(), {now});
}

test('micro revision preserves all unselected content', () => {
  const state = stateWithDraft();
  const before = structuredClone(state.listing.draft.content);
  const next = reviseDraft(state, {
    fields: {'bullets.3.body': 'Four pre-drilled corner holes make mounting easy.'},
    expectedDraftRevision: 1
  }, {now: '2026-08-25T04:01:00.000Z'});

  assert.equal(next.listing.draft.revision, 2);
  assert.equal(next.listing.draft.content.title, before.title);
  assert.deepEqual(next.listing.draft.content.bullets.slice(0, 3), before.bullets.slice(0, 3));
  assert.deepEqual(next.listing.draft.content.bullets[4], before.bullets[4]);
  assert.equal(next.listing.draft.content.bullets[3].body, 'Four pre-drilled corner holes make mounting easy.');
  assert.equal(state.listing.draft.content.bullets[3].body, before.bullets[3].body);
});

test('formal version and hashes are created only on approval', () => {
  const state = stateWithDraft();
  const revised = reviseDraft(state, {
    fields: {description: 'A concise replacement description.'},
    expectedDraftRevision: 1
  }, {now});

  assert.equal(revised.listing.approved.length, 0);
  assert.equal(revised.listing.draft.json_sha256, undefined);
  const approved = approveDraft(revised, {userAction: 'approved', now});
  assert.equal(approved.listing.approved[0].version, 1);
  assert.match(approved.listing.approved[0].json_sha256, /^[a-f0-9]{64}$/);
  assert.match(approved.listing.approved[0].markdown_sha256, /^[a-f0-9]{64}$/);
  assert.equal(approved.listing.approved[0].content.version, 1);
  assert.equal(approved.listing.draft, null);
  assert.equal(revised.listing.draft.content.version, undefined);
});

test('approved snapshots remain unchanged while a new draft is revised', () => {
  const approved = approveDraft(stateWithDraft(), {userAction: 'approved', now});
  const snapshot = structuredClone(approved.listing.approved[0]);
  const drafted = createDraft(approved, {...snapshot.content, title: 'Second draft title'}, {now});
  const revised = reviseDraft(drafted, {
    fields: {title: 'Revised second draft title'},
    expectedDraftRevision: 1
  }, {now});

  assert.deepEqual(revised.listing.approved[0], snapshot);
  assert.equal(revised.listing.draft.content.title, 'Revised second draft title');
});

test('rejects stale revisions and paths outside the existing draft', () => {
  const state = stateWithDraft();
  assert.throws(
    () => reviseDraft(state, {fields: {title: 'x'}, expectedDraftRevision: 0}),
    error => error.code === 'STALE_DEPENDENCY'
  );
  assert.throws(
    () => reviseDraft(state, {fields: {'attributes.unconfirmed': 'x'}, expectedDraftRevision: 1}),
    error => error.code === 'BLOCKING_INPUT' && /unknown/i.test(error.message)
  );
});

test('renders listing markdown deterministically', () => {
  const draft = stateWithDraft().listing.draft;
  const first = renderListing(draft);
  const second = renderListing(structuredClone(draft));
  assert.equal(first, second);
  assert.match(first, /# Hard Hat Required Sign/);
  assert.match(first, /\*\*VISIBLE WARNING\*\*/);
});

test('approval derives finalizer scope metadata from current project state', () => {
  const state = stateWithDraft();
  delete state.listing.draft.content.project_id;
  delete state.listing.draft.content.rules_unverified;
  delete state.listing.draft.content.upload_ready;
  state.listing.rules_unverified = ['attributes', 'special_features'];

  const approved = approveDraft(state, {userAction: 'approved', now});
  const content = approved.listing.approved[0].content;
  assert.equal(content.project_id, state.project.product_id);
  assert.equal(content.marketplace, state.project.marketplace);
  assert.equal(content.product_type, state.project.product_type);
  assert.equal(content.product_master_version, state.product_master.version);
  assert.deepEqual(content.rules_unverified, ['attributes', 'special_features']);
  assert.equal(content.upload_ready, false);
});

test('Listing approval rejects a stale Product Master before creating a version', () => {
  const state = stateWithDraft();
  state.product_master.status = 'stale';
  assert.throws(
    () => approveDraft(state, {userAction: 'approved', now}),
    error => error.code === 'STALE_DEPENDENCY'
  );
  assert.equal(state.listing.approved.length, 0);
});
