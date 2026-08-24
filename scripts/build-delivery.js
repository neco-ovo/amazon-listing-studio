#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDelivery } from './lib/bundle.js';

console.error('[deprecated] Use scripts/studio.js finalization when available.');
const args = process.argv.slice(2);
const projectDir = args[0];
const outputIndex = args.indexOf('--output');
const outputDir = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
if (!projectDir || !outputDir) throw new Error('Usage: node scripts/build-delivery.js <project-dir> --output <new-delivery-dir>');
const approval = JSON.parse(await readFile(path.join(projectDir, 'approval.json'), 'utf8'));
const result = await buildDelivery({projectDir, outputDir, approval});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
