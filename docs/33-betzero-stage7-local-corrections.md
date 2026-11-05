# Stage 7 — local safety corrections

Date: 2026-11-05. Local implementation only. No VPS connections, deployment, push, service restarts, production database writes or strategy activation were performed.

## Files changed in this stage

- `deploy/balls49-betzero-worker.service`: audited absolute Node executable, supervisor heap cap, resource limits, restart throttling and shutdown allowance.
- `deploy/betzero-worker.env.example`: child heap default 512 MB.
- `betzero-worker.js`: child heap defaults to and is capped at 512 MB.
- `betzero-reconciliation.js`: read-only archive validation/planning and provisional-summary metadata.
- `scripts/reconcile-betzero-lab.js`: explicit operator command, defaults to read-only dry-run; no server/worker integration or schedule.
- `betzero-lab.js`: additive provenance table, pending-only transactional reconciliation, strategy/version-specific chronological streak rebuilding, provisional statistics.
- `betzero-forward-metrics.js`: provisional metadata in each rolling window and cache invalidation when pending quality changes.
- `web/src/pages/BetZeroLabPage.jsx`: provisional warnings for selected strategy summaries and rolling results; observation-time limitation.
- `test_betzero_reconciliation.js`: nine regression tests.
- This report.

The working tree already contained Stage 2–4 changes, including `bot.js`. This stage did not edit `bot.js`, production prediction algorithms, subscriptions, authentication, staking, Telegram, production settlement, collector reset or publisher delivery. Existing lab snapshot settlement is unchanged. The archive repair command is separate and lab-only.

## Worker configuration

Executable: `/home/balls49/.nvm/versions/node/v24.21.0/bin/node`, with supervisor `--max-old-space-size=512`; child heap capped at 512 MB.

| Setting | Value |
| --- | --- |
| CPUQuota | 25% of one CPU, shared by service processes |
| CPUWeight / Nice | 10 / 10 |
| MemoryHigh / MemoryMax | 768M / 1G, service cgroup total |
| TasksMax | 32 |
| Restart | on-failure, 30-second delay |
| Start limit | 3 starts within 600 seconds |
| Stop | existing graceful signal handling, control-group kill, 15-second timeout |
| Queue | unchanged: one running, two waiting |
| Job bounds | unchanged: 50,000 pairs, ten minutes |

Limits include child processes. A heap cap is not a total RSS cap. Repeated failure stops restart attempts; operator investigation is required. Existing claim fencing/recovery handles interrupted jobs; jobs are not silently promoted to successful results.

Local configuration assertions and worker lifecycle tests passed. Windows has no `systemd-analyze`; native unit validation and actual cgroup enforcement remain deployment gates on Linux. No packages were installed.

During a future Node upgrade, retain the old binary/release for rollback, explicitly update the unit's absolute path, validate the new executable and unit on Linux, and only restart under approved deployment. Do not rely on interactive NVM shell initialization or `/usr/bin/node`.

## Reconciliation behavior

Only existing PENDING predictions at least five minutes old are considered. At most 100 decisions are returned per invocation; a target filter supports investigation of a specific draw. Missing archive results remain pending. This is an explicit maintenance tool, not an automatic midnight task.

Input is the collector's actual array format: `id`, comma-separated `dr`, and `timestamp`. IDs must be canonical positive safe integers; six distinct integer numbers must be within 1–49. Archive timestamps must be parseable, after the prediction and not in the future. They establish observation provenance only, not the actual draw deadline.

Conflicting duplicates, malformed matching results, incompatible already-settled lab results, unknown strategy versions and invalid saved selection counts are rejected. Identical results with reordered balls are accepted. Original saved selections determine WIN (all absent) or LOSS (any present), using the existing lab grading function.

Apply mode rechecks the prediction and archive eligibility under a write lock, updates only status/result/validation time, inserts provenance, and rebuilds that strategy version's streak events and lab alerts chronologically in the same transaction. Prediction timestamp, selections, source, conditions, version and settings are preserved. A failed transaction rolls back; a subsequent run can retry safely. Already-settled records are not repaired again. No missing predictions are created. No Telegram alerts are emitted.

