# Image workflow

Read this reference only for image work. Keep generation in the active harness and deterministic state operations in `scripts/studio.js`.

## Positive recipe

1. Compile one brief with `compileImageBrief`: identity, goal, source roles, permitted claims, difference plan, text strategy, exclusions, and output requirements.
2. Call the harness's real image capability for a **one-pass complete image**, including short copy. Save the raster locally.
3. Run only relevant file and geometry checks, then inspect that exact saved file once for identity, text, claims, misleading components, and commerce quality.
4. Record it with `scripts/studio.js record-candidate`. A failed candidate receives a compact rejection record and no SHA-256.
5. Present a passing candidate. On explicit approval, run `scripts/studio.js approve`; approval hashes once, binds the artifact, and returns the next action.

The brief is the plan. Do not create a separate planning artifact or request concept approval for an item already present in the approved gallery plan.

## Identity and reference adaptation

Treat product references as identity evidence, layout references as layout only, and competitor links as market data only. Preserve construction, printed copy, palette, warning semantics, and defining motifs by default. The user may authorize a redesign; changing those elements after a Product Master is locked requires a new Product Master.

Without a more specific request, adapt at least two coherent presentation elements: orientation-aware hierarchy, emphasis typography, type scale, line breaks, region proportions, visual center, spacing, or negative-space distribution. Changes may add a visual or information module when its content is supported by permitted facts. They must not create novelty that weakens recognition or style coherence.

Use local fonts or Google Fonts as visual style references in speed-first mode. Do not claim exact font embedding. Switch to deterministic, traceable typography only when the user requests it or an otherwise accepted image has a localized exact-text failure.

## Main image and Product Master

Keep physical product ratio independent from canvas ratio. Follow an explicit user canvas request, then applicable marketplace/category guidance, then a compliant existing canvas, and use square only as the final fallback. Do not pad, crop, stretch, or regenerate solely to force 1:1.

For an Amazon main image, use the applicable white-background, complete-product, count, prohibited-element, and occupancy rules. Amazon.com's dated fallback occupancy is 85%; a stricter value such as 95% applies only when the category or user requests it.

Approve the exact inspected main raster before locking Product Master. Secondary images use the current locked Product Master as the first identity reference and are generated one at a time.

## Gallery execution

Plan the gallery once after Product Master lock. The default roles remain three distinct application scenes, one size/spec card, one material/detail card, and one back/structure card; replace unsupported roles rather than fabricating evidence.

After the user approves a secondary, register it and follow the returned `generate_gallery_item` action in the same turn. Do not ask whether to register, continue, or regenerate the already-planned next card.

Audit props and visible fasteners as possible included-package claims. Omit screws, hooks, brackets, tools, or accessories unless confirmed, even when a realistic scene would normally show them.

## Repair ladder

Choose the cheapest valid action from diagnosed defects:

1. **Deterministic edit** for centering, placement, safe crop, type size, spacing, visual balance, or dimension-line geometry.
2. **Targeted AI edit** for a localized generated-pixel or style problem that cannot be corrected deterministically.
3. **Regenerate** only when the complete composition or product identity is unusable and no accepted base can be retained.

Allow at most one unpresented automatic correction. If it fails, show the diagnosed problem and proposed next action before consuming another generation call. Unknown defects stop for user review rather than defaulting to regeneration.

Inspect the final saved raster after every repair. SHA-256 is required on approval, Product Master lock, and final delivery—not for an ordinary rejected candidate.

