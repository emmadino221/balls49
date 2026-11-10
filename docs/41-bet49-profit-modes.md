# Bet49 single-number profit modes

Local implementation. No commit, deployment, production settings change or
live bets were performed for this work.

## Calculation

One selection at decimal odds 7.80 has a net winning return of stake times 6.80.
Let B be the whole-naira base, L the settled losses in the current cycle and
n the count of settled losing bets in that cycle.

- Same profit: target = B * 6.80.
- Accumulating profit: target = B * 6.80 * (n + 1).
- Next stake = ceil((L + target) / 6.80).
- First stake is B. A settled win resets the cycle. SKIP, unplayed outcomes and
  entry pauses do not add an attempt. Flat betting overrides recovery modes.

Shared browser/Node implementation: `balls49-extension/bet49-staking.js`.
Whole-naira rounding can make the realized net profit slightly exceed target.
For base 100, the first three stakes are 100 / 115 / 132 for same profit and
100 / 215 / 347 for accumulating profit, assuming preceding bets lost.

## Execution and saved settings

`bet49ProfitMode` defaults to `fixed`; `accumulating` is opt-in. Both website
automation and extension settings send this setting to the same server.
The extension executes the server-specified stake, without a Bet49 local
fallback calculation. The cycle base and mode are captured with the execution
payload and retained after acknowledgement. Settled losses and attempt counts
are persisted in the existing martingale session state.

An existing legacy cycle with `cycleTarget` retains its old fixed-profit formula
until its settled win; it is not reinterpreted as accumulating. Changing settings
does not change a recorded cycle mode. No database migration is required.

## Suggestions and previews

Suggested plans now size Bet49 for one number, including capital-fitting,
reserve and execution validation. New plan requests freeze the chosen mode.
Automatic refresh carries it forward; the plan fingerprint includes its mode.
Old plans without a mode use fixed profit; users should preview and reapply an
old six-number reserve plan after its active recovery finishes.

Calculator, suggestion table, history simulator and extension preset estimates
use the shared helper for single-number recovery. The prediction-page selector
is explicitly a display-only estimate, not a change to automation settings.
Legacy multi-number calculator options remain separately labeled. Accumulating
historical simulation stops at multi-number records instead of misrepresenting
them as one bet. No historical selections or results are rewritten.

## Validation and rollout

JavaScript syntax checks and frontend production build passed locally.
Regression tests, browser responsiveness checks and extension interaction checks
were not run. The existing frontend bundle-size warning remains.
Before rollout, verify settings round-trips, fixed/accumulating examples,
settlement/reset, duplicate receipts, restart recovery, mode freezing, skips,
capital sizing and stake limits using isolated fixtures.

Both VPS branches will need the shared helper and server changes; the website
needs its rebuilt frontend. Reload the updated local extension to get its new
selector. Unrelated existing content.js edits must be preserved and reviewed
separately when preparing the release.
