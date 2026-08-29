# Variation workflow

Read only for Parent/Child work. Parent is the common product identity; each Child is one purchasable SKU with one exact ordered tuple. Keep shared secondary records and invalidate direct dependents only.

## Family and theme

Use a current category Schema or user template for an ordered, category-permitted single or compound theme. Sparse real combinations are valid; never invent a Cartesian product or infer a compound theme from differences. Category differences are not a hard rejection boundary—compare stable identity, purpose, product form, and real offer relationships.

Promotion is non-destructive: preserve an approval-complete single product's files, hashes, approvals, and deliveries in place while adding Family/Parent/Child records with `scripts/studio.js promote-variation`. Existing Families use `add-child`, `revise-child`, and `remove-child`. New Children receive scoped asset and Listing directories.

Family Identity contains supported common facts. Parent copy uses only those facts. Child drafts store real differences, while approval and delivery materialize complete copy with Parent SKU, Child SKU, ordered theme, and exact values. Standard Size/Color/Pattern/Style/Pack differences may reuse Parent copy; different graphics, warning meaning, buyer intent, product form, purpose, or core function require suitable Child copy or block the Family.

## Images

Each Child main is independently scoped and approved. Light-difference Children may reuse the merchant composition with necessary attribute changes; never stretch a different ratio or use a family composite as a Child main.

Shared secondary images are reusable asset records with factual dependencies and applicable Child mappings, not a Family gallery. Reuse merchant layouts when facts and visible meaning match. Dimensions are Child-specific unless identical; scenes must show the target Child and exclude sibling wording, graphics, tuples, and unconfirmed contents. Rigid-aluminum layouts use the local reviewed seed in `assets/merchant-layouts/rigid-aluminum-signs.json`, derived from task `01a03541-aca1-7572-8ee5-1b6444353559`; the local reviewed seed is authoritative and runtime never requires task access.

Keep every fact visibly used by a shared image in `factDependencies`. Scalar values use normalized comparison; arrays and objects use semantic deep comparison. Do not delete structured dependencies merely to make applicability approval pass.

## Efficient revision and approval

Direct dependents of Child-local copy/facts, presentation edits, approvals, and lookups use the fast local path without a full rerun. A changed common fact recalculates Parent intersection and affected shared mappings only. Identity or theme changes and finalization are full.

When unresolved Family facts block Parent approval, use `scripts/studio.js resolve-variation-facts --project-dir <dir> --input <resolution.json>`. An explicitly approved resolution may `retain` one value already present on every active Child and clear its conflicts, or `exclude` an unresolved/non-publishable field. It cannot change a Child value, remove a supported fact, or modify a Variation Theme field. The transaction records history and recomputes Parent common facts plus shared applicability; do not write a project-specific mutation script.

Parent Listing, Child Listing, Child main, and shared-image approvals remain separate immutable records. One explicit batch action may create several records atomically; each item still passes its own scope checks, and final approval is last. New compatible Children use new shared mappings without mutating old approvals.

Record scoped images with `record-variation-candidate`; inspection and hash bind one byte snapshot. Approve one item with `approve-variation` or an approved set with `approve-variation-batch`. Final approval freezes identity, Parent, ordered theme, active tuples, Product Masters, complete Listings, asset maps, marketplace, product type, and rule status.

`finalize` delivers the full Family or one exact Child under trusted project approval, verifies the newly built package, and stores shared bytes once. An exact-Child package excludes siblings while retaining Parent identity and applicable shared assets. Run `verify-delivery --project-dir <dir>` only for a later, copied, moved, downloaded, or explicitly requested recheck. Do not create an upload spreadsheet without a current category template.
