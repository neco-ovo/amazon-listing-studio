# Workflow Efficiency Design

## Goal

Reduce routine token use, generation wait time, and approval turns without weakening Product Master identity, fact grounding, immutable approval records, or strict delivery verification.

## Approved changes

1. Keep `SKILL.md` below 650 words and load at most one domain reference for ordinary work. Compress the optional Variation reference below 700 words.
2. Keep the main image as a separate approval gate. After the first secondary establishes the visual system, generate up to three low-risk planned secondary candidates before one consolidated review. Dimension, structure, claim-sensitive, or visibly inconsistent cards remain individual.
3. Add one atomic Variation batch-approval command. One explicit user approval may create several independent scope-specific approval records; any invalid item rejects the entire batch. `variation_final` may appear only once and last.
4. `finalize` already verifies its newly built package. Do not immediately repeat `verify-delivery`; reserve that command for later, copied, downloaded, moved, or explicitly requested rechecks.
5. Route Child fact edits by impact: Child-local facts are fast; facts currently common to the Family use dependency scope; core identity/theme changes remain full or use their dedicated operation. This changes orchestration breadth, not dependency invalidation rules.

## Non-goals

- No removal of candidate inspection, approval hashes, Product Master binding, stale-dependency checks, or final integrity verification.
- No automatic approval and no Seller Central publishing.
- No refactor of `variation-bundle.js` or `variation-approvals.js` in this PR.

## Verification

Add pressure-oriented Skill structure tests, atomic batch approval tests, route-classification tests, CLI workflow coverage, full regression, and official Skill validation.
