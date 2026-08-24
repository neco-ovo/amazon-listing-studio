# Knowledge and facts

Read this reference only for intake, fact conflicts, reusable market knowledge, or Product Master invalidation.

## Authority order

1. Current explicit user confirmation for this product.
2. Approved seller-family facts whose scope applies to this product.
3. Product documents and reference links.
4. Category observations and competitor patterns.
5. AI suggestions.

A higher source overrides a lower one. Preserve source IDs and the losing value when a conflict matters. Ask one concise question only when a missing or conflicting fact blocks the current artifact.

## Three knowledge scopes

- Project facts live in `state.json`. A user-confirmed project fact is publishable and overrides reusable knowledge.
- Seller-family facts live under `library/seller-families/`. Match the family from stable construction traits such as material and product form, not an exact Amazon category. A rigid aluminum yard sign, store sign, and safety sign may share one family; corrugated plastic, vinyl decals, and digital signs do not. Category names are hints, not hard boundaries.
- Category observations live under `library/categories/<marketplace>/`. Store recurring benefits, shopper language, visual patterns, and source dates here. They may guide briefs and keywords but are not automatically product claims.

Use `scripts/studio.js learn-category` to merge market observations. Promote a common performance point to a seller-family fact only after the user confirms it applies to that family. This preserves the requested reuse without turning competitor language into unsupported product facts.

Separate family membership from claim applicability. Structural claims such as rust resistance may inherit with the confirmed aluminum construction. Process-dependent claims such as fade resistance, reflectivity, or waterproofing require matching finish/process evidence. When that evidence is absent, ask one consolidated question before formal image and Listing work. Record a confirmation for only the current project or, when the user says the manufacturing series shares the process, for the seller family so later matching projects do not ask again. A negative or uncertain answer omits only those claims and does not block the workflow.

## Product identity and invalidation

Product identity includes construction, dimensions and orientation, count, front/back appearance, printed copy, defining colors, mounting features, and included components. A user-authorized redesign may change specified identity fields. After Product Master lock, an identity change creates a new Product Master and stales dependent secondary images and Listing claims; a presentation-only change does not.

Do not treat visible screws, hooks, props, tools, brackets, or scene accessories as included unless confirmed. Do not infer reflective, certified, compliant, lifespan, thickness, or performance claims from category prevalence alone.
