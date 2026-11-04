# BetZero Strategy Lab backend

The BetZero Strategy Lab is an isolated, owner-only research subsystem. It does
not modify production picks, bet placement, staking, subscriber responses,
Telegram broadcasts, or production streaks. All results are experimental and
must not be used for real-money betting.

## Strategy registry

The registry is versioned and persisted in `betzero_lab_strategies` with its
enablement/configuration in `betzero_lab_strategy_configs`.

| Strategy | Status | Behavior |
|---|---|---|
| Single-Color Add-10 | UNVERIFIED, disabled | The qualifying single-color numbers are not defined precisely enough. |
| Smallest-Number Add-10 | UNVERIFIED, disabled | Additional instructor conditions are unconfirmed. |
| Color Pattern | UNVERIFIED, disabled | The color grouping and 7-9 rule are unresolved. |
| Maximum/Minimum | UNVERIFIED, disabled | The sequence and switching conditions are unresolved. |
| Timing and Skip Filter | UNVERIFIED, disabled | Entry, wait, and pattern-switch conditions are unresolved. |
| Combined Strategy | UNVERIFIED, disabled | Its components and combination conditions are unresolved. |
| Simple Smallest-Number Add-10 | RESEARCH_ONLY, enabled | Research-only model: choose the smallest valid number in the immediately previous completed draw, add 10, and predict that one number absent from the next draw. Skip if the candidate exceeds 49. This is not the instructor-verified strategy. |

Unverified strategies cannot be enabled through the lab configuration API and
are recorded as skipped in forward testing and excluded from official
backtest metrics.

## Forward testing and validation

Forward predictions are created only from a newly settled, valid six-number
source draw when the signed live snapshot identifies the immediately following
draw and its clock is active. The source settlement timestamp must be newer than
the lab's start and last observed snapshot; missed opportunities are not
backfilled and historical simulations are never presented as forward picks.

The lab's isolated validator uses the existing BetZero outcome rule: a pick wins
only when none of its selected, distinct numbers occur among the six drawn
numbers. The lab accepts one through four experimental selections, so the
one-number research model is tested with the same absence outcome. Missing or
invalid six-ball results are not losses. Duplicate result ingestion is
idempotent; if a recorded result changes, a lab-only revision is recorded and
streaks/alerts are recalculated in target-draw order.

## Backtesting

Backtests consume settled `result.balls` history only. They evaluate consecutive
source/target draw pairs in chronological order, use only the source draw to
generate a pick, and split the requested evaluation window chronologically into
60% development, 20% validation, and 20% final test. Runs preserve the seed,
dataset hash, strategy versions/configuration, per-target simulation records,
and per-segment aggregates.

Each tested entry gets 64 reproducible random selections with the same pick
count and entry timing. The theoretical all-absent rate is calculated as
`C(49-k, 6) / C(49, 6)` for `k` selected numbers. Win rates include Wilson 95%
confidence intervals and are accompanied by sample sizes and skips/coverage.
`FURTHER_INVESTIGATION` is a research flag only when at least 100 picks have a
Wilson lower bound above the theoretical baseline; it is not evidence of
profitability or future performance. Historical simulations cannot prove that
the pick was available to the system before the draw.

## Storage

All tables are additive in the existing SQLite database:

- `betzero_lab_strategies`, `betzero_lab_strategy_configs`
- `betzero_lab_forward_predictions`, `betzero_lab_streak_events`
- `betzero_lab_alerts`, `betzero_lab_result_revisions`
- `betzero_lab_backtest_runs`, `betzero_lab_backtest_results`,
  `betzero_lab_backtest_predictions`
- `betzero_lab_state`

Streaks are derived from persisted forward prediction records, ignoring
PENDING, INVALID, and SKIP outcomes; skips do not reset a streak. Forward
predictions, backtest simulations, and production history remain separate.
Dashboard alerts default to 3, 5, 7, and 10 consecutive losses and are also
stored for each new worst losing streak. Thresholds can be configured in the
lab. The lab does not send Telegram notifications.

## Owner API

These routes require the existing owner/admin session cookie:

- `GET /admin/betzero-lab` — registry, forward statistics, latest predictions,
  alerts, and recent backtest runs.
- `GET /admin/betzero-lab/predictions?strategyId=...&limit=...` — latest 1–500
  forward records, optionally scoped to a registered strategy.
- `POST /admin/betzero-lab/strategy-config` — enable or disable a verified
  research strategy and configure unique loss-alert thresholds from 1 through
  100. Unverified strategies cannot be enabled. Defaults are 3, 5, 7, and 10.
- `POST /admin/betzero-lab/backtests` — run `{ "window": "100|500|1000|all",
  "seed": "optional-seed" }`.
- `GET /admin/betzero-lab/backtests?runId=...&limit=...&offset=...` — retrieve
  run details and page through its saved simulated predictions.
- `GET /admin/betzero-lab/backtests` — list recent runs.

The public-site API allowlist includes these endpoints, but they remain
owner-only. The responsive owner-only dashboard is available at
`web/dist/betzero-lab.html`; its navigation link is shown only in an owner
session. The server continues to enforce authorization independently of the
frontend.

## Verification

Run the isolated tests with:

```powershell
node --test test_betzero_lab.js
```

The existing production tests should also be run before deployment. An
experimental SQLite warning from Node is expected when using its built-in
`node:sqlite` module.
