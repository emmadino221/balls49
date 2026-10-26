# Public suggestions and video library

## Pages

- `suggestions.html` replaces Testimonials. Old `testimonials.html` links render the same page.
- `videos.html` is public and plays owner-curated YouTube videos. Users can also open the original YouTube page if embedding is disabled.
- Both links appear in the main navigation and footer. Layouts support light/dark themes and narrow screens.

## Owner workflow

Open Predictions, unlock the existing Owner Tools, then find **Manage your YouTube videos**. Enter a title, HTTPS YouTube link, and optional description. Add more videos, edit existing entries, move them up/down, or remove them. Removing a library entry does not delete anything from YouTube. The owner session is required for every server mutation; hiding the form is not the authorization check.

Video metadata is stored in `site_videos` in the configured `SITE_DB_PATH` SQLite database on the website service. It survives code deployments and prediction-history resets, provided the database directory remains persistent. Back up the database alongside account data. Entries are not copied by the prediction snapshot feed. There is no fixed video-count cap. Links must identify a YouTube video; no arbitrary iframe HTML or external URLs are accepted.

## Suggestions

No model API, AI key, or external AI service is used. The server publishes aggregate results only for completed history: wins/losses, skips/unavailable results, observed win rate, current/worst losing runs, sample size and draw range. It does not return live predictions, private settings, user data, or selection logic.

Choose 50, 100, 200, 500 or 1,000 recent completed draw records. Fewer available records are reported honestly. Wins and losses alone form the win-rate denominator. Missing draw IDs break losing runs; skipped predictions preserve them. Streaks describe that window, not lifetime tracking. Rule changes can coexist in historical records.

Suggestions explain insufficient samples (under 50 settled picks), current runs of three or more losses, frequent skips, or general review guidance. They do not rank markets as profitable or claim a predictive edge. The page refreshes every 30 seconds; errors retain an explicitly labelled previous snapshot. Daily history clearing can leave it empty until new results arrive.

## Routes and deployment

### Gameplay planner

Visitors select a game and enter **base stake only**. No capital or personal budget is collected. The public response also includes an outcome-only replay of candidate entry/pause rules:

- Wait for 0 through 4 observed losses after a win; pause after 1 through 3 played losses.
- Choose using the oldest 70% of the requested window, requiring 30 played examples. Rank by win rate, then shorter played-loss run, then sample size.
- Inspect that fixed choice on the newer 30%, requiring 15 played examples. Label weaker or insufficient results explicitly. A candidate must match or exceed the every-pick baseline win rate; this does not establish profitability.
- Each segment starts fresh. Entry uses only prior results. Skips preserve state; missing draw IDs reset the simulated sequence. After a pause, wait for an observed win and the entry loss count again. Unplayed wins never erase played recovery losses.

The separate monetary illustration uses fixed base-profit recovery: per-selection stake = ceiling((prior exposure lost + target profit) / (decimal odds - selection count)). The first attempt uses the entered base. It assumes exactly one selection wins, fixed odds/count, no fees or partial placements. Bet49 conservatively uses six numbers; Unified has no fixed-odds table and directs visitors to its underlying game. This is not the extension's rollover or other recovery modes.

The table shows the largest played-loss run in either segment plus one attempt, capped at 12 with an explicit warning when truncated. Its cumulative reserve can all be lost. It is not a safe budget, prediction of future streaks, or affordability recommendation. Pauses preserve the next recovery amount; exhausting the illustrated reserve means stop and review, not automatically refill. These suggestions never apply automation settings or place bets. Repeatedly selecting history windows can overfit results.

Public GET `/public-suggestions?limit=100` and `/public-videos`; owner POST `/admin/videos` with save, move or delete actions. Existing trusted-origin and owner-cookie controls apply. Browser requests use the normal `/api` prefix.

Deploy the new backend to the website service, rebuild the web bundle, and restart that service. Static route generation and the backend static allowlist include both new pages. The bot worker needs the new `site-content.js` module whenever its `bot.js` is updated. No extension update is required.
