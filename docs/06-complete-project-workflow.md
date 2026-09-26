# Complete Balls49 Workflow: Current Implementation View

## System Components

The current workspace contains these runtime and UI components:

1. `collector.js` fetches, normalizes, and writes draw history into `draws.json`.
2. `bot.js` is the main Node orchestration runtime and prediction/confidence server.
3. `ml_retrainer.py` reads `predictions.json` and writes `ml_retraining_model.json`.
4. `balls49-extension/content.js` receives `/stream` instructions and performs the DOM automation.
5. `balls49-extension/background.js` and `popup.js` expose extension UI and messaging.
6. The `web/` folder contains static HTML pages for dashboard, pricing, strategy, history, backtesting, and market pages.
7. The JSON files persist state, results, predictions, steps, streaks, and session state.

## Startup Flow

1. Set environment variables for `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` if needed.
2. Run `python ml_retrainer.py predictions.json ml_retraining_model.json` when you want to refresh the artifact from `predictions.json`.
3. Start the Node server with `node bot.js`.
4. Load the `balls49-extension/` directory in Chrome for the DOM automation bridge.
5. Open the static pages from `web/` for the UI/marketing/strategy surface.

## Draw Collection and Normalization

1. `collector.js` reads the current draw history and records it into `draws.json`.
2. New records are deduplicated.
3. The draw numbers, total, range, and color data are normalized and added into the local draw log.
4. The server maintains prediction and result records based on this stored draw history.

## Prediction and Result Cycle

1. `bot.js` reads the current draw and prediction context.
2. It computes or selects the prediction for the active markets `u4`, `color`, `sum`, and `totalColor`.
3. It writes the prediction record into `predictions.json`.
4. `processUpdates()` compares the live draw result against the stored prediction and writes `WIN`, `LOSS`, or `SKIP` results into the same record.
5. `predictionLog` is updated, and `scheduleRetrainingRefresh()` then checks whether the history has hit a 10/50/100 refill milestone.
6. The retrainer is invoked and writes the refreshed `ml_retraining_model.json` file.

## Automation and Extension Execution

1. `content.js` opens the `/stream` event path and polls for instructions.
2. The server provides a pending `EXECUTE_BET` payload only when a positive-stake active market exists.
3. The extension reads the payload and performs the required DOM actions.
4. `/ack` records whether the action is confirmed or failed.
5. The browser overlay and UI can show local runtime and confidence state.

## Long-Run Improvement Layer

The system currently records predictions and results, then computes a historical artifact for calibration:

- `ml_retrainer.py` computes rates across windows 10, 50, and 100.
- `ml_retraining_model.json` stores `bias`, `winRate10`, `winRate50`, `winRate100`, and `featureVector` fields.
- `bot.js` reads `marketModels` and uses `getRetrainedModelBias()` for the confidence pass.

This gives the project a working artifact refresh loop even without a full ML dependency stack.

## Operational Workflow

When the system is running:

1. Confirm draw collection is producing new records.
2. Confirm `bot.js` is processing the same draw correctly.
3. Confirm `predictions.json` and `session_state.json` are updating.
4. Confirm the retrainer file is refreshed at the milestone window size.
5. Confirm the browser extension is receiving the `EXECUTE_BET` payload from `/stream`.
6. Confirm the result cycle updates `predictions.json` with `WIN`/`LOSS`/`SKIP` values.

## Recovery and Safety

The local implementation should stop or pause automation when:

- stop-loss or take-profit is reached,
- a pending payload is stale,
- a balance mismatch is detected,
- the payload gate fails due to a missing market or non-positive stake,
- or the extension is unable to execute the selected DOM route.

Recovery should only proceed after verifying that draw IDs, market selection, and payload state remain consistent.
