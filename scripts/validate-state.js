import { validateState } from './lib/state.js';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/validate-state.js <project-dir>');
  process.exitCode = 1;
} else {
  const result = await validateState(target);
  console.log(result.valid ? 'PASS' : 'FAIL');
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = result.valid ? 0 : 1;
}
