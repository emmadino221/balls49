# Balls49 Prediction Logic and Current Model Signals

## Current Implementation Source

The current prediction engine lives in `bot.js`. It reads local draw history and prediction objects, then writes a prediction record to `predictions.json` and a result record back into the same structure when a draw is resolved.

The new retraining artifact path is handled by `ml_retrainer.py`, which reads `predictions.json` and writes `ml_retraining_model.json` with rolling window rates and a feature-vector summary per market.

## Runtime Files

The current live and persistent files include:

- `draws.json` — normalized draw history.
- `predictions.json` — prediction output and recorded results.
- `last_prediction.json` — last prediction snapshot.
- `streaks.json` — streak bookkeeping.
- `win_steps.json` — step-wise win tables.
- `ml_streaks.json` — machine learning/streak bookkeeping.
- `ml_retraining_model.json` — retraining artifact with bias, rolling rates, and feature vectors.

## Prediction Flow

1. The collector fetches historical draw data and saves normalized draw records into `draws.json`.
2. The bot reads `draws.json` and current draw metadata.
3. `computePredictions()` or the equivalent prediction generation path in `bot.js` creates `u4`, `color`, `sum`, and `totalColor` predictions.
4. The predictions are stored in `predictions.json` with `predicted`, `steps`, `mlScores`, and `brainData` payloads.
5. On the matching draw result, `processUpdates()` writes `result` data such as `WIN`, `LOSS`, and `SKIP` across each market.
6. `scheduleRetrainingRefresh()` triggers the Python retrainer at sample milestones 10, 50, and 100.

## Market Logic

### BetZero (`u4`)

The live bot still uses a number-selection strategy that reads draw and frequency structuring. The market output is represented in `predicted.betzero` and the outcome is stored as `result.betzero`.

### Rainbow (`color`)

The market output is represented in `predicted.rainbow`, and the result field is `result.rainbow`.

### Hi/Lo (`sum`)

The market output is represented in `predicted.hilo`, and the result field is `result.hilo`.

### Total Color (`totalColor`)

The market output is represented in `predicted.totalColor`, and the result field is `result.totalColor`.

## ML and Calibration Layer

The confidence path in `bot.js` currently blends:

- adaptive long-run calibration based on the prediction log,
- `getRetrainedModelBias()` from `ml_retraining_model.json`, and
- market-specific confidence heuristics from `brainData`.

The retrainer writes `bias`, `winRate10`, `winRate50`, `winRate100`, and `featureVector` fields into `marketModels` keyed by `u4`, `color`, `sum`, and `totalColor`.

## Historical Calibration Model

The current long-run improvement design is artifact-driven rather than a dependency-heavy ML package. It performs rolling-window observation and writes a bias and feature summary into `ml_retraining_model.json`.

This means the architecture is currently:

- `bot.js` reads the artifact bias and uses it in the confidence score path.
- `ml_retrainer.py` computes the rolling-rate and feature-vector summaries.
- `scheduleRetrainingRefresh()` refreshes the artifact automatically at draw-length checkpoints.

The future direction is to replace the heuristic JSON artifact with a learned model stack if Python dependencies such as `numpy` and `scikit-learn` are available in the workspace interpreter.
- The backtest reproduces the current simulator rules, not the randomness or execution conditions of the betting platform.
