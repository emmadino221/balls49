# Balls49 Current Frontend and Web Asset Structure

## Current Workspace Shape

The project now has a hybrid structure:

- A Node bot runtime in `bot.js`.
- A browser automation extension in `balls49-extension/`.
- A static HTML/CSS/JS web surface in `web/`.
- A Python retrainer in `ml_retrainer.py` that writes the artifact `ml_retraining_model.json`.
- Runtime data files such as `predictions.json`, `draws.json`, `session_state.json`, and `streaks.json`.

The frontend is therefore not a single monolithic product page. It is split between:

1. A Chrome extension workflow for live automation and DOM execution.
2. Static web HTML pages under `web/` for UI screens, dashboard-like pages, backtesting, strategy explanations, and marketing/product pages.

## Current Web and Extension Assets

### Browser Extension Folder

`balls49-extension/` contains:

- `content.js` — reads `/stream`, executes bet instructions, places DOM actions, and overlays the live page.
- `background.js` — handles extension messaging and background events.
- `manifest.json` — extension manifest and permissions.
- `popup.html`, `popup.js` — local UI and options exposure.

### Static Web Pages Folder

`web/` contains page HTML and styling assets such as:

- `dashboard.html`
- `predictions.html`
- `strategy.html`
- `history.html`
- `backtest.html`
- `betzero.html`
- `hilo.html`
- `rainbow.html`
- `pricing.html`
- `settings.html`
- `calibration.html`
- `total-color-2way.html`
- `total-color-3way.html`

The associated CSS/JS files are in the same folder and should be treated as the current web UI assets.

## What the App Should Present

The design direction should present a clear automation, strategy, and prediction telemetry product. The UI is organized around three views:

1. Live automation status and pending payload delivery.
2. Prediction and statistical history.
3. Strategy, calibration, and risk configuration.

## Required Page/Experience Categories

### 1. Dashboard and Automation

- Current automation status and last processed draw.
- Active markets, stakes, ML score, cooldown, and session state.
- Exposure, stop-loss, take-profit, and active strategy flags.

### 2. Prediction and History

- Prediction rows, draw IDs, market decisions, and result outcomes.
- Historical review of `predictions.json` and `ml_retraining_model.json`.

### 3. Strategy and Calibration

- Market selection, confidence scoring, and adaptive long-run calibration.
- Display model bias and rolling window metrics from the retrainer file.

### 4. Extension UI and Local Browser Controls

The extension popup and content script remain the operational browser control layer for receiving and executing the live payload.

## Current Architecture Fit

The design files should not describe a future product-only dashboard. They should describe the present project structure:

- `bot.js` is the orchestration server.
- `ml_retrainer.py` + `ml_retraining_model.json` form the artifact-based retraining layer.
- `web/` holds the visible static page experience.
- `balls49-extension/` holds the browser automation implementation.

The design should therefore remain realistic and implementation-aware instead of promising a full app architecture that does not exist yet.
- Provide a collapsible sidebar or mobile navigation.

## Current Integration

The extension currently uses `popup.html` and `popup.js` for controls and `content.js` for live page interaction. The backend is reached through `http://localhost:3001` using endpoints such as `/config`, `/stats`, `/stream`, `/ack`, `/reset`, and `/backtest`.

## Frontend Improvements Needed

- Replace inline styles with a shared design system.
- Add structured API loading and error states instead of silent failures.
- Escape or safely render backend-provided text before inserting HTML.
- Add component and responsive browser tests before a web dashboard launch.
