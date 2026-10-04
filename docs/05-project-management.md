# Project Structure and Release Workflow

## Source layout

```text
balls49/
  bot.js                       # prediction engine, local API, settlement, Telegram, account/public API
  collector.js                 # draw collection
  bot.py                       # standalone Telegram martingale/sequence calculator bot
  ml_retrainer.py              # historical calibration artifact generator
  balls49-extension/           # Manifest V3 popup, background worker, and game-page content script
  web/                         # React/Vite site and shared styles
  docs/                        # architecture, access, prediction, safety, and workflow docs
  test_ml_retrainer.py         # retrainer tests
```

Runtime state includes local JSON files such as `draws.json`, `predictions.json`, `last_prediction.json`, `session_state.json`, streak/step files, and `telegram_prediction_outbox.json`. Website accounts, sessions, and public prediction-feed state use SQLite. These are environment/runtime data, not source artifacts; `.gitignore` keeps them out of commits.

## Runtime responsibilities

- The private worker (`bot.js` plus `collector.js`) computes predictions, settles outcomes, manages local extension automation, and sends separate Telegram picks/results.
- `bot.py` is a separate Telegram sequence-calculator bot; it is not the prediction/settlement worker and reads `TELEGRAM_BOT_TOKEN`.
- `telegram_prediction_outbox.json` durably queues unsent channel pick messages; the worker retries delivery. Do not delete a live outbox file unless intentionally discarding queued messages.
- The React/Vite website reads account, clock, current-prediction, and history APIs. Local Vite configuration proxies API calls to the bot.
- In public hosting mode, the hosted API serves the website and receives signed sanitized snapshots from one private worker. Do not run public automation routes.
- The browser extension connects to the private worker and performs betting-page DOM interactions; it is not the website account system.

## Development and release checks

1. Inspect `git status` and keep runtime state/secrets out of the change set.
2. Run `node --check bot.js` and `node --check` on changed extension scripts.
3. Run `npm run build` from `web/`.
4. Run the focused retrainer tests when Python retraining code or artifacts change.
5. Validate changed DOM selectors manually on the supported game page; third-party site selectors cannot be validated by syntax checks.
6. Review the final diff, update these docs for route/schema/behavior changes, and preserve existing runtime data.
7. Back up persistent SQLite/state before migrations and confirm deployment runs exactly one prediction worker.

Keep the extension and website behavior aligned with the server's seven public market keys and access rules. Distinguish website-only personal stake plans from extension stake configuration and bot-global loss tracking.
