# Delivery and compliance

Read this reference only for current-rule verification, final approval, or package creation.

## File closeout

Reuse the current project root across revisions and retries; use the existing state and delivery records to identify current artifacts and replacements. Keep unselected image candidates as design inputs, not disposable work.

After successful delivery and its required checks, remove only exact files created for this task that are reproducible intermediates, have no live references, and are not needed for continuation: temporary exports, verification extractions, or upload staging. Check upload inputs, state, and recovery references before removing an `r2-upload-staging` file. Preserve source images, approved assets and records, evidence, and materials needed to diagnose an interrupted or failed attempt. Unknown ownership or dependencies means retain the file for later classification.

Verify archives through their member sets and contents without leaving a second extracted delivery. A full delivery ZIP, an image-hosting ZIP, and formal assets can coexist when each serves its own consumer; overlapping content alone is not redundancy. Protect approved sources and records through the existing mechanisms; keep the current atomic delivery replacement rather than retaining every full delivery generation. `compact-project` migrates layout and preserves legacy material; it is not a historical-version cleanup command. Historical cleanup follows the workspace's approved scope and dependency checks.

Keep current `listing/`, upload, and `delivery/` presentation separate from production/checking work. Title-check inputs, temporary workbook readbacks, debug output, and one-off review pages belong in the relevant `.studio/work/<stage>/checks` or `review` location, not beside the current deliverable. Retain required QA evidence in the existing stage records and link it from the delivery summary; a work path alone does not authorize deleting evidence. Keep not-ready upload drafts in upload-stage work and label them when requested; do not present them as the ready upload set. Preserve all tool-required manifests, mappings, approved sources, and atomic commit paths.

## Upload readiness

Resolve rules for the exact marketplace and product type. Upload-ready output requires an applicable fresh snapshot or verified current Schema. If affected fields remain unverified, preserve `rules_unverified` and `upload_ready=false`; user permission to continue does not convert unknown rules or facts into compliance.

For a legacy product-type label, pass `compatibleProductTypes` only when the current template evidence or user has explicitly confirmed the equivalent current type. This selects applicable rules without silently changing the project product type.

Never add competitor brands, unsupported standards, certification claims, promotional language, contact details, or URLs. Treat product-specific title, image, attribute, and category limits as dynamic rules rather than timeless constants.

## Final scope

Final approval must bind the current Product Master version, every selected approved image, approved Listing version, marketplace, product type, and rule status. Finalization must decode and rehash every selected image and regenerate the approved Listing JSON and Markdown. Earlier hashes are comparison evidence, not a reason to skip final reads.

Reject missing files, hash mismatches, stale Product Master bindings, invalid approvals, Listing mutations after approval, or bundle members that do not match the manifest. Build under `.studio/work/`, then atomically replace the one verified `delivery/`; never overwrite the last valid delivery with a partial attempt.

Use `scripts/build-delivery.js` only as a deprecated v1 compatibility entrypoint. Finalize v2 projects with `scripts/studio.js finalize --project-dir <dir>`. The command loads the one current immutable final approval from `.studio/state.json` and writes the single current `delivery/`; it blocks when no current approval exists or a single-product scope is ambiguous. `--approval <final-approval.json>` remains available for backward compatibility and diagnostics, and the delivery builder still applies the same strict scope, version, and file-hash checks.

Finalization verifies the ZIP member set, byte lengths, hashes, image decoding, Listing JSON, and approval scope before reporting success. Manifest artifact paths are archive-relative and explicitly declare `container: delivery.zip`. Do not immediately repeat `verify-delivery` for that newly finalized package. Use `scripts/studio.js verify-delivery --delivery-dir <delivery-dir>` only for a later, copied, downloaded, moved, or explicitly requested recheck without extraction; do not create a manual verification directory.

Variation delivery image basenames use a short project code, variant code, size, and purpose, such as `skp-rwb-8x12-main.png`. Names must be unique across the package without hashes. Before Cloudflare upload, check whether the destination object already exists and stop for confirmation instead of overwriting it.

Before upload-template preparation, apply the pre-upload audit in `listing-audit.md` to the completed current Listing and selected actual images. Reuse a matching audit from the existing review; recheck only affected evidence after changes. A published ASIN is not required. Read the approved copy and image references bound to the package, and route supported blocking findings back through existing revision/approval/finalization rather than patching immutable files. Optional suggestions or unavailable backend data do not create an extra approval gate. Template validation and finalization checks remain independently required.

Optional upload preparation reads the verified delivery.zip bound to the current final approval; it does not rebuild Listing or image facts from mutable project files. Run `scripts/studio.js prepare-upload` only on request. The workbook settings supply `attributeRow` and `dataRow`; Amazon technical headers select the unique upload sheet and current keyword and image columns. Never assume a fixed sheet, row, column, or slot count. Supply one confirmed `item_type_keyword`; when a Family needs a consistent gallery sequence, supply one `image_role_order` instead of repeating per-Child URL arrays.

Without image URLs, `prepare-upload` returns `manual_upload_required` plus a verified image-only ZIP. After the user uploads it, run `map-r2-images` with the user-specified prefix and public base URL; it constructs URLs from verified archive paths and accepts only public image responses. Then rerun `prepare-upload` with `delivery/hosted-input.json`. Trust this exact mapping; do not download every hosted object merely to hash it again.

`host-images-r2` is only an optional shortcut. It runs Wrangler `whoami` with logs under `.studio/work`; failure immediately returns `manual_upload_required` and the image ZIP. It never starts login, uses tunnels, or overwrites an existing object. When ready, it preflights the complete key set and resumes only objects recorded for the same delivery identity, bucket, and public base URL.

The Skill packages files for manual Seller Central use; it does not publish automatically.

For a full Family or exact-Child package, add `references/variation-workflow.md`; trusted Variation verification also requires the saved project scope.
