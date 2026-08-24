# Capability contracts

Check capabilities at project start and again when the relevant operation is first used.

Existing artifacts, user ownership, deadlines, and provider success messages do not weaken these contracts. Resume only from evidence recorded for the exact saved artifact and current version.

## `ask_user`

Ask one concise question when the current phase lacks a required fact, two user confirmations conflict, unusual geometry needs a choice, or unverified category Schema needs authorization. Do not demand Case IDs or exhaustive forms.

## `read_reference`

Read user files, images, public links, and local dated rules. Classify extracted content as observations until the user confirms it. A style or layout reference cannot define product identity or facts.

## `generate_image`

Generate or edit an actual bitmap with the selected references. A textual prompt, provider status, or remote claim of completion is not an image asset.

The returned value must identify a local saved path and declare one of the supported media types: `image/png`, `image/jpeg`, or `image/webp`. `saved: false`, a prompt without a path, or a remote URL without a saved local file is a hard `CAPABILITY_FAILURE`.

## `inspect_image`

Inspect the exact saved path, not only an in-memory preview or provider thumbnail. Return an explicit result for identity, count, geometry, inventions, claims, watermarks, composition, and applicable rules.

## Workspace files

The runtime must be able to create state and versioned asset files, read them back, hash them, and preserve rejected versions. If any required operation is unavailable, return `CAPABILITY_FAILURE` and stop the affected phase.

## Successful raster contract

Success requires all of the following:

1. a local saved path;
2. a supported raster media type;
3. nonempty, decodable bytes;
4. recorded size and SHA-256;
5. saved-file inspection with no hard failure;
6. presentation to the user before approval.

Before an asset enters project state, `acceptGeneratedRaster` reads the exact local path, rejects zero-byte files, verifies that the bytes begin with the declared PNG, JPEG, or WebP signature, and calls `inspect_image` on that same path. Provider status and filename extensions are never sufficient evidence. An inspection exception, `ok: false`, or an inspection result tied to a different path is a hard `CAPABILITY_FAILURE` for the affected image phase.

Signature bytes are only a preliminary check. The adapter must decode the saved bytes and record raster width and height before inspection or approval.

At phase start, `assertCapabilities` verifies that every required capability is callable. A named capability that is absent or non-callable is unavailable even if the harness advertises a similarly named feature.
