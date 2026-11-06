# Minimum/Maximum Stage B — local implementation

## Scope and identity

`minimum_maximum_three` v1.0.0 is a separate, disabled-by-default, three-number
research experiment. The unverified `maximum_minimum` placeholder remains unchanged.
The one-number and four-number handlers and their saved settings are preserved.
This is the user's research specification, not independently verified tutorial evidence.

## Rules and persistence

MIN selects minimum minus one, minimum, minimum plus one; minimum 1 skips.
MAX selects maximum minus one, maximum, maximum plus one; maximum 49 skips.
There is no wrapping or replacement. All three numbers must be absent for a win.

Initialization uses the five most recent valid consecutive source/target pairs
with target ID strictly below the upcoming target. Newest sole MIN win chooses
MAX; sole MAX win chooses MIN; both winning stops the search with a tie skip.
No winner or insufficient history skips. WIN switches, LOSS repeats, boundary
and tie skips reassess. Pending outcomes block progression. Disabled intervals
do not create simulated missed predictions or reset state.

Decision state and prediction insertion share the existing lab transaction.
Duplicate insertion/settlement does not advance state twice. Malformed results
leave the new strategy pending. Conflicting valid results pause this strategy
for review, preserving its previously settled rows. Existing strategies retain
their previous correction behavior. There is deliberately no automatic conflict
clear/reset action; recovery requires a separately reviewed procedure.

## Additive database initialization

Lab initialization creates, if absent:

- `betzero_lab_minmax_state`: state JSON keyed by strategy ID and version.
- `betzero_lab_minmax_draws`: completed result context, observation time, conflict flag.

It inserts the new registry/configuration rows with enablement false using
INSERT OR IGNORE. Existing records and enablement are not reset. No production
database was opened for implementation or validation. State/context are research
data and should be included in the existing full SQLite backup.

## Historical API and safeguards

The existing backtest and queue endpoints accept optional `strategyId` for an
explicit research-only evaluation snapshot. Unverified IDs are rejected. Omission
retains the existing saved-configuration behavior. Saved forward settings are
never enabled by a historical request. Sealed requests cannot override strategy
selection; they use their frozen specification.

100 opportunities use the synchronous endpoint. Larger windows use the existing
queue and wait if the worker is unavailable. Nothing starts/unmasks the worker.
The 50,000 evaluated-pair limit, single runner, two waiting jobs, timeout,
cancellation, and resource limits remain. Input may include up to five extra
initialization pairs; oversized/gapped context fails closed rather than becoming
an unbounded query. Missing valid context produces INSUFFICIENT_HISTORY.

Context boundaries are recorded in job specifications, checked against sealed
reservations, and recorded as exploratory exposures. Sealed MIN/MAX protocols
reserve their six preceding context draws as well as their scored range.
Frozen rule hashes cover both the lab and MIN/MAX module. Existing frozen jobs
or protocols with an older code hash must not be edited to match this release.

The new simulator produces one ordered set of picks. Saved rows, segmented
metrics, and full-run streaks use those same picks. State continues across
reporting segments; full-run metrics do not reset at segment boundaries.
Random comparisons use 64 seeded three-number samples on each entered target.
Theoretical absence probability is 43*42*41/(49*48*47), approximately 66.98%.
These repetitions do not increase the number of real observations.

## Local validation

Command:

    node --test test_betzero_minmax.js test_betzero_lab.js test_betzero_jobs.js test_betzero_forward.js test_betzero_reconciliation.js test_site_static.js

58 tests passed, zero failed. Includes calculation, chronology/no-lookahead,
boundary/tie skips, switching, missing/conflicting results, restart recovery,
atomic rollback, historical isolation, matched baselines, full-run streaks,
context protection, actual isolated calculation child, queue safety, existing
history preservation, database-copy initialization, and authorization regressions.
All worker tests use temporary databases/processes, not the installed service.

Frontend production build passes (23 route entry points). The existing main
bundle exceeds the 500 kB warning threshold; no build error.

In-memory browser preview: confirmation/cancellation, disabled historical test,
unchanged other settings/history, and 320/375/390/480/1440 px layouts in both
actual light and dark themes passed without document horizontal overflow.
Fixtures are synthetic UI/test data, not reported prediction performance.
Artifacts are under ignored `output/playwright/minmax-*` and `output/minmax-*`.

## Deployment risks and outstanding approval

- Not deployed, committed, or pushed; no VPS services restarted or worker activated.
- New forward strategy remains disabled. Forward activation needs separate approval.
- Full consistent SQLite backups and an identified rollback release are required
  before any later deployment. Old code should leave additive tables untouched;
  preserve them on rollback rather than deleting new history/state.
- Existing frozen protocols/jobs may reject changed rule hashes. Preserve them
  and the matching old release; do not rewrite sealed specifications or reuse cohorts.
- Real-world forward operation and production performance have not been measured.
  Context must accumulate before five-opportunity initialization is possible.
- Pending settlements intentionally stop this strategy; result conflicts require
  review. State is not silently reset when toggling enablement.
- The dashboard displays at most 1,000 saved historical rows per fetched page.
  Longer runs retain all rows in storage and support the existing pagination API.
- Unrelated pre-existing extension changes must be reviewed separately before
  preparing any deployment release.
