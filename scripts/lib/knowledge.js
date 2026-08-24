import { readFile, readdir } from 'node:fs/promises';
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

async function familyFiles(libraryDir) {
  const directory = path.join(path.resolve(libraryDir), 'seller-families');
  try {
    return (await readdir(directory, {withFileTypes: true}))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => path.join(directory, entry.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function loadKnowledge({libraryDir, marketplace, categoryId, familyId = null, candidateTraits = null}) {
  const market = safeSegment(marketplace, 'marketplace', /^[a-z0-9.-]+$/i);
  const categoryName = safeSegment(categoryId, 'categoryId', /^[a-z0-9][a-z0-9-]*$/i);
  const categoryPath = path.join(path.resolve(libraryDir), 'categories', market, `${categoryName}.json`);
  const category = await readJson(categoryPath, 'category knowledge');
  let family = null;
  let familyMatch = null;
  if (familyId) {
    const familyName = safeSegment(familyId, 'familyId', /^[a-z0-9][a-z0-9-]*$/i);
    family = await readJson(path.join(path.resolve(libraryDir), 'seller-families', `${familyName}.json`), 'seller-family knowledge');
    familyMatch = candidateTraits
      ? matchSellerFamily(family, candidateTraits)
      : {status: 'explicit', family_id: family.family_id};
  } else if (candidateTraits) {
    const candidates = [];
    const incomplete = [];
    for (const filePath of await familyFiles(libraryDir)) {
      const item = await readJson(filePath, 'seller-family knowledge');
      const result = matchSellerFamily(item, candidateTraits);
      if (result.status === 'matched') candidates.push({family: item, match: result});
      else if (result.status === 'needs_confirmation') incomplete.push(result);
    }
    if (candidates.length === 1) {
      family = candidates[0].family;
      familyMatch = candidates[0].match;
    } else if (candidates.length > 1) {
      familyMatch = {status: 'ambiguous', family_ids: candidates.map(item => item.family.family_id)};
    } else if (incomplete.length) {
      familyMatch = {status: 'needs_confirmation', candidates: incomplete};
    } else {
      familyMatch = {status: 'not_matched'};
    }
  }
  return {
    category,
    family,
    familyMatch,
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

function normalizedTrait(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US').replace(/[\s-]+/g, '_');
}

function traitValues(value) {
  return (Array.isArray(value) ? value : [value]).map(normalizedTrait).filter(Boolean);
}

export function matchSellerFamily(family, candidate = {}) {
  const match = family?.match;
  if (!family?.family_id || !match?.required_traits) {
    return {status: 'needs_confirmation', family_id: family?.family_id ?? null, missing_traits: ['family_match_rules']};
  }
  for (const [field, excluded] of Object.entries(match.excluded_traits ?? {})) {
    const actual = normalizedTrait(candidate[field]);
    if (actual && traitValues(excluded).includes(actual)) {
      return {status: 'not_matched', family_id: family.family_id, conflict: field};
    }
  }
  const missing = [];
  for (const [field, accepted] of Object.entries(match.required_traits)) {
    const actual = normalizedTrait(candidate[field]);
    if (!actual) missing.push(field);
    else if (!traitValues(accepted).includes(actual)) {
      return {status: 'not_matched', family_id: family.family_id, conflict: field};
    }
  }
  if (missing.length) return {status: 'needs_confirmation', family_id: family.family_id, missing_traits: missing};
  const category = normalizedTrait(candidate.amazon_category);
  const categoryHint = traitValues(match.category_hints ?? []).includes(category);
  return {
    status: 'matched',
    family_id: family.family_id,
    category_hint_matched: categoryHint,
    basis: Object.keys(match.required_traits)
  };
}

export function evaluateFamilyClaims({family, candidateFacts = {}, projectFacts = {}}) {
  const familyMatch = matchSellerFamily(family, candidateFacts);
  if (familyMatch.status !== 'matched') {
    return {family_match: familyMatch, inherited: {}, confirmation_required: [], questions: []};
  }
  const inherited = {};
  const confirmationRequired = [];
  for (const [factId, fact] of Object.entries(family.facts ?? {})) {
    if (projectFacts[factId]?.status === 'user_confirmed') continue;
    if (['structural', 'family_confirmed'].includes(fact.inheritance)) {
      inherited[factId] = structuredClone(fact);
    } else if (fact.inheritance === 'process') {
      confirmationRequired.push({fact_id: factId, value: structuredClone(fact.value)});
    }
  }
  const labels = confirmationRequired.map(item => item.fact_id.replaceAll('_', '-'));
  return {
    family_match: familyMatch,
    inherited,
    confirmation_required: confirmationRequired,
    questions: labels.length
      ? [`Does this product use the ${family.family_id} family's confirmed ${labels.join(', ')} processes?`]
      : []
  };
}

export function applyFamilyClaimConfirmation({
  family,
  factIds,
  confirmed,
  scope,
  projectFacts = {},
  now = new Date().toISOString()
}) {
  if (!['project', 'seller_family'].includes(scope)) fail('BLOCKING_INPUT', 'Confirmation scope is invalid', {scope});
  if (!Array.isArray(factIds) || factIds.length === 0) fail('BLOCKING_INPUT', 'Confirmed family fact IDs are required');
  const nextFamily = structuredClone(family);
  const nextProjectFacts = structuredClone(projectFacts);
  for (const factId of factIds) {
    const familyFact = nextFamily.facts?.[factId];
    if (!familyFact || familyFact.inheritance !== 'process') {
      fail('BLOCKING_INPUT', 'Confirmation targets an unknown process-dependent family fact', {fact_id: factId});
    }
    if (scope === 'project') {
      nextProjectFacts[factId] = {
        value: confirmed ? structuredClone(familyFact.value) : false,
        status: 'user_confirmed',
        authority: 'project',
        publishable: true,
        source_ids: [`user-family-applicability-${now}`],
        confirmed_at: now
      };
    } else {
      familyFact.inheritance = confirmed ? 'family_confirmed' : 'not_applicable';
      familyFact.applicability_confirmed_at = now;
      familyFact.applicability_confirmed_by = 'user';
    }
  }
  return {family: nextFamily, projectFacts: nextProjectFacts};
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
      if (['process', 'not_applicable'].includes(item.inheritance)) continue;
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
