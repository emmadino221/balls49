# Main Bet49: Smallest +10

Local change, not deployed.

The issued Bet49 pick is one number: the minimum of the immediately preceding
completed six-ball result, plus 10. No wrapping. Missing, invalid or conflicting
previous results, or a candidate above 49, produce a SKIP. The target result and
future results are never used. Identical duplicate source results are accepted.

This copies the selection calculation of `simple_smallest_number_add_10`
v1.0.0 without importing its database, settings, predictions or performance.
Bet49 still wins on appearance; the Lab experiment still wins on absence.
The BetZero Lab configuration and historical records are unchanged.

The main output remains an array (`bet49Pick`), now containing one number or
empty on SKIP. Existing website, Telegram and automation consumers receive this
selection after deployment. Historical multi-number records retain their
original selections and appearance-based settlement. No stakes or settings are
rewritten. Existing active automation may consume the new selection after
deployment, so rollout must account for ongoing sessions.

BetZero, Rainbow and High/Low continue using the previous internal multi-number
pool. They are not recalculated from the new single published Bet49 pick. Earlier
documentation describing those markets as following the published Bet49 picks
therefore refers to the legacy pool after this change.

`brainData.bet49` records the new method, source draw and skip reason. The offline
market replay receives the same pure helper; no Lab settings or records are read.

Regression tests (including VM test contexts that extract computePredictions)
must be updated and run before release. No production performance claim follows
from the absence-based research strategy's results.
