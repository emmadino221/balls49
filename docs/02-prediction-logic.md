# Prediction, Settlement, and Stake Progression

## Sources of truth

`bot.js` computes predictions, tracks market steps, settles outcomes, serves the local automation/API routes, and sends Telegram channel messages. `collector.js` gathers draw data. In local-worker mode, predictions/results are persisted in `predictions.json`, the active prediction is checkpointed in `last_prediction.json`, and tracker/session data is stored in files such as `session_state.json` and `streaks.json`. In public-site mode, sanitized prediction feed/history snapshots are persisted in SQLite. These runtime and account files are private and must not be committed.

The `ml_retrainer.py` script consumes prediction history and writes the optional `ml_retraining_model.json` artifact. The model/confidence layer is a heuristic and historical calibration aid; it does not guarantee future results.

## Markets and results

The public prediction/history surfaces expose seven markets:

| Public market | Prediction/result keys | Rule summary |
|---|---|---|
| BetZero | `betzero` | Select four numbers; win if none appear in the draw. |
| Bet49 | `bet49` | Select one number; win if it appears in the draw. |
| Rainbow Color | `rainbow` | Win when at least two drawn balls match the selected color. |
| Total Color (3-way) | `totalColor` | Select two colors and an excluded color; settlement follows the documented top-color/tie rule. |
| Total Color (2-way) | `totalColor2` | Select two colors; a tie outcome is represented as black. |
| High/Low | `hilo` | Win when the predicted draw-total range matches the actual range. |
| Unified | `unified` | A wrapper around the chosen supported market; its result follows that market. |

Skipped/inactive picks settle as `SKIP` and are not wins or losses. Bet49 is an independent market and is not a target in the extension's Unified automation strategy.

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
