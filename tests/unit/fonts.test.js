import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {zipSync} from 'fflate';

import {
  discoverFonts,
  inspectZipFonts,
  normalizeFamily,
  selectFont,
} from '../../scripts/lib/fonts.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const bytes = value => new TextEncoder().encode(value);

function clearUtf8Flags(archive) {
  const buffer = Buffer.from(archive);
  for (let offset = 0; offset <= buffer.length - 4; offset += 1) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x04034b50) buffer.writeUInt16LE(buffer.readUInt16LE(offset + 6) & ~0x0800, offset + 6);
    if (signature === 0x02014b50) buffer.writeUInt16LE(buffer.readUInt16LE(offset + 8) & ~0x0800, offset + 8);
  }
  return buffer;
}

test('discovers extracted and archived formats and groups cross-format families', async () => {
  await withTempWorkspace(async root => {
    const akony = path.join(root, 'Display', 'AKONY');
    const sassy = path.join(root, 'Script', 'Sassy Charm');
    await mkdir(akony, {recursive: true});
    await mkdir(sassy, {recursive: true});
    await Promise.all([
      writeFile(path.join(akony, 'AKONY.otf'), bytes('otf')),
      writeFile(path.join(akony, 'AKONY.ttf'), bytes('ttf')),
      writeFile(path.join(sassy, 'Sassy Charm.woff'), bytes('woff')),
      writeFile(path.join(sassy, 'Sassy Charm.woff2'), bytes('woff2')),
      writeFile(path.join(root, 'font-pack.zip'), zipSync({'collection/Sassy Charm.ttc': bytes('ttc')})),
    ]);

    const catalog = await discoverFonts(root, {
      readMetadata: async (sourcePath, fontBytes) => ({
        family: sourcePath.includes('AKONY') ? '  akony  ' : 'SASSY   CHARM',
        postscriptName: sourcePath.includes('AKONY') ? 'AKONY-Regular' : 'SassyCharm-Regular',
        variant: 'Regular',
        languages: ['latin'],
        styleTags: sourcePath.includes('AKONY') ? ['display'] : ['script'],
        byteLength: fontBytes.length,
      }),
    });

    assert.equal(catalog.files.length, 5);
    assert.equal(catalog.families.length, 2);
    assert.deepEqual(catalog.files.map(file => file.format).sort(), ['otf', 'ttc', 'ttf', 'woff', 'woff2']);
    assert.ok(catalog.files.some(file => file.container === 'zip'));
    assert.ok(catalog.files.every(file => file.sha256 && file.sourceLabel));
    assert.deepEqual(catalog.families.map(family => family.normalizedFamily), ['AKONY', 'Sassy Charm']);
  });
});

test('normalizeFamily handles aliases without collapsing distinct subfamilies', () => {
  assert.equal(normalizeFamily({family: '  akony '}, {aliases: {'akony': 'AKONY'}}), 'AKONY');
  assert.equal(normalizeFamily({family: 'SASSY   CHARM'}), 'Sassy Charm');
  assert.notEqual(normalizeFamily({family: 'Les Flos Chaos'}), normalizeFamily({family: 'Les Flos Sage'}));
  assert.notEqual(normalizeFamily({family: 'Les Flos Sage'}), normalizeFamily({family: 'Les Flos Sans'}));
});

test('inspectZipFonts rejects traversal and configured archive limits', () => {
  assert.throws(
    () => inspectZipFonts(zipSync({'../evil.ttf': bytes('bad')})),
    error => error.code === 'UNSAFE_ARCHIVE' && /path/i.test(error.message),
  );
  assert.throws(
    () => inspectZipFonts(zipSync({'large.ttf': bytes('123456')}), {maxEntryBytes: 5}),
    error => error.code === 'UNSAFE_ARCHIVE' && /entry size/i.test(error.message),
  );
  assert.throws(
    () => inspectZipFonts(zipSync({'dense.ttf': new Uint8Array(2000)}), {maxCompressionRatio: 2}),
    error => error.code === 'UNSAFE_ARCHIVE' && /compression ratio/i.test(error.message),
  );
});

test('inspectZipFonts uses the ZIP encoding flag consistently with extraction', () => {
  const legacyNamedArchive = clearUtf8Flags(zipSync({'字体包/字体.ttf': bytes('font')}));
  const entries = inspectZipFonts(legacyNamedArchive);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].bytes.toString(), 'font');
});

test('selectFont follows requested family and discloses fallback', () => {
  const catalog = {
    files: [
      {normalizedFamily: 'AKONY', variant: 'Regular', sourcePath: 'a.otf'},
      {normalizedFamily: 'Sassy Charm', variant: 'Regular', sourcePath: 'b.ttf'},
    ],
  };
  assert.deepEqual(selectFont(catalog, {family: 'AKONY'}), {
    ...catalog.files[0],
    fallbackFrom: null,
  });
  assert.deepEqual(selectFont(catalog, {family: 'Missing', fallbackFamily: 'Sassy Charm'}), {
    ...catalog.files[1],
    fallbackFrom: 'Missing',
  });
});
