# Website automation dashboard

The Automation page controls the existing extension session. The extension must
remain open in the Bet9ja tab to execute selections. Manual extension use remains
available. This update does not embed Bet9ja inside the website.

## Connect and use

1. Update both VPS checkouts and reload the extension in chrome://extensions.
2. Refresh the Bet9ja tab and unlock the extension with your extension access key.
3. Sign in to the website and open Tools & history > Automation.
4. Link that same extension access key (not your owner key or Bet9ja password).
5. Choose Use website control. This pauses automation.
6. Review games, stakes, progression, sniper, entry rules and limits, then save.
7. Choose Start automation and confirm. Keep the Bet9ja tab and extension connected. You may close the dashboard.

The page shows the reported bookmaker balance separately from the bot's calculated
balance, session profit/loss, game steps and up to 100 recently placed draws.
Activity begins with this update; older placements are not reconstructed.

## Control and execution

### Transfer a strategy suggestion

On Suggestions, use Preview automation setup to open the linked Automation
page. Suggested strategies is also available directly in Automation. Select one
or more individual games, or Unified by itself. Choose the draw window and either
a whole-naira base stake (50?50,000) or allocated capital (50?10,000,000).

Preview reads the worker's current history. Each selected game must pass the
existing training and validation checks; insufficient or weaker plans display a
reason instead of being silently transferred. The preview shows entry losses,
played-loss pause, recovery attempt limit, base stake and reserve for each game.
Save these plans keeps automation paused. History or settings changes invalidate
the preview. Start remains a separate explicit action. The existing member
extension authentication and subscription checks apply.

The worker now executes the actual entry/pause/resume rules instead of translating
them to a different sniper rule. Observation starts with a fresh win. Played
losses count toward the pause; unplayed wins permit re-entry but do not erase
recovery debt. Recovery stakes use the fixed base-profit target and round up to
whole naira. Gaps restart entry observation, preserving actual recovery debt.
Unified uses its four currently supported execution markets (BetZero, Rainbow,
High/Low, and Total Color 3-way) and reserves for the most expensive path at each
attempt. Individual Bet49 plans require six numbers.

Capital sizing selects the largest common base that can fund the sum of all
selected plans' bounded recovery reserves. Every stake must stay within 50,000;
insufficient capital at the minimum base blocks saving. The allocation is a bot
ledger, not a bank balance or deposit. Settled losses reduce available capital.
After a settled win completes all active recovery, capital includes net results
(including previous losses), and capital-mode stakes are resized. There is no
resizing during an unfinished recovery. The entire allocation can be lost.

The optional automatic strategy switch is off by default. When on, the worker
reviews fresh history after recovery wins, keeping the selected games/window.
If no eligible affordable plan is available, it pauses for review. When off,
capital mode still resizes stakes using the existing rules. No refresh restarts
a halted session, clears stop-loss totals, or changes the user's risk limits.
All this runs in the worker and survives closing the dashboard. State is included
in the existing persisted session configuration.

Saving a suggested plan disables rollover, flat/weighted/dynamic staking and
separate sniper, summary and alternate-strategy filters. Stop loss, take profit,
circuit breaker, cooldown and shadow settings remain in force and may stop a
plan earlier. Saving the manual Game setup replaces the suggested strategy and
turns off its updates. Reset execution or switching to extension control marks
the suggested plan for review; reapply it before returning to website automation.

Deploy both worker and website code together. This feature uses the existing
website-controlled extension protocol; no new extension package is required.

- Stop works from either interface. Switching controllers pauses the session.
- Switching or stopping preserves recovery and sniper progression. Settings edits
  require a stopped session without an active execution or recovery sequence.
- The extension popup has a Use extension control button for returning to manual use.
- Website mode requires a fresh extension heartbeat. Closing the dashboard does
  not pause automation. An extension connection missing for about 15 seconds pauses
  the worker; restarting requires an explicit Start. Stop loss, take profit and
  other configured limits continue to apply while the dashboard is closed.
- Each submission rechecks the worker. One extension executor token holds the lease;
  existing per-draw claims prevent another tab claiming the same execution.
- Stop cannot undo a bookmaker-accepted bet or an in-flight submission. Submitted
  bets can still settle after Stop. Check the bookmaker slip for interrupted batches.
- Placement receipts record submitted Bet49 numbers and Total Color selections.
  Partial batches pause for review and are not automatically replayed.
- An explicit extension session wipe clears this activity list and execution state,
  retaining saved setup. Switching controllers does not wipe activity.
