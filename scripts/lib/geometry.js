function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${name} must be a positive number.`);
  return number;
}

export function physicalRatio({width, length}) {
  return positiveNumber(width, 'width') / positiveNumber(length, 'length');
}

export function selectCanvas({user, category}) {
  return {ratio: user?.ratio ?? category?.ratio ?? '1:1'};
}

export function validateRenderedRatio({physicalWidth, physicalHeight, renderedWidth, renderedHeight, tolerance = 0.02}) {
  const expected = physicalRatio({width: physicalWidth, length: physicalHeight});
  const actual = physicalRatio({width: renderedWidth, length: renderedHeight});
  const relativeError = Math.abs(actual - expected) / expected;
  return {ok: relativeError <= tolerance, expected, actual, relativeError, tolerance};
}
