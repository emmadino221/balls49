# Prediction, Settlement, and Stake Progression

## Sources of truth

`bot.js` computes predictions, tracks market steps, settles outcomes, serves the local automation/API routes, and sends Telegram channel messages. `collector.js` gathers draw data. In local-worker mode, predictions/results are persisted in `predictions.json`, the active prediction is checkpointed in `last_prediction.json`, and tracker/session data is stored in files such as `session_state.json` and `streaks.json`. In public-site mode, sanitized prediction feed/history snapshots are persisted in SQLite. These runtime and account files are private and must not be committed.

The `ml_retrainer.py` script consumes prediction history and writes the optional `ml_retraining_model.json` artifact. The model/confidence layer is a heuristic and historical calibration aid; it does not guarantee future results.

## Markets and results

The public prediction/history surfaces expose seven markets:

| Public market | Prediction/result keys | Rule summary |
|---|---|---|
| BetZero | `betzero` | Select four numbers; win if none appear in the draw. |
| Bet49 | `bet49` | Use the last 10 consecutive completed draws. Use the two colors in the same draw's active Total Color 2-way prediction, and take up to six most-recent numbers from those colors that appeared at least twice. Skip whenever Total Color 2-way skips. Skip if fewer than four qualify. Any selected number appearing wins. Each number is a separate 7.80-odds bet. |
| Rainbow Color | `rainbow` | Win when at least two drawn balls match the selected color. |
| Total Color (3-way) | `totalColor` | Exclude the previous completed outcome; pick the other three of Red, Blue, Green and DRAW. No frequency selection. |
| Total Color (2-way) | `totalColor2` | Select two colors; a tie outcome is represented as black. |
| High/Low | `hilo` | Use weighted 20/50/100-draw HIGH/LOW counts, with LOW on ties. Always pick with valid history; MID loses for either side. |
| Unified | `unified` | A wrapper around the chosen supported market; its result follows that market. |

Skipped/inactive picks settle as `SKIP` and are not wins or losses. Bet49 is an independent market and is not a target in the extension's Unified automation strategy.

Bet49 breaks equal absence streaks by choosing the lowest number, so the same draw history always produces the same initial pick. Its active target and the draw ID from which it is being tracked are saved with the global tracker, allowing the pick to survive worker restarts and absences longer than 100 draws. After a hit, it selects a new target using the longest current absence in the latest 100 draws.

## Draw lifecycle

1. The worker reads current draw metadata and draw history, then computes the next-draw predictions.
2. It creates or updates one prediction record per draw ID and checkpoints the current prediction.
3. The Telegram pick is placed in a persistent `telegram_prediction_outbox.json` queue before delivery. Failed delivery is logged and retried with backoff; the outbox is local runtime state and is ignored by Git.
4. When the matching draw is available, the bot settles each active market, updates tracker steps and historical records, and publishes the draw result separately to Telegram.
5. The website's public API exposes settled history and a plan-filtered live pick. The current-prediction payload includes `lastUpdated`, sourced from the logged prediction timestamp.

Because the pick and result are separate Telegram messages, the draw ID in each heading is the correlation key. If a prediction message is temporarily undeliverable, the bot retries it; a result may still be delivered while retry is pending.

## Martingale calculations

The website calculator and personal prediction stake planner use their market-specific recovery formulas. Odds-based markets use their configured odds (Bet49 uses 7.80); High/Low has a multiplier progression; Total Color markets account for their two-/three-way stake exposure. Bet49's website calculator increases its profit target by one base stake per additional step, by design. The extension/bot Bet49 automation uses its separate 7.80-odds recovery progression, so the website Bet49 calculator/planner and automated Bet49 stake may differ after Step 1.

The website personal stake planner is distinct from extension automation and global bot tracking. Each signed-in account can lock a separate base stake per accessible market. For each locked plan, a settled loss advances the step, a win resets it to Step 1/base stake, and a skip leaves the step unchanged. The backend reconciles new settled history when plans are loaded; changing/unlocking and locking a base stake starts a new Step 1 sequence. The recommendation is informational only and never submits a bet.

