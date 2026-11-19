# Current architecture and operations

Reviewed: **15 November 2026**, local Balls49 source baseline **0336076**.
Local update 17 November: main BetZero now uses [Streak 1](43-main-betzero-streak-one.md).
Main BetZero requires exactly four qualifiers and skips fewer; this is not a deployment record.
This is a documentation and targeted source review, not a live VPS audit or a
fresh regression-test report. Saved strategy settings and deployed revisions
cannot be inferred from source defaults or old reports.

## 1. Components and data flow

| Component | Responsibility | Main source |
| --- | --- | --- |
| Balls49 collector | Draw clock, completed results and archive | `collector.js` |
| Private prediction worker | Main selections, settlement, automation sessions, Telegram and signed publishing | `bot.js`, market modules |
| Website service | Account/admin APIs, stored public feed, automation bridge, research and football | `bot.js` in public mode, `site-*.js`, `automation-bridge.js` |
| Website UI | React/Vite routes, dashboards and same-origin API client | `web/src/` |
| Balls49 extension | Game-page interaction, execution receipts and telemetry | `balls49-extension/` |
| BetZero Lab | Versioned research predictions, statistics, simulations and reconciliation | `betzero-*.js` |
| Research worker | Bounded asynchronous backtests, separate from the prediction worker | `betzero-worker.js`, `betzero-jobs.js` |
| Real football | Provider cache, model, saved predictions and combinations | `football-service.js`, `football-model.js`, `football-tickets.js` |
| Virtual football | Separate Python generator, models, publisher and extension | sibling `virtual 2 mobile/` repository |

Balls49 results flow from collector to prediction worker. The worker saves picks
and settles them against matching draw IDs, then sends signed snapshots to the
website. The website serves authorized live picks and historical results.
Telegram picks and results are separate messages; unsent picks use a durable outbox.

Automation flows through the authenticated website bridge or extension controls
to the private worker, then to the game-page extension. Receipts identify actual
submitted selections. Website-only personal stake estimates do not place bets.

Virtual football uses `new.py` to freeze round selections in `matches.db`.
`publish_site_feed.py` sends signed snapshots to the website every ten seconds.
The virtual extension and Telegram use those selections, not independent picks.
Real football runs in the website service and has its own provider and tables.

## 2. Current main Balls49 selections

These are source-backed rules, not claims about predictive accuracy.

| Market | Current selection |
| --- | --- |
| Bet49 | `predictBet49SmallestAdd10`: minimum of the immediately preceding valid six-ball draw +10; one number; no initial wrapping; invalid/missing/conflicting input or overflow skips. Wins on appearance. |
| BetZero | `predictBetZeroFromLab`: copies the saved Lab Streak 1 v3.0.0 prediction for the exact draw. Requires an enabled, pending, unexpired Lab record with exactly four selections; otherwise skips. Wins when all selected numbers are absent. |
| Rainbow | Majority color of the legacy internal multi-number Bet49 pool, not the new published single-number Bet49 pick. A tie or unavailable pool skips. |
| Total Color 3-way | Internal ranked colors plus No Winning Color. |
| Winning Color | First ranked color from the shared internal color ranking. |
| High/Low | MIN/MAX v2 method MIN gives HIGH; MAX gives LOW. Uses validated transmitted Lab state where usable, otherwise historical replay. See [42](42-high-low-follows-minmax.md). |

The public product exposes six markets. Total Color 2-way is not a standalone
prediction or history market; its ranked color data remains an internal input
for supported selections. Unified prediction is retired.

Old algorithms may remain exported for historical/offline callers. Their presence
does not mean the main worker still issues those selections. Historical records
retain their issued selections and should not be reinterpreted using today's rule.

## 3. Research versions and isolation

| Strategy family | Versions / behavior |
| --- | --- |
| `simple_smallest_number_add_10` | v1: one-number absence experiment. Main Bet49 copies its calculation but grades appearance instead. |
| `smallest_add10_step10_four` | v1: four-number absence experiment. |
| `minimum_maximum_three` | v1: switch after WIN, keep after LOSS. v2: keep after WIN, switch after LOSS. Separate state and history. |
| `statistics_streak_drop_betzero` / `statistics_streak_drop_bet49` | v1: require four transitions from streak 2 or 3 to 1. v2: accept three or four. v3: latest snapshot only, first up to four ascending numbers currently at streak 1; skip if none. Bet49 chooses one seeded random candidate. |
| `minmax_high_low` | v1: HIGH/LOW research derived from MIN/MAX v2. |

The six incomplete tutorial placeholders were removed from the active registry;
retained database rows are historical, not runnable strategies. Version-specific
configuration, histories and metrics must remain separate. Enablement is a saved
database setting: inspect the authenticated dashboard/API, not this table.

Statistics snapshots have no authoritative provider draw ID. Their association
with the observed clock is not independent proof of provider freshness.

The Lab does not place bets. Main Bet49/BetZero share selection calculations;
High/Low also has a deliberate Lab-state input. Therefore the old blanket claim
that no Lab state can influence any production selection is no longer accurate.
Backtesting settings must still never enable forward generation or change stakes.

