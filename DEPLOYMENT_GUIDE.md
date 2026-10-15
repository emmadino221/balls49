# Public Hosting Readiness

## Current status

The website can be built as a static Vite frontend (`cd web; npm ci; npm run build`). The API and prediction automation run from `bot.js` and use Node's built-in SQLite module. A production API needs Node 24.x, HTTPS at the host or trusted reverse proxy, and persistent storage for `SITE_DB_PATH`.

The project now has a private worker-to-site feed. The extension remains connected to the local worker at `http://localhost:3001`; that worker sends a sanitized prediction, draw clock, and history snapshot to the hosted API over HTTPS. In `SITE_PUBLIC_MODE=true`, the hosted API rejects automation routes such as `/stream`, `/ack`, `/config`, and `/update-balance`. It accepts only the HMAC-authenticated `POST /internal/prediction-snapshot` feed plus website routes, including authenticated per-account stake-plan routes. The public API stores the latest feed in SQLite and hides live predictions when the draw clock goes stale.

Do not expose the local API port to the internet or put the Telegram token, admin key, cookies, or account database in frontend files or a public repository.

## Before selecting a host

Deploy the website API first, then configure the worker's `PREDICTION_INGEST_URL` to its exact HTTPS `/internal/prediction-snapshot` route. Set the same randomly generated `PREDICTION_INGEST_SECRET` (at least 32 bytes) on both services. The worker sends signed, timestamped requests; the hosted service rejects requests without a valid signature, requests older than one minute, and snapshots older than the latest stored version. Clock/current data is sent every five seconds. History is synced in batches of up to 1,000 changed draws, so the initial 16,000+ local records take multiple updates; later requests contain only new or changed draws.

The deployment will also need:

- A persistent volume for `site_users.sqlite` and related SQLite WAL files.
- HTTPS and the exact deployed frontend origin in `SITE_ALLOWED_ORIGINS`.
- Server-side environment variables for `SITE_PUBLIC_MODE`, `SITE_ALLOWED_ORIGINS`, `SITE_ADMIN_KEY`, and `SITE_DB_PATH`.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_CHANNEL_ID` only on the private worker that sends Telegram messages.
- `GOOGLE_SHEET_URL` only on the private worker if you use the optional Google Sheets export.
- `PREDICTION_INGEST_URL` and `PREDICTION_INGEST_SECRET` on the private worker; only `PREDICTION_INGEST_SECRET` on the hosted API.
- One running prediction worker, backups of the account database, and monitoring for restarts and failed prediction delivery. Keep the worker PC and game browser session online; without fresh worker updates, the website clock and live prediction stop updating.
- Persistent private-worker storage for `telegram_prediction_outbox.json`, which queues and retries undelivered Telegram pick messages. This file contains runtime prediction text and must not be committed or served publicly.

## Frontend build settings

Build the frontend from the `web` directory with `npm ci` and `npm run build`. Set `VITE_HISTORY_API_URL` to the API's `/public-history` endpoint. The live prediction endpoint is derived from that URL unless `VITE_LIVE_PREDICTION_API_URL` is set explicitly. `VITE_*` values are embedded in browser code and must never contain secrets.

## Local data and repository hygiene

The root `.gitignore` excludes credentials, cookies, account/session databases, generated predictions, local state, dependencies, and build output. Ignore rules do not remove files that were already committed or uploaded. Before publishing a repository, inspect its tracked-file history and rotate any secret that was ever committed.

For local owner setup and manual account approvals, see [SITE_ACCESS_SETUP.md](SITE_ACCESS_SETUP.md).

## Updating the existing deployment

The current installation has three separately updated components:

| Component | Location | Update required |
| --- | --- | --- |
| Prediction worker | VPS, `~/balls49`, `balls49-bot.service` | Pull code and restart the service |
| Website API | Render service `emmybet` | Deploy the latest GitHub commit |
| React website | Render service `balls49` | Deploy and rebuild the latest GitHub commit |

Repository: `https://github.com/emmadino221/balls49`, branch `main`.
The owner confirmed the streak reset working after release `61d0b7d` on
15 October 2026. Updating only the VPS does not update either Render service.

### Render

For both `emmybet` and `balls49`, check whether automatic deployment has started.
Otherwise choose **Manual Deploy > Deploy latest commit**. Confirm that both
services show the intended commit as live, then refresh the website.

### VPS

From a trusted terminal logged in as the `balls49` user:

```bash
cd ~/balls49
git status --short
git pull --ff-only origin main
```

If the pull fails or reports conflicts, resolve that before restarting. Preserve
local runtime state; do not use a hard reset to discard unexpected changes.
After a successful pull:

```bash
sudo systemctl restart balls49-bot.service
sudo systemctl status balls49-bot.service --no-pager -l
sudo journalctl -u balls49-bot.service -n 50 --no-pager
```

Restart `balls49-collector.service` only when its code or configuration changes.
The Render frontend build handles website assets; a VPS worker-only update does
not require building the website on the VPS.

### Streak reset synchronization

Both worker and hosted API must include the reset update. The signed snapshot
carries `marketStatsResetAt`; the API returns its latest reset timestamp in the
response. Each side keeps the newer timestamp in SQLite. No history is deleted,
and no extension martingale or automation state is reset. Offline workers catch
up after the next successful feed exchange.

If website statistics are missing while Telegram works, first check the deployed
API version. `/public-current-prediction` includes `marketStats.summaryStats` for
an accessible prediction. `/public-history` includes `worstLosingStreaks` and
`streakDrawCount`; `range=all` calculates across all saved resolved draws even
when the returned history cards are paginated.

The last attempted automated SSH connection was blocked by a changed host key.
Before reusing that connection, verify the server identity through the hosting
console. Do not disable SSH host-key checking to bypass the mismatch.
