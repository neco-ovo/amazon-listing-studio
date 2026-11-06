# Listing audit

Read for a standalone published Listing audit or completed Listing content before upload-template preparation. Use existing facts, validation and review; do not run the upstream Listing Doctor score engine or create another optimization workflow.

## Choose the evidence mode

- **Online:** retrieve the current Amazon page from the requested ASIN/URL. Save requested and resolved ASIN, selected variant, marketplace, capture time, delivery location if known, source URL, method and retrieval gaps. Inspect current text, visible attributes, Gallery and A+ where accessible. Default-child redirects do not establish a family-wide audit or verified parent/child mapping. Keep the page observation unchanged; never fill it with historical local product values. If retrieval is blocked, report the observed scope and use an available public route; do not require a paid API or silently substitute local data. This mode needs no Product Master initialization, content generation or full delivery workflow.
- **Pre-upload:** after Studio has completed the current Listing and selected actual images, before generating the upload template, inspect those exact artifacts and their current fact references. Record SKU/Child coverage, revision or existing hashes, marketplace and product type where known. No published ASIN or online fetch is required. Include A+ only when it already exists and is relevant to the requested deliverable; absent optional A+ does not block the Listing. For a Family, cover each requested sellable Child's actual overrides and selected assets, reusing common evidence only where applicable.

## One bounded evidence review

Reuse the existing independent copy review to check relevant buyer questions across text, actual Gallery and available A+. Do not demand a fixed question count or new review round. A prior audit is reusable only for the same content/scope; recheck changed rows and direct dependencies, not the entire project.

Focus questions on the actual purchase decision: use, intended user, dimensions, material/performance, compatibility/mounting, included components, variant choice and meaningful limitations. Do not infer an obligation to add a FAQ, image or claim from every unanswered question. Identify conflicts between text and imagery, including width/height order and accessories that imply inclusion. Image OCR/transcription stays separate from DOM text and must reference the exact source image and position; verify important wording visually.

Produce a compact audit artifact in the existing project/private sources (or the chosen standalone audit root). One report may contain the observation, evidence matrix and reviewed issues; reference existing artifacts instead of duplicating their bodies. For online mode keep original observations apart from product-fact verification.

Each useful question records: question and relevance, SKU/scope, text/Gallery/A+ evidence references, answer status, fact status, `fact_refs`, `fact_scope`, conflicts and proposed action or confirmation question.

- Answer status: covered, partial, not answered in observed scope, or unassessable. Failure to load A+ cannot establish full-page absence.
- Fact status: confirmed, page claim only, unknown or conflicting. Confirmed must point to the current product or explicitly applicable family fact and its source; a published performance claim alone is not verified performance.
- Field availability: obtained, unavailable, or supported not applicable. An evidenced empty backend field is obtained; a field not retrieved is unavailable. Unknown mapping is not an orphan ASIN, and absent attribute baseline is not zero/full completeness.

Before asking the user, reuse applicable existing confirmations in the fact-verification layer, without rewriting the online snapshot. Ask one consolidated set of concrete questions for remaining unknown or conflicting facts with meaningful buyer value. Potential new selling points with insufficient support should become questions, not invented promises or silently discarded opportunities. Unresolved facts affect the relevant claim, not unrelated grounded drafts.

## Approval-to-upload handoff

When upload delivery is already in scope and Listing approval completes the current copy plus selected image set, complete this review or verify an exactly matching existing report before ending the handoff as ready for template preparation. No extra user approval is required for the audit itself. A prior copy-only review is reusable evidence for its text checks, not a completed audit: inspect the selected image files and record the relevant cross-media buyer-question evidence. If required artifacts are unavailable, record the missing scope and keep the audit incomplete.

Reference the saved report and covered Listing/image versions and SKU scope in the workflow audit stage, together with the result and unresolved items. Set the next stage to audit while this evidence is missing, or to the affected revision stage for supported blockers; hand off to upload only after the scoped review has no supported unresolved blocker. An audit result does not establish template validation or authorize publishing. For a copy-only request outside upload-delivery scope, leave this as a future prerequisite rather than extending the current task.

## Checks and disposition

Reuse Studio's current text/keyword validators and the workflow's title checker. Workspace titles remain at most75 characters including spaces and punctuation, or the stricter verified field limit. Never pad to the limit, force Generic into the title, alter standard units such as MPH to satisfy an acronym heuristic, or fail useful natural front-end repetition merely to increase a score.

Decode actual image dimensions and separate main image, Gallery and A+ requirements. Record whether white-background/watermark checks are visual observations or measured detections; do not default unknown values to false. Apply the current applicable rule and distinguish it from an internal preference. Non-square images or width below1000 alone do not prove noncompliance or unavailable zoom. Do not create an image-generation retry threshold from an audit preference.

Do not lint unavailable backend fields or invent product-type attribute baselines. Skip their findings and corrective actions together; a null score with stale risks is insufficient. Reuse current template/Schema checks for actual backend and conditional requirements when available.

Report supported blocking issues, presentation suggestions, observation limitations and fact questions separately. A blocker needs a confirmed fact conflict, applicable hard rule, or existing strict-delivery invariant; unanswered optional questions and unavailable public backend data do not automatically block template work. Do not claim upload readiness where required facts/rules remain unresolved. Keep a scoped result such as no supported blocking issue found, affected items unresolved, or audit incomplete, with the actual limitations; no overall Doctor score or extra user approval.

Route authorized revisions back to the original Listing, Gallery or A+ stage. Preserve existing immutable approvals and revise only affected artifacts and direct dependents. An audit request alone does not authorize rewriting a live Listing, changing advertising, or publishing. Sales/advertising explanations require matched operating data; scores, one offer snapshot or a selected default Child cannot establish a cause of no sales.
