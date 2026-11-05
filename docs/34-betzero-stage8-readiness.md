# Stage 8 — final VPS deployment readiness verification

Date: 2026-11-05. Snapshot captured at 11:19:06 UTC (12:19:06 Europe/Berlin).

## Decision

Local reconciliation, additive lab migration, legacy-code read compatibility and Linux unit validation passed. **No deployment, live repair or worker activation is authorized or performed.** Actual CPU/memory enforcement remains unverified; leave worker activation blocked pending an isolated Linux resource test and separate approval. A website-only release can be reviewed separately with the worker masked.

No VPS files were created, no services were installed/restarted, and no live database writes, predictions, settlements or backfills were performed by this verification. The existing website, bot and collector remained active. Their inspected restart counters were zero. Both backup services reported success/exit 0; this does not replace a fresh pre-deployment backup.

## Evidence capture and limits

The live SQLite database was opened with `mode=ro` and `query_only`. SQLite's backup API captured a consistent committed snapshot into remote memory. Only the ten `betzero_lab_*` tables were exported into an isolated local SQLite file. Subscriber/authentication/vault records and secrets were not downloaded or displayed. The collector archive was read once into a valid JSON snapshot; the deployed legacy lab module was copied for compatibility testing.

This is a **lab-scoped logical backup**, not a full application disaster-recovery backup. Explicit secondary indexes are reconstructed by lab initialization. The database and archive are independent snapshots, not a cross-file atomic transaction; the completed target result and exact IDs were checked. Test data is retained under ignored `output/stage8/`, including untouched snapshots, disposable migrated/restored copies and machine-readable reports. It must not be committed.

Captured data: 10,423 lab prediction rows across legacy strategies, 887 collector records. This count includes historical SKIP records for disabled tutorial strategies and is not the number of settled one-number predictions.

## Draw 5890334

The live one-number prediction remained PENDING both at capture and the final read-only check. The collector still had exactly one matching result. Six tutorial rows for the same draw were SKIP and were not changed. Four-number predictions are absent on the current VPS.

- Strategy/version: `simple_smallest_number_add_10`, `1.0.0`.
- Original prediction time: `2026-11-04T22:59:34.021Z`.
- Collector observation: `2026-11-04T23:00:19.465Z`.
- Validated archive: exact target ID, six distinct integers within 1–49, no conflicting matching result.
- First operation: new CLI dry-run against the untouched local snapshot; proposed outcome **WIN**.
- Subsequent apply: disposable local copy only, one record repaired.
- Original prediction fields, including timestamp, selections, source, conditions and version, matched exactly after repair.
- Twenty repeated applications: zero further changes; one provenance record.

Collector observation time is not proof of the actual draw deadline. The repaired legacy row does not gain verified pre-draw timing metadata.

### Strategy-specific impact on the captured snapshot

| Metric | Before | After isolated repair |
| --- | ---: | ---: |
| Settled predictions | 1,487 | 1,488 |
| Wins | 1,293 | 1,294 |
| Losses | 194 | 194 |
| Current losing streak | 0 | 0 |
| Worst losing streak | 4 | 4 |
| Longest winning streak | 45 | 45 |
| Provisional summary | Yes | No |

These are snapshot statistics, not a live dashboard update. Later draws or unresolved results can change the totals/provisional flag. The live target is still PENDING.

## Worker verification

The exact proposed unit was passed over SSH into an anonymous Linux `memfd`, then validated with:

```text
systemd-analyze verify --man=no --generators=no /proc/self/fd/<fd>:balls49-betzero-worker.service
```

Result: exit 0, no stdout/stderr warnings. The memory descriptor was closed afterward; no unit file was installed. The audited absolute Node executable exists. The VPS exposes cgroup v2 CPU and memory controllers. The worker remains `LoadState=not-found`, `ActiveState=inactive`.

Proposed limits remain CPUQuota 25%, CPUWeight 10, MemoryHigh 768M, MemoryMax 1G, 512 MB supervisor/child heaps, TasksMax 32, Nice 10, 15-second graceful stop, RestartSec 30, at most three starts within 600 seconds. Queue limits remain one running/two waiting, 50,000 pairs and ten minutes.

