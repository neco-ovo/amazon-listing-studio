# Variation workflow

For Parent/Child work only. Parent is common product identity; each Child a purchasable SKU with an exact tuple. Keep shared secondary records and invalidate direct dependents only.

## Family and theme

Use category Schema or user template for an ordered, category-permitted theme. Sparse combinations are valid; never invent a Cartesian product or infer a compound theme from differences. Category differences are not hard boundaries—compare identity, purpose, form, and offer relationships.

Promotion is non-destructive and preserves files and approvals while adding Family records with `promote-variation`. Existing Families use `add-child`, `revise-child`, and `remove-child`.

Family Identity contains supported common facts; Parent copy uses only those facts. Child drafts store real differences. Standard variation differences may reuse Parent copy; different meaning, intent, form, purpose, or function require Child copy or block the Family.

## Images

Each Child main is independently scoped and approved. Light differences may reuse merchant composition with attribute changes.

Shared secondary images are reusable asset records, not a Family gallery; they carry factual dependencies and applicable Child mappings. Reuse merchant layouts only when facts and meaning match. Scenes must exclude sibling content and unconfirmed contents. Task `01a03541-aca1-7572-8ee5-1b6444353559` produced local reviewed seed `assets/merchant-layouts/rigid-aluminum-signs.json`; runtime does not need task access.

Record every visible shared-image fact in `factDependencies`; compare scalars normalized and arrays or objects semantically. `subset_shared` matches declared Child facts without requiring Family common facts. Never delete dependencies merely to pass approval.

## Efficient revision and approval

Direct dependents use the fast local path without a full rerun. Common-fact changes recalculate only Parent intersection and affected shared mappings; identity/theme changes and finalization remain full.

For unresolved Family facts, run `resolve-variation-facts`. An approved resolution may retain a value shared by every active Child or exclude an unresolved field; it cannot change Child values, remove supported facts, or alter the Variation Theme. It records history and recomputes common facts and shared applicability.

Parent Listing, Child Listing, Child main, and shared-image approvals remain separate immutable records. One explicit batch action may create several records atomically; each item still passes its own scope checks, and final approval is last. New compatible Children use new shared mappings without mutating old approvals.

Record scoped images with `record-variation-candidate`; inspection and hash bind one byte snapshot. `child_main` and `child_secondary` belong to one exact Child, while `shared_image` is only for a genuinely reusable Family or subset asset. After the gallery plan is approved, Child secondaries may be registered and approved as one batch instead of requiring image-by-image confirmation. Approve one item with `approve-variation` or an approved set with `approve-variation-batch`. Final `approve-variation` validates common facts, aggregates per-Listing rule gaps, locks a draft Family Identity in same transaction, then freezes Parent, ordered theme, canonical tuples, customer-facing display values, Product Masters, complete Listings, asset maps, marketplace, product type, and rule status. Scope and file hashes are automatic integrity records, not a separate user confirmation.

A same-Child, same-role revision marks the prior asset `superseded`; approval history remains and Final selects the revision.

First Final approval moves draft version 0 to locked version 1 atomically; no separate lock.

Use `reverify-variation-rules --project-dir <dir> --template <xlsm>` to bind matching template evidence, reapprove unchanged Listings and Final, and rebuild delivery once.

For wording-only changes such as presenting portrait `8 x 12 Inches` as `12 x 8 Inches`, use `set-variation-display-values`. It updates Listing and upload presentation, stales the affected Listing and current final Variation version, and leaves physical facts, Product Masters, and images unchanged.

When a Child Product Master is explicitly `stale`, an approved replacement main advances its version and stales only assets and Listing content bound to the prior version. A locked Product Master still rejects a different main. New shared-image candidates remain under `.studio/work/` until approval publishes them to `<project>/assets/shared/`; preserved legacy `family/shared-assets/` candidates remain accepted. Child main candidates stay bound to their exact Child asset scope.

`finalize` delivers the full Family or one exact Child under trusted project approval, verifies the newly built package, and stores shared bytes once. An exact-Child package excludes siblings while retaining Parent identity and applicable shared assets. Run `verify-delivery --project-dir <dir>` only for a later, copied, moved, downloaded, or explicitly requested recheck. Do not create an upload spreadsheet without a current category template.
