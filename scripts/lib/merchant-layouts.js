import { readFile } from 'node:fs/promises';
import { fail } from './errors.js';

function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US').replace(/[\s-]+/g, '_');
}

function validateLibrary(library) {
  if (!library || library.schema_version !== 1 || !Array.isArray(library.layouts)) {
    fail('BLOCKING_INPUT', 'Merchant layout library is invalid');
  }
  const ids = new Set();
  for (const layout of library.layouts) {
    if (!layout?.id || ids.has(layout.id) || !layout.asset_type || !layout.preview?.path
      || !/^[a-f0-9]{64}$/.test(layout.preview.sha256 ?? '')
      || layout.reuse_policy !== 'FIXED_LAYOUT_ALLOWED') {
      fail('BLOCKING_INPUT', 'Merchant layout record is invalid', {layout_id: layout?.id ?? null});
    }
    ids.add(layout.id);
  }
  return library;
}

export async function loadMerchantLayouts(filePath) {
  try {
    return validateLibrary(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    if (error.code) throw error;
    fail('BLOCKING_INPUT', 'Cannot read merchant layout library', {path: filePath, reason: error.message});
  }
}

export function selectMerchantLayout(library, context = {}) {
  validateLibrary(library);
  const traits = Object.fromEntries(Object.entries(context.familyTraits ?? {}).map(([key, value]) => [key, normalized(value)]));
  const facts = new Set((context.facts ?? []).map(normalized));
  const excluded = new Set((context.excludedConditions ?? []).map(normalized));
  return library.layouts.find(layout => {
    if (layout.asset_type !== context.assetType) return false;
    if (Object.entries(layout.applicable_traits ?? {}).some(([key, values]) => !values.map(normalized).includes(traits[key]))) return false;
    if ((layout.required_facts ?? []).some(item => !facts.has(normalized(item)))) return false;
    if ((layout.do_not_use_when ?? []).some(item => excluded.has(normalized(item)))) return false;
    return true;
  }) ?? null;
}
