# Main BetZero: saved Lab Streak 1 prediction

Local implementation, 17 November 2026. Not deployed.

Main BetZero copies the persisted `statistics_streak_drop_betzero` v3.0.0
prediction for the exact target draw, preserving selection order. It does not
recalculate the Lab rule or fall back to Step-10. Exactly four distinct integers
from 1 through 49 are required; shorter Lab selections skip main BetZero.

The worker sends its observed statistics and completed results through the existing
signed prediction feed before main calculation. The receiver saves eligible Lab
predictions against the live clock once validated statistics are available, then
returns the saved row as `labBetzero`. Existing publication requests are serialized.
The response cap is 8 KiB. Network requests retain their ten-second timeout.

The adapter requires the exact strategy/version, consecutive source/target IDs,
saved enabled status, PENDING status, and an unexpired pre-deadline prediction.
Missing, disabled, conflicting, expired or malformed records skip. The Lab's
prediction ID, version, timestamp and deadline are retained in main metadata.
No strategy settings or existing predictions are rewritten.

The Lab retains its up-to-four rule; main automation requires exactly four and
retains its configured 1.65 odds. Provider statistics still lack authoritative
source draw IDs: existing timing association remains observational.

Draw-only backtests cannot reproduce saved Lab records and explicitly skip this
market. Deploy the website receiver before the worker; an older receiver without
`labBetzero` causes main BetZero to skip. Website availability is now a dependency
for main BetZero. Already checkpointed predictions are not replaced mid-draw.

Validation: syntax checks and frontend build. Automated tests were not run in
this turn. No production database or service was accessed or changed.
