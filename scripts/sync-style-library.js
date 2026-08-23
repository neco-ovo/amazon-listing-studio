import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

import {diffUpstream, writeDiffReport} from './lib/templates.js';

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function readJson(location) {
  if (/^https?:\/\//i.test(location)) {
    const response = await fetch(location);
    if (!response.ok) throw new Error(`Unable to read upstream: HTTP ${response.status}`);
    return response.json();
  }
  return JSON.parse(await readFile(location, 'utf8'));
}

const args = process.argv.slice(2);
const upstreamPath = valueAfter(args, '--upstream');
const snapshotPath = valueAfter(args, '--snapshot');
const reportPath = valueAfter(args, '--report');
if (!upstreamPath || !snapshotPath || !reportPath) {
  throw new Error('Usage: node scripts/sync-style-library.js --upstream <file-or-url> --snapshot <reviewed.json> --report <diff.json>');
}
const snapshotBytes = await readFile(snapshotPath);
const beforeHash = createHash('sha256').update(snapshotBytes).digest('hex');
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
const upstream = await readJson(upstreamPath);
const diff = diffUpstream(snapshot, upstream);
await writeDiffReport({...diff, snapshot_sha256: beforeHash, generated_at: new Date().toISOString()}, reportPath);
const afterHash = createHash('sha256').update(await readFile(snapshotPath)).digest('hex');
if (afterHash !== beforeHash) throw new Error('Reviewed snapshot changed during diff generation.');
process.stdout.write(`${JSON.stringify({report: reportPath, snapshot_sha256: beforeHash, added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length})}\n`);
