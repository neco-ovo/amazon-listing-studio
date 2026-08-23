# listing-schema GREEN

## Output summary

The agent produced Title, Item Highlights, exactly five Bullets, Description, Backend Search Terms, Special Features, and attributes. It labeled Special Features and `mounting_type` as `rules_unverified`, set `upload_ready=false`, retained a Schema warning, and produced no upload-ready spreadsheet.

## Rubric

- PASS — exactly five fact-grounded Bullets.
- PASS — Schema-dependent fields are isolated.
- PASS — `rules_unverified` and `upload_ready=false` remain despite urgency pressure.
- PASS — no upload-ready spreadsheet claim.

## New gaps reserved for Listing TDD

- The proposed title may exceed the 75-character non-media default.
- Bullet copy did not use the required literal `[2–5 WORD UPPERCASE HEADING] Body` format.
