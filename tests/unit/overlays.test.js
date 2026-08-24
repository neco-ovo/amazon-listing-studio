import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import {composeOverlay, layoutOverlay} from '../../scripts/lib/overlays.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const fontPath = 'C:/Windows/Fonts/arial.ttf';
const basePlan = {
  canvas: {width: 1000, height: 1000},
  facts: {'dimensions.width': {value: 12, unit: 'in'}},
  items: [{
    id: 'width',
    type: 'dimension',
    factRef: 'dimensions.width',
    text: '12 in',
    x: 150,
    y: 900,
    width: 700,
    height: 60,
  }],
};

async function makeInput(filePath) {
  await sharp({create: {width: 1000, height: 1000, channels: 3, background: '#eeeeee'}})
    .png()
    .toFile(filePath);
}

test('layoutOverlay rejects empty, out-of-bounds, and unknown-fact copy', () => {
  assert.throws(
    () => layoutOverlay({...basePlan, items: [{...basePlan.items[0], text: '  '}]}),
    error => error.code === 'OVERLAY_INVALID' && /empty/i.test(error.message),
  );
  assert.throws(
    () => layoutOverlay({...basePlan, items: [{...basePlan.items[0], x: 900, width: 200}]}),
    error => error.code === 'OVERLAY_INVALID' && /bounds/i.test(error.message),
  );
  assert.throws(
    () => layoutOverlay({...basePlan, items: [{...basePlan.items[0], factRef: 'dimensions.unknown'}]}),
    error => error.code === 'FACT_UNKNOWN',
  );
  assert.throws(
    () => layoutOverlay({...basePlan, items: [{...basePlan.items[0], text: '15 ft'}]}),
    error => error.code === 'FACT_MISMATCH',
  );
});

test('layoutOverlay allows an item to start at the canvas origin', () => {
  const layout = layoutOverlay({...basePlan, items: [{...basePlan.items[0], x: 0, y: 0}]});
  assert.deepEqual(layout.items[0].bounds, {x: 0, y: 0, width: 700, height: 60});
});

test('composeOverlay creates a decodable raster and exact provenance manifest', async () => {
  await access(fontPath);
  await withTempWorkspace(async root => {
    const inputPath = path.join(root, 'input.png');
    const outputPath = path.join(root, 'output.png');
    await makeInput(inputPath);
    const manifest = await composeOverlay({
      inputPath,
      outputPath,
      plan: basePlan,
      resolvedFont: {path: fontPath, family: 'Arial', source: 'system', fallbackFrom: null},
    });

    assert.equal(manifest.items[0].text, '12 in');
    assert.equal(manifest.items[0].unit, 'in');
    assert.equal(manifest.bounds_ok, true);
    assert.equal((await sharp(outputPath).metadata()).width, 1000);
    assert.notEqual(manifest.input_sha256, manifest.output_sha256);
    assert.equal(manifest.font.path, fontPath);
    assert.equal(manifest.font.fallbackFrom, null);
    assert.deepEqual(JSON.parse(await readFile(`${outputPath}.overlay.json`, 'utf8')), manifest);
  });
});

test('composeOverlay rejects a missing font and discloses a selected fallback', async () => {
  await withTempWorkspace(async root => {
    const inputPath = path.join(root, 'input.png');
    await makeInput(inputPath);
    await assert.rejects(
      composeOverlay({
        inputPath,
        outputPath: path.join(root, 'missing-font.png'),
        plan: basePlan,
        resolvedFont: {path: path.join(root, 'missing.ttf'), family: 'Missing', source: 'local', fallbackFrom: null},
      }),
      error => error.code === 'FONT_UNAVAILABLE',
    );

    const manifest = await composeOverlay({
      inputPath,
      outputPath: path.join(root, 'fallback.png'),
      plan: basePlan,
      resolvedFont: {path: fontPath, family: 'Arial', source: 'system', fallbackFrom: 'Requested Display'},
    });
    assert.equal(manifest.font.fallbackFrom, 'Requested Display');
  });
});

test('composeOverlay renders the selected font bytes into different glyph pixels', async () => {
  await withTempWorkspace(async root => {
    const inputPath = path.join(root, 'input.png');
    await makeInput(inputPath);
    const arial = await composeOverlay({
      inputPath,
      outputPath: path.join(root, 'arial.png'),
      plan: basePlan,
      resolvedFont: {path: 'C:/Windows/Fonts/arial.ttf', family: 'Arial', source: 'system'},
    });
    const times = await composeOverlay({
      inputPath,
      outputPath: path.join(root, 'times.png'),
      plan: basePlan,
      resolvedFont: {path: 'C:/Windows/Fonts/times.ttf', family: 'Times New Roman', source: 'system'},
    });
    assert.notEqual(arial.output_sha256, times.output_sha256);
  });
});

test('composeOverlay shrinks real glyphs to remain inside the approved text box', async () => {
  await withTempWorkspace(async root => {
    const inputPath = path.join(root, 'input.png');
    const outputPath = path.join(root, 'fitted.png');
    await sharp({create: {width: 400, height: 220, channels: 3, background: '#ffffff'}})
      .png()
      .toFile(inputPath);
    const plan = {
      canvas: {width: 400, height: 220},
      facts: {},
      items: [{
        id: 'display-copy',
        type: 'text',
        text: 'WWWWWW',
        x: 120,
        y: 40,
        width: 160,
        height: 140,
        fontSize: 120,
        color: '#000000',
      }],
    };
    const manifest = await composeOverlay({
      inputPath,
      outputPath,
      plan,
      resolvedFont: {path: 'C:/Windows/Fonts/arialbd.ttf', family: 'Arial Bold', source: 'system'},
    });
    const {data, info} = await sharp(outputPath).removeAlpha().raw().toBuffer({resolveWithObject: true});
    let minX = info.width;
    let maxX = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const offset = (y * info.width + x) * info.channels;
        if (data[offset] < 245 || data[offset + 1] < 245 || data[offset + 2] < 245) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    assert.ok(minX >= plan.items[0].x, `glyph begins at ${minX}`);
    assert.ok(maxX < plan.items[0].x + plan.items[0].width, `glyph ends at ${maxX}`);
    assert.ok(manifest.items[0].resolved_font_size < plan.items[0].fontSize);
    assert.ok(manifest.items[0].rendered_text_width <= plan.items[0].width);
  });
});
