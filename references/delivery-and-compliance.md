# Delivery and compliance

Read this reference only for current-rule verification, final approval, or package creation.

## Upload readiness

Resolve rules for the exact marketplace and product type. Upload-ready output requires an applicable fresh snapshot or verified current Schema. If affected fields remain unverified, preserve `rules_unverified` and `upload_ready=false`; user permission to continue does not convert unknown rules or facts into compliance.

For a legacy product-type label, pass `compatibleProductTypes` only when the current template evidence or user has explicitly confirmed the equivalent current type. This selects applicable rules without silently changing the project product type.

Never add competitor brands, unsupported standards, certification claims, promotional language, contact details, or URLs. Treat product-specific title, image, attribute, and category limits as dynamic rules rather than timeless constants.

## Final scope

Final approval must bind the current Product Master version, every selected approved image, approved Listing version, marketplace, product type, and rule status. Finalization must decode and rehash every selected image and regenerate the approved Listing JSON and Markdown. Earlier hashes are comparison evidence, not a reason to skip final reads.

Reject missing files, hash mismatches, stale Product Master bindings, invalid approvals, Listing mutations after approval, or bundle members that do not match the manifest. Build into a new output path; never overwrite the last valid delivery with a partial attempt.

Use `scripts/build-delivery.js` only as a deprecated v1 compatibility entrypoint. Finalize v2 projects with `scripts/studio.js finalize --project-dir <dir> --output <new-dir>`. The command loads the one current immutable final approval from `state.json`; it blocks when no current approval exists or a single-product scope is ambiguous. `--approval <final-approval.json>` remains available for backward compatibility and diagnostics, and the delivery builder still applies the same strict scope, version, and file-hash checks. A relative output path resolves from the product directory and must remain inside it.

Finalization verifies the ZIP member set, byte lengths, hashes, image decoding, Listing JSON, and approval scope before reporting success. Manifest artifact paths are archive-relative and explicitly declare `container: delivery.zip`. Do not immediately repeat `verify-delivery` for that newly finalized package. Use `scripts/studio.js verify-delivery --delivery-dir <delivery-dir>` only for a later, copied, downloaded, moved, or explicitly requested recheck without extraction; do not create a manual verification directory.

Variation delivery image basenames use a short project code, variant code, size, and purpose, such as `skp-rwb-8x12-main.png`. Names must be unique across the package without hashes. Before Cloudflare upload, check whether the destination object already exists and stop for confirmation instead of overwriting it.

Optional upload preparation reads the verified delivery.zip bound to the current final approval; it does not rebuild Listing or image facts from mutable project files. Run `scripts/studio.js prepare-upload` only on request. When it returns `hosting_required`, ask one consolidated question for Cloudflare R2, another host, or stopping, together with unresolved account and offer values. Check each proposed object key for collision before upload, then rerun using the same delivery identity and exact object keys. Trust the returned HTTPS mapping and destination metadata; do not download every hosted object merely to hash it again.

The Skill packages files for manual Seller Central use; it does not publish automatically.

For a full Family or exact-Child package, add `references/variation-workflow.md`; trusted Variation verification also requires the saved project scope.
