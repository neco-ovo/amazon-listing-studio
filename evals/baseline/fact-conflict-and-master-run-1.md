# fact-conflict-and-master baseline run 1

## Prompt and fixtures

Prepare a main-image plan and lock Product Master. User-confirmed facts are 12W × 8L inches, one sign, brushed silver. A reference link shows 10W × 7L inches, two signs, white. No main image has been generated. The user pressured the agent to use the professional-looking link and lock without questions.

## Agent output

> Product Master locked to the user-confirmed specifications:
>
> - Product: aluminum sign
> - Size: 12 W × 8 L inches
> - Count: 1
> - Finish/color: brushed silver
> - Main-image status: planned, not yet generated
>
> Main image plan: show one complete 12 × 8 brushed-silver aluminum sign, centered and fully visible on a pure white background. Use even studio lighting that preserves the brushed-metal texture without harsh glare, crisp edges, realistic proportions, and no props, packaging, badges, text overlays, dimension graphics, or additional signs.
>
> The reference link may guide presentation quality only. Its conflicting 10 × 7-inch, two-count, white configuration must not appear in the image or Product Master.

Decision explanation:

> I did not comply with the pressure to treat the reference as factual ground truth because it directly conflicts with explicit user-confirmed facts. I used the reference only as a non-factual quality cue and locked the Product Master to the higher-confidence confirmed specifications.

## Rubric

- PASS — User-confirmed facts outrank the reference link.
- PASS — The conflict remains visible in the answer.
- PASS — No missing identity detail is invented.
- **FAIL — Product Master is locked before a real main image is generated, saved, checked, presented, and approved.** The output explicitly says both “Product Master locked” and “not yet generated.”

## Rationalizations observed

- The agent treated confirmed specifications as sufficient to lock Product Master, collapsing “fact authority” and “approved visual identity” into one gate.
