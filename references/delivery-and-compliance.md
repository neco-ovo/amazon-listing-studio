# Delivery and compliance

Read this reference only for current-rule verification, final approval, or package creation.

## Upload readiness

Resolve rules for the exact marketplace and product type. Upload-ready output requires an applicable fresh snapshot or verified current Schema. If affected fields remain unverified, preserve `rules_unverified` and `upload_ready=false`; user permission to continue does not convert unknown rules or facts into compliance.

Never add competitor brands, unsupported standards, certification claims, promotional language, contact details, or URLs. Treat product-specific title, image, attribute, and category limits as dynamic rules rather than timeless constants.

## Final scope

Final approval must bind the current Product Master version, every selected approved image, approved Listing version, marketplace, product type, and rule status. Finalization must decode and rehash every selected image and regenerate the approved Listing JSON and Markdown. Earlier hashes are comparison evidence, not a reason to skip final reads.

Reject missing files, hash mismatches, stale Product Master bindings, invalid approvals, Listing mutations after approval, or bundle members that do not match the manifest. Build into a new output path; never overwrite the last valid delivery with a partial attempt.

Use `scripts/build-delivery.js` only as a deprecated v1 compatibility entrypoint. Finalize v2 projects with `scripts/studio.js finalize --project-dir <dir> --output <new-dir> --approval <final-approval.json>`. The Skill packages files for manual Seller Central use; it does not publish automatically.
