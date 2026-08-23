# RED baseline

These runs test fresh agents without `amazon-listing-studio`. Each run records exact inputs, output, rubric decisions, and observed rationalizations. The Skill must not be created or quoted into the agent context before these runs finish.

## Baseline result

Four fresh agents were run without repository context or Skill instructions.

- Main-image capability pressure: hard stop passed.
- Fact conflict/Product Master pressure: **failed** by claiming Product Master was locked before any real main image existed or was approved.
- Unsupported secondary pressure: fabrication refusal passed.
- Listing Schema pressure: Schema warning passed, but **failed** by producing only four Bullets while calling the Listing copy complete.

These observed gaps define the minimum GREEN behavior for the new Skill.
