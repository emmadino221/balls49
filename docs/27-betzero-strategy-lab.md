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
| Single-number absence experiment — Smallest +10 | RESEARCH_ONLY, enabled by default | Original `simple_smallest_number_add_10`, version `1.0.0`, preserved. Choose the smallest number in the previous valid completed draw, add 10, and predict that one number absent. Skip if it exceeds 49. This is not a four-number BetZero prediction. |
| Smallest +10 / Step-10 Four-Number Research | RESEARCH_ONLY, disabled by default | New `smallest_add10_step10_four`, version `1.0.0`. Start at smallest +10, skip if above 49, then append three successive +10 steps wrapping within 1–49. Newly designed research; not instructor-verified. |

### Four-number calculation and contracts

The source must contain six distinct integers from 1 through 49. Let `m` be
its smallest number. The first selection is `m + 10`; if that exceeds 49,
skip without wrapping it. Each subsequent selection is
`((previous - 1 + 10) % 49) + 1`, until exactly four selections exist.

Examples: minimum 3 produces `[13,23,33,43]`; minimum 12 produces
`[22,32,42,3]`; minimum 39 produces `[49,10,20,30]`; minimum 40 skips.
There are no random fillers, color conditions, or future-result inputs.
The step and wrapping are research design choices, not evidence of an advantage.

The original experiment retains its stored ID, version, original registry
label, selections, configuration and historical results. Its clearer label is
applied at read/display time. Its contract is exactly one number; the new
strategy's contract is exactly four distinct integers in 1–49. Invalid counts
cannot be settled as wins/losses. Unknown strategy versions are not generated
or re-settled using another version's rules. `statsForVersion(id, version)` and
`listForwardPredictions({strategyId, strategyVersion})` support isolated reads;
default strategy-scoped history uses its current registered version.

Initialization only inserts the new registry and disabled configuration rows
into existing tables. No schema change, history rewrite, auto-enable, or reset
is required. Rule changes must use a new version and retain old rule handlers
if outstanding predictions still need settlement.

Unverified strategies cannot be enabled through the lab configuration API and
are recorded as skipped in forward testing and excluded from official
backtest metrics.

## Forward testing and validation

Forward predictions are created only from a newly settled, valid six-number
source draw when the signed live snapshot identifies the immediately following
draw and its clock is active. The source settlement timestamp must be newer than
the lab's start and last observed snapshot; missed opportunities are not
backfilled and historical simulations are never presented as forward picks.

The lab's isolated validator uses the absence outcome rule: a pick wins
only when none of its selected, distinct numbers occur among the six drawn
numbers. It enforces exactly one for the original experiment or exactly four
for the new research strategy, based on the saved strategy ID and version. Missing or
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

The four-number theoretical baseline is `C(45,6)/C(49,6)`, approximately 58.26%.
Its random baseline uses four distinct numbers on identical entered targets;
skipped targets receive no random trials. Seeds include the segment seed,
strategy ID/version, target ID, and repetition index. The original experiment's
random sequence is unchanged. Random repetitions do not increase the number
of independent strategy predictions.

Stage 2 introduces the opt-in worker and sealed protocols described below.
Legacy saved results are labelled exploratory at read time without rewriting
their stored records. The historical `final_test` segment name is retained for
API compatibility but does not imply an untouched cohort.

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

## Stage 2: asynchronous worker (not automatically installed or started)

`betzero-worker.js` is a separate Node process. It must be launched explicitly
with `SITE_DB_PATH` pointing to the existing website database. It does not load
`bot.js`, credentials, betting code, or Telegram. The supervisor forks a child
with an allowlisted environment. The child freezes the available draw contents,
records their dataset hash, and evaluates against a private temporary SQLite
database using the queued versions/configuration. Production database writes
are only lab results, copied in transactions of at most 100 prediction rows.
An incomplete import remains a FAILED staging run, hidden from result APIs.
Completed result visibility and the job's completion are committed together.

