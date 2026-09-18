# Variation workflow

Read only for Parent/Child work. Parent is the common product identity; each Child is one purchasable SKU with one exact ordered tuple. Keep shared secondary records and invalidate direct dependents only.

## Family and theme

Use a current category Schema or user template for an ordered, category-permitted single or compound theme. Sparse real combinations are valid; never invent a Cartesian product or infer a compound theme from differences. Category differences are not a hard rejection boundary—compare stable identity, purpose, product form, and real offer relationships.

Promotion is non-destructive and preserves completed product files and approvals while adding Family records with `promote-variation`. Existing Families use `add-child`, `revise-child`, and `remove-child`.

Family Identity contains supported common facts; Parent copy uses only those facts. Child drafts store real differences. Standard variation differences may reuse Parent copy; different meaning, intent, form, purpose, or function require Child copy or block the Family.

## Images

Each Child main is independently scoped and approved. Light differences may reuse the merchant composition with necessary attribute changes.

Shared secondary images are reusable asset records, not a Family gallery; they carry factual dependencies and applicable Child mappings. Reuse merchant layouts only when facts and meaning match. Scenes must exclude sibling content and unconfirmed contents. Task `01a03541-aca1-7572-8ee5-1b6444353559` produced the local reviewed seed `assets/merchant-layouts/rigid-aluminum-signs.json`; runtime never needs task access.

Record every visible shared-image fact in `factDependencies`; compare scalars normalized and arrays or objects semantically. `subset_shared` matches declared Child facts without requiring Family common facts. Never delete dependencies merely to pass approval.

## Efficient revision and approval

Direct dependents use the fast local path without a full rerun. Common-fact changes recalculate only Parent intersection and affected shared mappings; identity/theme changes and finalization remain full.

When unresolved Family facts block Parent approval, use `scripts/studio.js resolve-variation-facts --project-dir <dir> --input <resolution.json>`. An explicitly approved resolution may `retain` one value already present on every active Child and clear its conflicts, or `exclude` an unresolved/non-publishable field. It cannot change a Child value, remove a supported fact, or modify a Variation Theme field. The transaction records history and recomputes Parent common facts plus shared applicability; do not write a project-specific mutation script.

Parent Listing, Child Listing, Child main, and shared-image approvals remain separate immutable records. One explicit batch action may create several records atomically; each item still passes its own scope checks, and final approval is last. New compatible Children use new shared mappings without mutating old approvals.

Record scoped images with `record-variation-candidate`; inspection and hash bind one byte snapshot. `child_main` and `child_secondary` belong to one exact Child, while `shared_image` is only for a genuinely reusable Family or subset asset. After the gallery plan is approved, Child secondaries may be registered and approved as one batch instead of requiring image-by-image confirmation. Approve one item with `approve-variation` or an approved set with `approve-variation-batch`. Final `approve-variation` validates current common facts and locks a draft Family Identity in the same transaction before freezing Parent, ordered theme, canonical tuples, customer-facing display values, Product Masters, complete Listings, asset maps, marketplace, product type, and rule status. Scope and file hashes are automatic integrity records, not a separate user confirmation.

For wording-only changes such as presenting portrait `8 x 12 Inches` as `12 x 8 Inches`, use `set-variation-display-values`. It updates Listing and upload presentation, stales the affected Listing and current final Variation version, and leaves physical facts, Product Masters, and images unchanged.

When a Child Product Master is explicitly `stale`, an approved replacement main advances its version and stales only assets and Listing content bound to the prior version. A locked Product Master still rejects a different main. New shared-image candidates remain under `.studio/work/` until approval publishes them to `<project>/assets/shared/`; preserved legacy `family/shared-assets/` candidates remain accepted. Child main candidates stay bound to their exact Child asset scope.

`finalize` delivers the full Family or one exact Child under trusted project approval, verifies the newly built package, and stores shared bytes once. An exact-Child package excludes siblings while retaining Parent identity and applicable shared assets. Run `verify-delivery --project-dir <dir>` only for a later, copied, moved, downloaded, or explicitly requested recheck. Do not create an upload spreadsheet without a current category template.
