# Image generation

Keep three geometries separate:

- Physical product ratio comes from confirmed dimensions and must remain unchanged in every rendered view where it is measurable. A confirmed 12 × 8 inch face is 3:2, regardless of canvas shape.
- Canvas ratio follows an explicit user request, then verified category guidance, then an already-generated canvas that meets applicable requirements and preserves the complete product. Use the Amazon square canvas only as a final fallback when none of those supplies a ratio. Square is not a general acceptance requirement; do not pad, crop, stretch, or regenerate solely to force 1:1.
- Main-image occupancy is measured along the product bounding box's dominant direction. Use the current marketplace/category minimum; for Amazon.com the dated base fallback is 85%. A stricter verified category rule or explicit user/project target, such as 95% for a sign project, raises the minimum for that scope only. Preserve at least one pixel of visible white margin on every side.

Do not stretch, crop, or silently change the product to satisfy canvas or occupancy targets. Generate a new candidate when the requirements cannot coexist.

Select only templates whose `required_facts` are supported from `assets/templates/commerce-templates.json`. Their previews are layout or style references, never product identity. Invoke real image generation for every candidate, save it locally, and pass the exact path through capability acceptance and saved-image QA.

## Reference adaptation and text strategy

Split a product reference into **identity invariants** and adaptable presentation. Preserve product construction, printed copy, warning semantics, palette, and defining motifs. Re-plan typography, line breaks, scale, spacing, and region heights when the target orientation differs. For a portrait product, inspect vertical rhythm and negative or empty space across the printable face; reject a layout that merely compresses a landscape design into the upper portion and leaves a large unintended lower void.

Record the planning controls `reference_fidelity`, `layout_variant`, `emphasis_fields`, `font_mood`, and `text_render_strategy`. These may be supplied by the user or selected from the product style and reference. An emphasis field may use a different display font or scale only when the contrast preserves style coherence, warning authority, legibility, and the reference's visual era. Prefer no more than one display family plus one body family; reject novelty type that competes with the message.

When fixed printed copy is part of the product face, generate the complete main image with exact text first so image geometry and typography are planned together. Inspect spelling and layout on the saved raster. Use deterministic text repair only when the product and composition pass but exact text fails. Generate a text-free base first only when the generator cannot preserve dense copy after the allowed correction attempt or when the user explicitly requests deterministic typography.

The approved main image is the first product-identity reference for every secondary. Generate one secondary at a time, inspect and present it, and obtain explicit approval before starting the next. Default roles are three distinct application scenes, one size/spec card, one material/detail card, and one back/structure card; replace any role whose required facts are unavailable.