Small synchronous backtests and queued jobs are separate API contracts. Queue
limits are one running job, two waiting jobs, 50,000 pairs and ten minutes.
Frozen versions/seeds and protected final-test cohorts must not be rewritten to
make an incompatible job run. Forward results and historical simulations are
different evidence; old exploratory results are not untouched final tests.

## 4. Accounts, automation and balances

- Website accounts use verified email, password hashes and cookie sessions.
  Owner approval controls access; extension keys identify separate worker sessions.
- Weekly Premium is predictions-only; extension and Elite access are monthly
  under the documented membership rules. See [26](26-website-automation.md).
- Website control must be selected before dashboard commands control execution.
  Switching controllers pauses the session. The extension/game tab must remain open.
- Suggested plans define entry, played-loss pauses and recovery. Automatic plan
  updates occur after settled recovery wins, not an unconfirmed browser result.
- Bet49 single-number staking uses odds 7.80 and the shared helper. Fixed target
  is base x 6.80; accumulating target multiplies that by the next actual attempt.
  See [41](41-bet49-profit-modes.md). Legacy multi-number examples are not current defaults.
- Reported live balance, calculated virtual balance, actual receipts, prediction
  streaks and execution-session streaks are distinct records, not interchangeable.
- Warning-only suggestion mode can continue beyond its suggested reserve; do not
  describe every displayed risk amount as an enforced stop. Execution safeguards
  and manual Stop remain separate from plan entry pauses.

## 5. Football

Real football uses `football-data.org` caches and saves pre-match predictions.
The latest model is `team-strength-v1`; older saved picks keep their original model.
See the latest section of [23](23-football-preview.md), which supersedes its initial
owner-only, single-league and last-ten-match-model descriptions.

Virtual football freezes two Over 1.5 picks or skips; Under 1.5 uses the lowest
Over-confidence eligible match; GG and NG choose at most one each; Win chooses
one HOME/AWAY pick with odds above 1.70. Its separate README documents model
dependencies, extension 3.2, restart gaps and outstanding market-price checks.
Those documented gaps have not been newly tested by this review.

## 6. Persistence, backups and operating boundaries

Documented VPS layout (recheck before any deployment):

- `/home/balls49/balls49`: private bot checkout; `balls49-bot`.
- `/home/balls49/balls49-site`: website checkout; `balls49-site`.
- `balls49-collector`: Balls49 collector.
- `/var/lib/balls49-site/site_users.sqlite`: website database.
- `/home/balls49/balls49/site_users.sqlite`: worker database.
- `/var/lib/balls49-virtual/matches.db`: separate virtual database.
- `balls49-virtual` and `balls49-virtual-feed`: virtual generator and publisher.

Runtime JSON contains prediction, session, execution and outbox state. SQLite
contains accounts, sessions, feeds, research and football records. Vault keys
must be preserved with their matching databases. None belongs in source control.
Daily active-history resets and reporting-only resets have different scopes;
neither should be used as an automation-session reset. Old warm-up counts in
[18](18-daily-history-reset.md) predate current algorithms.

[28](28-google-drive-backups.md) describes consistent SQLite copies, encrypted
off-host archives, download/hash verification, email failure alerts and retention
(older than 30 days, keeping the newest seven). Individual database consistency
does not imply an atomic snapshot of all databases and JSON. Full service restore
rehearsal remains a separate check. Verify coverage of the virtual database and
model/configuration files explicitly; do not assume the original two-database
backup covers the separate virtual application.

The checked-in research worker unit specifies Node at
`/home/balls49/.nvm/versions/node/v24.21.0/bin/node`, CPUQuota 25%, MemoryHigh 768M,
MemoryMax 1G and a 512 MB supervisor heap. Child heap is separately bounded.
Restart delay is 30 seconds, limited to three starts in 600 seconds; shutdown
uses the service control group with a 15-second timeout. These replace the older
1.5 GB/50% examples. Actual Linux enforcement requires separate verification.
Previous deployment instructions required the worker masked and inactive;
this review did not inspect or change its live state. Starting it may claim jobs.

## 7. Deployment and documentation rules

This guide is not authorization to deploy. Before any approved rollout:

1. Record exact bot/site/virtual revisions, branches, local edits and rollback IDs.
   The bot has historically used a different branch from the website; do not
   blindly pull website main into both checkouts.
2. Capture fresh consistent backups, verify them and preserve recovery keys/config.
3. Review migrations on copies and build/test the exact intended release.
4. Deploy receivers before publishers when feed contracts change. Reload browser
   extensions separately. Keep research-worker activation separately approved.
5. Check service health, clock freshness, access, feeds, normal settlement and
   latency. A successful build alone does not establish live health.

Documentation precedence:

- Use this guide as the overview; follow linked feature documents and source for
  exact behavior. Resolve contradictions before running commands.
- Stage reports (29 through 37) preserve dated evidence, test counts and approval
  gates. They do not establish today's deployed version or enabled settings.
- Older deployment snippets and Render references are historical examples.
- Local implementation notes saying "not deployed" describe their writing date,
  not permanent release status. Record fresh deployment evidence separately.
- The untracked security/readiness reports are historical findings. Later fixes
  are documented elsewhere; neither old findings nor fix notes establish live
  security without current verification.

When changing behavior, update this overview and the relevant feature guide;
mark superseded sections explicitly. Keep old results as dated evidence rather
than replacing them with new performance claims.
