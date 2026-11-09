# Streak-drop research v2.0.0

Local implementation; not deployed or enabled automatically.

Both existing streak-drop strategy IDs now have an independent v2.0.0.
V1 continues to require four qualifying numbers and retains its saved settings,
pending predictions, results and statistics. V2 configuration rows are inserted
disabled by the existing insert-if-absent registration. No schema change or
historical rewrite is required. No production database was opened for this work.

## Rules

- Keep the existing consecutive statistics snapshot requirements.
- Qualify a number only when its streak changes from 2 or 3 to 1.
- Sort by number ascending. Exactly three qualifiers: use those three.
- Four or more qualifiers: use the first four. Fewer than three: SKIP.
- BetZero wins when all selected numbers are absent from the six-ball result.
- Bet49 chooses one seeded random number from the same three/four candidates;
  it wins if that number appears. Its seed includes the strategy version.
- Do not accumulate qualifiers across draws or reconstruct past statistics.

## Isolation and metrics

The dashboard displays explicitly versioned cards. Configuration requests must
specify the version. Enabling v2 does not disable v1: an administrator must
separately choose whether to keep v1 running. Pending v1 predictions can settle.
Existing exact-version histories and streaks remain independent. Historical
simulation picks are keyed by both strategy ID and version.

Three-number selections are accepted only for BetZero streak-drop v2 (besides
the separate existing three-number MIN/MAX strategies). Settlement and archive
reconciliation validate the actual selection count. Random baselines use the
same number count per evaluated prediction; theoretical rates are averaged over
the evaluated selections. Bet49's matching single-number baseline stays 6/49.
The selectionCount compatibility field is the maximum (4); selectionCounts is
[3,4] for BetZero v2. No forward baseline is shown before v2 has settled samples.

Snapshot freshness, conflicts, chronological safeguards, protected cohorts,
queue limits and worker activation behavior are unchanged. Results remain
provisional because provider statistics have no authoritative draw ID.
Existing frozen jobs remain frozen; changed rule hashes must not be rewritten
to force old jobs to execute against new code.

## Validation and release status

Frontend production build completed locally. Regression tests and browser
checks have not been run for this change. They remain necessary before release.
No worker activation, commit, push, service restart or deployment was performed.