Rebuilds above 50,000 records per strategy version fail closed pending separate review. The command uses a one-second SQLite busy timeout. Each repair is a separate transaction, but rebuilding a long strategy history can still hold a write lock: benchmark against a representative database copy and use an approved maintenance window before live application. Apply is not connected to a web endpoint or background service.

## Database change

One additive table: `betzero_lab_reconciliations`:

- `prediction_id` primary key, one successful repair per prediction.
- `source_name`, `source_hash` (SHA-256 of parsed archive JSON), `result_hash` (SHA-256 of canonical sorted balls).
- `observed_at`, `reconciled_at`, `outcome`.

No existing historical row rewrite occurs during migration. Actual repair is explicit `--apply`. Existing registry initialization preserves saved settings; the original enabled experiment is not silently disabled. Four-number and six unverified strategies remain disabled. Dry-run opens the existing DB read-only and does not initialize or migrate schemas.

## Statistics

Strategy/version summaries and 100/500/1,000 windows expose pending counts and a provisional warning when pending predictions are overdue, have invalid timestamps, or precede settled history. Unresolved results are not assumed to be wins or losses. Streaks remain provisional until resolved. After repair they are recomputed chronologically without mixing versions. Collector observations do not upgrade legacy records into timing-verified forward samples.

## Target 5890334

Actual local read-only source was backed up into a temporary SQLite copy. Migration was run twice on the copy and all six original tables were compared before/after; contents were unchanged and integrity returned `ok`. The local collector archive contains 1,000 records, but zero matches for 5890334. The local database contains zero matching lab predictions. Dry-run returned zero decisions. Temporary copies were removed; the original local DB and archive were not updated.

Consequently this stage does **not** independently verify or settle the VPS prediction. Prior Stage 6 findings are not a substitute for a fresh dry-run on the actual authorized dataset. Tests using this target ID are synthetic regression fixtures, not reported historical performance.

Prepared future read-only command (requires separate VPS access approval; not executed):

```sh
/home/balls49/.nvm/versions/node/v24.21.0/bin/node \
  /home/balls49/balls49-site/scripts/reconcile-betzero-lab.js \
  --db /var/lib/balls49-site/site_users.sqlite \
  --archive /home/balls49/balls49/draws.json \
  --target 5890334 --dry-run
```

The dry-run output omits raw selections, balls and saved database records. Missing archive data requires recovery from an existing authorized backup; do not fabricate results. Applying this record requires separate approval and a fresh consistent database/key backup.

## Validation

- Full JavaScript suite: 77 passed, zero failed.
- Python discovery: one test passed.
- Production build: passed, 23 static entries generated.
- New tests: Nigeria midnight rollover/missing publication; dry-run and successful reconciliation; repeated application/restart; malformed/conflicting results; preserved fields/settings/state; one/four-number grading and streak separation; additive database-copy migration; transaction rollback/recovery; CLI read-only default and redaction; worker configuration assertions.
- Existing tests include queue bounds, cancellation, timeout, crash recovery, contention, duplicate claims, authorization, graceful worker shutdown, production prediction isolation and historical preservation.
- Real local DB-copy migration: integrity `ok`, all six original tables preserved, repeated initialization safe.
- `git diff --check`: passed.

Warnings: Node SQLite experimental API warning; existing main frontend chunk about 508.81 kB exceeds the 500 kB advisory threshold. No Stage 7 live-VPS or browser interaction test was performed; UI compiled successfully.

## Approval gates / readiness

Local corrections and regression validation are complete. Not yet approved for deployment or reconciliation on production. Remaining gates: fresh VPS database/key backups, approved release/rollback packaging, Linux unit and effective cgroup verification, representative-copy reconciliation latency measurement, fresh target-5890334 dry-run, API/dashboard checks and monitoring after an approved deployment. Keep all research enablement unchanged. No automatic forward testing or reconciliation has been activated.
