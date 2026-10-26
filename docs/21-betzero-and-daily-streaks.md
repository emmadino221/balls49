# BetZero selection and daily streak archive

## BetZero

The live worker keeps Bet49's issued selection unchanged. For BetZero it ranks
those numbers by their occurrence counts in the same ten completed draws used
by Bet49, then takes four. Equal counts retain Bet49 order. If Bet49 skips,
BetZero skips. Settlement still wins only when none of the four numbers appears.
All consumers receive the same issued BetZero pick; old picks are not rewritten.
This supersedes the earlier first-four and independent BetZero selection rules.

## Daily history records

`daily_streak_archive` lives in the configured site SQLite database. The worker
records settled outcomes as they arrive, keyed by draw ID, so repeats do not
double-count. Out-of-order results within an open day are sorted by draw ID
before calculating streaks. The day is the Nigeria date of `settledAt`, with
legacy timestamp fallback. Skips preserve a run; wins end it. Every calendar day
starts at zero, independently of manual tracking-period resets.

Before midnight clearing, summaries are saved and per-draw archive outcomes for
past dates are discarded. Daily totals and maxima remain. Closed summaries are
not recomputed from a partial old-history replay. Accounts and extension state
are not changed by archiving.

Existing available history seeds the archive at startup. Deleted data cannot be
reconstructed; the first day and days with missing data may be incomplete.
No row is invented for a date without data. A late result belongs to its validation
date, rather than a previous day's draw date.

Authenticated prediction snapshots sync up to 30 daily summaries at a time,
cycling through all stored dates to catch up after outages. The website trusts
the worker's summaries rather than rebuilding them from its partial feed.
Public `/public-daily-streaks` returns past dates and one selected summary;
`?day=YYYY-MM-DD` selects another day. No picks or user information are returned.
The History page refreshes this section every minute. Today becomes selectable
after Nigeria midnight (and the next sync).

Deploy both worker and website code and build the website. The new module must
be present for both services. No extension installation is needed. Back up the
configured SQLite databases to preserve this archive across server migrations.
