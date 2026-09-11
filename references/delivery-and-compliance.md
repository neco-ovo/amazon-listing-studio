# Delivery and compliance

Read this reference only for current-rule verification, final approval, package creation, or external image uploads.

## Upload readiness

Resolve rules for the exact marketplace and product type. Upload-ready output requires an applicable fresh snapshot or verified current Schema. If affected fields remain unverified, preserve `rules_unverified` and `upload_ready=false`; user permission to continue does not convert unknown rules or facts into compliance.

Never add competitor brands, unsupported standards, certification claims, promotional language, contact details, or URLs. Treat product-specific title, image, attribute, and category limits as dynamic rules rather than timeless constants.

## Final scope

Final approval must bind the current Product Master version, every selected approved image, approved Listing version, marketplace, product type, and rule status. Finalization must decode and rehash every selected image and regenerate the approved Listing JSON and Markdown. Earlier hashes are comparison evidence, not a reason to skip final reads.

Reject missing files, hash mismatches, stale Product Master bindings, invalid approvals, Listing mutations after approval, or bundle members that do not match the manifest. Build into a new output path; never overwrite the last valid delivery with a partial attempt.

Use `scripts/build-delivery.js` only as a deprecated v1 compatibility entrypoint. Finalize v2 projects with `scripts/studio.js finalize --project-dir <dir> --output <new-dir>`. The command loads the one current immutable final approval from `state.json`; it blocks when no current approval exists or a single-product scope is ambiguous. `--approval <final-approval.json>` remains available for backward compatibility and diagnostics, and the delivery builder still applies the same strict scope, version, and file-hash checks. A relative output path resolves from the product directory and must remain inside it.

Finalization verifies the ZIP member set, byte lengths, hashes, image decoding, Listing JSON, and approval scope before reporting success. Manifest artifact paths are archive-relative and explicitly declare `container: delivery.zip`. Do not immediately repeat `verify-delivery` for that newly finalized package. Use `scripts/studio.js verify-delivery --delivery-dir <delivery-dir>` only for a later, copied, downloaded, moved, or explicitly requested recheck without extraction; do not create a manual verification directory.

The Skill packages files for manual Seller Central use; it does not publish automatically.

## External image upload names

When the active environment can upload approved images to external storage, derive one stable `upload_slug` from 2 to 4 distinctive project keywords. Remove dimensions and generic terms such as `sign`; reuse the same slug across that project. Name each flat object `<upload_slug>-<size>-<purpose>.png`, or omit `<size>` only for an image that is genuinely size-independent. Use the short purposes `main`, `size`, `weather`, `front-back`, and `application`; do not add hashes or directory-like paths. `scripts/lib/upload-names.js` provides the deterministic naming and preflight helpers.

Check the exact object name at the upload target before upload. If the object exists, stop and ask whether to overwrite it; overwrite only after explicit approval for that object. If the target cannot be checked, stop only the external upload and keep the local delivery usable. These cloud object names do not rename or change delivery files, manifests, approvals, or hashes.

For a full Family or exact-Child package, add `references/variation-workflow.md`; trusted Variation verification also requires the saved project scope.
