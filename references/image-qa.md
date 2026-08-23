# Image QA

`validateMainImage` performs deterministic raster checks only. It decodes the exact saved asset, finds pixels outside the configured near-white threshold, measures the product bounds, dominant-direction occupancy, canvas-edge margin, corner background, and—when confirmed dimensions are supplied—the rendered physical ratio.

The validator reports failures and never crops or repairs the asset. Its passing result is not semantic approval: identity, product count, invented parts, misleading claims, text, logos, watermarks, and marketplace/category rules still require saved-file inspection before user approval.
