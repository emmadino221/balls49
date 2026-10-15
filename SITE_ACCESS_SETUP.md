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

The person enters their name, email, and password at **Sign up**. New accounts wait for owner identity confirmation before they can sign in. In **Site owner tools**, confirm the person through a known contact, select their account email, choose Free Trial, Premium, or Elite, set the duration, and save manual approval. Premium needs at least one checked market. Elite includes all seven markets and is marked with Telegram access. User records and salted password hashes are stored in `site_users.sqlite`.

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

## Total Color 3-way after a DRAW

When the immediately preceding completed draw is tied for the most frequent color (DRAW / No Winning Color), the next 3-way prediction selects **Red + Blue + Green** and eliminates **No Winning Color**. A sole winning color wins; another DRAW loses. The normal two-color-plus-DRAW prediction filter resumes after a sole color result. If the preceding result is missing or incomplete, it cannot trigger this rule.

Telegram, current/trial/history pages, results, exports, and the extension use the actual three selections. Historical predictions retain their original choices and grading. It still uses three equal stakes; existing confidence, summary, sniper, and stop rules govern automation. Reload the extension and refresh its game tab as well as restarting the bot so execution uses the new three-selection payload.

## Summary losing streak statistics

Each market displays separate maximum losing streaks for saved **Summary ENTER** and **Summary HOLD** predictions on the Predictions page and in Telegram draw results. Both use settled history within the existing max-loss tracking period. A loss increases only the streak for the label issued with that prediction; a win resets only that label's current streak. Other labels, skipped draws, pending results, and LEARNING labels do not change it. The maximum stays recorded until the owner resets max-loss tracking.

HOLD statistics measure the underlying prediction's result even when no bet was placed. Unified uses the summary label of its chosen market for that draw and tracks its own results. Old records without summary labels and markets without summary decisions (currently Bet49 and Total Color 2-way) show no summary data instead of inventing a label. Existing history is retained, so these statistics survive restarts and include previously saved labels.

Telegram results use a separate block for each game: game and outcome, colored
pick, tracking step and maximum losses, then summary details when applicable.
The summary section appears only for an active prediction with a saved summary
label for that draw. Games without a label and skipped games omit the section;
their underlying statistics remain stored. The website's no-data display is
unchanged. Draw numbers, total/range, selected colors and Unified's source game
remain included in the Telegram result. Total Color 3-way shows only its selected
outcomes in Telegram predictions and results, including Unified picks; the
avoided color is omitted from the message. Prediction and settlement logic are
unchanged.

## Extension summary entry gate

In **Expert Settings → Summary model entry gate**, each supported market has **Off**, **Summary ENTER**, and **Summary HOLD** choices. Click **Save Settings** after choosing. HOLD allows an active pick only when the summary label saved for that draw is HOLD; ENTER requires ENTER. LEARNING and missing summary data block both enabled modes. BetZero, Rainbow, High/Low, and Total Color 3-way currently supply summary decisions. Unified mode applies the gate of its selected underlying market.

Existing enabled gates migrate to ENTER. Choices are saved in extension storage and bot sessions and restored after restarting. The label is the one issued with the prediction, so a model retraining during the draw does not change the gate. Confidence thresholds, sniper conditions, and all other execution rules still apply; ML Override bypasses only the confidence thresholds. Changing the gate does not recall a bet already queued. Reload the extension and refresh the game tab after installing this update, and restart the bot.

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
## Reset prediction streak tracking

The owner reported the deployed reset working on 15 October 2026. The reset and
history-range update was released in commit `61d0b7d`.

1. Open **Predictions** and expand **Site owner tools**.
2. Unlock the controls with the hosted API's `SITE_ADMIN_KEY`.
3. Choose **Reset all prediction streaks** and confirm the reset.
4. Allow the next successful worker feed exchange to synchronize both services.
5. New Telegram messages and refreshed website statistics use the new period.

In Predictions, unlock Owner tools and choose **Reset all prediction streaks**.
This starts a new reporting period for every game's current tracking step,
maximum losing streak, and Summary ENTER/HOLD current and maximum losing streaks.
Existing predictions and results remain saved. The extension's martingale,
stakes, global automation steps and sniper state are unchanged. Displayed
tracking steps can therefore differ from automation steps after a reset.

For Telegram, set `TELEGRAM_OWNER_CHAT_ID` to your personal numeric Telegram
user/chat ID in the bot's private environment, restart the bot, and send
`/resetstreaks` privately to the bot. `/resetmaxloss` is an alias for the same
owner-only action. Do not use `/reset`: that separate command resets betting state.

The VPS bot and hosted API exchange the newest reset timestamp through the
signed prediction feed. Both must run this version. A reset on either side
reaches the other on the next successful feed exchange; offline instances
catch up when publishing resumes. Existing Telegram messages are not edited.

History's **Worst losing streak** is calculated separately from the live reset
period, for each game within the selected last 10/50/100/200/500/1,000 draws or
all saved resolved draws. All time includes older results even before loading
their cards. A win ends a streak; skipped picks neither increase nor reset it.
Draw ID search filters cards but does not change this range statistic.

An empty Summary ENTER/HOLD bucket can show **No summary data** until a new
prediction with that label settles. Markets without a summary model continue
to show no summary data. This does not mean synchronization has failed.
