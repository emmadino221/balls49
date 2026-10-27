# High/Low from six Bet49 picks

The live High/Low prediction now uses the issued Bet49 selection for the same
draw. Bet49 must be ACTIVE with exactly six distinct valid numbers. Add all six:

- Total at most 148: LOW.
- Total 149 through 151: SKIP (middle range).
- Total at least 152: HIGH.
- Four or five Bet49 numbers, inactive Bet49, or invalid selection: SKIP.

This replaces the rolling-history High/Low signal for newly issued predictions.
The old helper remains available for historical/offline callers only. All live
surfaces (Telegram, website and extension) consume the same issued status and
range. Unified eligibility also respects the High/Low ACTIVE status. Existing
saved predictions are not rewritten, and their results use the original pick.
Actual draw settlement thresholds and extension recovery settings are unchanged.

Deploy the bot worker to generate the new predictions. The existing website and
extension already support High/Low SKIP; no extension update is needed.
