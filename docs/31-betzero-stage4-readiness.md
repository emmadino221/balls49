# Stage 4 — forward-testing readiness

Date: 2026-11-05. Local preparation and verification only. No deployment, push, VPS access, saved strategy activation, or real forward-generation run was performed.

## Readiness assessment

The forward-generation path and dashboard are ready for a separately approved live validation. Actual pre-draw recording on the VPS is **not yet demonstrated**: the four-number strategy remains disabled and this stage used isolated fixtures. Tests confirm that the code records a prediction before the clock's estimated target deadline; they cannot establish that a bookmaker's clock is accurate in live operation.

| Requirement | Local verification | Remaining verification |
| --- | --- | --- |
| Predictions before target | Four-number test records PENDING before expected target time, using only prior draw; actual server receipt time is saved | Live clock accuracy, transport delays and pre-draw evidence on VPS |
| Strategy separation | Exact strategy ID and version partition records, windows, baselines and streaks | None for local implementation |
| Outcome/streak metrics | Wins, losses, skips, invalid/unverified counts, current/worst losing streak, longest winning streak | Real accumulating sample after separate approval |
| Duplicate protection/settlement | Repeated delivery creates one prediction and settles once; timestamps remain unchanged; existing correction/restart tests pass | Live publisher delivery/reconnect observation |
| Dashboard | 100/500/1,000 record windows, sample sizes, Wilson intervals, matching baselines, empty state and charts | Real forward results |
| Loss alerts | Configured thresholds and existing all-time events; explicit no-reversal wording | User-selected thresholds before activation |
| Worker recovery | Full worker suite passes: exclusive claims, bounded queue, cancellation, timeout, stale-claim fencing/recovery, actual child computation and clean active/idle shutdown | Linux service restart/resource enforcement on VPS |
| Backup | Fresh SQLite backup created; integrity check returns `ok` | Current VPS database/vault-key backup and restore verification |

## Timing hardening

Previously a positive countdown alone could still refer to an old clock observation. New forward rows require:

- Matching current and clock target draw IDs; source ID is target minus one.
- A valid six-number source result and source settlement newer than lab startup/last snapshot, no later than the snapshot.
- No target result already included in the snapshot.
- A finite positive countdown up to 300 seconds.
- A positive integer `clock.observedAt`, no later than the snapshot and at most 30 seconds older.
- Recording time `max(snapshotAt, server now)` strictly before `observedAt + countdown * 1000`.

New prediction conditions include `observedAt`, `expectedTargetAt`, `snapshotAt`, and `recordedAt`. The stored prediction timestamp is recording time. The existing source/version/target uniqueness rule remains in force. No production or lab settlement algorithm was changed; settlement still updates existing lab predictions on result arrival.

The dashboard excludes rows missing valid timing evidence from its new verified rates. For WIN/LOSS rows it additionally requires validation after prediction, valid selections and valid result balls. Historical rows are not rewritten, deleted or backfilled with invented evidence. They remain in the original history/all-time views, and the new panel reports how many are unverified. Deployment with a publisher that lacks `clock.observedAt` will suppress new forward generation until its clock feed is corrected.

## Rolling results and baselines

Windows mean the latest 100, 500 or 1,000 terminal records per exact strategy version. WIN, LOSS, SKIP and INVALID occupy window slots; pending predictions are counted separately. Fewer available records are shown honestly, without filling the sample. Streaks in this panel are within the selected window; existing all-time statistics remain separate. Skips do not reset a settled-result streak.

The theoretical probability of all k picks being absent is `C(49-k,6)/C(49,6)`: approximately 87.755% for one pick, 58.246% for four. Each verified settled entry gets one deterministic seeded random control with the same selection count, target and entry/skip conditions. Seed: `betzero-forward-baseline-v1`, combined with strategy ID, version and target draw ID. The target outcome is not an input to random selection. Unlike Stage 3's 64-repetition historical estimate, this live dashboard uses one control per entry to keep request work bounded. The baseline is stable across overlapping windows.

Win rates show settled sample size and 95% Wilson intervals. Text warns that repeated monitoring and serial dependence limit inference. A threshold warning says: “Loss-streak threshold reached. This is not a reversal signal.” Thresholds are configurable descriptive alerts, not calibrated statistical claims that a reversal is due. Win rates are not profitability estimates.

