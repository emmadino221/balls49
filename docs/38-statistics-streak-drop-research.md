# Statistics streak-drop research (local implementation)

## Rules, version 1.0.0

- `statistics_streak_drop_betzero`: compare two consecutive observational snapshots of
  `btc=11090`, `period=100`. Qualify only `strk` transitions 2 -> 1 or 3 -> 1.
  Sort 1 through 49 and take the first four. Fewer than four: SKIP; no carryover.
- `statistics_streak_drop_bet49`: choose one of that same four using a reproducible
  SHA-256 seed including version, target draw and both input hashes. No additional
  candidates are eligible. BetZero need not be enabled to evaluate this shared rule.
- BetZero wins when all four numbers are absent from the completed six-ball draw.
  Bet49 wins when its one number appears. Histories, outcomes and streaks are separate.
- Uniform six-ball theoretical baselines: BetZero product of (43-i)/(49-i), i=0..3;
  Bet49 6/49. Random comparisons use the same entry/skip sample and selection count.

## Collection and limitations

The existing bot statistics request is reused, with request/receive timestamps and
the observed clock deadline. Collection requires the immediately previous completed
result to be known before the request, and a fresh clock with time remaining.
The signed publisher carries the response to the owner Lab. No additional Bet9ja
request is introduced and production prediction inputs/algorithms are unchanged.

The provider statistics response has **no draw ID or generation timestamp**. Its
association with a source draw is observational, not proof that the provider has
updated its statistics. Every new strategy's performance is therefore provisional.
The implementation must not be described as provider-verified draw alignment.

An additive table, `betzero_lab_number_statistics`, retains one normalized 49-number
snapshot per source draw, timestamps, signature and conflict flag. First values
are never overwritten. Different values for the same source mark it conflicted;
affected comparisons skip. Missing, invalid, nonconsecutive or late samples skip.
This table and two disabled strategy/config entries are created on Lab initialization.
No production database has been initialized or migrated by this implementation.

Historical draws alone cannot reconstruct Bet9ja's `strk` values. Historical replay
requires recorded snapshot pairs and a target settlement timestamp after capture.
It uses isolated research selection without changing saved forward enablement.
Actual snapshot inputs, hashes and Bet49 seed are saved with prediction records.

## Backtest isolation

Existing synchronous limits and asynchronous queue/timeout/cancellation limits remain.
The earlier snapshot (target minus two) is included in protected-cohort/exposure checks.
Queued snapshot inputs are hashed; the worker checks the hash and copies inputs to
its private database before simulation. Changed inputs fail rather than silently rerun
a different dataset. The new module participates in the frozen rules hash; previously
queued jobs and sealed protocols with older hashes are not rewritten and may fail the
existing hash guard. New statistics strategies support exploratory testing only;
sealed snapshot-cohort support is not implemented.

## Activation and validation

Both strategies default DISABLED. Existing experiments and all six unverified
strategies retain their settings. Owner confirmation controls can enable research
generation later; implementation alone does not enable either strategy.

## Local validation ? 9 November 2026

JavaScript syntax checks and frontend production build passed. The relevant Lab
regression run passed **105 tests, 0 failures**, including 12 new statistics-transition
checks. An existing registry-count assertion was updated from 10 to 12 while retaining
checks for the original identities and disabled defaults.

Coverage includes exact transitions, first-four ordering, skips, deterministic Bet49
selection, opposite grading, theoretical baselines, immutable snapshots, conflicts,
late/missing inputs, forward settlement, duplicate settlement, independent streaks,
no target-result lookahead, disk restart, protected warm-up cohorts, a real isolated
child-worker replay, and rejection of snapshot changes after enqueue. Existing Lab,
MIN/MAX v1/v2, jobs, forward metrics, reconciliation and migration tests also passed.
Temporary/in-memory databases and synthetic test fixtures were used. The worker test
ran a local child process only; no production worker service was activated. These are
mechanics checks, not historical performance claims.

Log: `output/streak-drop-regression.log` (local, ignored output).
Frontend build emitted its existing greater-than-500-kB bundle warning.
No live collection, real-data performance evaluation, browser interaction checks,
commit, push or VPS deployment were performed. Both new strategies remain disabled
by default. Provider statistics alignment still requires live observation before
research activation. Existing extension and other unrelated working changes were
preserved.

## Subsequent cleanup — retired tutorial placeholders

At the owner's request, the six incomplete tutorial placeholders were removed from
the active strategy registry. New databases no longer register them. Existing stored
registry/config/history rows are retained, but are excluded from current strategy
lists, controls and the default forward-history feed. They cannot be enabled or
selected for a new backtest. Saved historical backtest reports are not rewritten.
The active registry contains six implemented versions (five IDs, with MIN/MAX v1/v2).
Existing enablement settings for those implementations are unchanged.

Registry-dependent test expectations were updated. Release validation reran all 105
Lab tests after cleanup: 105 passed, 0 failed. A regression hiding archived versions
of retained strategies was corrected; archived version statistics remain accessible.
JavaScript syntax and frontend build passed. Release log: `output/streak-drop-release-check.log`.
