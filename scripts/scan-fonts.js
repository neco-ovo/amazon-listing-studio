import {writeFile} from 'node:fs/promises';

import {discoverFonts} from './lib/fonts.js';

const args = process.argv.slice(2);
const root = args[0];
const outputIndex = args.indexOf('--output');
const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
if (!root) throw new Error('Usage: node scripts/scan-fonts.js <font-root> [--output catalog.json]');
const catalog = await discoverFonts(root);
if (output) await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
const summary = {
  root: catalog.root,
  files: catalog.files.length,
  extracted: catalog.files.filter(file => file.container === 'file').length,
  archived: catalog.files.filter(file => file.container === 'zip').length,
  families: catalog.families.length,
  metadataFallbacks: catalog.files.filter(file => file.fallback.used).length,
  output,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
