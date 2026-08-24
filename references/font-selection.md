# Font selection

Recursively scan local `.otf`, `.ttf`, `.woff`, `.woff2`, and `.ttc` files plus safe font entries inside ZIP archives. Group by normalized family rather than raw file count, but retain every variant, format, source label, exact logical path, SHA-256, language/style metadata, and any metadata fallback disclosure.

User style requirements take priority. Otherwise select a readable family suited to the product and card role. Local fonts are preferred when suitable, but an appropriate network font may be used when the environment allows it. Cache only a network font that is actually used and record its source, file hash, and fallback reason in the overlay manifest. Per-font license verification is not required by this workflow.

ZIP scanning rejects absolute or traversal paths, encrypted font entries, an entry over 20 MiB uncompressed, selected font content over 100 MiB total, or a compression ratio above 100:1. Unsafe archives are excluded as a hard input failure; they are never partially trusted.

Run `scripts/scan-fonts.js` before typography work. Use `scripts/compose-overlay.js` for exact copy, then inspect the saved composite and its manifest. A network font is acceptable only when retrieval is permitted and its cached file, source URL, SHA-256, and fallback reason are recorded.