**Not verified:** actual throttle behavior, MemoryHigh reclaim, hard-limit termination, combined parent/child RSS, or recovery after cgroup OOM. No separate Linux test machine/container was available; no stress process or new cgroup was created on the production VPS. Windows process tests do not verify Linux enforcement. Available VPS RAM was approximately 1,676 MiB with no swap, lower than the earlier audit; a 1 GiB hard limit is not a reservation and does not eliminate host-pressure risk.

### Prevent unexpected queued work

Current VPS has no jobs table or installed worker. Isolated migration creates an empty queue and does not start a process. However, `betzero-worker.js` calls recover/claim when started: **a started worker can immediately execute an existing queued job.** There is no separate application-level maintenance/start latch. Copying the unit or daemon-reloading alone does not run it; `enable --now`, manual start, dependencies, or later boot of an enabled unit can.

Deployment must keep the unit **disabled and masked**, and inspect queued/running jobs before any later unmask/start approval. Do not describe installation as safe if an installer also starts/enables the worker.

## Migration, rollback and isolation

- Current lab initialization plus queue/protocol initialization ran twice on the isolated live-derived snapshot.
- All original prediction rows and all existing configuration rows were unchanged by migration.
- One-number enabled state remained true; all six unverified settings remained false.
- Four-number definition was added disabled on the copy. It is not yet registered on the live VPS, and no four-number activation exists there.
- Additive tables/indexes, including reconciliation provenance, passed SQLite integrity checks.
- The actual deployed legacy lab module opened the migrated/repaired schema and rendered its overview without changing prediction rows or original settings. This validates lab read compatibility, not a full old-server integration test.
- Restoring an independent copy from the untouched snapshot reproduced every original lab prediction row exactly; integrity passed. This restore never overwrote a live or migrated database.
- Production algorithms, authentication, subscriptions, staking, Telegram and production settlement code were not changed in Stage 8. No experimental forward generation was invoked by the test runner.

Full application database/vault recovery was not rehearsed in this stage because the export deliberately excluded private application data. Use the existing complete backup/recovery procedure before deployment.

## Reconciliation latency and database locking

Measured on local Windows/Node with the live-derived lab data; these are single-machine measurements, not VPS performance guarantees.

| Operation | Measurement |
| --- | ---: |
| Migration/initialization (two lab initializations plus queue initialization) | 170.05 ms |
| Initial dry-run | 55.92 ms |
| Dry-run while another connection held a WAL writer transaction | 2.99 ms |
| Contended apply, busy timeout configured at 1,000 ms | failed safely after 1,204.15 ms |
| Successful isolated apply | 82.13 ms |
| Measured write transaction duration | 78.45 ms |
| 20 subsequent idempotent runs | 1.04–3.35 ms each |

The contended attempt left the prediction PENDING; after releasing the competing writer, one repair succeeded. The existing 77-test suite also covers interrupted writes, rollback/restart, job contention and claim recovery. SQLite remains single-writer: even a roughly 78 ms local write lock can delay synchronous production handlers, and VPS timings may be worse. Prefer a quiet approved maintenance window, one target first, bounded retries, and latency monitoring. Do not launch large reconciliation batches alongside backtests.

## Regression validation and files

- JavaScript: **77/77 passed**.
- Python discovery: **1/1 passed**.
- Production build: passed, 23 static page entries.
- `git diff --check`: passed.
- Existing warnings: experimental Node SQLite API; main frontend bundle approximately 508.81 kB exceeds the 500 kB advisory threshold.

Stage 8 source additions only:

1. `scripts/betzero-stage8-local.js`: reproducible isolated-copy verification, performance/locking measurements and lab rollback checks. Defaults to ignored local evidence directory; never connects to the VPS.
2. This report.

Runtime evidence/copies are in ignored `output/stage8/`. Earlier stage changes remain uncommitted and were not pushed. No production source fixes were needed in this stage.

## Exact controlled deployment checklist — FUTURE APPROVAL REQUIRED

### A. Release and recovery gates

