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
7. Choose Start automation and confirm. Keep the dashboard and Bet9ja tab open.

The page shows the reported bookmaker balance separately from the bot's calculated
balance, session profit/loss, game steps and up to 100 recently placed draws.
Activity begins with this update; older placements are not reconstructed.

## Control and execution

### Transfer a strategy suggestion

On Suggestions, choose a game, history window and whole-naira base stake from
1 to 50,000. Supported plans offer Preview automation setup. In Automation,
preview the latest history, then apply to the setup form while stopped and free
of active recovery. Game setup opens for review; Save settings is still required.
No transfer starts betting or wipes progression. New history invalidates a preview
before it is applied. Unsupported or insufficient samples cannot be transferred.

The preview lists the selected game, base stake, maximum steps and sniper values.
Unified enables supported games except Winning Color. Stop loss, take profit,
circuit breaker and shadow settings remain in place. Existing live staking and
sniper rules apply; their prediction-history entry steps are not an exact replay
of the suggestion's played-bet illustration. The illustrated reserve does not
replace the user's loss limit.

- Stop works from either interface. Switching controllers pauses the session.
- Switching or stopping preserves recovery and sniper progression. Settings edits
  require a stopped session without an active execution or recovery sequence.
- The extension popup has a Use extension control button for returning to manual use.
- Website mode requires fresh dashboard and extension heartbeats. A connection
  missing for about 15 seconds pauses the worker; restarting requires an explicit Start.
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
derived from SITE_ADMIN_KEY. Normal status responses never contain keys. An active
subscriber may explicitly reveal their own key, and the owner receives the key
when approving extension access. Rotating the
admin key requires relinking. Revoked extension keys cannot operate the worker.
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
