import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';

import {create as createFont} from 'fontkit';
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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertFactText(item, fact) {
  if (!item.factRef) return;
  const text = item.text.toLowerCase();
  const value = fact?.display ?? fact?.value;
  const valueMatches = value !== undefined && value !== null && text.includes(String(value).toLowerCase());
  const unitMatches = !fact?.unit || new RegExp(`(?:^|\\s)${escapeRegex(fact.unit)}(?:\\s|$)`, 'i').test(item.text);
  if (!valueMatches || !unitMatches) {
    throw new DomainError('FACT_MISMATCH', 'Overlay text contradicts or omits its referenced fact value or unit.', {
      id: item.id,
      factRef: item.factRef,
      text: item.text,
      fact
    });
  }
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
      assertFactText(item, fact);
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

function glyphBounds(run) {
  let penX = 0;
  let penY = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  run.glyphs.forEach((glyph, index) => {
    const position = run.positions[index];
    const bounds = glyph.bbox;
    minX = Math.min(minX, penX + position.xOffset + bounds.minX);
    maxX = Math.max(maxX, penX + position.xOffset + bounds.maxX);
    minY = Math.min(minY, penY + position.yOffset + bounds.minY);
    maxY = Math.max(maxY, penY + position.yOffset + bounds.maxY);
    penX += position.xAdvance;
    penY += position.yAdvance;
  });
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
    throw invalid('Overlay text has no measurable glyph bounds.');
  }
  return {minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY};
}

function fitText(item, font) {
  const run = font.layout(item.text);
  const bounds = glyphBounds(run);
  const requested = Math.min(item.fontSize ?? item.height * 0.55, item.height * 0.8);
  const widthFit = item.width * font.unitsPerEm / bounds.width;
  const heightFit = item.height * font.unitsPerEm / bounds.height;
  const fontSize = Math.max(1, Math.min(requested, widthFit, heightFit) * 0.98);
  const scale = fontSize / font.unitsPerEm;
  return {
    run,
    bounds,
    fontSize,
    scale,
    renderedWidth: bounds.width * scale,
    renderedHeight: bounds.height * scale,
  };
}

function textPathSvg(item, font, color, fit) {
  const {run, bounds, scale} = fit;
  const centerX = item.x + item.width / 2;
  const centerY = item.y + item.height / 2;
  const startX = centerX - ((bounds.minX + bounds.maxX) * scale) / 2;
  const baseline = centerY + ((bounds.minY + bounds.maxY) * scale) / 2;
  let penX = 0;
  const paths = run.glyphs.map((glyph, index) => {
    const position = run.positions[index];
    const transform = `translate(${penX + position.xOffset} ${position.yOffset})`;
    penX += position.xAdvance;
    return `<path d="${glyph.path.toSVG()}" transform="${transform}"/>`;
  }).join('');
  return `<g fill="${color}" transform="translate(${startX} ${baseline}) scale(${scale} ${-scale})">${paths}</g>`;
}

function itemSvg(item, font) {
  const color = escapeXml(item.color ?? '#111111');
  const fit = fitText(item, font);
  const text = textPathSvg(item, font, color, fit);
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
  let font;
  try {
    font = createFont(fontBytes);
  } catch (cause) {
    const error = new DomainError('FONT_UNAVAILABLE', 'Resolved overlay font file cannot be decoded.', {path: resolvedFont?.path});
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
  const fittedItems = layout.items.map(item => {
    const fit = fitText(item, font);
    return {
      ...item,
      resolved_font_size: fit.fontSize,
      rendered_text_width: fit.renderedWidth,
      rendered_text_height: fit.renderedHeight,
    };
  });
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.canvas.width}" height="${layout.canvas.height}">`
    + fittedItems.map(item => itemSvg(item, font)).join('')
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
    items: fittedItems,
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
