# BetZero v2 database migration safety review

Local review completed 7 November 2026. No VPS connection or production database
was used. This report concerns `betzero-version-migration.js`, not strategy rules.

## Verdict

The original migration needed hardening before deployment. The corrected local
implementation passes the schema-copy, preservation, failure and regression tests
below. **This is conditional local validation, not clearance to migrate an
uninspected production database.** Production schema compatibility, database size,
disk space and migration duration still need verification on a fresh consistent
production backup under separate approval.

## Exact schema inspected

The pre-v2 initialization SQL was read from local Git release `717932e` and copied
verbatim to `tests/fixtures/betzero-pre-v2-schema.sql`. The current local
`betzero-lab.js` declarations were compared against it. The migration now carries
exact supported declarations for the three historical tables; only the two
approved key extensions differ between legacy and upgraded forms.

| Table | Existing keys | Foreign keys | Other constraints |
| --- | --- | --- | --- |
| `betzero_lab_backtest_runs` | `PRIMARY KEY(run_id)` | None | Status is `COMPLETED` or `FAILED`; original nullability retained |
| `betzero_lab_backtest_results` | `PRIMARY KEY(run_id,strategy_id,segment)` | `run_id` references runs; default NO ACTION on update/delete | All five columns NOT NULL |
| `betzero_lab_backtest_predictions` | `PRIMARY KEY(prediction_id)`; `UNIQUE(run_id,strategy_id,target_draw_id)` | `run_id` references runs; default NO ACTION on update/delete | Original NOT NULL declarations; status is WIN, LOSS or SKIP |

The explicit historical index is:

```sql
CREATE INDEX betzero_lab_backtest_prediction_target_idx
ON betzero_lab_backtest_predictions(run_id, target_draw_id, strategy_id);
```

SQLite also creates the primary-key and unique-constraint autoindexes. No views,
triggers or inbound foreign keys referencing the two rebuilt tables are declared
by the inspected application schema. Job `run_id` fields and protocol/job links
are logical references, not foreign-key cascade declarations.

The approved changes are exactly:

```sql
-- Results
PRIMARY KEY(run_id, strategy_id, strategy_version, segment)
-- Predictions; prediction_id remains the original primary key
UNIQUE(run_id, strategy_id, strategy_version, target_draw_id)
```

The runs table is never rebuilt. The full original CREATE TABLE statements,
including column order and CHECK clauses, are in the fixture file, and the exact
accepted definitions are also visible at the top of the migration module.

## Discovered risks and fixes

1. **Silent skipping of an unknown schema.** Previously a nonmatching regular
   expression or missing table was treated as already migrated. Now preflight
   requires a recognized legacy or upgraded definition, required parent table,
   and expected target index. It accepts formatting differences but rejects extra
   columns, changed constraints, unexpected parent schemas and staging objects.
2. **Foreign-key cascade risk.** DROP TABLE can affect referencing rows. The new
   guard enumerates foreign keys in every main-schema table and rejects any
   inbound reference to either rebuilt table, regardless of whether foreign-key
   enforcement is currently enabled. It does not disable enforcement.
3. **Dependent objects.** Previously only explicit indexes were saved. Triggers
   could be lost and views could become invalid. The migration now rejects
   dependent main/temp triggers and views for separate review, rather than
   attempting an unreviewed rewrite. Temporary tables shadowing required names
   are rejected too. Dependency detection is deliberately conservative.
4. **Implicit column-order assumption.** Under the inspected schema, the old
   `INSERT INTO new SELECT * FROM old` had matching column order because only the
   key clause changed. It was still unchecked. The fix uses explicit named
   columns after exact schema validation, and also preserves rowids.
5. **No copy verification.** The fix compares both directions with SQL EXCEPT,
   including rowids, each value and SQLite storage class, and compares row counts
   before dropping the old table. SQL stays within SQLite; values are not
   round-tripped through JavaScript numeric conversions.
6. **Startup masking missing objects.** `createBetZeroLab` now checks existing
   historical schema before `CREATE IF NOT EXISTS` can silently recreate a missing
   table or required index. A new empty lab is still supported.
7. **Index and integrity verification.** Explicit index SQL is recreated and
   compared. Original CHECK, nullability, primary-key and foreign-key constraints
   are retained by the supported CREATE definitions. Foreign-key and full
   integrity checks run before and after an actual upgrade, within the same
   transaction. A repeat run validates schema but does not rebuild tables.

Both table upgrades remain in one `BEGIN IMMEDIATE` transaction. Errors roll back
the transaction. No unrelated strategy, forward-history, job or protocol updates
are issued.

## Isolated test methodology and results

Each preservation fixture begins with the actual legacy initialization schema,
synthetic but realistically structured historical data, actual job/protocol table
definitions, strategy configurations and forward records. A consistent copy is
created using SQLite `VACUUM INTO`; migration runs against that copy. The source
file remains unchanged.

Per fixture:

- 12 saved runs, 108 result summaries and 3,600 historical prediction rows.
- One-number, four-number and MIN/MAX versioned records, with WIN/LOSS/SKIP
  outcomes, chronological draw IDs, seeds, selections, metadata and timestamps.
- Different MIN/MAX versions in different legacy runs; new tests verify both
  versions can coexist within one run after migration.
- Preserved JSON spacing, Unicode text, a nullable run completion timestamp and
  deliberate rowid gaps.
- Saved forward records, version-specific states and enabled/disabled settings.
- Queued job payload and sealed protocol specification, including frozen hashes.
- Additional partial, expression and unique indexes to check index preservation.

