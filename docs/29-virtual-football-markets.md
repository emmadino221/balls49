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

The publisher that creates the virtual match snapshots lives in the separate
`virtual 2 mobile` repository (`new.py` and `publish_site_feed.py`).
The GG fallback is a transparent logical implication, not a separate goals
model or confidence estimate. Do not infer a future pick from a reported result.
The web receiver validates and stores the optional market but does not calculate
predictions.

`/virtual-football.html` shows available upcoming predictions grouped by Win,
Over 1.5, NG, and GG. `/virtual-results.html` shows separate tables for those
markets, grouped by each fixture's supplied week label. Each table grades the
saved pick against the reported score; matches without a usable score are
marked `NO SCORE`. Over 1.5 is graded from the explicit goals pick, or from the
existing GG-derived Over pick when the goals pick is absent.

The results page has separate Over 1.5, GG, NG, and Win tabs. Over 1.5 is selected
initially and excludes explicit Under 1.5 picks; the GG-derived Over fallback is
retained. Each tab shows its own match count and weekly result table, including
an empty state when there are no matching reported picks. Feed refreshes preserve
the selected tab. Keyboard users can switch tabs with Left/Right, Home, and End.

## Shortlisted predictions

New rounds freeze their website selections before results are available:

- Over 1.5: at most two GG predictions with BTTS model confidence of at least
  60%, ranked by that confidence. This is a GG-derived signal, not an independent
  Over 1.5 probability estimate.
- GG: the highest-confidence GG prediction, at most one match.
- NG: the highest-confidence NG prediction, at most one match.
- Win: the highest-confidence HOME or AWAY prediction whose selected team's
  odds are strictly greater than 1.70, at most one match. Draws do not qualify.

Unknown teams and failed model evaluations cannot qualify. Missing qualifying
matches leave empty slots. A match may qualify in more than one market.

The publisher includes `selectedMarkets`, `roundId`, `winOdds` and
`bttsConfidence`. All rows from new rounds are published, including those with
an empty selection list, so an empty new round cannot reuse an older shortlist.
The receiver validates requirements and per-round limits against saved picks.
The website displays only the newest upcoming round and uses the appropriate
market confidence. Results use the frozen selections; legacy results are kept
without retrospective ranking. Existing Telegram and extension selection rules
are unchanged.

Deploy the website receiver and frontend first, then update both collector and
publisher in the virtual repository and restart their services. The collector
adds its new SQLite columns on startup. A fresh collected round is required for
the new prediction view; old feeds lack the required shortlist metadata.
