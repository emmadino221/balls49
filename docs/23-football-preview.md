# Football owner preview

## Setup

The website service (`balls49-site`, public mode) reads `FOOTBALL_DATA_API_KEY`
from its environment. Keep the token in `/etc/balls49/site.env`, never in Git or
frontend environment variables. Restart the service after configuring it.
The private casino worker does not start the football scheduler.

Deploy the website backend and rebuild the frontend with `build:same-origin`.
Unlock Owner Tools on Predictions, then open `/football.html`. The navigation
link appears for owner sessions; the server also enforces owner access on
`GET /admin/football`. Sports are not included in user subscription access yet.

## Data and request budget

Source: `https://api.football-data.org/v4/competitions/PL/matches`, authenticated
with `X-Auth-Token`. This first release covers the provider's current Premier
League season only. The service fetches at most once every 30 minutes, persists
the last attempt across restarts, and prevents overlapping fetches. Browser
refreshes read the database and never trigger extra provider requests. Failed
requests retain saved data and display an error. Data older than an hour is
labelled stale. The account must actually have access to the competition.

Official references:
- https://www.football-data.org/documentation/quickstart
- https://docs.football-data.org/general/v4/match.html

## Experimental baseline

For each upcoming fixture within seven days, use each team's latest ten completed
results (minimum five each). Estimate goals from their scoring/conceding averages
with a 10% home adjustment. Independent Poisson scores yield home/draw/away model
estimates. These are uncalibrated estimates, not proven accuracy or odds. This
does not include injuries, lineups, bookmakers, or player statistics.

Only data already finished at generation time is used. No backfilled predictions
are created for matches that have started. Picks must be generated at least 15
minutes before kickoff; the first saved pick is immutable. There is no live
prediction mode. Results use regular-time scores (90 minutes plus stoppage time).
Where a regular-time score is unavailable, full-time scores are accepted only for
REGULAR duration. Otherwise settlement waits for suitable data.

Postponed, cancelled, suspended or kickoff-changed fixtures void saved picks. Void
picks are not regenerated. Finished score corrections can update outcomes, but
never rewrite the saved prediction. Missing results remain pending. Free data
may arrive late. The UI lists the latest 100 historical picks; all stay stored.

`football_state` and `football_picks` are separate SQLite tables and survive the
casino daily reset. Include the configured site database in regular backups.
No casino predictions, Telegram routes, extension settings or account plans are
changed. Basketball remains a separate future integration.

## Deployment checks

No provider call has been verified from development because the token exists only
on the VPS. After deployment, check the preview's configured state, update time,
provider errors, fixtures and saved picks. An empty fixture window is valid;
insufficient history must show no pick. Review actual prediction results before
enabling paid/public access.

## Public preview update

Football is now freely accessible at `/football.html` through
`GET /public-football`. No login or subscription is required during this preview.
The admin-only endpoint remains available for provider diagnostics; public errors
use a generic message. Tokens remain server-side. The navigation is visible to
everyone. Cards label the suggested outcome as 1 (home), X (draw), or 2 (away).
This is an experimental model selection, not a proven betting recommendation.

## Compact cards and additional markets

New `goals-baseline-v2` predictions also save Over/Under 2.5 and Both Teams to
Score Yes/No. These probabilities sum the same pre-match Poisson score model;
they require no extra provider calls. All three markets settle separately using
regular-time goals and are voided together when the fixture is voided.
Older saved predictions retain match-result-only coverage, even if still upcoming.
There is no retrospective addition of markets. Cards show compact market/pick/
estimate rows, with explanations and alternative percentages behind Details.

## Multiple competitions

The league selector now supports PL (Premier League), PD (La Liga), BL1
(Bundesliga), SA (Serie A), FL1 (Ligue 1) and CL (Champions League). These are
listed in the provider's free coverage at https://www.football-data.org/coverage;
actual account authorization is still enforced by the provider.

`football_league_state` stores independent caches, update times and errors. The
old Premier League cache migrates once without deleting any saved picks. Legacy
picks without a league code belong to PL. New picks carry their competition code.
Public and admin endpoints accept `?league=CODE`; unknown codes default to PL.

One request is started at least ten seconds apart, with a 30-minute minimum
between attempts for each competition. Attempt timestamps persist across
restarts. HTTP 429 causes a global pause, respecting Retry-After with a minimum
30-minute backoff. HTTP 403 displays a competition availability notice and does
not block other leagues. Browser navigation never triggers provider fetches.

Models use only that competition's current-season completed matches, maintaining
the five-result minimum per team. Champions League early-season samples may be
insufficient; no cross-league data is silently substituted. Historical picks and
market results are separated by league. Current-season API refreshes do not
automatically query previous seasons for unresolved old picks.

## Model-ranked combinations

