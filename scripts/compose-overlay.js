import {readFile} from 'node:fs/promises';

import {composeOverlay} from './lib/overlays.js';

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const [inputPath, outputPath] = args;
const planPath = valueAfter(args, '--plan');
const fontPath = valueAfter(args, '--font');
if (!inputPath || !outputPath || !planPath || !fontPath) {
  throw new Error('Usage: node scripts/compose-overlay.js <input> <output> --plan plan.json --font font.ttf [--family Name] [--source local]');
}
const plan = JSON.parse(await readFile(planPath, 'utf8'));
const manifest = await composeOverlay({
  inputPath,
  outputPath,
  plan,
  resolvedFont: {
    path: fontPath,
    family: valueAfter(args, '--family') ?? 'Resolved Font',
    source: valueAfter(args, '--source') ?? 'local',
    fallbackFrom: valueAfter(args, '--fallback-from') ?? null,
  },
});
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
