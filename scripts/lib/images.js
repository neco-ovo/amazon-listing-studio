import sharp from 'sharp';

import {validateRenderedRatio} from './geometry.js';

function isWhitePixel(data, offset, channels, {whiteThreshold, maxColorDelta}) {
  const red = data[offset];
  const green = data[offset + Math.min(1, channels - 1)];
  const blue = data[offset + Math.min(2, channels - 1)];
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);
  const alpha = channels >= 4 ? data[offset + 3] : 255;
  return alpha === 0 || (minimum >= whiteThreshold && maximum - minimum <= maxColorDelta);
}

export function measureNonWhiteBounds(raw, options = {}) {
  const {data, width, height, channels} = raw;
  const thresholds = {whiteThreshold: options.whiteThreshold ?? 245, maxColorDelta: options.maxColorDelta ?? 10};
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isWhitePixel(data, (y * width + x) * channels, channels, thresholds)) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left || bottom < top) return null;
  return {x: left, y: top, width: right - left + 1, height: bottom - top + 1, right, bottom};
}

export function measureVisualBalance(raw, options = {}) {
  const {data, width, height, channels} = raw;
  const requested = options.region ?? {x: 0, y: 0, width, height};
  const region = {
    x: Math.max(0, Math.floor(requested.x)),
    y: Math.max(0, Math.floor(requested.y)),
    width: Math.min(width - Math.max(0, Math.floor(requested.x)), Math.floor(requested.width)),
    height: Math.min(height - Math.max(0, Math.floor(requested.y)), Math.floor(requested.height)),
  };
  if (region.width <= 0 || region.height <= 0) throw new Error('Visual-balance region must have positive in-canvas dimensions.');

  const minContrast = options.minContrast ?? 30;
  const regionCenter = region.x + (region.width - 1) / 2;
  let totalWeight = 0;
  let weightedX = 0;
  let leftWeight = 0;
  let rightWeight = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const offset = (y * width + x) * channels;
      const alpha = channels >= 4 ? data[offset + 3] : 255;
      if (alpha === 0) continue;
      const red = data[offset];
      const green = data[offset + Math.min(1, channels - 1)];
      const blue = data[offset + Math.min(2, channels - 1)];
      const contrast = 255 - (red + green + blue) / 3;
      if (contrast < minContrast) continue;
      const weight = contrast * (alpha / 255);
      totalWeight += weight;
      weightedX += x * weight;
      if (x < regionCenter) leftWeight += weight;
      else rightWeight += weight;
    }
  }

  if (totalWeight === 0) {
    return {
      ok: false,
      region,
      centroid_x: null,
      centroid_offset_ratio: null,
      left_weight: 0,
      right_weight: 0,
      left_right_weight_ratio: null,
      reason: 'MISSING_FOREGROUND',
    };
  }
  const centroidX = weightedX / totalWeight;
  const centroidOffsetRatio = Math.abs(centroidX - regionCenter) / region.width;
  const smallerSide = Math.min(leftWeight, rightWeight);
  const weightRatio = smallerSide === 0 ? Infinity : Math.max(leftWeight, rightWeight) / smallerSide;
  const maxCentroidOffsetRatio = options.maxCentroidOffsetRatio ?? 0.08;
  const maxWeightRatio = options.maxWeightRatio ?? 2;
  return {
    ok: centroidOffsetRatio <= maxCentroidOffsetRatio && weightRatio <= maxWeightRatio,
    region,
    centroid_x: centroidX,
    centroid_offset_ratio: centroidOffsetRatio,
    left_weight: leftWeight,
    right_weight: rightWeight,
    left_right_weight_ratio: weightRatio,
    thresholds: {max_centroid_offset_ratio: maxCentroidOffsetRatio, max_weight_ratio: maxWeightRatio},
  };
}

function inspectBackground(raw, options = {}) {
  const thresholds = {whiteThreshold: options.whiteThreshold ?? 245, maxColorDelta: options.maxColorDelta ?? 10};
  const {data, width, height, channels} = raw;
  const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]
    .map(([x, y]) => isWhitePixel(data, (y * width + x) * channels, channels, thresholds));
  return {ok: corners.every(Boolean), corners};
}

export async function validateMainImage(filePath, options = {}) {
  const {data, info} = await sharp(filePath).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const raw = {data, width: info.width, height: info.height, channels: info.channels};
  const bounds = measureNonWhiteBounds(raw, options);
  const background = inspectBackground(raw, options);
  const failures = [];
  const minOccupancy = options.minOccupancy ?? 0.85;
  if (!bounds) failures.push({code: 'MISSING_PRODUCT', message: 'No nonwhite product pixels were detected.'});
  const occupancy = bounds ? (bounds.width >= bounds.height ? bounds.width / info.width : bounds.height / info.height) : 0;
  if (occupancy < minOccupancy) failures.push({code: 'LOW_OCCUPANCY', message: 'Product occupancy is below the configured minimum.', actual: occupancy, minimum: minOccupancy});
  const fullyVisible = bounds !== null && bounds.x >= 1 && bounds.y >= 1 && bounds.right <= info.width - 2 && bounds.bottom <= info.height - 2;
  if (!fullyVisible) failures.push({code: 'NOT_FULLY_VISIBLE', message: 'Product requires at least one pixel of margin on every canvas edge.'});
  if (!background.ok) failures.push({code: 'NONWHITE_BACKGROUND', message: 'Canvas corners are not white.'});

  let physicalRatioCheck = null;
  if (bounds && options.physicalWidth !== undefined && options.physicalHeight !== undefined) {
    physicalRatioCheck = validateRenderedRatio({
      physicalWidth: options.physicalWidth,
      physicalHeight: options.physicalHeight,
      renderedWidth: bounds.width,
      renderedHeight: bounds.height,
      tolerance: options.ratioTolerance ?? 0.02,
    });
    if (!physicalRatioCheck.ok) failures.push({code: 'PHYSICAL_RATIO_MISMATCH', message: 'Rendered product shape does not match its confirmed physical ratio.', ...physicalRatioCheck});
  }
  return {
    ok: failures.length === 0,
    width: info.width,
    height: info.height,
    bounds,
    occupancy,
    background,
    fully_visible: fullyVisible,
    physical_ratio_ok: physicalRatioCheck?.ok ?? null,
    physical_ratio: physicalRatioCheck,
    failures,
  };
}
