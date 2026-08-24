import {readFile} from 'node:fs/promises';
import path from 'node:path';

import {buildDelivery} from './lib/bundle.js';

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const projectDir = args[0];
const outputDir = valueAfter(args, '--output');
if (!projectDir || !outputDir) throw new Error('Usage: node scripts/build-delivery.js <project-dir> --output <new-delivery-dir>');
const approval = JSON.parse(await readFile(path.join(projectDir, 'approval.json'), 'utf8'));
const result = await buildDelivery({projectDir, outputDir, approval});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
