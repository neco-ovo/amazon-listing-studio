# Image workflow

Read this reference only for image work. Keep generation in the active harness and deterministic state operations in `scripts/studio.js`.

## Main-image design gate (before complete main generation)

For a new product or substantive main-image redesign, present a concise proposal before generating complete main-image candidates. Use the existing brief or project planning notes; do not introduce a separate approval schema. Show distinct useful directions when alternatives matter, without manufacturing a fixed number of options. If only one direction is justified, present it for selection.

For each direction show: a stable option label; the product-face layout and reading order (printed text line breaks, motifs, border and typography where relevant); the Amazon main-image presentation (view, white background, product scale and quantity); what is retained and changed relative to the user's references, with reasons; proposed Child options and their real or suggested differences; recommendation, unresolved facts and limits. Distinguish product artwork from text/props outside the product. Use text/table, schematics or existing local Child/artwork assets to make choices concrete. Once the layout direction is established, optionally generate only the needed element candidates (such as animal motifs) and show them for selection. This optional material-preview step does not require final motif/Child selection first; do not pre-generate complete mains for every speculative option. Preserve local assets, identify preview sources and differences, and keep generated elements as design candidates, not confirmed facts or approved Product Masters. Record the selected layout and elements in existing notes; add no mandatory preview stage. Edits/compositing must follow active tool instructions. Candidate colors, motifs or sizes are proposals, not confirmed product facts or authorized SKU combinations.

Wait to generate complete mains until the user selects the shown design, relevant elements and production scope; the optional material previews above may support that selection. Materials, competitor ASINs, tentative ideas, broad workflow requests, or a generic request to continue do not imply selection of an unseen design. A clear approval of a single shown plan can select it; with multiple options and unclear scope, resolve only that choice. Record the chosen option/version and scope in the existing brief/project notes and reuse it on resume. Generate complete mains only for selected directions and Children, keeping unselected options as suggestions. Before rendering, resolve only unknown facts that would otherwise require inventing product identity.

Do not repeat this gate for a still-applicable selected proposal or an authorized local repair within it. A later explicit instruction to skip proposals and generate a specified design may override the default; do not infer that exception from merely supplying inputs. Material changes outside the chosen design require selection of the revised proposal only. Selection authorizes the scoped generation, not approval of the resulting raster: inspect, show and approve that exact image before Product Master lock. This main-image gate does not change gallery sequencing or the independent A+ process.

## Positive recipe

1. Compile one brief with `compileImageBrief`: identity, goal, source roles, permitted claims, difference plan, text strategy, exclusions, and output requirements.
2. Generate the **one-pass complete image** with required exact text first. Call the harness's real image capability and save the raster locally.
3. Run only relevant file and geometry checks, then inspect that exact saved file once for identity, text, claims, misleading components, and commerce quality.
4. Record it with `scripts/studio.js record-candidate`. A failed candidate receives a compact rejection record and no SHA-256.
5. Present a passing candidate. On explicit approval, run `scripts/studio.js approve`; approval hashes once, binds the artifact, and returns the next action.

Keep mutable candidates under `.studio/work/`; approval publishes only the current formal raster under `assets/`.

The brief is the plan. Do not create a separate planning artifact or request concept approval for an item already present in the approved gallery plan.

## Identity and reference adaptation

Treat product references as identity evidence, layout references as layout only, and competitor links as market data only. Preserve construction, printed copy, palette, warning semantics, and defining motifs by default. The user may authorize a redesign; changing those elements after a Product Master is locked requires a new Product Master.

The compact brief records `identity invariants`, `emphasis_fields`, `layout_variant`, `font_mood`, `reference_fidelity`, and `text_render_strategy` instead of creating a second planning artifact.

Without a more specific request, adapt at least two coherent presentation elements: orientation-aware hierarchy, emphasis typography, type scale, line breaks, region proportions, visual center, spacing, or negative-space distribution. Changes may add a visual or information module when its content is supported by permitted facts. They must not create novelty that weakens recognition or style coherence. For an established seller-owned Amazon Listing secondary-gallery baseline, do not require two new presentation changes for each Child; preserve the baseline and adapt only necessary identity, factual, or permitted color differences. This exception does not change third-party reference handling.

For a portrait product, plan the hierarchy around its tall face and redistribute negative space instead of copying a horizontal reference and leaving the lower area empty.

Use the portable bundled set in `assets/fonts/catalog.json` before system fonts and Google Fonts when it suits the product and card role. Treat bundled, other local, or network fonts as visual style references in speed-first mode; do not claim exact font embedding. Switch to deterministic, traceable typography only when the user requests it or an otherwise accepted image has a localized exact-text failure.

