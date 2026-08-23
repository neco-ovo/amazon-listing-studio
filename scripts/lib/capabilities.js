import {DomainError} from './errors.js';

const RASTER_SIGNATURES = new Map([
  ['image/png', bytes => bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', bytes => bytes.length >= 3
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff],
  ['image/webp', bytes => bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'],
]);

function capabilityFailure(message, details = {}, cause) {
  const error = new DomainError('CAPABILITY_FAILURE', message, details);
  if (cause !== undefined) error.cause = cause;
  return error;
}

export function assertCapabilities(capabilities, required) {
  const names = Array.isArray(required) ? required : [];
  const missing = names.filter(name => typeof capabilities?.[name] !== 'function');

  if (missing.length > 0) {
    throw capabilityFailure('Required capabilities are unavailable.', {missing});
  }
}

export async function acceptGeneratedRaster(result, io = {}) {
  if (!result?.path) {
    const promptOnly = typeof result?.prompt === 'string' && result.prompt.trim().length > 0;
    throw capabilityFailure(
      promptOnly
        ? 'Prompt-only output is not a completed image asset.'
        : 'Image generation did not return a saved local path.',
      {resultKind: promptOnly ? 'prompt-only' : 'missing-path'},
    );
  }

  if (result.saved === false) {
    throw capabilityFailure('Generated image was not saved.', {path: result.path});
  }

  const signatureMatches = RASTER_SIGNATURES.get(result.mediaType);
  if (!signatureMatches) {
    throw capabilityFailure('Generated image has an unsupported raster media type.', {
      path: result.path,
      mediaType: result.mediaType,
      supported: [...RASTER_SIGNATURES.keys()],
    });
  }

  assertCapabilities(io, ['readFile']);
  let bytes;
  try {
    bytes = await io.readFile(result.path);
  } catch (cause) {
    throw capabilityFailure('Unable to read saved image file.', {path: result.path}, cause);
  }

  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes ?? []);
  if (bytes.length === 0) {
    throw capabilityFailure('Saved image file is empty.', {path: result.path});
  }
  if (!signatureMatches(bytes)) {
    throw capabilityFailure('Saved image signature does not match its media type.', {
      path: result.path,
      mediaType: result.mediaType,
    });
  }

  if (typeof io.inspectImage !== 'function') {
    throw capabilityFailure('Saved-file image inspection capability is unavailable.', {
      path: result.path,
    });
  }

  let inspection;
  try {
    inspection = await io.inspectImage(result.path);
  } catch (cause) {
    throw capabilityFailure('Unable to inspect saved image file.', {path: result.path}, cause);
  }

  if (inspection?.ok !== true) {
    throw capabilityFailure('Saved-file inspection rejected the generated image.', {
      path: result.path,
      inspection,
    });
  }
  if (inspection.path !== undefined && inspection.path !== result.path) {
    throw capabilityFailure('Inspection result does not belong to the saved image path.', {
      path: result.path,
      inspectedPath: inspection.path,
    });
  }

  return {
    path: result.path,
    mediaType: result.mediaType,
    bytes: bytes.length,
    inspection,
  };
}
