# Amazon Product Project Input v1

Use this specification when a downstream skill, including an Amazon A+ content skill, receives an Amazon product project directory as input.

## Consumer contract

The input is the product project root. Read `product.json` first. It is the only index for current publishable facts, approved product images, and approved Listing files.

Do not read `.studio/`, infer facts from filenames, scan candidate directories, or replace a missing indexed file with another file found in the project.

All paths are POSIX-style paths relative to the project root. Reject absolute paths and traversal. Resolve links before reading and reject a file whose real path is outside the real project root.

## Required root files

```text
project.md       optional human summary
product.json     required machine-readable index
assets/          files referenced by product.json.assets
listing/         files referenced by product.json.listing
```

`delivery/` is optional and is not an A+ source. `.studio/` is private to the producer.

## `product.json`

Minimal single-product example:

```json
{
  "schema_version": 1,
  "product_id": "danger-hard-hat-sign",
  "marketplace": "amazon.com",
  "language": "en-US",
  "product_type": "aluminum-sign",
  "facts": {
    "material": "Aluminum",
    "size": "8 x 12 in",
    "orientation": "Portrait",
    "included_components": ["1 sign"]
  },
  "approved_claims": ["rust-resistant"],
  "excluded_claims": ["mounting hardware included"],
  "assets": [
    {"role": "main", "scope": "product", "path": "assets/main.png"},
    {"role": "application", "scope": "product", "path": "assets/application.png"}
  ],
  "listing": {
    "product": "listing/listing.json"
  }
}
```

Variation example:

```json
{
  "schema_version": 1,
  "product_id": "slow-kids-pets-sign",
  "marketplace": "amazon.com",
  "language": "en-US",
  "product_type": "aluminum-sign",
  "facts": {
    "material": "Aluminum",
    "included_components": ["1 sign"]
  },
  "approved_claims": ["rust-resistant", "weather-resistant"],
  "excluded_claims": ["mounting hardware included"],
  "variation": {
    "themes": ["color", "size"],
    "children": [
      {
        "sku": "SIGN-YELLOW-12X16",
        "values": {"color": "Yellow and Black", "size": "12 x 16 in"},
        "facts": {}
      }
    ]
  },
  "assets": [
    {"role": "material", "scope": "shared", "path": "assets/shared/material.png"},
    {
      "role": "main",
      "scope": "child",
      "child_sku": "SIGN-YELLOW-12X16",
      "path": "assets/children/SIGN-YELLOW-12X16/main.png"
    }
  ],
  "listing": {
    "parent": "listing/parent/listing.json",
    "children": {
      "SIGN-YELLOW-12X16": "listing/children/SIGN-YELLOW-12X16/listing.json"
    }
  }
}
```

## Field semantics

| Field | Requirement |
|---|---|
| `schema_version` | Must equal `1`. Stop on an unsupported version. |
| `product_id` | Stable project identity. |
| `marketplace` | Target Amazon marketplace. |
| `language` | Content language and locale. |
| `product_type` | Seller-facing product family, not necessarily an Amazon browse-node label. |
| `facts` | Confirmed publishable common or single-product facts. |
| `approved_claims` | Claims allowed in generated content. They remain subject to marketplace rules. |
| `excluded_claims` | Statements or implications downstream content must avoid. |
| `variation` | Optional Parent/Child structure. Omit for a single product. |
| `assets` | Exact current approved image index. |
| `listing` | Exact current approved Listing index. |

Unknown, conflicted, suggested, and observation-only facts are absent. Absence means unknown, not false.

Validate the document boundary before use: the root and each structured member must have the object, array, string, or integer type shown by this specification; Child SKUs must be non-empty and unique; every `child_sku` and `child_skus` reference must name a listed active Child; and `scope: "product"` is valid only when `variation` is absent.

## Variation resolution

For a Child, combine top-level `facts` with that Child's `facts`; the Child value wins only for a key explicitly present in the Child. `variation.children[].values` supplies the exact purchasable variation tuple.

Do not synthesize missing Child combinations. The listed Children are the complete active set, including sparse compound Variation families. A valid in-progress project may omit a Parent Listing, a Child Listing, or some Child assets. Process only listed Children and fail only when an artifact required for the user's requested scope is absent. Do not use one Child's main image, wording, color, pattern, size, or scenario for another Child unless an indexed asset has `scope: "shared"` or explicitly lists that Child.

## Asset resolution

Each asset requires `role`, `scope`, and `path`.

Supported scope meanings:

- `product`: applies to the single product.
- `shared`: applies to every active Child and does not accept `child_sku` or `child_skus`.
- `child`: requires `child_sku` and applies only to that Child.
- `subset`: requires a non-empty `child_skus` list.

The consumer may select the image roles needed for its output, but it must not treat unindexed images as approved inputs. A missing or unreadable indexed asset is a missing-input error.

## Listing resolution

- Single product: read `listing.product` when the requested task needs Listing copy.
- Variation Parent: read `listing.parent` when present and required by the requested task.
- Variation Child: read the exact entry in `listing.children` when that Child's Listing is required.

The `listing` object and individual entries may be absent while the project is in progress. Their absence is blocking only when the requested downstream output requires that scope's Listing.

Listing copy is marketing language, not independent proof of a product fact. Factual A+ claims must be supported by `facts` or `approved_claims`. `excluded_claims` always wins over Listing wording.

## Downstream read sequence

1. Validate `product.json` and `schema_version`.
2. Select the single product or exact Child SKU requested by the user.
3. Resolve common facts, Child values, Child overrides, approved claims, and excluded claims.
4. Resolve only indexed assets applicable to that scope.
5. Read the indexed Listing for marketing language and search intent.
6. Report any missing required input once; do not search `.studio/` for substitutes.

## Producer requirements

A producer claiming Amazon Product Project Input v1 must ensure:

- every indexed path exists inside the project root;
- every indexed image is the current approved image for its declared scope;
- every indexed Listing is the current approved Listing;
- `product.json` contains no unresolved or observation-only facts;
- removed or replaced artifacts are no longer indexed;
- Child SKUs and all Child asset or Listing references satisfy the active-set constraints;
- updating one Child does not silently change another Child's index.
