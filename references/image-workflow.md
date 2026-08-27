# Image workflow

Read this reference only for image work. Keep generation in the active harness and deterministic state operations in `scripts/studio.js`.

## Positive recipe

1. Compile one brief with `compileImageBrief`: identity, goal, source roles, permitted claims, difference plan, text strategy, exclusions, and output requirements.
2. Generate the **one-pass complete image** with required exact text first. Call the harness's real image capability and save the raster locally.
3. Run only relevant file and geometry checks, then inspect that exact saved file once for identity, text, claims, misleading components, and commerce quality.
4. Record it with `scripts/studio.js record-candidate`. A failed candidate receives a compact rejection record and no SHA-256.
5. Present a passing candidate. On explicit approval, run `scripts/studio.js approve`; approval hashes once, binds the artifact, and returns the next action.

The brief is the plan. Do not create a separate planning artifact or request concept approval for an item already present in the approved gallery plan.

## Identity and reference adaptation

Treat product references as identity evidence, layout references as layout only, and competitor links as market data only. Preserve construction, printed copy, palette, warning semantics, and defining motifs by default. The user may authorize a redesign; changing those elements after a Product Master is locked requires a new Product Master.

The compact brief records `identity invariants`, `emphasis_fields`, `layout_variant`, `font_mood`, `reference_fidelity`, and `text_render_strategy` instead of creating a second planning artifact.

Without a more specific request, adapt at least two coherent presentation elements: orientation-aware hierarchy, emphasis typography, type scale, line breaks, region proportions, visual center, spacing, or negative-space distribution. Changes may add a visual or information module when its content is supported by permitted facts. They must not create novelty that weakens recognition or style coherence.

For a portrait product, plan the hierarchy around its tall face and redistribute negative space instead of copying a horizontal reference and leaving the lower area empty.

Use local fonts or Google Fonts as visual style references in speed-first mode. Do not claim exact font embedding. Switch to deterministic, traceable typography only when the user requests it or an otherwise accepted image has a localized exact-text failure.

When typography needs contrast, choose a display font for the emphasis field and a body font for supporting copy only when their weight, width, and industrial or retail mood preserve style coherence.

## Main image and Product Master

Keep physical product ratio independent from canvas ratio. Follow an explicit user canvas request, then applicable marketplace/category guidance, then a compliant existing canvas, and use square only as the final fallback. Do not pad, crop, stretch, or regenerate solely to force 1:1.

For an Amazon main image, use the applicable white-background, complete-product, count, prohibited-element, and occupancy rules. Amazon.com's dated fallback occupancy is 85%; a stricter value such as 95% applies only when the category or user requests it.

Approve the exact inspected main raster before locking Product Master. Secondary images use the current locked Product Master as the first identity reference and are generated one at a time.

## Gallery execution

Plan the gallery once after Product Master lock. The default roles remain three distinct application scenes, one size/spec card, one material/detail card, and one back/structure card; replace unsupported roles rather than fabricating evidence.

Before writing a new layout, select at most one matching seller-owned merchant layout seed from `assets/merchant-layouts/rigid-aluminum-signs.json`. A merchant seed may keep its fixed layout, hierarchy, icon system, typography direction, and information positions across the seller's brands. Adapt only what the current Product Master, product ratio, approved copy, facts, and scene suitability require. Do not reopen or reanalyze the source product project. Third-party product designs still require coherent presentation differences.

After the user approves a secondary, register it and follow the returned `generate_gallery_item` action in the same turn. Do not ask whether to register, continue, or regenerate the already-planned next card.

Audit props and visible fasteners as possible included-package claims. Omit screws, hooks, brackets, tools, or accessories unless confirmed, even when a realistic scene would normally show them.

Inspect the saved candidate once for applicable commerce quality: identity and required text, product prominence at thumbnail size, claim-to-visual correspondence, misleading components, and whether a scene is a real use environment rather than only a mounting surface. Run design-differentiation checks only for a source role that requires them. Small precision icons should use deterministic vector/icon composition when available rather than spending another full generation call.

## Repair ladder

Use deterministic repair for a localized geometry or typography defect before spending another generation call.

For dimension infographics, anchor every repaired dimension line to the measured product bounds rather than an isolated canvas coordinate. Unless the user or a reviewed template specifies a supported alternative, keep the line gap within 2%–6% of the canvas short side. Check regional visual balance as well as in-canvas bounds so a sparse corridor cannot pass merely because its label is technically visible.

Choose the cheapest valid action from diagnosed defects:

1. **Deterministic edit** for centering, placement, safe crop, type size, spacing, visual balance, or dimension-line geometry.
2. **Targeted AI edit** for a localized generated-pixel or style problem that cannot be corrected deterministically.
3. **Regenerate** only when the complete composition or product identity is unusable and no accepted base can be retained.

Allow at most one unpresented automatic correction. If it fails, show the diagnosed problem and proposed next action before consuming another generation call. Unknown defects stop for user review rather than defaulting to regeneration.

Inspect the final saved raster after every repair. SHA-256 is required on approval, Product Master lock, and final delivery—not for an ordinary rejected candidate.

For Parent/Child image scopes, Child-main independence, shared-asset applicability, or cross-Child contamination checks, add `references/variation-workflow.md` only when the project is a Variation Family.
