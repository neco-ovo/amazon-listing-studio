import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';

import sharp from 'sharp';

import {DomainError} from './errors.js';

function invalid(message, details = {}) {
  return new DomainError('OVERLAY_INVALID', message, details);
}

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw invalid(`${label} must be a positive number.`);
}

function finiteNonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw invalid(`${label} must be a nonnegative number.`);
}

export function layoutOverlay(plan) {
  finitePositive(plan?.canvas?.width, 'Canvas width');
  finitePositive(plan?.canvas?.height, 'Canvas height');
  if (!Array.isArray(plan.items) || plan.items.length === 0) throw invalid('Overlay items are required.');
  const ids = new Set();
  const items = plan.items.map(item => {
    if (!item.id || ids.has(item.id)) throw invalid('Overlay item IDs must be nonempty and unique.', {id: item.id});
    ids.add(item.id);
    if (typeof item.text !== 'string' || item.text.trim().length === 0) throw invalid('Overlay text cannot be empty.', {id: item.id});
    for (const field of ['x', 'y']) finiteNonnegative(item[field], `${item.id}.${field}`);
    for (const field of ['width', 'height']) finitePositive(item[field], `${item.id}.${field}`);
    if (item.x < 0 || item.y < 0 || item.x + item.width > plan.canvas.width || item.y + item.height > plan.canvas.height) {
      throw invalid('Overlay item exceeds canvas bounds.', {id: item.id});
    }
    let fact = null;
    if (item.factRef) {
      fact = plan.facts?.[item.factRef];
      if (fact === undefined) throw new DomainError('FACT_UNKNOWN', 'Overlay references an unknown fact.', {id: item.id, factRef: item.factRef});
    }
    return {
      ...item,
      text: item.text,
      unit: fact?.unit ?? item.unit ?? null,
      fact_value: fact?.value ?? null,
      bounds: {x: item.x, y: item.y, width: item.width, height: item.height},
    };
  });
  return {canvas: {...plan.canvas}, items, bounds_ok: true};
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function itemSvg(item) {
  const color = escapeXml(item.color ?? '#111111');
  const fontSize = Math.max(12, Math.min(item.fontSize ?? item.height * 0.55, item.height * 0.8));
  const centerX = item.x + item.width / 2;
  const centerY = item.y + item.height / 2;
  const text = `<text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" font-family="OverlayFont" font-size="${fontSize}" fill="${color}">${escapeXml(item.text)}</text>`;
  if (item.type !== 'dimension') return text;
  const lineY = item.y + item.height - 4;
  const arrow = Math.min(12, item.height / 4);
  return [
    `<line x1="${item.x}" y1="${lineY}" x2="${item.x + item.width}" y2="${lineY}" stroke="${color}" stroke-width="3"/>`,
    `<polyline points="${item.x + arrow},${lineY - arrow / 2} ${item.x},${lineY} ${item.x + arrow},${lineY + arrow / 2}" fill="none" stroke="${color}" stroke-width="3"/>`,
    `<polyline points="${item.x + item.width - arrow},${lineY - arrow / 2} ${item.x + item.width},${lineY} ${item.x + item.width - arrow},${lineY + arrow / 2}" fill="none" stroke="${color}" stroke-width="3"/>`,
    text,
  ].join('');
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function composeOverlay({inputPath, outputPath, plan, resolvedFont}) {
  const layout = layoutOverlay(plan);
  let fontBytes;
  try {
    fontBytes = await readFile(resolvedFont?.path);
  } catch (cause) {
    const error = new DomainError('FONT_UNAVAILABLE', 'Resolved overlay font file is unavailable.', {path: resolvedFont?.path});
    error.cause = cause;
    throw error;
  }
  const inputBytes = await readFile(inputPath);
  const inputMetadata = await sharp(inputBytes).metadata();
  if (inputMetadata.width !== layout.canvas.width || inputMetadata.height !== layout.canvas.height) {
    throw invalid('Overlay canvas does not match the input raster dimensions.', {
      expected: layout.canvas,
      actual: {width: inputMetadata.width, height: inputMetadata.height},
    });
  }
  const embeddedFont = fontBytes.toString('base64');
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.canvas.width}" height="${layout.canvas.height}">`
    + `<style>@font-face{font-family:OverlayFont;src:url(data:font/ttf;base64,${embeddedFont}) format('truetype');}</style>`
    + layout.items.map(itemSvg).join('')
    + '</svg>',
  );
  await sharp(inputBytes).composite([{input: svg, left: 0, top: 0}]).toFile(outputPath);
  const outputBytes = await readFile(outputPath);
  const outputMetadata = await sharp(outputBytes).metadata();
  if (outputMetadata.width !== layout.canvas.width || outputMetadata.height !== layout.canvas.height) {
    throw invalid('Composed raster dimensions changed unexpectedly.', {outputMetadata});
  }
  const manifest = {
    schema_version: 1,
    input_path: inputPath,
    output_path: outputPath,
    canvas: layout.canvas,
    items: layout.items,
    bounds_ok: layout.bounds_ok,
    font: {
      path: resolvedFont.path,
      family: resolvedFont.family,
      source: resolvedFont.source,
      sha256: hash(fontBytes),
      fallbackFrom: resolvedFont.fallbackFrom ?? null,
    },
    input_sha256: hash(inputBytes),
    output_sha256: hash(outputBytes),
    composite_dimensions: {width: outputMetadata.width, height: outputMetadata.height},
  };
  await writeFile(`${outputPath}.overlay.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}
