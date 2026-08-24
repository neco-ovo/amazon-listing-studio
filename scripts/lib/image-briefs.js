import { fail } from './errors.js';

const IDENTITY_CHANGE_FLAGS = Object.freeze({
  change_printed_copy: 'printed_copy',
  change_palette: 'palette',
  change_warning_semantics: 'warning_semantics',
  change_structure: 'structure'
});

function authorizedIdentityChanges(userRequest) {
  return Object.entries(IDENTITY_CHANGE_FLAGS)
    .filter(([flag]) => userRequest?.[flag] === true)
    .map(([, field]) => field);
}

function differences(userRequest, master) {
  const selected = [];
  const add = value => {
    if (!selected.includes(value)) selected.push(value);
  };
  for (const item of userRequest?.presentation_changes ?? []) add(item);
  if (userRequest?.target_orientation === 'portrait' || master?.orientation === 'portrait') {
    add('reflow_for_portrait_hierarchy');
    add('rebalance_vertical_regions');
  }
  if ((userRequest?.emphasis_fields ?? []).length > 0) add('differentiate_emphasis_typography');
  add('redistribute_visual_mass_and_negative_space');
  add('adjust_type_scale_and_line_spacing');
  return selected.slice(0, Math.max(2, selected.length));
}

function permittedClaims(claims) {
  return Object.fromEntries(
    Object.entries(claims ?? {})
      .filter(([, claim]) => claim?.publishable === true)
      .map(([field, claim]) => [field, structuredClone(claim.value)])
  );
}

export function compileImageBrief({
  kind,
  master,
  userRequest = {},
  references = {},
  claims = {},
  galleryItem = {}
}) {
  if (!kind || !master?.identity) fail('BLOCKING_INPUT', 'Image kind and authoritative product identity are required');
  const identityChanges = authorizedIdentityChanges(userRequest);
  if (identityChanges.length > 0 && userRequest.allow_identity_redesign !== true) {
    fail('BLOCKING_INPUT', 'Product identity redesign requires explicit user authorization', {changes: identityChanges});
  }

  const identity = {
    ...structuredClone(master.identity),
    printed_copy: structuredClone(master.printed_copy ?? []),
    palette: structuredClone(master.palette ?? []),
    warning_semantics: master.warning_semantics ?? null,
    orientation: master.orientation ?? null,
    product_master_version: master.version ?? null
  };
  const traceableTypography = userRequest.font_traceability === true || userRequest.deterministic_typography === true;

  return {
    identity,
    goal: galleryItem.goal ?? userRequest.goal ?? kind,
    source_roles: {
      product: 'identity_reference',
      layout: 'layout_only',
      competitor_links: 'market_data_only',
      product_paths: structuredClone(references.product ?? []),
      layout_paths: structuredClone(references.layout ?? [])
    },
    permitted_claims: permittedClaims(claims),
    difference_plan: differences(userRequest, master),
    text_strategy: traceableTypography ? 'deterministic_traceable' : 'one_pass_complete',
    exclusions: [
      'competitor imagery as product identity',
      'unconfirmed product claims or included accessories',
      'unapproved identity changes',
      'unintended empty composition corridors'
    ],
    output: {
      kind,
      gallery_item_id: galleryItem.id ?? null,
      target_orientation: userRequest.target_orientation ?? master.orientation ?? null,
      requires_new_product_master: master.status === 'locked' && identityChanges.length > 0,
      authorized_identity_changes: identityChanges,
      font_style_sources: traceableTypography
        ? [userRequest.preferred_font_source ?? 'local_or_google_fonts']
        : ['local_or_google_fonts_as_visual_reference']
    }
  };
}
