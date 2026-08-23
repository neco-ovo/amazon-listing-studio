import {writeFile} from 'node:fs/promises';

const REQUIRED_FIELDS = [
  'id', 'version', 'name', 'asset_types', 'use_when', 'do_not_use_when',
  'required_facts', 'product_view', 'composition', 'scene', 'camera',
  'lighting', 'generated_layers', 'deterministic_layers', 'font_style',
  'qa', 'preview', 'provenance',
];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

export function validateTemplateLibrary(library) {
  const errors = [];
  if (!library || !Array.isArray(library.templates)) return {valid: false, errors: ['templates must be an array']};
  if (library.templates.length < 8 || library.templates.length > 12) errors.push('template count must be between 8 and 12');
  const ids = new Set();
  for (const template of library.templates) {
    for (const field of REQUIRED_FIELDS) {
      if (!Object.hasOwn(template, field)) errors.push(`${template.id ?? '<unknown>'}.${field} is required`);
    }
    if (!template.id || ids.has(template.id)) errors.push(`template id is missing or duplicated: ${template.id}`);
    ids.add(template.id);
    for (const field of ['asset_types', 'use_when', 'do_not_use_when', 'required_facts', 'generated_layers', 'deterministic_layers', 'qa']) {
      if (!Array.isArray(template[field])) errors.push(`${template.id}.${field} must be an array`);
    }
    if (!template.preview?.path?.endsWith('.webp')) errors.push(`${template.id}.preview.path must be WebP`);
    if (!['LAYOUT_REFERENCE', 'STYLE_REFERENCE'].includes(template.preview?.reference_role)) errors.push(`${template.id}.preview.reference_role is invalid`);
    if (!/^[a-f0-9]{64}$/.test(template.preview?.sha256 ?? '')) errors.push(`${template.id}.preview.sha256 is invalid`);
    if (!template.provenance?.upstream_url || !Array.isArray(template.provenance?.case_ids)) errors.push(`${template.id}.provenance is incomplete`);
  }
  return {valid: errors.length === 0, errors};
}

export function selectTemplate(library, context = {}) {
  const facts = context.factIds instanceof Set ? context.factIds : new Set(context.factIds ?? []);
  const excluded = new Set(context.exclusions ?? []);
  return library.templates.find(template =>
    template.asset_types.includes(context.assetType)
    && template.required_facts.every(fact => facts.has(fact))
    && template.do_not_use_when.every(condition => !excluded.has(condition))) ?? null;
}

export function diffUpstream(snapshot, upstream) {
  const before = new Map((snapshot.templates ?? []).map(item => [item.id, item]));
  const after = new Map((upstream.templates ?? []).map(item => [item.id, item]));
  const added = [...after.keys()].filter(id => !before.has(id)).sort().map(id => after.get(id));
  const removed = [...before.keys()].filter(id => !after.has(id)).sort().map(id => before.get(id));
  const changed = [...after.keys()]
    .filter(id => before.has(id) && JSON.stringify(stable(before.get(id))) !== JSON.stringify(stable(after.get(id))))
    .sort()
    .map(id => ({id, before: before.get(id), after: after.get(id)}));
  return {added, changed, removed};
}

export async function writeDiffReport(diff, reportPath) {
  await writeFile(reportPath, `${JSON.stringify(diff, null, 2)}\n`, 'utf8');
}
