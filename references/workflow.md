# Approval workflow

## Intake

Record user facts before extracted observations. Keep `user_confirmed`, `source_observed`, `ai_suggested`, `unknown`, `conflicted`, and `not_applicable` distinct. Ask only for facts blocking the current phase.

## Main image and Product Master

1. Plan canvas separately from physical product proportions.
2. Generate a real main raster.
3. Save, decode, hash, and inspect the saved file.
4. Present it with QA findings.
5. Lock Product Master only after explicit approval.

The lock records identity, physical dimensions/proportions, color/variant, count, confirmed visible components, canonical reference hashes, approved-main hash, and version.

## Secondary images

Default to three distinct application scenes, one size/spec image, one material/detail image, and one back/structure/installation image. Replace any unsupported card. Generate, inspect, and approve one image before starting the next. Every asset records its Product Master version and fact dependencies.

## Listing

Start after the chosen secondary set is current. Generate Title, Item Highlights, exactly five Bullets, Description, Backend Search Terms, Special Features, and supported category attributes. Use approved publishable facts only. Present all fields and warnings together for one consolidated review. If Schema is unavailable, ask once whether to continue, label only affected fields, and keep `upload_ready=false`.

## Rejection and change

Never overwrite a rejected or approved asset. Create a child version with one targeted correction and rerun all checks. Ask the user after two unsuccessful automatic corrections. Identity changes increment Product Master and stale explicit dependents; presentation-only changes replace only affected presentation files.

## Delivery

Require one consolidated approval bound to the current Product Master, image set, Listing, marketplace, product type, and Schema status. Reject missing, corrupt, stale, or unapproved artifacts. Produce relative paths, media types, byte sizes, and SHA-256 hashes.

Sunk cost, product ownership, and urgency do not bypass saved-file inspection, sequential secondary approval, Schema warnings, or version-bound final approval. Resume from recorded evidence rather than assuming existing files were approved.
