# Amazon Variation Support Design

**Date:** 2026-08-27  
**Status:** Approved conversational design; pending written-spec review  
**Target:** `amazon-listing-studio`

## Objective

Extend the existing Skill with optional Amazon Variation support without slowing or complicating ordinary single-product work. A Variation project represents one product family, one non-buyable Parent identity, and multiple purchasable Child SKUs. Parent copy describes the common product series; Child copy and images describe the exact purchasable SKU.

The implementation must support new Variation projects and non-destructive promotion of completed single-product projects. It must also support compound Variation Themes such as `Color × Size` and must not assume that every possible attribute combination exists.

## Chosen Approach

Add an optional Variation layer to the current v2 project model. Existing single-product state, workflows, commands, and tests remain valid. Variation modules and checks load only when `project.mode` is `variation_family` or when the user explicitly requests Parent/Child work.

Rejected alternatives:

- A separate Variation Skill would duplicate facts, Listing, image approval, and delivery rules.
- Treating every single product as a one-child family would add files and state to simple tasks.

## Efficiency Principles

- Do not repeat market research, rule refresh, shared-fact confirmation, or shared-copy generation for each Child.
- Do not rewrite fields that have no Child-specific difference.
- Do not regenerate identical secondary images or require duplicate approvals.
- Do not reapprove the entire family when one Child changes.
- Do not generate Parent or family-range images unless requested or required by the current category template.
- Validate and invalidate only changed fields and their direct dependents, except during final delivery verification.
- Do not run precise physical-ratio measurement for every main-image variant. Use it for dimension graphics, explicit user requirements, or visible distortion; otherwise reject only obvious stretching, compression, or orientation conflict.

## Project and Directory Model

One Variation Family uses one product project directory. New Variation projects use this logical structure:

```text
<product-root>/
├─ family/
│  ├─ family.json
│  └─ shared-assets/
├─ parent/
│  └─ listing/
├─ children/
│  └─ <child-sku>/
│     ├─ child.json
│     ├─ listing/
│     └─ assets/
├─ state.json
└─ delivery/
```

The state has these optional Variation objects:

- `family_identity`: stable common identity, brand, product form, material, construction, shared functions, and explicit non-merge boundaries.
- `variation_theme`: an ordered list of one or more dimensions and their category field names.
- `parent`: Parent SKU, shared Listing baseline, version, and approval status.
- `children`: keyed Child records containing SKU, variation tuple, facts, Listing overrides, Child Product Master, and approval status.
- `shared_assets`: common assets with applicability conditions and approval bindings.
- `variation_versions`: immutable snapshots of approved family compositions.

Every Child SKU is unique and every active Child has a complete unique tuple for the declared Variation Theme. A compound theme stores dimensions independently, for example:

```json
{
  "dimensions": ["color_name", "size_name"],
  "values": {"color_name": "Slow Down016", "size_name": "12 x 16 in"}
}
```

The system supports sparse combinations. It must not invent a Child merely because another Color and Size combination could exist mathematically.

Amazon browse-node or small-category differences are observations, not hard family boundaries. Many valid Child offers appear under different small categories. Compatibility is based primarily on stable product identity, purpose, product form, and a plausible Variation relationship.

## Single-Product Promotion and Resume

When an existing completed project receives a Parent or new-Child request, the Skill detects its state before writing:

- Existing Variation Family: use `add-child`, `revise-child`, or `revise-parent`.
- Existing single-product project: use `promote-to-variation`.
- Partially created Variation structure: validate the checkpoint and resume missing steps.
- Existing delivery: preserve it as an immutable historical version and create a new Variation version.

Promotion creates missing `family`, `parent`, and `children/<existing-sku>` directories. It does not move or duplicate approved legacy images or Listings because their paths, hashes, and approval bindings must remain valid. The first Child references those legacy files. New artifacts use the new Child layout. The existing single-product Product Master becomes the first Child Product Master. Common facts become Family Identity candidates; Child-only facts remain on the Child.

If the existing product lacks a SKU, ask one consolidated question. Initialization and resume must be idempotent and must never overwrite an existing design, approval, or delivery.

## Family and Child Identity

Identity locking has two levels:

- `Family Identity` locks facts common to the series and its compatibility boundaries.
- `Child Product Master` locks the exact approved main image and real variation attributes of one purchasable SKU.

