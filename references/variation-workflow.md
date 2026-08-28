# Variation workflow

Read this reference only when the request or saved project state involves Parent/Child work. Ordinary single-product work stays on its existing route and does not load Variation detail.

## Activate and select the theme

A Parent expresses the common product identity. Each active Child expresses one exact purchasable SKU and its complete ordered variation tuple. Start with stable identity, purpose, product form, and real Child offers; category differences alone are not a hard rejection criterion or family boundary.

Select an ordered, category-permitted one- or compound-dimension theme from a current category Schema or user-provided current template. Never synthesize a compound theme from observed differences. Preserve its dimension order, require every Child to supply every dimension, reject duplicate complete tuples, and support sparse real combinations without inventing a Cartesian product.

## Promote or extend a project

For an approval-complete single-product project, use `scripts/studio.js promote-variation --project-dir <dir> --parent-sku <sku> --child-sku <sku> --theme <theme.json>`. Promotion is non-destructive: supplement `family`, `parent`, and `children/<sku>` directories while preserving approved legacy images, Listings, approvals, hashes, and deliveries in place. The first Child references those artifacts; never move or overwrite them for layout normalization. Resume only a matching partial promotion.

For an existing Family, use `add-child`, `revise-child`, or `remove-child` with a JSON input file. A new Child creates its own `children/<sku>/assets` and `children/<sku>/listing` directories. Do not create possible Color × Size combinations that the merchant does not actually offer.

## Lock identity and write copy

Family Identity contains supported facts common to every active Child and explicit non-merge boundaries. Each Child Product Master binds the exact approved main raster and real variation values for that purchasable SKU; Family Identity never substitutes for Child approval.

The Parent Listing is the series baseline and may use only common facts. Child drafts store real differences, but approval and delivery materialize complete effective Child copy with `parent_sku`, `child_sku`, ordered `variation_theme`, and the exact `variation_values`. Small standard-attribute differences may reuse Parent copy with limited overrides. Different graphics, warning meaning, buyer intent, product form, purpose, or core function require independently suitable Child copy or block the Family when identity is incompatible.

## Scope images and reuse layouts

Every image brief declares `child_specific`, `shared_asset`, `subset_shared`, `family_range_asset`, or `parent_asset`. Each Child main is independently scoped and approved against that Child Product Master. Light-difference Children may reuse the merchant composition with only necessary Size, Color, Pattern, Style, or Pack Count changes; never use a family-range composite as a Child main.

Shared secondary images are reusable asset records with explicit factual dependencies and applicable Child mappings, not a separate Family gallery. Reuse approved merchant secondary-image layouts when their facts and visible meaning match. Dimension cards remain Child-specific unless the dimensions match; scenario imagery must show the target Child and must not import another Child's wording, graphics, tuple, or unconfirmed package contents.

For rigid aluminum signs, use the local reviewed seed metadata and previews in `assets/merchant-layouts/rigid-aluminum-signs.json`. They were derived from approved smoke-test deliverables associated with task `01a03541-aca1-7572-8ee5-1b6444353559`; the local reviewed seed is the portable source of truth, and runtime does not require task access.

## Revise only direct dependents

Local Child copy edits, presentation-only image edits, approvals, and knowledge lookups are fast operations. Invalidate the changed artifact and its direct dependents only, without a full workflow rerun. A Child fact formerly treated as common also invalidates the Parent intersection and affected shared-asset mappings; unrelated Children and immutable approvals remain unchanged. Promotion, identity or theme changes, and finalization use full mode.

## Approve and deliver

Parent Listing, Child Listing, Child main, and shared-image approvals are separate and immutable. A shared approval freezes its dependency facts and current applicable Child set; later compatible Children reuse it through new mapping records rather than mutating the approval.

Use `scripts/studio.js record-variation-candidate --project-dir <dir> --input <candidate.json>` for an explicitly scoped `child_main` or `shared_image` candidate. Recording reads one immutable byte snapshot for decoding, deterministic checks, saved-file inspection, and hashing, then freezes that inspected hash and exact role; approval rehashes the live saved path and rejects any byte or role change. Then use `scripts/studio.js approve-variation --project-dir <dir> --input <approval.json>` with exactly one of `child_main`, `shared_image`, `parent_listing`, `child_listing`, or `variation_final` as `scopeType` and `userAction: "approved"`. Child paths and IDs are never interchangeable, and fields belonging to one scope must not be reused for another. The legacy `record-candidate` and `approve` commands remain the single-product route.

Final approval freezes Family Identity and Parent versions, ordered theme dimensions, exact active Child tuples, every Child Product Master and effective Listing version, scoped image maps, marketplace, product type, and rule status. Shared image entries include their immutable asset-scope declaration, while Child secondary entries include their approval scope, exact Child owner, and Product Master version. A promoted legacy secondary may retain an unscoped legacy approval only through the Child's preserved legacy reference; final approval normalizes its current Child and Product Master identity, and any present conflicting legacy field blocks approval or delivery. Finalize either a full Family or one exact Child. A Family package contains Parent copy, complete Child copy, one physical copy per shared asset, and the Variation Matrix; exact-Child delivery excludes unrelated siblings while retaining Parent identity and applicable shared assets.

Use `scripts/studio.js finalize --project-dir <dir> --output <new-dir> --approval <approval.json> [--child-sku <exact-sku>]`. Then use `scripts/studio.js verify-delivery --delivery-dir <delivery-dir> --project-dir <dir>`: Variation verification must use trusted project approval verification and must not downgrade to the single-product verifier. Do not create a Seller Central spreadsheet without a current category field Schema or user-provided template.
