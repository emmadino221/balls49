# Complete Balls49 Runtime Workflow

## Components

- `collector.js` and the draw API provide current draw metadata and history.
- `bot.js` computes and settles the seven public markets, serves local automation and website APIs, and sends Telegram channel messages.
- `bot.py` is a separate Telegram martingale/sequence calculator bot; it does not publish the prediction feed or settle draw outcomes.
- `balls49-extension/` receives local instructions, carries out the selected market's browser actions, acknowledges execution, and renders the overlay.
- `web/` is a React/Vite site for predictions, history, Free Trial, market guide, calculator, pricing, and accounts.
- `ml_retrainer.py` optionally derives a calibration artifact from settled prediction history.
- Local JSON files persist worker state; SQLite stores website users/sessions and hosted prediction-feed state.

## Prediction and result lifecycle

1. The worker reads the draw clock and historical data, then computes BetZero, Bet49, Rainbow, both Total Color markets, High/Low, and Unified.
2. The prediction is recorded against a draw ID and checkpointed before delivery.
3. Telegram picks and draw results are separate channel messages. Picks are stored in the local `telegram_prediction_outbox.json` before the first send and retried with backoff when Telegram rejects or cannot receive them. Correlate both messages by draw ID.
4. The matching draw settles the stored prediction as `WIN`, `LOSS`, or `SKIP`. Active loss steps are advanced/reset according to the market tracker; skips do not represent losses.
5. Public site history/clock/current-prediction data is served from local state or the sanitized public feed. Live picks remain subject to access and reveal timing; `lastUpdated` is the logged prediction timestamp.

## Extension execution

The extension connects to the private worker on `http://localhost:3001`, receives `/stream` instructions, validates the active market and stake, performs DOM actions, and posts `/ack`. Bet49 has its own single-number flow and is not a Unified automation target. Extension settings and progression are distinct from personal stake plans saved by website accounts.

Do not assume DOM selectors are stable across changes to the third-party betting page. Verify the flow manually before enabling live automation.

## Website accounts and personal stake plans

Website accounts use the authenticated account/session API. Market access is checked on the server. A signed-in user may save a separate base amount for each accessible market; settled losses advance that plan's step, wins reset it, and skips leave it unchanged. The site-calculated amount is guidance only and does not create or execute extension bets.

## Deployment modes

- **Local mode:** bot, website API, and extension run on the user's machine; Vite proxies API requests to the bot.
- **Public website mode:** host the React build and account/public API behind HTTPS, persistent SQLite storage, and an exact origin allowlist. A single private worker publishes sanitized snapshots using HMAC-signed HTTPS requests. Keep `/stream`, `/ack`, and all betting controls private.

## Operational checks

- Verify that the current draw ID and prediction ID match.
- Confirm the prediction record exists before relying on its later settlement/result.
- Check bot logs and the Telegram outbox if a pick message is missing; the result can be delivered while the pick is awaiting retry.
- If `streaks.json` is empty, the worker rebuilds streak summaries from `predictions.json` and logs the recovery. Other malformed persistence files remain fatal so corrupted state is not silently discarded.
- Check extension acknowledgement and overlay state before trusting automated placement.
- Keep runtime JSON, outbox messages, SQLite files, cookies, and credentials out of version control.
- Validate changes with Node syntax checks, extension syntax checks, a Vite production build, and focused Python tests as applicable.
