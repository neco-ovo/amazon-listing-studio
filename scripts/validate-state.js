#!/usr/bin/env node
import { runCli } from './studio.js';

console.error('[deprecated] Use scripts/studio.js validate.');
const projectDir = process.argv[2];
const result = projectDir
  ? await runCli(['validate', '--project-dir', projectDir])
  : {ok: false, code: 'BLOCKING_INPUT', message: 'Project directory is required'};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok || result.result?.valid === false) process.exitCode = 1;
