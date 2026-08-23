# Image generation

Keep three geometries separate:

- Physical product ratio comes from confirmed dimensions and must remain unchanged in every rendered view where it is measurable. A confirmed 12 × 8 inch face is 3:2, regardless of canvas shape.
- Canvas ratio follows an explicit user request, then verified category guidance, then the Amazon square default.
- Main-image occupancy is measured along the product bounding box's dominant direction. The project target is at least 95%, while preserving at least one pixel of visible white margin on every side.

Do not stretch, crop, or silently change the product to satisfy canvas or occupancy targets. Generate a new candidate when the requirements cannot coexist.
