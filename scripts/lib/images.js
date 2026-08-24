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
