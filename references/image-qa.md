# Image QA

`validateMainImage` performs deterministic raster checks only. It decodes the exact saved asset, finds pixels outside the configured near-white threshold, measures the product bounds, dominant-direction occupancy, canvas-edge margin, corner background, and—when confirmed dimensions are supplied—the rendered physical ratio.

The CLI defaults to the dated Amazon.com base occupancy of 85%. Pass `--min-occupancy` for a stricter current category or user/project target. A user may raise the threshold but cannot waive a verified marketplace/category minimum.

The validator reports failures and never crops or repairs the asset. Its passing result is not semantic approval: identity, product count, invented parts, misleading claims, text, logos, watermarks, and marketplace/category rules still require saved-file inspection before user approval.

Run `scripts/validate-image.js` on the exact saved raster, then inspect that same file visually. Six existing images, a trusted provider, user ownership, or an urgent deadline never substitutes for inspection. A hard failure creates a new historical candidate; do not reinterpret it as approval because regeneration is costly.

## Physical ratio: advice versus explicit requirement

Default `ratioPolicy: "advisory"` retains the historical 0.02 measurement hint and reports deviations in `warnings`, not `failures`. `physical_ratio_ok` describes the measurement only; it is not the overall acceptance gate. `ok` still requires other raster checks to pass, and saved-file semantic inspection remains mandatory. A large apparent distortion must not be waved through merely because the geometric warning is nonblocking. Candidate recording preserves warnings in inspection findings; old rejected/approved records are not rewritten.

Only use `ratioPolicy: "required"` with explicit numeric `ratioTolerance`, confirmed physical dimensions and a nonempty `ratioConstraintSource` citing the actual user requirement or verified applicable rule. Knowing a product is 12x16 alone does not authorize a 2% hard limit. A legacy `ratioTolerance` without policy remains advisory; recover any actual hard requirement from its evidence, not the number alone. CLI equivalents: `--ratio-policy required --ratio-tolerance 0.02 --ratio-source "Explicit user instruction reference" --physical 12x16`. The number here is an example, not a recommended universal limit. Invalid options fail rather than silently disabling checks.

Do not regenerate repeatedly to satisfy an internal measurement hint, nor request approval again for an unchanged approved design. If a real defect needs correction, preserve the accepted design and choose a method allowed by active tool instructions; inspect the actual corrected file.

## Deterministic overlays

This section applies only when active tool instructions permit deterministic image editing. Where imagegen is required unless the user explicitly requests another method, use imagegen by default; an explicit user request for an overlay or deterministic correction is needed for the alternative. General design approval does not authorize that method.


Add exact dimensions, labels, and benefit copy after image generation through a bounded SVG overlay. Every item must contain nonempty approved text, remain fully inside the canvas, and resolve any `factRef` from the current fact ledger. The composer embeds the resolved font, draws dimension lines and arrowheads explicitly, and records exact text, unit, fact value, bounds, font path/source/hash/fallback, input/output hashes, and composite dimensions.

Text bound to a `factRef` must contain that fact's recorded value and unit; contradictory copy fails as `FACT_MISMATCH`. Selected font bytes are rendered as glyph paths so the recorded font changes the actual output pixels rather than only the manifest.

Write `<output>.overlay.json` only after the final raster decodes at the expected size. This manifest makes typography and factual copy reviewable without asking the image model to render precise text.
