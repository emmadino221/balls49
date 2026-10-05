# Website accounts, manual approvals, and plan previews

## Start the site with owner access enabled

The API reads `SITE_ADMIN_KEY` from the environment. Set it in the same PowerShell window that starts the bot:

```powershell
$env:SITE_ADMIN_KEY = "use-a-long-random-secret-here"
node .\bot.js
```

Keep the admin key private. Do not paste it into `bot.js`, React files, screenshots, or public website settings. If you want it available in future PowerShell windows, use `setx SITE_ADMIN_KEY "your-long-random-secret"`, then open a new terminal before starting the bot.

Open Predictions on the website, expand **Site owner tools**, enter the key, and choose **Preview Free Trial**, **Preview Premium**, or **Preview Elite**. The preview applies only to your owner browser session. Premium preview uses the checked markets; Elite previews all seven.

## Approve an account

The person enters their name and email at **Sign up**, opens the verification link sent to that inbox, and chooses a password on the verification page. Only after confirming mailbox access is the account created and listed in **Site owner tools**. Select that verified account email, choose Free Trial, Premium, or Elite, set the duration, and save. Premium needs at least one checked market. Elite includes all seven markets and is marked with Telegram access. User records and salted password hashes are stored in `site_users.sqlite`.

### Configure signup verification email

The hosted Node service sends verification messages through Resend. Verify a sender domain with Resend first, then set these values in the **`emmybet` Node Web Service → Environment** settings in Render:

```text
RESEND_API_KEY=<Resend API key>
SITE_EMAIL_FROM=Emmy-Bet <no-reply@your-verified-domain.example>
SITE_PUBLIC_URL=https://balls49.onrender.com
```

Keep `RESEND_API_KEY` only in the backend environment; it must never be a `VITE_*` variable. `SITE_EMAIL_FROM` must use an address on a domain verified with Resend. Save and redeploy the Node service after setting these values. Signup and verification links will not work until email delivery is configured. Existing accounts created before email verification was enabled must request a verification email from the sign-in page; their existing plan data is preserved, but login and plan approval remain blocked until the email is verified.

## Notes

- The first start after the SQLite update imports existing accounts from `site_users.json` in a transaction. The JSON file is left untouched as a backup; after import, the SQLite database is the source of truth.
- The new SQLite session store keeps login cookies valid across bot restarts. Existing browser sessions created before this update must sign in once after the restart because they were held only in memory.
- Stop the bot before copying the database for a backup, and copy `site_users.sqlite` plus any `site_users.sqlite-wal` or `site_users.sqlite-shm` files. Keep these files private and do not upload them to a public repository.
- The built-in SQLite module requires a recent Node runtime; use Node 24.x, as in the current development setup. Set `SITE_DB_PATH` to an absolute path on persistent storage when deploying so a host restart or redeploy does not discard accounts and sessions.
- This standalone bot server uses HTTP. Keep it on your own machine or behind HTTPS before accepting real users or sending the admin key over a network. The current site still offers the limited public Free Trial reveal; account approval unlocks paid-market access through the authenticated API.
- Elite Telegram access is recorded as a plan entitlement here. Automatic Telegram channel membership/invite delivery is not connected yet and must be handled manually.
- The separate Free Trial page lets a visitor choose one market, then reveals it during the final 10 seconds before the draw.
- Signed-in users can lock a separate personal base stake for each accessible market on the Predictions page. Settled losses advance that personal plan, wins reset it to Step 1, and skipped picks leave the step unchanged. The displayed stake is guidance only; it does not place a bet or configure the extension.
- In local mode, the API accepts browser requests from the Bet9ja game page and Chrome extension pages so the browser extension can receive live signals. Keep the API on loopback; the extension and bot need to run on the same computer.
- Prediction broadcasts read `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID` when `bot.js` starts. Add the bot as an administrator with permission to post in the channel. Pick messages are written to the worker's `telegram_prediction_outbox.json` before delivery; failures are logged and retried with backoff. Keep this local runtime file on persistent storage and out of source control. A result can arrive while its pick is waiting for a retry.

## Public hosting boundary

The bot and website API share `bot.js`. Keep the normal local mode for your current desktop automation. For local website access, Vite proxies `/api` requests to the bot API on loopback, so the API does not need to be exposed on your LAN. When hosting the API for the website, set these server environment variables:

```text
SITE_PUBLIC_MODE=true
SITE_ALLOWED_ORIGINS=https://your-real-site.example
SITE_ADMIN_KEY=<long-random-secret>
PORT=<provided-by-your-host>
SITE_DB_PATH=<absolute-path-on-persistent-storage>/site_users.sqlite
```

`SITE_PUBLIC_MODE=true` exposes only the website account, admin, public history, public clock, plan-filtered current-prediction routes, and the signed `POST /internal/prediction-snapshot` endpoint. It hides automation controls such as `/stream`, `/config`, `/reset`, `/ack`, `/global-config`, and `/update-balance`. The browser extension stays connected to the private worker at `http://localhost:3001`; set `PREDICTION_INGEST_URL` on that worker to the hosted API's HTTPS ingestion URL, and set the same randomly generated `PREDICTION_INGEST_SECRET` (at least 32 bytes) on both worker and hosted API. Do not expose the local API port to the internet. Public mode binds to `0.0.0.0` by default. `SITE_ALLOWED_ORIGINS` must be the exact origin of the deployed site (scheme and hostname, with a port only if needed), separated by commas if there are multiple trusted sites.

Set the frontend build variable `VITE_HISTORY_API_URL` to the deployed API's `/public-history` URL; the frontend derives the API base URL from it. Never put `SITE_ADMIN_KEY`, the Telegram token, or other server secrets in a `VITE_*` variable or frontend code.

Public mode requires HTTPS: its authentication cookie is HttpOnly, Secure, and SameSite=None so a separately hosted website can send it, while state-changing requests are restricted to the configured website origin. Local mode uses a Lax cookie and remains on loopback.

After this cookie change, users of the previous browser-token version must sign in once again. The app removes its old account/admin tokens from local storage; future sessions are kept in the HttpOnly cookie.

The API now throttles signups per source IP, login attempts per source IP and email, and owner-key attempts per source IP. If a hosting proxy combines visitor IPs, configure additional rate limits at that trusted edge; the app does not trust client-supplied forwarding headers. SQLite now provides durable account and session storage, but a public launch still needs a persistent host volume for the database and a deployment setup that runs the prediction/bot worker exactly once. Keep using private test accounts until those hosting requirements are in place.
