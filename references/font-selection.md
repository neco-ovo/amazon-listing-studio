# Font selection

Recursively scan local `.otf`, `.ttf`, `.woff`, `.woff2`, and `.ttc` files plus safe font entries inside ZIP archives. Group by normalized family rather than raw file count, but retain every variant, format, source label, exact logical path, SHA-256, language/style metadata, and any metadata fallback disclosure.

User style requirements take priority. Otherwise select a readable family suited to the product and card role. Local fonts are preferred when suitable, but an appropriate network font, including a family from Google Fonts, may be used when the environment allows it. Cache only a network font that is actually used and record its family, source URL, file hash, and fallback reason in the overlay manifest. Per-font license verification is not required by this workflow.

For controlled differentiation, compare the display font and body font as a pair. A distinct display font for an emphasis field is suitable only when style coherence, product-category tone, weight contrast, visual era, and legibility remain intact. Use at most one display family plus one body family by default. Before abandoning a preferred font, fit its real glyph bounds by reducing size or adjusting tracking; then try another suitable local family, then an approved network family, and only then a generic system fallback.

ZIP scanning rejects absolute or traversal paths, encrypted font entries, an entry over 20 MiB uncompressed, selected font content over 100 MiB total, or a compression ratio above 100:1. Unsafe archives are excluded as a hard input failure; they are never partially trusted.

Run `scripts/scan-fonts.js` before typography work. Use `scripts/compose-overlay.js` for deterministic text repair or explicitly requested exact composition, then inspect the saved composite and its manifest. The composer must fit actual glyph bounds inside the approved region rather than validating only the nominal plan box. A network font is acceptable only when retrieval is permitted and its cached file, source URL, SHA-256, and fallback reason are recorded.