Family Identity never substitutes for Child main-image approval. A change to one Child invalidates only its direct dependents unless it changes a fact previously treated as common. In that case, recalculate the Parent fact intersection and affected shared assets.

Hard incompatibilities block the Variation:

- materially different product forms, core purposes, or buyer objects;
- duplicate Child SKU or duplicate complete variation tuple;
- internally conflicting Child facts;
- Parent content using a fact not shared by all active Children;
- a Child title or image explicitly depicting another Child.

Ambiguous compatibility prompts one consolidated question and records the decision. Small-category differences alone never block merging.

## Difference Classification

For all active Children, classify facts as:

- `common`: identical, supported facts eligible for Family Identity and Parent copy;
- `variation`: declared dimensions such as Size, Color, Pattern, Style, or Pack Count;
- `child_only`: functions, graphics, warning copy, use intent, or marketing expressions unique to a Child;
- `conflict`: contradictory evidence requiring resolution.

Choose a mode automatically, with a user override:

- **Light-difference mode:** common identity, purpose, material, and core function; differences are standard variation attributes. Generate one Parent baseline and only necessary Child title, attributes, search-term increments, and field overrides.
- **Large-difference mode:** graphic, warning language, buyer intent, use object, or core function changes enough to affect conversion copy. Generate a complete effective Listing for each Child while still inheriting common facts and reusing approved merchant secondary-image layouts.

If classification is ambiguous, ask once for the family rather than field by field.

## Parent and Child Listing Model

Parent stores a full series-level Listing baseline: Parent Title, Item Highlights, Bullets, Description, search terms, special features, and relevant product details. Child records store only real differences during drafting, but approval and delivery materialize a complete effective Child Listing so downstream consumers do not depend on implicit merging.

### Parent

Parent content answers: “What is this product series?” It may use only facts common to every active Child. Parent Title normally omits:

- specific size;
- specific color;
- specific pack count;
- Child-only function;
- Child-only graphic, warning phrase, pattern, or style.

The Parent Title follows the current category rule or user-provided template. It must remain highly general without becoming vague or losing the core searchable product identity.

### Child

Child content answers: “What is this exact purchasable SKU?” Child Title uses the current category limit, with 75 characters as the conservative default target when no more specific verified rule exists. Its priority is:

1. core buyer search language;
2. product identity;
3. necessary product attributes;
4. distinguishing variation attributes.

Size, Color, Pattern, Style, Pack Count, and other dimensions may appear when true for that Child. SEO must not change facts, introduce unsupported claims, or cause keyword stuffing.

### Copy Checks and Fast Revisions

The bounded Listing audit detects:

- Parent facts or title tokens belonging to only some Children;
- missing or conflicting Child variation attributes;
- incompatible products incorrectly grouped together;
- installation surfaces replacing core buyer intent;
- mechanical front/back keyword duplication;
- unsupported Child-specific search terms;
- unnatural, indirect, overly promotional, or unnecessary compliance language.

A single-field edit patches and validates that field and its direct dependencies only. It must not rebuild the whole family or repeat research and rule checks.

## Image Model

Every image brief declares an asset scope:

- `child_specific`: bound to one Child SKU and its Product Master;
- `shared_asset`: common material, construction, installation, or brand content reusable by compatible Children;
- `subset_shared`: one asset or layout applicable to an explicit Child subset;
- `family_range_asset`: optional composite display of multiple Child variants;
- `parent_asset`: generated only when requested or required by a verified category template.

`shared_asset` means a reusable asset pool, not a mandatory image showing all Children. The Family does not receive a separate image set by default. A `family_range_asset` may show multiple variants, but it cannot serve as a Child main image.

### Main Images

Each Child has its own approved main image. In light-difference mode, reuse the approved composition and make the smallest necessary adjustment for Size, Color, Pattern, or Pack Count. Do not run mandatory exact-ratio analysis for every variant, but reject obvious stretching, compression, or orientation conflict. Large-difference mode decides case by case whether the composition remains suitable.

### Secondary Images

Reuse approved merchant layouts by default. Replace only necessary product imagery, copy, dimensions, colors, graphics, and scenario details. Material, construction, installation, and brand graphics may be shared when their factual dependencies match. Dimension images are Child-specific unless the relevant dimensions are identical. Scenario layouts may be shared, but their visible product and scenario meaning must match the Child.

