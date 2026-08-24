# Image generation

Keep three geometries separate:

- Physical product ratio comes from confirmed dimensions and must remain unchanged in every rendered view where it is measurable. A confirmed 12 × 8 inch face is 3:2, regardless of canvas shape.
- Canvas ratio follows an explicit user request, then verified category guidance, then the Amazon square default.
- Main-image occupancy is measured along the product bounding box's dominant direction. Use the current marketplace/category minimum; for Amazon.com the dated base fallback is 85%. A stricter verified category rule or explicit user/project target, such as 95% for a sign project, raises the minimum for that scope only. Preserve at least one pixel of visible white margin on every side.

Do not stretch, crop, or silently change the product to satisfy canvas or occupancy targets. Generate a new candidate when the requirements cannot coexist.

Select only templates whose `required_facts` are supported from `assets/templates/commerce-templates.json`. Their previews are layout or style references, never product identity. Invoke real image generation for every candidate, save it locally, and pass the exact path through capability acceptance and saved-image QA.

The approved main image is the first product-identity reference for every secondary. Generate one secondary at a time, inspect and present it, and obtain explicit approval before starting the next. Default roles are three distinct application scenes, one size/spec card, one material/detail card, and one back/structure card; replace any role whose required facts are unavailable.
