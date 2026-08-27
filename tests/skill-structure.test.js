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

test('entrypoint describes two modes and four focused references', async () => {
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  assert.match(skill, /fast mode/i);
  assert.match(skill, /full mode/i);
  for (const name of ['knowledge-and-facts.md', 'image-workflow.md', 'listing-workflow.md', 'delivery-and-compliance.md']) {
    assert.match(skill, new RegExp(name.replace('.', '\\.')));
  }
  assert.doesNotMatch(skill, /read `?references\/capability-contracts\.md`?.*before every/is);
});

test('Skill routes optional Variation work to one focused reference', async () => {
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  const reference = await readFile(path.join(root, 'references', 'variation-workflow.md'), 'utf8');

  assert.match(skill, /Parent|Child/);
  assert.match(skill, /references\/variation-workflow\.md/);
  assert.match(skill, /single-product.+does not load|only when.+Variation/is);
  assert.ok(skill.split(/\r?\n/).length < 220, 'Variation routing must keep SKILL.md compact');
  for (const phrase of [
    'common product identity',
    'purchasable SKU',
    'category-permitted',
    'shared secondary',
    'direct dependents'
  ]) assert.match(reference, new RegExp(phrase, 'i'));
});

test('entrypoint confines each product to a portable collection-root child directory', async () => {
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  assert.match(skill, /projects-root/i);
  assert.match(skill, /product.+root.+before.+(?:design|artifact)/is);
  assert.match(skill, /all.+(?:design|image|Listing|delivery).+inside.+product/is);
  assert.doesNotMatch(skill, /D:\\Amazon/);
});

test('skill routes every hard workflow requirement without bloating frontmatter', async () => {
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  const lines = skill.split(/\r?\n/);
  assert.ok(lines.length < 220, `SKILL.md has ${lines.length} lines`);
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
    /final approval.+current Product Master/i
  ]) assert.match(skill, pattern);
});

test('all routed repository paths exist and use forward slashes', async () => {
  const markdownFiles = [path.join(root, 'SKILL.md'), ...await filesBelow(path.join(root, 'references'), '.md')];
  const routed = new Set();
  for (const file of markdownFiles) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(/`((?:references|scripts|assets)\/[A-Za-z0-9._/-]+)`/g)) routed.add(match[1]);
  }
  assert.ok(routed.size >= 6, 'expected progressive-disclosure routes');
  for (const relative of routed) await access(path.join(root, relative));
});

test('implementation has no legacy WebUI, server, or worker lifecycle', async () => {
  const sourceFiles = await filesBelow(path.join(root, 'scripts'), '.js');
  const prohibited = /(?:\bui\/|server\.js|launcher\.js|task-worker\.js|\.listen\s*\(|worker lease|heartbeat loop)/i;
  for (const file of sourceFiles) {
    assert.doesNotMatch(await readFile(file, 'utf8'), prohibited, path.relative(root, file));
  }
});

test('main-image guidance adapts reference layouts and uses deterministic text only as repair', async () => {
  const imageGuidance = await readFile(path.join(root, 'references', 'image-workflow.md'), 'utf8');
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  assert.match(imageGuidance, /generate.+complete.+exact text.+first/is);
  assert.match(imageGuidance, /deterministic.+repair/i);
  assert.match(imageGuidance, /portrait.+(?:negative|empty) space/i);
  assert.match(imageGuidance, /identity invariants/i);
  for (const token of ['emphasis_fields', 'layout_variant', 'font_mood', 'reference_fidelity', 'text_render_strategy']) {
    assert.match(imageGuidance, new RegExp(token));
  }
  assert.match(imageGuidance, /Google Fonts/);
  assert.match(imageGuidance, /display font.+body font/i);
  assert.match(imageGuidance, /style coherence/i);
  assert.match(skill, /deterministic.+repair/i);
  assert.doesNotMatch(skill, /For exact text, choose a font.+compose-overlay/i);
});

test('image route is compact and defaults to complete one-pass generation', async () => {
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  const imageWorkflow = await readFile(path.join(root, 'references', 'image-workflow.md'), 'utf8');
  assert.match(skill, /references\/image-workflow\.md/);
  assert.doesNotMatch(skill, /references\/(?:image-generation|image-qa)\.md/);
  assert.match(skill, /scripts\/studio\.js/);
  assert.match(imageWorkflow, /one-pass complete image/i);
  assert.doesNotMatch(imageWorkflow, /generate a text-free base first/i);
  assert.match(imageWorkflow, /deterministic edit.*targeted AI edit.*regenerate/is);
  assert.match(imageWorkflow, /at most one unpresented automatic correction/i);
});

test('secondary-image guidance prevents scene props from implying included accessories', async () => {
  const imageWorkflow = await readFile(path.join(root, 'references', 'image-workflow.md'), 'utf8');
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');

  assert.match(imageWorkflow, /props.+included-package claims/i);
  assert.match(imageWorkflow, /(?:screws|fasteners).+(?:unless confirmed|unconfirmed)/i);
  assert.match(skill, /(?:scene props|fasteners).+imply included package contents/i);
});

test('infographic repair anchors dimensions and checks regional balance', async () => {
  const imageWorkflow = await readFile(path.join(root, 'references', 'image-workflow.md'), 'utf8');
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');

  assert.match(imageWorkflow, /dimension line.+measured product bounds/i);
  assert.match(imageWorkflow, /2%.+6%/i);
  assert.match(imageWorkflow, /regional visual balance/i);
  assert.match(skill, /dimension lines.+measured product bounds/i);
  assert.match(skill, /regional visual balance/i);
});

test('skill routes merchant layouts and one-pass commerce quality checks', async () => {
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  const imageWorkflow = await readFile(path.join(root, 'references', 'image-workflow.md'), 'utf8');
  const listingWorkflow = await readFile(path.join(root, 'references', 'listing-workflow.md'), 'utf8');
  const knowledge = await readFile(path.join(root, 'references', 'knowledge-and-facts.md'), 'utf8');

  assert.match(skill, /light drafts.+immutable approvals.+strict delivery/i);
  assert.match(imageWorkflow, /merchant.+layout seed/i);
  assert.match(imageWorkflow, /fixed layout/i);
  assert.match(imageWorkflow, /thumbnail/i);
  assert.match(knowledge, /marketing expressions.+same consolidated question/i);
  assert.match(listingWorkflow, /one.+bounded self-check/i);
  assert.match(listingWorkflow, /do not recursively polish/i);
});

test('approval and delivery guidance expose shared preflight and direct ZIP verification', async () => {
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  const delivery = await readFile(path.join(root, 'references', 'delivery-and-compliance.md'), 'utf8');

  assert.match(skill, /approval.+derive.+system scope/is);
  assert.match(skill, /shared.+finalization preflight/i);
  assert.match(delivery, /verify-delivery/);
  assert.match(delivery, /without extraction/i);
});

test('legacy CLIs are compatibility wrappers instead of duplicate orchestrators', async () => {
  for (const name of ['init-project.js', 'validate-state.js', 'validate-listing.js', 'build-delivery.js']) {
    const source = await readFile(path.join(root, 'scripts', name), 'utf8');
    assert.match(source, /deprecated/i, name);
    assert.ok(source.split(/\r?\n/).length < 70, `${name} is not thin`);
  }
  assert.match(await readFile(path.join(root, 'scripts', 'init-project.js'), 'utf8'), /runCli/);
  assert.match(await readFile(path.join(root, 'scripts', 'validate-state.js'), 'utf8'), /runCli/);
});