**Final result: 94 tests passed, zero failed.** This includes 22 dedicated
migration tests and 72 existing/relevant strategy, job, worker, forward-metrics,
reconciliation and route tests.

Dedicated checks:

| Check | Result |
| --- | --- |
| Migration with `foreign_keys=ON` and OFF | Passed; original pragma value retained |
| All rows, rowids, column order/types/nullability/defaults and foreign keys | Preserved |
| Explicit indexes, autoindex keys and constraints | Verified; only approved uniqueness keys expanded |
| Parent runs, settings, forward records, queued jobs and sealed protocols | Unchanged |
| Repeated migration | No rebuilt tables; identical data, schema, schema version and database file hash |
| Failures after first/second DROP, during index recreation, before COMMIT | Full data/schema rollback; clean retry succeeds |
| Simulated missing copy | Detected; both table changes rolled back |
| CASCADE/RESTRICT child references | Rejected before destructive DDL; dependent rows retained |
| Views, owned/external/temp triggers and shadowing temp tables | Rejected without changes |
| Missing table/index, changed parent, extra column, orphan result, staging object | Explicit failure, no migration writes |
| Existing lab missing all historical tables | Startup fails instead of creating empty replacements |
| Competing SQLite writer | Bounded test timeout; no partial migration |
| `PRAGMA foreign_key_check` | No rows returned after successful migration/rollback |
| `PRAGMA integrity_check` | `ok` |

Measured migration-only times in the final local suite were approximately
220–360 ms for the 3,600-row fixtures. This is not a production latency estimate:
full integrity scans and table/index copies will scale with the real database.

An initial combined run had one worker test fail with `database is locked`.
That fixture lacked WAL mode and a busy timeout. The fixture was corrected to use
WAL and a bounded timeout, matching the other worker fixtures; the final full run
passed. Production connection settings and worker code were not changed by this
review.

Frontend production build passed; its existing over-500-kB bundle advisory remains.
Logs are in ignored `output/migration-review/regression-final.log` and `build.log`.
No production data was copied or inspected during these tests.

## Files changed during this review

- `betzero-version-migration.js`: exact schema/dependency checks, explicit copy,
  row/type/index verification and integrity checks.
- `betzero-lab.js`: pre-initialization schema guard only.
- `test_betzero_version_migration.js`: dedicated migration safety tests.
- `tests/fixtures/betzero-pre-v2-schema.sql`: original schema fixture from 717932e.
- `test_betzero_minmax_v2.js`: malformed-schema rejection assertion and isolated
  fixture WAL/timeout correction.
- This report; a follow-up link in the Stage B/v2 implementation report.

No one-number/four-number algorithm, saved application record or setting was
modified. Existing countdown and unrelated extension edits were not touched.

## Recommended production procedure — requires separate approval

1. Identify exact new/previous release hashes and both live SQLite paths. Record
   service health, saved strategy states, queue states and historical row counts.
2. Inspect the actual live schema read-only and run this preflight against a fresh
   consistent backup. Do not bypass a dependency or unexpected-schema rejection.
3. Preserve both databases with SQLite-aware backups, including any committed WAL
   content. Verify checksums, `foreign_key_check`, `integrity_check` and recovery
   access. Preserve required keys/configuration securely; never print secrets.
4. Test this exact release and migration on that backup, compare every historical
   value/index/constraint and unchanged job/protocol/configuration records. Measure
   time, peak disk use and rollback recovery. Keep the old release available.
5. Obtain approval for a maintenance window. Quiesce all writers to the affected
   databases and prevent automatic restarts; keep the backtesting worker masked
   and inactive. Take a final consistent backup after writes are stopped.
6. Run the migration once under controlled supervision, not concurrently from
   multiple starting services. A write lock covers copies, comparisons, indexes
   and integrity scans. Ensure space for replacement tables, indexes and journal/
   WAL growth. Do not run this while accepting normal production writes.
7. Before resuming writers, verify the new keys, row/value comparisons, both
   integrity pragmas, version settings and immutable queued/protocol payloads.
   Do not reinterpret hashes, run backtests, reconcile results or perform cutover.
8. Only after these checks, start the approved release and verify APIs, owner
   access, prediction clock and normal settlement. Monitor SQLite busy/locked
   errors, service logs and response times. v2 stays disabled until a separate
   administrator-approved cutover.

### Rollback conditions and procedure

- Stop on schema/dependency mismatch, any copy/count/integrity discrepancy,
  migration error, inadequate disk space or unacceptable duration. A SQL failure
  before commit is tested to roll back both rebuilt tables. Do not force past it.
- Before writers resume, an unsuccessful release can revert to the preserved
  release plus verified pre-migration database backups if necessary. Stop all
  connections first and restore using a reviewed SQLite-aware procedure; do not
  mix restored main files with stale WAL/SHM files. Recheck integrity before start.
- After writers resume, restoring an older whole database would discard new
  production results. Freeze writes, take a fresh incident backup and review a
  targeted recovery instead of automatically restoring the old snapshot.
- Once multiple versions share a run, the old uniqueness constraint cannot be
  restored without conflicts. Do not delete or merge v2 research history to force
  a downgrade. A separate reviewed recovery/export plan is required.
- Migration preserves frozen jobs/protocols but does not make their old rule-code
  hashes compatible with new code. They must continue to fail closed when hashes
  differ; no automatic rewriting or silent re-evaluation.

No commits, pushes, deployment, production migration or service restarts performed.
