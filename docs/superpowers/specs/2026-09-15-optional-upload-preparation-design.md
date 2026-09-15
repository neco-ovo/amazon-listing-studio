# Optional Upload Preparation Design

**Date:** 2026-09-15  
**Target:** `amazon-listing-studio`

## Goal

Add one optional upload-preparation branch after approved delivery. It turns approved local images and Listing data into a checked Amazon upload workbook without slowing image generation, Listing drafting, or ordinary finalization. It does not publish to Seller Central.

## Trigger and scope

Run this branch only when the user asks for an upload workbook or upload preparation. Do not add a new project stage or repeat image, Listing, keyword, approval, or delivery work.

The branch reads the current immutable delivery manifest, the user-supplied Amazon template, current project facts, and any saved upload-preparation inputs. Its output is a new versioned directory under `outputs/`; it never overwrites an earlier workbook.

## One consolidated intake

Amazon image template fields require public URLs, while Studio-generated images are local by default. At upload preparation, ask once how to host them:

- upload to Cloudflare R2 using an available configured connector;
- use another user-specified image host;
- stop before workbook generation.

Do not perform a redundant search for public URLs. Reuse an earlier saved upload mapping only when it belongs to the same delivery manifest and the referenced objects still resolve.

In the same question, request only unresolved account or offer inputs required by the selected template and fulfillment mode. Read an existing shipping-template value from the supplied workbook or saved current account input. Never invent, translate, or substitute a shipping-template name; ask when the template does not determine it.

## Image handoff

Read approved image members from `delivery-manifest.json`. Derive short object names from project code, actual Variation values, and the approved gallery role. Ignore connector words such as `and`, `at`, `the`, and `of`. Use semantic roles rather than truncated source filenames.

Before upload, check the destination prefix for every proposed object key. Stop on a pre-existing name unless the user explicitly approves replacement. After upload, re-list the prefix and verify object count, content type, and public URL construction. Keep credentials outside project files.

## Gallery projection

Build each Child's upload images from its approved gallery plan and current applicable shared assets. Preserve the approved semantic order and count; do not impose a fixed five-role gallery.

Multiple scene or selling-point images are allowed when the approved plan contains them. Avoid only accidental duplication: a Child-local and shared asset must not both fill the same planned slot unless the plan explicitly contains two slots. A missing optional slot stays missing rather than being filled with an unrelated image.

## Template mapping

Treat project `product_type`, template Product Type, and Browse Tree or `item_type_keyword` as separate fields. A legacy project type may use an explicitly confirmed compatible template type without rewriting project identity. Resolve Browse Tree values from the supplied template's Browse Data or valid-values mapping, not from a copied category path.

For every sellable Child, check part number, selling price, list price, inventory, fulfillment channel, shipping template, relationship fields, Variation Theme and values, and required image URLs. Parent offer, inventory, package, and image fields remain blank when the template defines them as Child-only.

## Conditional requiredness

Determine required fields from the workbook's data definitions, formulas, data validation, and conditional-formatting rules together with the values selected for that row. A red border is a signal to evaluate its formula, not a universal required marker.

For example, switching a Child to Amazon fulfillment may activate package dimensions and package weight; seller-fulfilled rows may leave them blank when the template formula permits it. Report missing cells only after evaluating the applicable condition for the exact Parent or Child row.

Classify findings as:

1. upload-blocking missing;
2. autofill from confirmed facts;
3. user confirmation required;
4. correctly blank or not applicable.

## Workbook verification

Before handoff, perform one bounded verification pass:

- image URLs match the approved delivery and the upload mapping;
- gallery order matches each Child's approved plan;
- conditional requirements match the row's fulfillment and other trigger values;
- Parent and Child field scope is correct;
- formulas contain no errors;
- the saved workbook can be reopened.

Render a visual preview only when workbook structure or formatting may have changed. If Excel holds the output file open, write a new versioned filename or ask the user to close it; do not rerun hosting, research, Listing, or approval work.

## Readiness labels

`manual-prep` means the workbook is useful for review but one or more current rules, facts, URLs, or account values remain unresolved. `upload-ready` requires a current applicable rule snapshot, all activated template requirements, verified image URLs, and a successful workbook check. User permission cannot convert unknown rules into verified rules.

## Minimal implementation boundary

Expose one `prepare-upload` command and keep Cloudflare as an optional harness capability. Reuse the existing delivery manifest, rule resolver, SIGNAGE field seed, and workbook dependencies. Store one compact upload-preparation manifest beside the output workbook; do not add a second project state machine, background uploader, dashboard, or Seller Central publisher.

## Tests

- Local generated images trigger one hosting-choice request before URL-required workbook generation.
- Existing shipping-template cells are preserved; absent or ambiguous values require confirmation.
- Gallery projection follows approved slots and allows repeated semantic categories when the plan contains multiple slots.
- FBA and FBM rows produce different package-field requirements according to template formulas.
- Legacy product-type compatibility requires explicit mapping and does not mutate project identity.
- Object names omit connector words, use semantic roles, remain unique, and stop on destination collisions.
- Workbook output reopens, contains no formula errors, and never overwrites an existing version.
