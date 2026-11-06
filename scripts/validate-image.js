import {resolve} from 'node:path';

import {validateMainImage} from './lib/images.js';

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith('--'))) throw new Error(`${flag} requires a value.`);
  return index >= 0 ? args[index + 1] : undefined;
}

function parsePhysical(value) {
  if (!value) return {};
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i.exec(value);
  if (!match) throw new Error('--physical must use WIDTHxHEIGHT, for example 12x8.');
  return {physicalWidth: Number(match[1]), physicalHeight: Number(match[2])};
}

const args = process.argv.slice(2);
const file = args[0];
if (!file) throw new Error('Usage: node scripts/validate-image.js <path> --kind main [--physical 12x8] [--min-occupancy 0.85] [--ratio-policy advisory|required] [--ratio-tolerance 0.02] [--ratio-source evidence]');
if ((valueAfter(args, '--kind') ?? 'main') !== 'main') throw new Error('Only --kind main is currently supported.');
const result = await validateMainImage(resolve(file), {
  ...parsePhysical(valueAfter(args, '--physical')),
  ratioPolicy: valueAfter(args, '--ratio-policy') ?? 'advisory',
  ratioTolerance: args.includes('--ratio-tolerance') ? Number(valueAfter(args, '--ratio-tolerance')) : undefined,
  ratioConstraintSource: valueAfter(args, '--ratio-source'),
  minOccupancy: Number(valueAfter(args, '--min-occupancy') ?? 0.85),
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
