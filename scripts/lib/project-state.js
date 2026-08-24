import { fail } from './errors.js';

const SCHEMA_VERSION = 2;

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('BLOCKING_INPUT', `${field} is required`);
  }
  return value.trim();
}

export function createProjectState({
  projectId,
  productName = projectId,
  marketplace = 'amazon.com',
  language = 'en-US',
  productType,
  now = new Date().toISOString()
}) {
  const productId = requiredText(projectId, 'projectId');
  return {
    schema_version: SCHEMA_VERSION,
    project: {
      product_id: productId,
      product_name: requiredText(productName, 'productName'),
      marketplace: requiredText(marketplace, 'marketplace'),
      language: requiredText(language, 'language'),
      product_type: requiredText(productType, 'productType'),
      stage: 'intake',
      updated_at: now
    },
    facts: {},
    product_master: null,
    gallery: { plan: [], assets: {}, selected: [] },
    listing: { draft: null, approved: [] },
    approvals: [],
    stale_dependencies: [],
    delivery: null,
    metrics: []
  };
}

export function validateProjectState(state) {
  const errors = [];
  if (state?.schema_version !== SCHEMA_VERSION) errors.push('schema_version must be 2');
  if (!state?.project?.product_id) errors.push('project.product_id is required');
  if (!state?.project?.product_name) errors.push('project.product_name is required');
  if (!state?.project?.marketplace) errors.push('project.marketplace is required');
  if (!state?.project?.language) errors.push('project.language is required');
  if (!state?.project?.product_type) errors.push('project.product_type is required');
  if (!state?.project?.stage) errors.push('project.stage is required');
  if (!state?.facts || Array.isArray(state.facts) || typeof state.facts !== 'object') errors.push('facts must be an object');
  if (!state?.gallery || !Array.isArray(state.gallery.plan) || !state.gallery.assets || !Array.isArray(state.gallery.selected)) {
    errors.push('gallery structure is invalid');
  }
  if (!state?.listing || !Array.isArray(state.listing.approved)) errors.push('listing structure is invalid');
  if (!Array.isArray(state?.approvals)) errors.push('approvals must be an array');
  if (!Array.isArray(state?.stale_dependencies)) errors.push('stale_dependencies must be an array');
  if (!Array.isArray(state?.metrics)) errors.push('metrics must be an array');
  return { valid: errors.length === 0, errors };
}

export function renderProjectSummary(state) {
  const validation = validateProjectState(state);
  if (!validation.valid) fail('BLOCKING_INPUT', 'Cannot render an invalid project state', {errors: validation.errors});

  const master = state.product_master
    ? `v${state.product_master.version} ${state.product_master.status}`
    : 'unlocked';
  const approvedListing = state.listing.approved.at(-1);
  const listing = approvedListing ? `v${approvedListing.version} approved` : state.listing.draft ? 'draft' : 'not started';
  const openQuestions = Object.values(state.facts).filter(fact => ['unknown', 'conflicted'].includes(fact.status));

  return `# ${state.project.product_name}\n\n` +
    `- Product ID: ${state.project.product_id}\n` +
    `- Marketplace: ${state.project.marketplace}\n` +
    `- Language: ${state.project.language}\n` +
    `- Product type: ${state.project.product_type}\n` +
    `- Current stage: ${state.project.stage}\n` +
    `- Product Master: ${master}\n` +
    `- Selected images: ${state.gallery.selected.length}\n` +
    `- Listing: ${listing}\n` +
    `- Delivery: ${state.delivery?.status ?? 'not built'}\n` +
    `- Updated: ${state.project.updated_at}\n\n` +
    `## Open questions\n\n` +
    (openQuestions.length
      ? openQuestions.map(fact => `- ${fact.field ?? fact.id}: ${fact.status}`).join('\n')
      : 'None recorded.') +
    `\n\n## Warnings\n\n` +
    (state.stale_dependencies.length ? state.stale_dependencies.map(item => `- ${item}`).join('\n') : 'None recorded.') +
    `\n`;
}

