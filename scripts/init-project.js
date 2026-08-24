#!/usr/bin/env node
import { runCli } from './studio.js';

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

console.error('[deprecated] Use scripts/studio.js init.');
const args = process.argv.slice(2);
const root = option(args, '--root');
const id = option(args, '--id');
const name = option(args, '--name');
const command = args.includes('--resume')
  ? ['validate', '--project-dir', root]
  : [
      'init', '--project-dir', root, '--project-id', id, '--product-name', name,
      '--marketplace', option(args, '--marketplace') ?? 'amazon.com',
      '--language', option(args, '--language') ?? 'en-US',
      '--product-type', option(args, '--product-type') ?? 'GENERIC_PRODUCT'
    ];
const result = await runCli(command);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
