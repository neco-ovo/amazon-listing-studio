import { initializeProject } from './lib/state.js';

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith('--')) continue;
    if (key === '--resume') parsed.resume = true;
    else parsed[key.slice(2)] = values[++index];
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
if (!args.root || !args.id || !args.name) {
  console.error('Usage: node scripts/init-project.js --root <dir> --id <slug> --name <product> [--marketplace amazon.com] [--language en-US] [--resume]');
  process.exitCode = 1;
} else {
  try {
    const result = await initializeProject(args.root, {
      projectId: args.id,
      productName: args.name,
      marketplace: args.marketplace || 'amazon.com',
      language: args.language || 'en-US'
    }, { resume: Boolean(args.resume) });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ code: error.code || 'ERROR', message: error.message, details: error.details || {} }, null, 2));
    process.exitCode = 1;
  }
}
