# Subscriber prediction analysis

`analysis.html` provides historical support for current picks and recent market
results. It is not a calibrated confidence or next-draw probability model.
Current selection logic is unchanged.

`GET /account/analysis` authenticates the cookie session before reading prediction
data. Elite receives all seven markets; Premium receives only its approved games.
Expired accounts and Free Trial receive 403, signed-out visitors 401. Optional
`market` requests outside the plan receive 403. Owner preview follows its selected
tier and games. UI locks supplement server enforcement; unauthorized analysis is
never included in that endpoint's response.

The page refreshes every 10 seconds. Current picks require a fresh, matching draw
clock with time remaining; stale/closed draws show a waiting state. Errors clear
the previous payload. Displayed market data contains only selected picks, sample
counts and aggregate results. It contains no strategy labels, coefficients,
alternative candidates, raw history or model parameters. This does not remove
metadata already exposed by other existing endpoints.

Up to 100 distinct, earlier settled draw records form the sample. Number support
counts absence for BetZero and presence for Bet49. Rainbow counts two or more
balls of the selected color. Total Color counts each selected winning outcome;
High/Low counts the selected total range. Unified analyzes its issued source pick.
Only six distinct valid balls qualify for these counts; missing data is not zero
confidence. Each card shows its denominator. Fewer than 20 draws gets a limited
data notice; this threshold is a display caution, not an accuracy guarantee.

These per-item percentages are not a combined bet probability. Recent prediction
win rate separately counts published WIN/LOSS results in the sample, excluding
skips. There is no invented Strong/Weak rating or predictive guarantee.

Deploy bot.js and prediction-analysis.js with the rebuilt website. The existing
signed snapshot includes the current picks and settled balls needed by Render;
no model internals are added to that feed. No migration or state reset is needed.
