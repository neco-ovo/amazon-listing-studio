# Listing limits and dynamic rules

For Amazon.com `en-US`, the dated local snapshot verified on 2026-08-24 records Amazon's 2026-07-27 non-media title limit of 75 characters including spaces and the new 125-character Item Highlights field. Amazon describes the two fields as a combined 200-character information space. See `assets/rules/amazon-us-defaults.json` for dated source URLs.

The project defaults of 200 characters per Bullet, 1000 combined Bullet characters, 2000 Description characters, and 250 UTF-8 bytes for backend search terms are conservative internal targets—not claims of one permanent universal Amazon rule. Resolve current rules in this order:

1. verifiable current marketplace and product-type Schema;
2. user-provided current category template;
3. dated local rule snapshot;
4. conservative Skill default.

When a current category Schema is unavailable, keep all fact-supported copy, list only the affected fields in `rules_unverified`, bind any user authorization to the current marketplace/product type/Product Master/Listing version, and set `upload_ready: false`. Do not label the bundle platform-approved or directly uploadable. Ask one concise question if permission to continue is required; no Case ID or exhaustive proof package is needed.

Deterministic validation checks Unicode character counts, backend UTF-8 byte count, five-Bullet structure, `[HEADING] Body` format, claim references, prohibited promotion/contact/competitor patterns, current Product Master version, and one-condense limit. Semantic review remains responsible for natural retail language, conversion strength, unsupported implications, image/copy agreement, and category-specific policy meaning.