When typography needs contrast, choose a display font for the emphasis field and a body font for supporting copy only when their weight, width, and industrial or retail mood preserve style coherence.

## Main image and Product Master

Measured physical-ratio deviation is advisory by default, not an automatic rejection or regeneration trigger. The validator's 2% value is a historical internal bounding-box review hint, not a verified Amazon limit or user constraint. Shadows, perspective and segmentation can alter those bounds; inspect the exact saved image for identity and truthful size understanding. Minor harmless deviations can be recorded and accepted; obvious distortion, wrong text/count/structure, clipping and mandatory resolution failures remain defects. Do not replace 2% with a universal 3% or 10% limit. Use required ratio validation only for a documented explicit constraint, as described in `references/image-qa.md`. Existing design approval is not reopened just because this measurement warns; modified raster approval still follows the existing version rules.


Keep physical product ratio independent from canvas ratio. Follow an explicit user canvas request, then applicable marketplace/category guidance, then a compliant existing canvas, and use square only as the final fallback. Do not pad, crop, stretch, or regenerate solely to force 1:1.

For an Amazon main image, use the applicable white-background, complete-product, count, prohibited-element, and occupancy rules. The saved main raster's longest edge must be at least 1600 px; a user or category rule may require more, never less. Amazon.com's dated fallback occupancy is 85%; a stricter value such as 95% applies only when the category or user requests it.

Approve the exact inspected main raster before locking Product Master. Secondary images use the current locked Product Master as the first identity reference. During intake or interview, approve the gallery plan, shared layout system, copy direction, and permitted claims once. Then generate all approved planned secondary images for the current Child (or current product without variations) before one consolidated review; for multiple Children, complete the representative-gallery sequence below before moving to the next Child. Repair or regenerate only the rejected or directly affected images.

## Gallery execution

The following gallery sequencing, baseline comparison, and information-deduplication rules apply only to Amazon Listing secondary images, not main images, A+, or other platforms.

Before fixing gallery roles/count or removing a potential information task for lack of evidence, distinguish unknown facts from confirmed absence. Reuse applicable confirmed project/family/process records first; do not ask again for facts already established within scope. If a gap would change a key benefit, size/spec content or image role, ask one consolidated clarification that names the missing facts and their planning consequences. This includes planning-impacting facts, not only facts that would make rendering impossible. Keep affected roles marked provisional while awaiting a required answer; continue independent planning, but do not silently finalize a reduced gallery, substitute a role, or render unsupported claims. Do not turn silence into a negative answer. After a negative/uncertain answer or explicit instruction to omit, propose grounded alternatives and resolve the revised scope under existing plan approval; no extra approval round or state schema. Unknown claims are not published, and not every conceivable claim warrants a question.

For multiple Children needing distinct galleries, reuse an applicable complete baseline from the current project; otherwise choose a representative Child with sufficient confirmed facts and state the choice. Finish that Child's planned set, review it in order, and resolve shared-layout problems before producing the next Child's set. Do not interleave same-role generation across Children. Record the baseline and allowed differences in the existing brief/plan, without another state schema. Preserve existing approval gates and batch authorization: this sequence adds no approval round. An inspected working baseline is not a formally approved asset and must not be labeled or delivered as one. Single-image corrections and already applicable shared assets keep their existing fast paths.

For each subsequent Child, use its own locked Product Master for identity and the baseline's complete same-role image for layout only. Preserve heading hierarchy, typography, module grid, icons, borders, corner treatment, spacing, scene divisions, and detail-inset visual balance. Adapt permitted colors and real product differences; preserve inset direction/crop only where the current physical structure allows it. External headings and labels do not inherit changes in printed product lettering. Never transfer the baseline Child's wording, motifs, dimensions, holes, or exclusive facts as identity evidence.

For deduplication of an approved gallery, preserve image count, slots, and information tasks unless the user authorizes removal or replanning. Assign facts a primary home in the existing brief/Storyboard, allowing purposeful supporting mentions and necessary quantity/accessory/variant disclosures elsewhere. Remove repeated full specification strips, not every repeated word. Scene demonstration and weather/material explanation may serve different tasks. If a planned role lacks evidence, first apply the clarification rule above; after the gap is resolved or expressly deferred, stop only that affected image and propose a supported replacement or scope change; execute it within existing authorization or obtain authorization for the uncovered change. Do not fabricate facts to retain a slot.

Review each saved Child set in order and compare subsequent same-role cards with the baseline side by side or sequentially. Identical information alone does not prove visual consistency. Record findings in the existing inspection record, not a new checklist system.


