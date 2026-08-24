import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fail } from './errors.js';

function safeSegment(value, field, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('BLOCKING_INPUT', `${field} is invalid`, {[field]: value ?? null});
  }
  return value;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    fail('BLOCKING_INPUT', `Cannot read ${label}`, {path: filePath, reason: error.message});
  }
}

export async function loadKnowledge({libraryDir, marketplace, categoryId, familyId = null}) {
  const market = safeSegment(marketplace, 'marketplace', /^[a-z0-9.-]+$/i);
  const categoryName = safeSegment(categoryId, 'categoryId', /^[a-z0-9][a-z0-9-]*$/i);
  const categoryPath = path.join(path.resolve(libraryDir), 'categories', market, `${categoryName}.json`);
  const category = await readJson(categoryPath, 'category knowledge');
  let family = null;
  if (familyId) {
    const familyName = safeSegment(familyId, 'familyId', /^[a-z0-9][a-z0-9-]*$/i);
    family = await readJson(path.join(path.resolve(libraryDir), 'seller-families', `${familyName}.json`), 'seller-family knowledge');
  }
  return {
    category,
    family,
    marketLanguage: Array.isArray(category.market_language) ? structuredClone(category.market_language) : []
  };
}

function sourceIds(item) {
  return [...new Set((item?.source_ids ?? item?.sources ?? []).filter(Boolean))];
}

function validScope(scope) {
  return scope && typeof scope === 'object' && !Array.isArray(scope)
    && Object.values(scope).some(value => typeof value === 'string' && value.trim() !== '');
}

export function mergeKnowledge({category = null, family = null, projectFacts = {}}) {
  const merged = {};

  for (const [field, item] of Object.entries(category?.observations ?? {})) {
    merged[field] = {
      value: structuredClone(item.value),
      authority: 'category',
      publishable: false,
      source_ids: sourceIds(item),
      observed_at: item.observed_at ?? null
    };
  }

  if (family) {
    if (!family.family_id || family.confirmed_by !== 'user' || !family.confirmed_at || !validScope(family.scope)) {
      fail('BLOCKING_INPUT', 'Seller-family facts require an explicit user confirmation scope', {
        family_id: family.family_id ?? null
      });
    }
    for (const [field, item] of Object.entries(family.facts ?? {})) {
      merged[field] = {
        value: structuredClone(item.value),
        authority: 'seller_family',
        publishable: true,
        source_ids: sourceIds(item),
        family_id: family.family_id,
        scope: structuredClone(family.scope),
        confirmed_at: family.confirmed_at
      };
    }
  }

  for (const [field, item] of Object.entries(projectFacts ?? {})) {
    merged[field] = {
      value: structuredClone(item.value),
      authority: 'project',
      publishable: item.status === 'user_confirmed' && item.publishable !== false,
      status: item.status ?? 'unknown',
      source_ids: sourceIds(item)
    };
  }

  return merged;
}