Queue limits: one RUNNING job enforced with a partial unique index, at most two
QUEUED jobs under BEGIN IMMEDIATE, maximum 50,000 pairs, ten minutes elapsed
from claim through import. Input target spans are also capped at 50,000 to
bound dataset reads even when draw IDs contain gaps. Queue/worker connections
use a 100 ms SQLite busy timeout; bounded retries during result import yield
between attempts. The production connection's settings are unchanged.

Cancellation is immediate for queued jobs and polled during running jobs.
The supervisor kills the calculation child on cancellation/deadline. Progress
and heartbeat updates fence stale workers using a unique claim token. After
30 seconds without heartbeat, a job becomes FAILED (or CANCELLED if requested),
not silently rerun. Waiting jobs can then run. Failed partial imports remain
hidden for diagnosis; no automatic historical deletion occurs. Temporary
datasets are removed after normal completion/failure; abrupt OS termination
can leave temporary files for OS cleanup. A child also checks its job lease.

`deploy/balls49-betzero-worker.service` is an example only. Before any future
installation, set its Node executable to the installed path and create a
dedicated environment file using `deploy/betzero-worker.env.example`. Do not
reuse a credential-bearing site/bot environment. CPUQuota (default 50%),
MemoryMax (1536 MB), and Nice are adjustable via systemd drop-ins;
BETZERO_WORKER_HEAP_MB controls child V8 heap (128–2048 MB, default 768).
KillMode=control-group stops both supervisor and child on service shutdown.
These OS resource limits are not enforced when manually running Node on Windows.

### API compatibility and ownership

All new routes require the existing owner session and existing origin checks:

- GET/POST `/admin/betzero-lab/jobs`: list the latest 20 jobs, or enqueue
  `{window, seed}` exploratory work / `{protocolId}` sealed work. POST returns
  202 and a job object, never a pretend completed result.
- GET `/admin/betzero-lab/jobs?id=...`: status, progress, frozen specification,
  error and completed run ID.
- POST `/admin/betzero-lab/job-cancel`: `{id}`.
- GET/POST `/admin/betzero-lab/protocols`: list protocols or freeze
  `{firstDraw,lastDraw,seed}` against current strategy settings.

The legacy POST `/admin/betzero-lab/backtests` still returns its synchronous
completed result shape for at most 100 pairs. Larger windows return 413 with
the async endpoint instruction. It checks reserved datasets before evaluation.
GET result endpoints retain their existing shapes; evaluationMode clarifies
legacy/exploratory versus sealed results. Forward records stay separate.

### Frozen final-test protocols

Protocols reserve 5–50,000 **future target draws**, above the highest draw
currently in website history. They freeze strategy IDs/versions, exact lab
module SHA-256, selection counts, enablement, configuration, seed, source rule,
target boundaries and reporting criteria. Protocols do not enable strategies.
Overlapping reservations are rejected globally, even under new strategy IDs,
versions or seeds. Exploratory/synchronous evaluations cannot use reserved
draws as either sources or targets. Exposure ranges are persisted.

Submission is allowed only after the final target exists. Claiming the cohort
for a queued job consumes it atomically, even if the job later fails, is
cancelled, or the process crashes. A second submission is rejected; inspect the
original saved job/results instead. If the rule-code hash changed, submission
or computation fails closed. The child requires all source/target draws in a
sealed cohort to have valid six-ball results. Missing/invalid data fails the
job without making the cohort reusable.

Exploratory runs contain development, validation and a reused holdout segment.
Sealed runs evaluate only the sealed cohort under frozen rules. Genuine forward
predictions remain those recorded live before target settlement. No historical
or sealed run is relabelled as a genuine forward prediction. Raw draw results
remain visible outside this lab: reservation prevents lab reuse, not external
inspection, privileged database edits, or operator knowledge.

### Verification

Run all `test_*.js` with Node's test runner, Python unittest discovery, and
`npm --prefix web run build:same-origin`. `test_betzero_jobs.js` covers queue
bounds, duplicate claims, busy locks, simulated ten-minute deadlines, running
cancellation, crashed claims, sealed reuse, actual child-process completion,
frozen settings, API authorization and the legacy response contract.
Responsive browser evidence is kept under ignored `output/playwright/` using a
synthetic localhost preview, not a production owner session.
