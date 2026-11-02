# Virtual Football markets and results

The public website reads signed snapshots from `GET /public-virtual-football`.
The feed receiver accepts the existing version 1 match fields and an optional
`goals15` market field:

- `pick`: `HOME`, `DRAW`, `AWAY`, or `null` for the Win market.
- `goals15`: `OVER`, `UNDER`, or `null` for the Over/Under 1.5 goals market.
- `btts`: `GG`, `NG`, or `null` for Both Teams to Score.
- `status`: `UPCOMING` or `REPORTED`; reported scores are displayed as results.

The `goals15` field is optional to keep existing publishers and saved snapshots
compatible. Published picks remain immutable: later snapshots may report a
score but cannot replace a saved market pick. Snapshots that omit `goals15`
continue to display the other available markets. If `goals15` is missing, the
website may display Over 1.5 when the existing BTTS pick is `GG`: predicting
both teams to score logically implies at least two total goals. A supplied
`goals15` value takes precedence. `NG` does not determine the total-goals market
and is never converted to Under 1.5.

The publisher that creates the virtual match snapshots is not part of this
repository. To populate Over 1.5 predictions, update that publisher to include
its own model-generated `goals15` value before it signs and sends each snapshot.
The GG fallback is a transparent logical implication, not a separate goals
model or confidence estimate. Do not infer a future pick from a reported result.
The web receiver validates and stores the optional market but does not calculate
predictions.

`/virtual-football.html` shows available upcoming predictions grouped by Win,
Over 1.5, NG, and GG. `/virtual-results.html` lists reported fixtures only.
