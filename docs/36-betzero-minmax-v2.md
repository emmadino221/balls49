# Minimum/Maximum v2 — local implementation review

## Scope

`minimum_maximum_three` now registers two versions. v1 retains its calculation,
settlement transition and saved configuration. v2 defaults disabled and keeps its
method after WIN, switching after LOSS. Boundary, tie, five-opportunity analysis,
unresolved settlement and chronological input rules remain shared. The one-number,
four-number and six incomplete tutorial algorithms are unchanged.

All validation uses isolated temporary SQLite databases and synthetic browser
fixtures. No application database, VPS, running production service, live strategy
configuration or production worker was changed. Test child processes are temporary
simulations, not activation of the installed worker service.

## Cutover contract

Admin POST `/api/admin/betzero-lab/minmax-cutover`:

```json
{"fromVersion":"1.0.0","toVersion":"2.0.0","confirmed":true}
```

The same-origin route uses the existing admin session and request protections.
The dashboard requires explicit confirmation and locks repeat submissions.

One `BEGIN IMMEDIATE` transaction checks both version states and pending/invalid
MIN/MAX records, rejects correction conflicts, checks five settled context pairs,
initializes an independent v2 state, disables v1 and enables v2. Any error rolls
back all changes. Original prediction rows, selections, timestamps, v1 state and
alert thresholds are preserved. Initialization can produce a wait/reassessment
decision (for example a tie); enabling does not guarantee an immediate selection.

The cutover records its time, initialization evidence and a target-ID barrier.
v2 cannot produce a selection for a target already known at cutover or from a
source result timestamp preceding cutover. Normal authoritative-clock eligibility
checks also apply. Cutover itself creates no predictions or settlements.

Generic configuration cannot enable v2 before cutover. After cutover, normal
exact-version v2 enable/disable is available, but unresolved/conflicted state
blocks re-enabling. v1 cannot be re-enabled through generic controls after
cutover; reversing the transition needs a separately reviewed rollback.
Repeated cutover returns a conflict rather than resetting state.

## Version-safe contracts

- Configuration requests send `strategyVersion`; MIN/MAX requires an explicit
  version. Internal `setStrategyConfig` uses `version`.
- Historical test/job requests send `strategyId` and `strategyVersion`.
  Omitted historical version remains v1 for compatibility.
- Prediction history accepts `strategyVersion` alongside `strategyId`.
- Overview preserves legacy v1 `strategies` and `forwardWindows` fields and adds
  `strategyVersions` (keys `id@version`) and `forwardVersionWindows` (keys
  `id:version`). New dashboard selectors, cards and statistics use version keys.
- New historical runs include version-keyed full-run summaries; older saved
  summaries remain readable as v1. Historical rows are filtered by both keys.
- Worker simulations use frozen configuration snapshots in private databases;
  they never apply frozen enablement as forward configuration. Stored job and
  protocol specifications/hashes are not rewritten.

## Database migration

Follow-up: `docs/37-betzero-migration-safety-review.md` documents additional local
schema/dependency guards and migration validation completed after this report.

Existing forward prediction, configuration, state, alert and streak tables
already include version keys. No forward history is rewritten.

Historical backtest uniqueness previously omitted version. The local migration
rebuilds only `betzero_lab_backtest_results` and
`betzero_lab_backtest_predictions`, extending their keys to include
`strategy_version`. It copies stored values unchanged, recreates explicit indexes
and commits both table changes transactionally. It is repeat-safe. v2 registry
and disabled configuration rows use `INSERT OR IGNORE`.

**Deployment risk:** table copies take a write lock and require disk space. A
future approved rollout must first back up the consistent database and recovery
keys, measure the migration on a representative copy and arrange an appropriate
maintenance window. This implementation has not migrated a production database.

## Files owned by this change

- `betzero-minmax.js`: version-aware pure state transitions and simulation.
- `betzero-lab.js`: registry, exact-version state/config/history, transactional
  cutover, historical simulation and version summaries.
- `betzero-version-migration.js`: historical uniqueness migration.
- `betzero-cutover-api.js`: admin-only cutover handler.
- `betzero-jobs.js`: exact-version selection in frozen job specifications.
- `betzero-worker.js`: frozen simulation configuration without forward activation.
- `betzero-forward-metrics.js`: separate version-keyed windows.
- `bot.js`: lab-only version parameters and cutover route.
- `web/src/pages/BetZeroLabPage.jsx`: separate legacy/v2 cards, confirmation,
  exact-version selectors/configuration/history and historical summaries.
- `test_betzero_minmax_v2.js`: transition, safety, isolation and migration tests.
- `test_betzero_lab.js`: expected registry count changes from 9 to 10 versions.
- This document.

## Existing countdown and unrelated work

The before-change snapshot is under ignored `output/minmax-v2-before/`.
`web/src/auth.js`, `web/src/pages/betzero-live.mjs`,
`web/src/pages/useBetZeroLive.js`, `web/src/pages/betzero-lab.css` and
`balls49-extension/content.js` remain byte-identical to that snapshot.
The page is shared: its existing countdown monitor, hook, timers, visibility
handling and clock interpretation are retained. The history request inside its
loader adds an exact-version query so dashboard filtering remains safe. No
countdown feature completion is included in this change. Other pre-existing
untracked documents/archive files are untouched.

## Validation

Relevant command:

```text
node --test test_betzero_minmax_v2.js test_betzero_minmax.js test_betzero_lab.js test_betzero_jobs.js test_betzero_forward.js test_betzero_reconciliation.js test_site_static.js
npm --prefix web run build:same-origin
```

The 72-test regression suite covers all four v2 transitions, unchanged v1 rules,
boundaries/ties, no lookahead, unresolved and corrected results, duplicate
settlement, restart recovery, independent metrics/streaks, confirmed cutover,
database contention and injected rollback failure, migration preservation,
admin authorization, frozen job versions, incompatible hashes, queue limits,
timeouts, cancellation and sealed cohorts.

Browser checks use the production build with an in-memory fixture server:
initial v1/v2 states, cancelled confirmation, successful cutover, exact-version
disable, reload persistence, v2 historical request and unchanged forward
enablement. Layouts checked at 320/375/390/480/1440 pixels in light/dark themes
without horizontal overflow. Logs/screenshots are under ignored
`output/playwright/`; regression/build logs under `output/minmax-v2-*.log`.

## Remaining release risks and approval

- Old frozen jobs/protocols have a different rule-code hash and fail closed under
  this release. Do not rewrite their hashes or silently regenerate specifications.
  Review retained cohorts and pending jobs before any future deployment.
- Older frontend code sending MIN/MAX configuration without a version will be
  rejected. Backend/frontend must be released together after approval.
- Returning to the older application after a v2 cutover is not a simple enable
  switch: preserve the new history and plan a coordinated code/database rollback.
  Never restore an old database over new live production results casually.
- Production-scale migration latency, VPS resource limits and live clock quality
  have not been revalidated by this local task.
- The build reports the existing bundle-size advisory (over 500 kB).
- Countdown work remains a separate unfinished change and needs its own review.

No commit, push, deployment, production restart or live cutover was performed.
