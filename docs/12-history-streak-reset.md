# Restart history worst losing streaks

Sign in through the existing owner controls on Predictions, then open History.
The owner-only **Restart history streak tracking** button resets only history's
worst losing streak calculations for all markets. Confirm the prompt to apply it.

The server requires an admin session for `POST /admin/reset-history-streaks`.
It stores one `history_streak_cutoff` setting in the website SQLite database,
containing the reset time and latest settled draw ID. It does not delete history
or modify prediction streaks, global steps, strategy selection, martingale,
sniper settings, or extension accounts. The existing reset-all-prediction-streaks
control remains separate.

History keeps its original draw-range selection. Streak calculations then use
only records with a newer draw ID and a settlement timestamp after the cutoff.
Old delayed results and records without settlement timestamps are excluded from
post-reset streaks. The next eligible validated draw starts a new count from zero.
Wins clear the current loss run; skipped picks do not clear or increase it.

The page shows **Worst losing streak since reset**, the reset date in local time,
and the number of eligible draws inside the selected range. History rows,
win/loss counts, win rates and total draw counts still include older records.
The all-time selection applies the same cutoff to streaks only.

Deploy both backend and website changes before use. This cutoff belongs to the
API database serving that website; it is not synchronized to Telegram/VPS streak
tracking. No bot restart is needed when pressing reset. Normal history polling
updates other visitors' displays. Back up the website database to retain the cutoff.
