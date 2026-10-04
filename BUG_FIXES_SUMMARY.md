# Current Runtime Reliability Notes

This document describes behavior in the current code, rather than the earlier line-numbered bug checklist. Line numbers and configuration limits change; use the source as the implementation authority.

## Telegram prediction delivery

Prediction and draw-result broadcasts are separate messages correlated by draw ID. The worker stores each pick in `telegram_prediction_outbox.json` before sending it to the channel. Telegram API rejections and network/timeouts are logged and the worker retries queued predictions with backoff. The outbox is runtime state and is excluded from source control. A result may arrive before a temporarily delayed pick retry; delivery acknowledgement loss can also lead to a duplicate retry.

Configure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID` on the worker. The bot must have permission to post in the target channel. Missing configuration disables channel broadcasts and is reported at startup.

## Prediction and website behavior

- Each prediction and result is associated with a draw ID.
- Current-prediction responses include the logged prediction update time; the website formats it in the visitor's locale.
- The website provides a per-account, per-market locked base stake and recommended martingale amount. Settled losses advance that personal plan, wins reset it to Step 1, and skips do not alter it.
- Website personal stake plans are guidance only and are separate from extension automation settings.
- Bet49 is a standalone one-number market. Its win condition is that the selected number appears in the next draw.

## Validation expectations

For bot or extension JavaScript changes, run `node --check` on the changed files. For website changes, run `npm run build` from `web/`. Run `git diff --check` before publishing. Syntax/build checks do not validate live third-party page selectors or actual Telegram permissions; those require deployment-level smoke checks.