Reads are bounded to 1,000 terminal rows per strategy/version. A partial expression index supports the window query. Cached metrics are invalidated when rows, pending count or alert thresholds change. No historical simulation is launched by the dashboard.

## Resource limits, backup and recovery

Reviewed the uninstalled example service: CPUQuota=50%, MemoryMax=1536M, Nice=10, TasksMax=32, KillMode=control-group, TimeoutStopSec=5, Restart=on-failure, PrivateTmp, NoNewPrivileges and restrictive UMask. Child heap defaults to 768 MB and is configurable within 128–2048 MB. The configured heap should remain below the service's total memory limit with room for the supervisor and SQLite. These are configuration checks, not measured Linux enforcement.

The one-running/two-waiting queue, 50,000-pair cap and ten-minute deadline remain unchanged. Lost claims are failed/cancelled and fenced rather than replayed; waiting jobs can continue. Consumed sealed protocols remain consumed after failures. Windows tests exercise process lifecycle through IPC; Linux systemd signal/cgroup behavior still needs an authorized VPS check.

Backup created using SQLite's online backup API:
`../local-backups/balls49-stage4-readiness-20261105T074151Z.sqlite`.
Integrity check: `ok`. This local database does not contain the VPS's live user/history dataset. It is not evidence that current VPS backups or vault-key restoration work. No VPS keys, services or backup schedules were inspected or modified.

## Files changed during Stage 4

| File | Change |
| --- | --- |
| `betzero-lab.js` | Clock/receipt-time guard, timing evidence, additive rolling-window index, overview metrics |
| `betzero-forward-metrics.js` | Version-scoped rolling statistics, matched random/theoretical baselines, intervals and descriptive streak flag |
| `test_betzero_forward.js` | Four new regression tests for timing, duplicate settlement, isolation, rolling counts, baselines, cache refresh, alerts and empty samples |
| `test_betzero_lab.js` | Existing test snapshot helper now supplies explicit clock observation time |
| `web/src/pages/BetZeroLabPage.jsx` | Rolling controls, metrics, sample/uncertainty disclosure and chart integration |
| `web/src/pages/betzero-lab.css` | Responsive metric layout |
| `docs/31-betzero-stage4-readiness.md` | This report |

Database changes are additive: one lab-only index and extra timing keys in new rows' existing conditions JSON. No historical-row migration or production schema change was made. The full lab-module hash changes, so older frozen jobs/protocols may fail closed on a later installation; they must not be rewritten or silently reused with new rules.

## Test and browser results

- All root JavaScript tests: **68 passed, zero failed**.
- Python unittest discovery: **1 passed**.
- Production same-origin build: **passed**, 23 entry points.
- Desktop 1440px, mobile 390px, narrow mobile 320px: no document overflow. Verified empty and populated panels, strategy switching, 500/1,000 selectors, light/dark presentation and charts. Automated metric tests cover all three window sizes.
- Browser preview used synthetic data in an in-memory database, explicitly for UI verification. Those numbers are not performance findings and are not added to real history. No activation endpoint was used.
- Browser console was clear after the preview supplied a favicon response; the original empty fixture had only a missing-favicon 404. No application JS error was observed.
- Browser artifacts: ignored `output/playwright/stage4-*`; regression log: `output/stage4-regression.txt`.
- Existing warnings remain: Node's experimental SQLite warning and a client bundle larger than 500 kB.

All local preview processes were stopped after verification. Existing one-number saved enablement was not changed; four-number enablement occurred only inside isolated unit tests, and no saved real configuration was activated. All six incomplete tutorial strategies remain disabled. Production prediction algorithms, staking, betting, subscriptions, Telegram and production settlement are untouched by this stage.

## Approval needed before proceeding

1. Approval for a VPS readiness inspection: installed Node path/version, real clock fields, database/vault-key backup, Linux resource limits and restart/load checks.
2. Approval to deploy the reviewed lab changes and install/configure the separate worker, if desired.
3. A separate explicit decision about enabling research-only forward collection, strategy versions, alert thresholds and observation period. Deployment alone must not be treated as activation approval.

No statistical edge was established in Stage 3. Stage 4 adds measurement readiness, not new evidence of predictive advantage. Stop here pending review.
