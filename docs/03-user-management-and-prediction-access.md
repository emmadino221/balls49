# Website Accounts, Market Access, and Personal Stake Plans

## Two separate identity/session systems

The website account system and extension automation sessions are separate:

- Website accounts use email/password authentication, salted password hashes, SQLite-backed users/sessions, and an HttpOnly session cookie. `publicAccount()` derives the current plan from the server-side user record.
- The local browser extension uses a `clientId` to route automation configuration, statistics, acknowledgements, and betting instructions in `bot.js`; it is not the website login identity.

The extension automation routes include `/stream`, `/ack`, `/config`, `/stats`, `/reset`, and `/backtest`. Keep the local worker private and on loopback. Public hosting mode allowlists website/account APIs and the signed prediction-ingest route, not extension execution routes.

## Website access and plans

New accounts are created only after the user opens a time-limited email verification link and sets a password. Login, personal stake plans, and owner plan approval require a verified email address. Accounts can then be approved for Trial, Premium, or Elite. Trial users choose one market on the Free Trial page; the pick is revealed during the final ten seconds. Premium access is limited to the markets selected for that account, while Elite includes all seven public markets. Owner preview is bound to the owner's authenticated browser session and does not change user accounts.

The public API checks the session and plan server-side before revealing paid-market live picks. `/public-history` serves settled public history and `/public-clock` serves the current clock; `/public-current-prediction` applies market access and reveal rules.

## Personal stake plans

Authenticated users can save stake plans at:

- `GET /account/stake-plans` — returns the signed-in user's plans and reconciles settled prediction results.
- `POST /account/stake-plan` — saves/locks or unlocks one market's base amount.

Each plan is stored in that user's SQLite-backed user record and is independent per market. A win resets its step to 1, a loss advances it, and a skip does not change it. Locking a changed base amount starts a new Step 1 sequence. The Predictions page displays the calculated next stake as guidance only; it does not place a bet and does not alter the extension's configured stakes or automation state.

## Operational security

- Never treat the extension `clientId` as a website account credential.
- Keep authorization decisions in the server; do not rely on hidden UI controls.
- Do not expose local automation routes to the public internet.
- Use HTTPS, persistent SQLite storage, an exact `SITE_ALLOWED_ORIGINS` allowlist, and the signed worker-to-site feed for public hosting.
- Keep the admin key, Telegram token, database, cookies, and runtime state out of source control.

For environment setup, approval steps, and deployment details, see `SITE_ACCESS_SETUP.md` and `DEPLOYMENT_GUIDE.md`.
