# Capability contracts

Check capabilities at project start and again when the relevant operation is first used.

## `ask_user`

Ask one concise question when the current phase lacks a required fact, two user confirmations conflict, unusual geometry needs a choice, or unverified category Schema needs authorization. Do not demand Case IDs or exhaustive forms.

## `read_reference`

Read user files, images, public links, and local dated rules. Classify extracted content as observations until the user confirms it. A style or layout reference cannot define product identity or facts.

## `generate_image`

Generate or edit an actual bitmap with the selected references. A textual prompt, provider status, or remote claim of completion is not an image asset.

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
