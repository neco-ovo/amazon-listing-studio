import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('skill is discoverable and Codex-primary', async () => {
  const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /^---\r?\nname: amazon-listing-studio\r?\ndescription: .+\r?\n---/);
  assert.match(skill, /generate_image/);
  assert.match(skill, /inspect_image/);
  assert.match(skill, /prompt-only/i);
  assert.doesNotMatch(skill, /start.*server|heartbeat|worker lease/i);

  const metadata = await readFile(new URL('../agents/openai.yaml', import.meta.url), 'utf8');
  assert.match(metadata, /allow_implicit_invocation: true/);
  assert.match(metadata, /\$amazon-listing-studio/);
});