- The website also offers Reset execution session. Stop first and wait for any
  placement or unsettled bet to finish. Confirming clears session totals, activity,
  martingale and sniper progression using the same worker reset as Wipe Execution.
  Saved game settings and limits are retained. Start again explicitly when ready.

## Server requirements

The website process connects to the private worker at 127.0.0.1:3001 using the
member's extension key. No additional public worker endpoint is needed beyond
the existing extension stats/config routes. Both services must run on the same VPS.

Links use the signed-in account identity. One extension session can be linked to
one website account. Keys are encrypted in the website SQLite database using a key
stored separately from SITE_ADMIN_KEY (see docs/27-security-and-owner-2fa.md for
the vault-key migration and backup requirements). Normal status responses never contain keys. An active
subscriber may explicitly reveal their own key, and the owner receives the key
when approving extension access. After the vault migration, rotating the
admin key invalidates owner sessions without requiring relinking. Revoked extension keys cannot operate the worker.
Keep the website database and server key persistent and backed up.

## Extension subscriptions

Owner tools > Manually approve an account offers Predictions only, Extension only,
and Predictions + extension. Extension access costs NGN 80,000 per 30 days; the
prediction plan is priced separately. Verify payment before granting access.
Approvals start the selected duration from today. Approving one service leaves
the other service's existing expiry unchanged. Both grants each service for the
selected duration; it does not bundle or discount their prices.

Extension approval issues and links a member key automatically. The owner may
share it privately, or the signed-in subscriber can reveal it on Automation.
Renewals retain the linked key and session. Expired member keys cannot obtain
new bets, while settlement receipts for already submitted bets remain accepted.
Legacy CLI-issued keys without expiry retain their previous access. To convert
one, have that user link their existing key before approving extension membership.

The website uses a signed loopback request to provision the worker key. Both
services need the same PREDICTION_INGEST_SECRET (already used for prediction
publishing). Do not publish /internal/extension-subscription through nginx.

## Deploy

### Delete a website user

Owner tools > Refresh account list shows a Delete user button for each account.
Type the exact email to confirm. Deletion removes the website user, login sessions,
pending email verification and automation link. Linked member keys and monthly
extension keys for that account are revoked first; the worker pauses those sessions.
If revocation cannot be confirmed, deletion does not proceed and can be retried.
The server owner key is never revoked by this action. Shared prediction history
and already submitted bets are not deleted or reversed. Legacy account imports
cannot restore deleted users on restart. No existing users are deleted by deployment.

Pause automation and allow submitted bets to settle before restarting the worker.
After committing and pushing, update the worker:

```sh
cd ~/balls49 &&
git pull --ff-only origin main &&
sudo systemctl restart balls49-bot &&
systemctl is-active balls49-bot
```

Then update the website:

```sh
cd ~/balls49-site &&
git pull --ff-only origin main &&
npm --prefix web ci &&
npm --prefix web run build:same-origin &&
sudo systemctl restart balls49-site &&
systemctl is-active balls49-site
```

Reload the updated local extension and refresh Bet9ja. An old extension does not
provide the heartbeat needed to start website control.

JavaScript syntax checks and the production website build are the local checks.
Account linking, browser interaction and live execution still need end-to-end
verification in a demo session before real-money use.

## Session streaks and email progress reports

The dashboard shows the existing worker current and maximum losing streaks.
A losing draw has no winning game among the bets actually submitted. Mixed draws
with any winner break this streak, even if their combined money result is negative.
Skipped draws do not count. These are execution-session metrics, not historical
prediction streaks. Reset execution clears the streaks.

Verified members with active extension access can opt into email reports every
1?10,000 settled played draws (default 10). Recipients are taken from the signed-in
account; arbitrary addresses cannot be supplied. Owner-only sessions have no
verified member recipient and must use a verified member login for this feature.
Saving starts the interval at the current counter. Execution reset starts a new
counter. Existing sessions start tracking the new draw counter upon upgrade.

The website process polls enabled schedules every 30 seconds, independently of
open browser tabs. Reports include session profit/loss, existing game/sequence
wins and losses, current/worst losing streak, reported balance and its timestamp,
and running/paused status. These are session totals, not interval-only totals.
Multiple delayed intervals coalesce; sends are at least 60 seconds apart per user.
The existing website Resend environment is reused; the worker needs no email key.

Schedules and pending reports are persisted in SQLite. Retries reuse an
idempotency key for up to 23 hours. Expired reports are skipped with a dashboard
error. Provider acceptance is shown separately from confirmed inbox delivery.
Disabling cancels queued reports, but cannot recall an in-flight email. Unlinking
or deleting an account removes its schedule. Expired or unverified memberships
are excluded from delivery. Failure emails never change or stop betting.