The Upcoming tab displays separate 3-, 5-, 10- and 20-match lists across all six
competitions, independent of the fixture league selector. For each eligible
fixture, choose the largest saved estimate among 1/X/2, Over/Under 2.5 and BTTS
Yes/No. Only markets actually saved before kickoff are eligible. Legacy picks
may have only 1/X/2. Tied market estimates retain the explicit outcome order;
matches tie-break by kickoff, then match ID. Lists may overlap but never repeat
a match within a list.

Exclude matches within 15 minutes of kickoff, beyond seven days, non-scheduled
statuses, void/non-pending picks, changed kickoff, missing fixtures, and league
feeds with errors or updates older than one hour. Incomplete lists show their
actual counts, without duplicates or fabricated selections. There is no minimum
probability filter: these are the highest ranked eligible selections, not a
claim that every selection is strong.

These are dynamic lists, not saved betting tickets. Match predictions and their
individual market results remain in the existing history. The page refreshes
every minute, removes selections near kickoff, and hides combinations when the
page's combination snapshot is over two minutes old. No additional provider
calls or betting actions are made. No combined success probability is calculated;
individual experimental estimates do not establish accumulator success chances.

## Saved official combinations

Owners can save a complete 3/5/10/20 list with its Save combination button after
unlocking Owner Tools. `POST /admin/football-combinations` requires an owner
session and receives only size plus a server-generated content fingerprint.
The server rebuilds the current eligible list and rejects changed or incomplete
lists rather than silently substituting selections. Repeated saves are idempotent.

`football_tickets` stores an immutable selection snapshot and creation time in
the site database. Public `GET /public-football-combinations?offset=0` returns
20 tickets per page, newest first. These records survive casino resets and
deployments with persistent storage. Include them in the site database backup.

Combination History is public, across all leagues. Each leg is graded against
the final regular-time score for its saved outcome (not merely the match-winner
prediction). Results derive from the persisted match results on each history
read and reflect provider score corrections. A missing result remains pending;
a void match voids that leg. Any loss makes the ticket Lost immediately; otherwise
pending legs keep it Pending. All non-void legs winning makes it Won; all void
legs makes it Void. Selections never change. No bookmaker bet, stake or payout
is created. Public visitors cannot save official combinations.

## Pitch-style presentation

The Upcoming view displays one match at a time on a pitch-style panel, with
home/away initials (not official kits), kickoff metadata and a countdown based
on the last known fixture time. Previous/next buttons and a match selector switch
fixtures. On narrow screens, teams appear above the central prediction panel.

Market buttons show Match Result, Over 2.5, Under 2.5, BTTS Yes and BTTS No.
Match Result displays the saved model pick; the other buttons display the exact
selected outcome's saved estimate, even if it is not the highest estimate.
The label distinguishes those cases. Missing legacy markets show No pick.
Started/non-scheduled/void fixtures do not show active estimates. Stale data is
labelled. Expanded details retain the original explanation and saved timestamp.

The combination section uses 3/5/10/20 buttons to show one list at a time, keeping
the owner save action and Combination History available. The calculation and
settlement logic is unchanged by this presentation update. No bookmaker odds or
external AI-provider claims are displayed.

## Team-strength model (14 November 2026)

New picks are made by `football-model.js` (`team-strength-v1`) instead of the
first model, which averaged each team's last ten matches. Saved picks are never
changed, so older picks keep the model they were made with.

How it works: each team gets an attack and a defence rating fitted over the
competition's matches, so goals against strong opponents count for more. Recent
matches weigh more (a match one year old counts half), teams with few matches
are pulled towards the league average, and a low-score correction fixes the
habit of predicting too few draws. A pick needs about three recent matches per
team.

Earlier seasons: the service tries to fetch the two previous seasons of each
competition from the data provider and stores them in the `football_past`
table. This is optional. If the data plan refuses them the log says
`[Football] Earlier season ... is not available` and ratings use the current
season only, which the test below shows is only slightly better than the first
model.

Test on two held-out seasons (2025/26 and 2026/27 to date, 1,770 matches in
five leagues; settings were chosen on three earlier seasons):

| Model | Match result right | Over/Under 2.5 right | Both score right |
| --- | --- | --- | --- |
| First model (last ten matches) | 49.3% | 55.8% | 55.4% |
| Team strength, current season only | 50.2% | 54.9% | 54.7% |
| Team strength with earlier seasons | 52.7% | 56.3% | 56.0% |
| Bookmaker odds | 54.0% | 57.9% | not available |

Match-result picks by how sure the model was (team strength with earlier
seasons): at 60% or more, 75.6% right (16% of matches); at 50% or more, 64.7%
right (41% of matches); all picks, 52.7%. The model does not beat bookmaker
odds, so it is not a route to guaranteed profit.

Re-run the test (read-only, downloads free season files from
football-data.co.uk into the folder):

```bash
node scripts/football-backtest.js /tmp/football-history --download
```

Add `--tune` to search the settings again on the older seasons.
