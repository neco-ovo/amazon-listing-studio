# Image QA

`validateMainImage` performs deterministic raster checks only. It decodes the exact saved asset, finds pixels outside the configured near-white threshold, measures the product bounds, dominant-direction occupancy, canvas-edge margin, corner background, and—when confirmed dimensions are supplied—the rendered physical ratio.

The validator reports failures and never crops or repairs the asset. Its passing result is not semantic approval: identity, product count, invented parts, misleading claims, text, logos, watermarks, and marketplace/category rules still require saved-file inspection before user approval.

## Deterministic overlays

Add exact dimensions, labels, and benefit copy after image generation through a bounded SVG overlay. Every item must contain nonempty approved text, remain fully inside the canvas, and resolve any `factRef` from the current fact ledger. The composer embeds the resolved font, draws dimension lines and arrowheads explicitly, and records exact text, unit, fact value, bounds, font path/source/hash/fallback, input/output hashes, and composite dimensions.

Write `<output>.overlay.json` only after the final raster decodes at the expected size. This manifest makes typography and factual copy reviewable without asking the image model to render precise text.
