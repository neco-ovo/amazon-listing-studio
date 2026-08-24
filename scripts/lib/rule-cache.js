import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_FRESH_DAYS = 90;
const REFRESH_PURPOSES = new Set(['upload_ready', 'verify_current']);

async function jsonFiles(root) {
  try {
    const entries = await readdir(root, {withFileTypes: true});
    const nested = await Promise.all(entries.map(entry => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) return jsonFiles(target);
      return entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
    }));
    return nested.flat();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function appliesTo(snapshot, marketplace, productType) {
  if (snapshot.marketplace !== marketplace) return false;
  const types = snapshot.product_types ?? (snapshot.product_type ? [snapshot.product_type] : []);
  return types.includes('*') || types.includes(productType);
}

function ageInDays(verifiedOn, now) {
  const verified = Date.parse(verifiedOn);
  const current = Date.parse(now);
  if (!Number.isFinite(verified) || !Number.isFinite(current) || current < verified) return Infinity;
  return (current - verified) / 86_400_000;
}

export async function resolveRules({
  libraryDir,
  marketplace,
  productType,
  now = new Date().toISOString(),
  purpose = 'draft',
  freshnessDays = DEFAULT_FRESH_DAYS
}) {
  const files = await jsonFiles(path.join(path.resolve(libraryDir), 'rules'));
  const snapshots = [];
  for (const file of files) {
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    if (appliesTo(snapshot, marketplace, productType)) snapshots.push(snapshot);
  }

  snapshots.sort((left, right) => Date.parse(right.verified_on) - Date.parse(left.verified_on));
  const rules = snapshots[0] ?? null;
  if (!rules) {
    return {
      rules: null,
      status: 'missing',
      refresh_required: REFRESH_PURPOSES.has(purpose),
      warnings: [`No cached rules match ${marketplace}/${productType}.`]
    };
  }

  const status = ageInDays(rules.verified_on, now) <= freshnessDays ? 'fresh' : 'stale';
  return {
    rules: structuredClone(rules),
    status,
    refresh_required: purpose === 'verify_current' || (purpose === 'upload_ready' && status === 'stale'),
    warnings: status === 'stale'
      ? [`Cached rules for ${marketplace}/${productType} are stale; grounded drafting may continue.`]
      : []
  };
}