Plan the gallery once after Product Master lock. The default roles remain three distinct application scenes, one size/spec card, one material/detail card, and one back/structure card; clarify planning-impacting unknown facts before replacing unsupported roles; never fabricate evidence.

Pause before generation only when a required product fact is missing, confirmed facts conflict, or a planned image would imply an unconfirmed included component or certification. Ordinary differences between dimension, structure, scene, and claim cards do not create separate pre-generation approval rounds after the gallery plan is approved.

Before writing a new layout, select at most one matching seller-owned merchant layout seed from `assets/merchant-layouts/rigid-aluminum-signs.json`. A merchant seed may keep its fixed layout, hierarchy, icon system, typography direction, and information positions across the seller's brands. Adapt only what the current Product Master, product ratio, approved copy, facts, and scene suitability require. Do not reopen or reanalyze the source product project. Third-party product designs still require coherent presentation differences.

After approval, register each accepted secondary and continue the approved gallery plan in the same turn. Do not ask whether to register or continue an already-planned card.

Audit props and visible fasteners as possible included-package claims. Confirmed absent excludes them from package displays; an explicitly selected mounting-demo layout may show absent fasteners solely in installation examples with clear Not Included labels on each relevant card and an overall accessories-not-included statement. Preserve the actual sign quantity and distinguish complete-product views from demonstrations; do not invent hole diameter, load capacity or universal mounting compatibility. Confirmed included permits only the exact named `included_components`; confirming screws does not authorize brackets or tools. When package contents are unknown and an approved scene actually needs accessory-like props, include that in the one consolidated pre-generation question; if unresolved, omit the props and continue.

Inspect the saved candidate once for applicable commerce quality: identity and required text, product prominence at thumbnail size, claim-to-visual correspondence, misleading components, and whether a scene is a real use environment rather than only a mounting surface. Run design-differentiation checks only for a source role that requires them. Small precision icons should use deterministic vector/icon composition when available rather than spending another full generation call.

Judge visual deviations by their result: product facts and buyer understanding first, then readability and major composition, and only then fidelity to the prompt or planned layout. A small spacing, line-length, type-size, decoration, or divider-angle difference that does not affect those outcomes remains a passing candidate; record `minor_visual_deviation` in `inspection_findings` when useful. Prompt deviation or an exceeded layout guideline alone does not trigger automatic rejection or regeneration. Before any correction, compare the expected visual benefit with its generation or editing cost and the risk of introducing a new defect. Exact user constraints still take priority.

For Amazon Listing secondary families, several individually small differences may cumulatively break the established visual system; classify that outcome as a family-consistency problem, not as separate `minor_visual_deviation` exemptions. Correct only affected images using the repair ladder, without pixel-level thresholds or automatic whole-set regeneration. A genuinely minor visual deviation remains a review finding, not a regeneration trigger. Wrong Child identity, size, wording, package contents, or another semantic defect remains a hard failure.

## Repair ladder

Choose the least invasive permitted repair only after identifying a real defect; measurement alone does not require an edit. All repair and overlay guidance in this reference is subordinate to active tool instructions. If image editing must use imagegen unless the user explicitly requests another method, use imagegen by default; deterministic pixel/geometry edits require that explicit method request. User selection of deterministic geometry correction qualifies, but general design approval does not. Never claim a skill overrides the tool restriction. When permitted, prefer deterministic localized repair over repeated full generation.

For dimension infographics, anchor every repaired dimension line to the measured product bounds rather than an isolated canvas coordinate. Unless the user or a reviewed template specifies a supported alternative, use a line gap within 2%–6% of the canvas short side as default layout guidance, not a standalone pass/fail threshold. Check regional visual balance as well as in-canvas bounds so a sparse corridor cannot pass merely because its label is technically visible.

Choose the cheapest valid action from diagnosed defects:

1. **Deterministic edit**, only when permitted under the method rule above, for centering, placement, safe crop, type size, spacing, visual balance, or dimension-line geometry.
2. **Targeted AI edit** for a localized generated-pixel or style problem that cannot be corrected deterministically.
3. **Regenerate** only when the complete composition or product identity is unusable and no accepted base can be retained.

Allow at most one unpresented automatic correction. If it fails, show the diagnosed problem and proposed next action before consuming another generation call. Unknown defects stop for user review rather than defaulting to regeneration.

Inspect the final saved raster after every repair. SHA-256 is required on approval, Product Master lock, and final delivery—not for an ordinary rejected candidate.

For Parent/Child image scopes, Child-main independence, shared-asset applicability, or cross-Child contamination checks, add `references/variation-workflow.md` only when the project is a Variation Family.