Configured max-step and stop-loss safeguards remain relevant to automation. Removing the former hard-coded 30-step ceiling does not disable a configured risk limit.

The calculator accepts step counts beyond the former 30-step ceiling. For large requests it keeps the summary calculation but shows only the first 100 and final 20 calculated rows, with an omission marker between them. If values exceed JavaScript's finite numeric range, it reports the first unrepresentable step instead of iterating or rendering indefinitely.

## Max-loss reset periods

The shared website/Telegram maximum-loss tracker starts from the configured reset timestamp and evaluates a result's `settledAt` time. New settlements record that time so a prediction created before a reset but settled afterward belongs to the new period. Older historical records without a settlement timestamp fall back to their prediction timestamp and cannot be classified exactly around an earlier reset.

## Confidence and backtests

`ml_retrainer.py` writes rolling historical summaries used by the bot's confidence/calibration path. Backtests reproduce the simulator's market/stake rules against historical records; they do not reproduce the betting platform's randomness, delays, DOM changes, or payout conditions. Historical performance is not a promise of future results.

## Selection update ? 20 October 2026

See [the selection rules](../SITE_ACCESS_SETUP.md#highlow-rolling-analysis-without-signal-based-skips) for weights, data validation and missing-data handling. These rules change future picks only. Existing martingale and automation gates remain in force. No accuracy improvement has been established through testing.


### Bet49 multi-number execution

- Requires 10 consecutive valid completed draws before the target. Draw order in the input does not affect selection.
- Use exactly the two colors from the same draw's active Total Color 2-way prediction. Skip if that prediction is missing, skipped, or has invalid colors. There is no separate dominant-color calculation for Bet49. Number 49 remains mapped to yellow and is not eligible for a red/blue/green pair.
- Within the two selected colors, numbers must appear at least twice. Take up to six by latest draw appearance; equal-recency numbers use ascending number order. Fewer than four means SKIP.
- A published WIN means any predicted number appeared. Session settlement uses only the numbers submitted by that extension. Multiple hits each pay 7.80 times the per-number stake.
- The configured Bet49 stake is per number. Total exposure is the number count times that stake. Recovery uses actual prior cycle costs divided by (7.80 minus the current number count), plus the cycle's initial one-hit profit target; amounts round up. Flat mode keeps the configured stake per number. A win clears Bet49 recovery.
- Website stake estimates assume a constant current pick count. The calculator has explicit 4-, 5-, and 6-number choices. Preset budgets reserve for six numbers. Legacy Bet49 backtests are unavailable because their single-number accounting is incompatible.
- Reload the updated extension before using the new backend. Old extensions receive WAIT for multi-number batches. Each number is selected, submitted, and cleared separately; the extension checks the remaining draw window between bets.
- A partial batch stops automation and reports submitted numbers without replaying the entire instruction. An unconfirmed submission is treated as potentially placed for conservative accounting, flagged in the receipt, and stops the batch. Check the provider's bet slip and balance before resuming; browser balance changes alone are not a definitive bet receipt.
- Existing single-number history remains readable. Legacy recovery costs are estimated from the saved step and configured base stake when no recorded cycle costs exist. No accounts or prediction history are cleared by this update.


### Rainbow follows Bet49

Live Rainbow 2+ uses the most common color among the current Bet49 selected numbers (each selected number contributes one vote). A tied highest count or a skipped Bet49 prediction makes Rainbow SKIP. It does not fall back to an older color or the previous adaptive selector. Total Color 2-way is computed first using its existing rule, then Bet49, then Rainbow; a Rainbow skip does not overwrite Total Color 2-way. Old extension strategy filters no longer gate Rainbow entries. Settlement remains a win when at least two balls of the predicted color appear in the actual draw. Historical records are unchanged.
