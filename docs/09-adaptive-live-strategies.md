# Adaptive live selection: BetZero and Rainbow

## Current BetZero rule (supersedes BetZero selection below)

BetZero now uses one strategy, implemented in `betzero.js`. It examines exactly
the 10 consecutive completed draws before the target. Numbers 1-49 appearing
zero or once are eligible. Previously published picks remain selected while
eligible; numbers appearing twice or more are replaced randomly without
duplicates until there are four picks. The latest saved four-number prediction
supplies continuity across restarts and skipped draws. The first update also
keeps eligible picks from the previous strategy.

Missing, invalid or conflicting results in that window cause a skip; older draws
are not substituted. An already issued prediction is not changed mid-draw.
All four numbers must be absent from the result to win. A losing number can
remain in the next prediction if its rolling count is still only one.

Automatic BetZero strategy switching has been removed. Old BetZero strategy
filters cannot block execution. Rainbow adaptive selection is unchanged.
Existing martingale, sniper, summary gates and settlement rules remain in place;
this change does not reset accounts, stakes, streaks or history. Historical
strategy records are retained. The older BetZero descriptions below document
the previous implementation, not the current selection rule.

The offline backtest's Current BetZero candidate now uses this rule and retains
picks across replayed draws. Random replacements mean repeated replays can
produce different results. No tests or live bets were run for this change.

The private worker applies `adaptive-strategies.js` after generating the base
picks and before saving or publishing the prediction. Telegram, the website and
the extension receive the same selected pick. Other markets keep their existing
selection logic. Unified may select one of these newly selected market picks.

## Candidate strategies

| Market | Current | Alternative |
| --- | --- | --- |
| BetZero | Existing weighted frequency/absence filter | Four least frequent numbers in 100 draws; ties choose smaller numbers |
| Rainbow | Existing weighted ball-frequency filter | Color with most two-or-more-ball outcomes in 100 draws; ties use Red, Blue, Green order |

Alternatives require 100 consecutive valid completed draws immediately before
the target. Invalid, duplicate and future/current IDs are excluded. If the
selected alternative cannot form a pick, it skips; it does not silently switch
to a different strategy. The current strategy keeps its existing skip rules.

## Selection rules, version 1

Both markets begin with Current. Each issued prediction saves both candidates
in `predictions.json` under `adaptiveStrategies`, alongside the selected strategy,
last switch draw, comparison metrics and decision reason. The active checkpoint
also contains this metadata. No invented alternative picks are backfilled into
old records.

On each new prediction, the selector evaluates saved candidates against the
actual settled balls from up to 200 recent settled records of this version.
This includes results settled through the worker's missed-draw recovery path.
Candidate outcomes are derived from immutable issued picks and actual balls;
they do not depend on whether an automated bet was placed.

Automatic switching requires all of:

1. At least 100 paired results where both candidates issued a valid pick.
2. The challenger wins at least five percentage points more often across those
   paired results in the recent window of up to 200 settled records.
3. The challenger also leads by at least five points on the latest 50 paired results.
4. At least 20 issued predictions since the incumbent's selection began.

Skips do not count as losses and are not included in paired win rates. Per-strategy
pick counts and settled-window size are saved to show coverage. Each game chooses
independently, and the same criteria apply when switching back to Current.
Old backtest results are not used to bypass the initial live collection period.

These thresholds are an initial heuristic. The adaptive selector itself has not
been validated for improved accuracy or profitability. Repeated switching based
on recent results can perform worse than either fixed strategy. Existing ML and
summary scores mix historical strategies and are not calibrated proof of this
selector's performance.

## State preservation

The selector changes only the next pick and its selection metadata. It does not
write global tracker, session, martingale, sniper or streak state. A switch does
not reset amounts, loss runs, summary statistics or historical results. Normal
settlement rules (including win resets) continue to operate. Owner reporting
resets do not reset the selector's comparison history.

Issued picks stay fixed for their draw. Selection resumes from the most recent
saved adaptive record after restart. Preserve `predictions.json` and the active
prediction checkpoint on the private worker as usual.

## Operation

No extension option is needed: this selector runs automatically in the private
worker after deployment and restart. Initially the current picks remain selected
while comparison records accumulate. Existing ML/summary gates, stake limits,
sniper rules and other automation controls still decide whether to place a bet.
Switches are logged as `[Strategy] <market>: <strategy> selected for draw ...`.

No extra bets or Telegram messages are sent for unselected candidate picks.
Candidate arrays remain private worker data; they are not added to public feed
payloads. Selected strategy IDs and settled candidate WIN/LOSS/SKIP outcomes are
included in the signed feed so the hosted API can rebuild strategy statistics.
The offline `backtest-markets.js` continues to compare fixed strategies;
it does not simulate this adaptive selector.

The change has not been deployed or tested by this implementation step. Before
public release, validate candidate persistence, restart recovery, selection
thresholds and preserved automation state without placing real bets.

## Automatic selection and simplified displays

Live adaptive selection, saved candidate records, comparisons and strategy streak
tracking continue internally. Strategy labels and strategy-specific maximum-loss
rows are no longer rendered in Telegram predictions/results or website prediction
cards (including Free Trial). Game streaks and Summary ENTER/HOLD remain visible.
Existing strategy metadata in API responses is retained; this is a display change,
not a restriction on inspecting strategy metadata in the browser network tab.

The extension no longer offers Live strategy filter controls. Save Settings and
startup configuration explicitly use follow for BetZero and Rainbow, overriding
older saved current/alternative filters so hidden filters cannot block entries.
Existing summary, confidence, sniper and stake controls still apply. Martingale
and sniper progression are not reset by this change. Already queued bets are not
recalled. Unrelated stake presets and backtesting controls remain available.

Deploy the Telegram worker and rebuild the website to update their displays.
Reload the extension and refresh the game tab while automation is paused, then
save settings before resuming. Strategy history and comparisons are retained.
