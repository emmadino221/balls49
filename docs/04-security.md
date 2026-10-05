# Security and Runtime Data Handling

## Application boundaries

The project has a private automation worker, a React website/API, and a Chrome extension. Local extension routes use a browser `clientId` for session routing; this is separate from website account authentication and must not be treated as a password or a strong public identity.

Public website mode exposes an explicit allowlist of account, admin, read-only prediction routes, and the HMAC-authenticated worker snapshot endpoint. Betting and extension routes such as `/stream`, `/ack`, `/config`, `/reset`, and `/update-balance` must remain on the private worker. Public deployments require HTTPS, the exact `SITE_ALLOWED_ORIGINS`, persistent SQLite storage, and one worker process.

## Secrets

- The Node worker reads `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID` from its environment for channel broadcasts; personal Telegram destinations are configured separately for user sessions. The optional standalone `bot.py` sequence-calculator bot also reads `TELEGRAM_BOT_TOKEN`.
- `SITE_ADMIN_KEY`, `PREDICTION_INGEST_SECRET`, and optional `GOOGLE_SHEET_URL` belong only in server/worker environment configuration.
- `RESEND_API_KEY` belongs only in the hosted API environment. The API sends one-time, expiring email-verification links before creating or approving member accounts.
- Never put server secrets in source code, the extension, website code, or `VITE_*` build variables.
- Rotate any credential that may have been committed or shared.

## User and runtime data

Website password hashes, accounts, sessions, and public-feed snapshots are stored in SQLite. Local automation, draw history, prediction history, model state, and unsent Telegram predictions use local runtime files, including `telegram_prediction_outbox.json`. Cookies and runtime files must remain private and ignored by Git. Back up account databases and worker state securely; do not upload them with source.

The Telegram prediction outbox stores unsent pick-message text and retries it with backoff. Keep that file on the private worker's persistent storage. After delivery, the queued message is removed. A worker restart can resend a message if Telegram accepted it but the worker did not record the acknowledgement; occasional duplicates are therefore possible.

## Operational protections and remaining risks

- Validate API input and market/step/stake values on the server.
- Keep session authorization and prediction access checks server-side.
- Do not trust unverified browser identity or forwarding headers.
- Extension DOM selectors target a third-party game page and may change; test selectors and acknowledgement behavior before live use.
- Martingale progressions can grow quickly. Max-step and stop-loss settings are independent safeguards; stake calculators are estimates, not guarantees.
- Monitor bot tick failures, Telegram delivery logs/outbox growth, prediction settlement, extension acknowledgements, and persistent-storage availability.
