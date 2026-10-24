# Daily fresh-data reset

The collector, private bot and public website reset their active history daily
at **00:00 midnight Nigeria time (23:00 UTC the previous day)**. The schedule does not depend on the
VPS timezone. First installation arms the next midnight; it does not immediately
erase history. A service that misses midnight resets on its next start. Reset
checkpoints prevent repeating the reset after a normal restart.

## Cleared

- Collector `draws.json`: raw calculation history.
- Private `predictions.json` and the active prediction checkpoint.
- Pending channel prediction messages from the previous period.
- Reporting streaks, win-step records, ML streaks and learned summary artifact.
- Website `public_prediction_history` and `public_prediction_feed` rows only.
- Published current steps, maximum losing streaks and summary statistics restart
  for the new period. Old signed snapshots are rejected using the reset epoch.

The collector first establishes an upstream draw-ID boundary after reset. It
then accepts only newer draws, so the upstream history response cannot restore
deleted calculation data. The first successful response is used as the baseline;
if the collector was offline, history before that response is not backfilled.

## Preserved

Accounts, approvals, subscriptions, login sessions, keys, cookies, configuration,
extension balances, martingale amounts and sniper state are not deleted or reset.
Execution global steps are retained for existing sniper sequences; published
tracking steps and streak reports use the new daily history. Bet49's prediction
target is cleared so it is selected again using fresh data.

Already placed bets and claimed executions retain only the necessary prediction
records in `daily_pending_settlements.json`. These records are not published,
used for analysis, or used for prediction calculations. The collector exposes
only explicitly requested old draw results for settlement. Records are removed
once the associated sessions no longer need them. Unclaimed queued bets are
cancelled. An unresolved claim is kept for accounting rather than silently lost.

Existing Telegram messages, Google Sheets rows, logs and independent backups are
not deleted. The reset changes future Telegram reporting and active site data.
Backups containing user accounts retain their existing retention policy.

## Fresh-data waiting period

- BetZero needs 10 consecutive new completed draws.
- Rainbow's base strategy and Total Color 2-way need at least 20 new draws.
- Bet49 needs 100 new draws.
- High/Low and the other Total Color markets resume when their normal minimum
  valid-history conditions are met.
- Rainbow adaptive comparison and ML summaries rebuild from new records.

External pre-reset aggregate color statistics are not used as a fallback after
the first reset. Analysis sample counts also rebuild from the new period.

## Deployment

Update **both** `~/balls49` and `~/balls49-site`. Restart
`balls49-collector`, `balls49-bot` and `balls49-site`. No frontend build or
extension reload is required for this backend update. Deploy all three before
the first scheduled midnight. A worker whose collector has not applied the same
reset will wait instead of generating predictions from old history.

Runtime checkpoints are ignored by Git. No live reset or automated test was run
during implementation. Do not run the bot or collector merely to check this
change: starting a previously armed service after a missed midnight applies its reset.
