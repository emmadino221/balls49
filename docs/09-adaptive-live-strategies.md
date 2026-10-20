# Adaptive live selection: BetZero and Rainbow

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

## Extension live strategy filter

Under **Expert Settings > Live strategy filter**, BetZero and Rainbow each offer:

- **Follow live selection** (default): accept either published strategy.
- **Current**: accept only the original weighted strategy.
- **Alternative**: accept only the candidate alternative for that game.

Click Save Settings. The filter is stored in Chrome sync storage, sent to the
private bot and restored with its session configuration. Reload the updated
extension, refresh the game tab and restart the updated private bot to install
this feature. A Render website rebuild is not needed for this extension setting.

The filter does not choose a different candidate pick or alter public predictions.
It holds new entries if the published strategy is different or its label is
missing. Follow live selection keeps legacy predictions usable. Matching draws
still need to pass the existing summary, confidence, sniper and stake controls.
ML Override does not bypass the strategy filter. Unified applies the filter of
the market it selected.

The mismatch check occurs before sniper entry checks and stake calculation.
Waiting does not reset or advance martingale or sniper state. Already placed
bets settle normally; already queued/retry payloads are not recalled by changing
the setting. Existing session-wide stop conditions still apply. Public global
steps and strategy statistics continue following actual draw results.

## Strategy labels and losing streaks

Telegram predictions/results and website live cards show the strategy selected
for that draw. Unified inherits the label when it selects BetZero or Rainbow.
Free Trial shows the label only after its normal reveal gate opens.

Each candidate strategy has its own current and worst losing streak, rebuilt
from saved pre-result candidates and actual settled balls. Unselected candidates
are scored too. A strategy's win resets its own current streak; a skip does not
increase or reset it. Missing historical candidates are not invented. The website
shows settled candidate counts alongside the maxima; no settled data displays a dash.

These statistics use the existing owner reporting reset cutoff. Resetting the
reporting period restarts their displayed streaks but preserves records and does
not reset adaptive comparison windows or martingale. The existing game streak
still tracks the published picks across strategy switches.

Deploy the worker, Render API and website together for these displays. The worker
republishes sanitized historical outcomes, allowing the API to reconstruct counts
for existing adaptive records. No strategy candidate numbers are exposed by this
addition to the public current-prediction endpoint.