1. Obtain explicit approval for the exact website release and installation scope. Worker start, repairing 5890334, and strategy activation are separate decisions. No activation is implied.
2. Review the accumulated uncommitted Stage 2–7 changes, exclude local evidence/runtime files, create an immutable approved release commit, and record the current website commit and unit configuration for rollback. Do not blindly pull an unreviewed branch.
3. Record service health/restarts, clock freshness, API latency, database integrity, free disk/RAM, exact strategy configurations, pending counts, and queued/running jobs immediately before the change.
4. Run the approved consistent full backup procedure, including committed SQLite WAL data, companion security keys and required configuration. Verify backup integrity/download and restore on an isolated copy. Record backup filename/hash and old release. Never print key/environment values.
5. Re-run the exact reviewed migrations against a fresh isolated copy. Require identical existing prediction/configuration rows and `integrity_check=ok` before touching the live schema.

### B. Install while preventing worker execution

6. Keep the worker disabled/masked before installing any unit. A future systemd installation can use an `/etc/systemd/system/balls49-betzero-worker.service -> /dev/null` mask with the reviewed unit installed in the lower-precedence `/usr/local/lib/systemd/system/` directory. Verify no existing unit/start job/dependency before this operation. Do not use `enable --now`.
7. Stage the approved website release and prebuilt assets. Preserve the current website environment and database paths. Do not pull/restart the separate private bot or collector checkouts.
8. Install only the reviewed worker unit and minimal worker environment (database path and heap setting). Keep the mask in place; daemon-reload only. Verify `LoadState=masked`, `ActiveState=inactive`, no worker PID and no RUNNING job. Environment values containing credentials must not be included or displayed.
9. Validate the installed unit file with `systemd-analyze verify` using its explicit file path. Verify Node path and resource directives. Repeat native validation after every Node-path/unit change.
10. Under the approved maintenance window, roll out the website release and perform only the approved website restart. The existing one-number configuration must remain unchanged; the four-number and six unverified strategies must remain disabled.

### C. Post-deployment checks before additional approvals

11. Confirm service health, owner-only API authorization, no unauthorized job access, database integrity and original strategy settings. Compare prediction history counts and immutable fields against the pre-change snapshot, accounting for legitimate new live results.
12. Check desktop/mobile owner dashboard, provisional warnings, distinct one/four-number statistics, queue visibility, and public-clock target IDs/freshness. Observe at least ten draw transitions and one quiet-period restart/recovery only if separately approved. Do not create historical predictions to fill gaps.
13. Repeat dry-run for 5890334 against a fresh authorized snapshot. Only a separate repair approval permits live `--apply`; require expected WIN, unchanged selections/timestamp, one provenance row and matching chronological streak totals afterward.
14. Before worker startup, validate effective CPU/memory behavior in an isolated Linux environment with disposable DBs. Confirm throttle/hard-limit behavior, clean cancellation and crash recovery. If unavailable, leave worker masked/inactive and document the unresolved gate.
15. On separate worker-start approval, inspect the full queued/running job list and obtain approval for what will execute. Only then unmask/start the reviewed worker. Enabling it on boot requires explicit operational approval. Monitor effective `cpu.max`, memory controls, parent/child RSS, queue state and timeout/recovery behavior.

### D. Monitoring and rollback conditions

- During the initial 30 minutes: inspect service errors/restarts, public API response times, draw freshness, pending-result age, duplicate predictions, job progress, SQLite busy errors, WAL growth, CPU/RAM/PSI and disk space. Continue through the next Nigeria midnight boundary (23:00 UTC) to confirm result delivery/reconciliation needs.
- Stop rollout/startup and roll back the website code if authentication/subscriber behavior changes, production predictions/staking/Telegram are affected, strategies change unexpectedly, duplicate forward records appear, corruption occurs, the website fails health checks, or sustained request/draw-delivery degradation appears relative to the recorded baseline.
- Keep the worker masked; if a later approved worker run causes OOM, restart loops, sustained database locks, or stale draw delivery, stop it under the approved incident procedure. Do not automatically retry failing jobs indefinitely.
- Prefer reverting to the recorded website release while retaining the additive database schema, whose lab read compatibility was tested. Validate the old server before calling rollback successful.
- Restore a database backup only for corruption/incompatible data and with separate incident approval: restoring an old whole-app database can discard legitimate registrations, payments, settings and predictions made after the backup. Preserve a fresh incident snapshot first, coordinate all writers, restore the matching keys/configuration, and verify integrity and application health. Never overwrite a running WAL database with a bare file copy.

STOP: this report is verification evidence and a future procedure, not authorization to deploy, repair, start workers or enable strategies.
