import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.');

async function filesBelow(directory, extension) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(absolute, extension));
    else if (!extension || absolute.endsWith(extension)) files.push(absolute);
  }
  return files;
}

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

test('skill routes every hard workflow requirement without bloating frontmatter', async () => {
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  const lines = skill.split(/\r?\n/);
  assert.ok(lines.length < 500, `SKILL.md has ${lines.length} lines`);
  const closing = lines.indexOf('---', 1);
  const keys = lines.slice(1, closing).filter(Boolean).map(line => line.split(':', 1)[0]);
  assert.deepEqual(keys, ['name', 'description']);
  assert.doesNotMatch(skill, /(?:references|scripts|assets)\\/);

  for (const pattern of [
    /call `generate_image`/i,
    /inspect.+exact saved (?:path|file)/i,
    /explicit user facts.+authoritative/i,
    /lock Product Master only after/i,
    /secondary images one at a time/i,
    /one consolidated Listing review/i,
    /rules_unverified.+upload_ready=false/i,
    /final approval.+current Product Master/i,
  ]) assert.match(skill, pattern);
});

test('all routed repository paths exist and use forward slashes', async () => {
  const markdownFiles = [path.join(root, 'SKILL.md'), ...await filesBelow(path.join(root, 'references'), '.md')];
  const routed = new Set();
  for (const file of markdownFiles) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/`((?:references|scripts|assets)\/[A-Za-z0-9._/-]+)`/g)) routed.add(match[1]);
  }
  assert.ok(routed.size >= 6, 'expected progressive-disclosure routes');
  for (const relative of routed) await access(path.join(root, relative));
});

test('implementation has no legacy WebUI, server, or worker lifecycle', async () => {
  const sourceFiles = await filesBelow(path.join(root, 'scripts'), '.js');
  const prohibited = /(?:\bui\/|server\.js|launcher\.js|task-worker\.js|\.listen\s*\(|worker lease|heartbeat loop)/i;
  for (const file of sourceFiles) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, prohibited, path.relative(root, file));
  }
});

test('main-image guidance adapts reference layouts and uses deterministic text only as repair', async () => {
  const imageGuidance = await readFile(path.join(root, 'references', 'image-generation.md'), 'utf8');
  const fontGuidance = await readFile(path.join(root, 'references', 'font-selection.md'), 'utf8');
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');

  assert.match(imageGuidance, /generate.+complete.+exact text.+first/i);
  assert.match(imageGuidance, /deterministic.+repair/i);
  assert.match(imageGuidance, /portrait.+(?:negative|empty) space/i);
  assert.match(imageGuidance, /identity invariants/i);
  assert.match(imageGuidance, /emphasis_fields/);
  assert.match(imageGuidance, /layout_variant/);
  assert.match(imageGuidance, /font_mood/);
  assert.match(imageGuidance, /reference_fidelity/);
  assert.match(imageGuidance, /text_render_strategy/);
  assert.match(fontGuidance, /Google Fonts/);
  assert.match(fontGuidance, /display font.+body font/i);
  assert.match(fontGuidance, /style coherence/i);
  assert.match(skill, /deterministic.+repair/i);
  assert.doesNotMatch(skill, /For exact text, choose a font.+compose-overlay/i);
});
