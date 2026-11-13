# Virtual Football markets and results

## Result filters and streaks

Each result market shows worst and current losing streaks, won rounds and lost
rounds. Calculations use chronological rounds within the loaded feed history
(currently the latest 200 match records), filtered by local publication date
and week. They are not all-time statistics. Repeated week labels remain separate
rounds. Over 1.5 needs both picks to win; either losing makes the round a loss.
Incomplete pairs or missing scores break the streak rather than implying a win
or loss. Skipped rounds do not count. The round-result filter changes table
visibility only, so hiding wins cannot artificially extend losing streaks.

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
Over 1.5, Under 1.5, NG, and GG. `/virtual-results.html` shows separate tables for those
markets, grouped by source and unique round ID, with the week label and publication time displayed. Each table grades the
saved pick against the reported score; matches without a usable score are
marked `NO SCORE`. Over 1.5 is graded from the explicit goals pick, or from the
existing GG-derived Over pick when the goals pick is absent.

The results page has separate Over 1.5, Under 1.5, GG, NG, and Win tabs. Only reported fixtures
with a saved round ID and explicit selection for the chosen market appear.
Over 1.5 is selected initially and excludes explicit Under 1.5 picks; the
GG-derived Over fallback is retained for selected picks. Each tab shows its own
match count and per-round result table, including
an empty state when there are no matching reported picks. Feed refreshes preserve
the selected tab. Keyboard users can switch tabs with Left/Right, Home, and End.

## Shortlisted predictions

New rounds freeze their website selections before results are available:

- Over 1.5: exactly two predictions from the dedicated total-goals model with
  model confidence of at least 60%, or no Over picks if fewer than two qualify.
  This model learns OVER (two or more goals) versus UNDER from reported settled
  scores and pre-match 1X2 odds. It does not use GG confidence.
- Under 1.5: one match every round, the lowest Over 1.5 model confidence of the
  round, whatever that confidence is. It never reuses an Over pick.
  There is no separate Under model; the published match carries `goals15: UNDER`
  and the market key `under`. Most matches finish with two or more goals, so
  this market is expected to lose more rounds than it wins; judge it from the
  results page before betting on it.
- GG: the highest-confidence GG prediction, at most one match.
- NG: the highest-confidence NG prediction, at most one match.
- Win: the highest-confidence HOME or AWAY prediction whose selected team's
  odds are strictly greater than 1.70, at most one match. Draws do not qualify.

Failed model evaluations cannot qualify. Win/GG/NG also exclude unknown teams;
the Over model uses odds rather than team encodings. Missing qualifying
matches leave empty slots; Over 1.5 requires both slots or skips the round.
A match may qualify in more than one market. Previously saved results remain
unchanged; the two-or-skip rule applies to newly collected rounds.

The publisher includes `selectedMarkets`, `roundId`, `winOdds` and
`bttsConfidence`. All rows from new rounds are published, including those with
an empty selection list, so an empty new round cannot reuse an older shortlist.
The receiver validates requirements and per-round limits against saved picks.
The website displays only the newest upcoming round and uses the appropriate
market confidence. Results use the frozen selections; legacy records remain stored
but are excluded from the shortlist history because their original market
selections cannot be reconstructed reliably. Telegram messages and the auto-bet
extension use these same frozen selections; neither chooses picks of its own.

Deploy the website receiver and frontend first, then update both collector and
publisher in the virtual repository and restart their services. The collector
adds its new SQLite columns on startup. A fresh collected round is required for
the new prediction view; old feeds lack the required shortlist metadata.

## Under 1.5 rollout

Deploy the website first. A receiver without the `under` market rejects every
snapshot that contains it, which stops the whole feed until the site is updated.
Then update the collector in the virtual repository; it adds `result_un` to
`weekly_accumulators` on startup. Extension 3.0 adds the "Under 1.5 Single" mode.

Status on 13 November 2026: live. The website, collector and extension 3.1 are
deployed and Under 1.5 picks are published every round. The first version
only picked at 65% confidence or lower; the live model rarely goes below about
69%, so that limit was removed. The market's win rate is not yet established.
The collector must be restarted after an update for new code to take effect.

The overall project layout and the list of open work are in `README.md` of the
virtual repository.

## Dedicated Over 1.5 rollout

Deploy the receiver/frontend before the updated collector and publisher. From
the virtual repository, using the service's Python environment and environment
variables, run `python train_model_over15.py`. It reads the database without
modifying it and atomically writes `ai_brain_over15.pkl`.
`VIRTUAL_DB_PATH` and `VIRTUAL_AI_OVER15_MODEL_PATH` override the default paths.
Restart collector and publisher after updating. The collector adds `goals15`
and `confidence_over15` columns on startup and reloads the model during its loop.

Training requires 200 settled matches with valid scores and odds. It reports
chronological holdout accuracy and an always-Over baseline, then fits the saved
model on all valid history. These scores do not establish profitability or
calibrated probabilities. The source scores are reported by the collector,
not independently verified final results. The existing auto-trainer runs the
new trainer on its scheduled cycle if that process is running.

Without a readable trained model, no Over picks qualify. The publisher sends
`goals15` and `over15Confidence`; the receiver validates them and keeps picks
immutable. Historical GG-derived picks remain readable. No GG fallback is used
for new Over predictions.
