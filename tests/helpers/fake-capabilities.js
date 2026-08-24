import {readFile} from 'node:fs/promises';

export function fakeImageCapabilities({path, mediaType = 'image/png', inspection = {ok: true}}) {
  return {
    generateImage: async () => ({path, mediaType, saved: true}),
    readFile,
    inspectImage: async inspectedPath => ({...inspection, path: inspectedPath}),
  };
}