### Image Consistency

Before generation, bind the brief to the target Child facts. After generation, inspect visible Size, Color, Pattern, Style, Pack Count, product wording, and scenario meaning for cross-Child contamination. Examples of blocking errors include a 12 × 16 Child shown as 8 × 12 or a Horse Crossing Child shown as Kids at Play. Also reject props or fasteners that imply unconfirmed package contents.

Use one targeted correction for a local defect. Do not repeat research, full planning, or unrelated image generation.

## Shared-Asset Applicability and Approval

A shared image approval records either:

- `all_current_children`, with explicit factual dependencies; or
- an explicit set of Child SKUs.

When a new Child is added, the old approval remains immutable. The Skill compares the new Child with the asset dependencies and recommends reuse when compatible. It does not regenerate or reapprove the asset merely because the Child is new. If incompatible, create a small derivative or exclude the Child.

Child main-image approval, shared-image approval, Parent Listing approval, and Child Listing approval are distinct records and cannot substitute for one another.

## Incremental Operations

- `promote-to-variation`: supplement an existing directory and register the existing product as the first Child.
- `add-child`: inherit common facts, Parent copy, and eligible shared assets before processing differences.
- `revise-child`: update one Child and its direct dependents.
- `revise-parent`: accept only the current common-fact intersection.
- `remove-child`: preserve history and recompute Parent facts and asset applicability.
- `finalize-family`: deliver an approved Family version.
- `finalize-child`: deliver one approved Child without rebuilding unaffected Children.

Task routing treats local Child copy edits, presentation-only image edits, approvals, and knowledge lookups as fast operations. Identity changes, first promotion, Variation Theme changes, and finalization use the full path.

## Approval and Delivery

Final Family approval binds:

- Family Identity version;
- Parent version;
- ordered Variation Theme dimensions;
- the exact active Child SKU and variation tuples;
- each delivered Child Product Master and effective Listing version;
- shared and Child-specific image mappings;
- marketplace, product type, and rule status.

The Family delivery contains:

- Parent shared Listing;
- one complete effective Listing per Child;
- Child main images and applicable secondary-image mappings;
- one physical copy of each shared image;
- a Variation Matrix with Parent SKU, Child SKUs, ordered theme dimensions, values, and asset ownership;
- a versioned manifest and integrity hashes.

The Skill may also deliver a selected Child only. It does not generate a Seller Central upload spreadsheet unless a current category field schema or user-provided template is available.

## Dynamic Rules

Title limits, permitted Variation Themes, required Parent fields, and upload schemas remain dynamic rules. Use the existing precedence: current verifiable official/category schema, user-provided current template, dated local snapshot, then conservative Skill default. Rule verification is shared for the Family and is not repeated per Child unless a Child genuinely uses a different product type or affected rule.

## Testing Strategy

All production behavior is developed test-first. Required coverage includes:

- optional Variation activation without affecting single-product state;
- idempotent, non-destructive promotion of a completed single-product project;
- directory supplementation while preserving old paths, hashes, approvals, and deliveries;
- one-dimensional and compound Variation Themes;
- sparse compound combinations and duplicate tuple rejection;
- light- and large-difference classification plus user override;
- Parent common-fact intersection and Child override materialization;
- Parent and Child title priorities, limits, and conflicts;
- cross-Child image contamination checks;
- shared-asset applicability and new-Child reuse;
- direct-dependency invalidation for Child and Parent changes;
- Family and Child delivery verification;
- existing single-product compatibility and the complete pre-existing test suite.

## Acceptance Criteria

- A completed single-product directory can be promoted, supplemented, resumed, and delivered as a Variation Family without moving or invalidating approved legacy assets.
- Parent content contains only shared product identity and facts.
- Every Child output represents its exact purchasable SKU and complete variation tuple.
- Compound themes work without requiring a full Cartesian product.
- Child images and copy cannot silently inherit another Child's visible or textual attributes.
- Shared copy and secondary images are generated and approved once when compatible.
- Adding or editing one Child does not cause unrelated Child work to repeat.
- Ordinary single-product work remains on its current fast path.
