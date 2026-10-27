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
