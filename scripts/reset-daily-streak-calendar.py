#!/usr/bin/env python3
"""Reset only the History calendar; default is read-only preview. Stop writers before apply."""
import argparse
import datetime as dt
import json
from pathlib import Path
import sqlite3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', action='append', required=True, help='Existing SQLite database; repeat for bot and website')
    boundary = parser.add_mutually_exclusive_group(required=True)
    boundary.add_argument('--since-ms', type=int, help='Same UTC epoch milliseconds for both databases; at most next Nigeria midnight')
    boundary.add_argument('--next-nigeria-day', action='store_true', help='Exclude today; start at the next midnight in Nigeria (UTC+1)')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--services-stopped', action='store_true')
    args = parser.parse_args()
    if args.apply and not args.services_stopped:
        parser.error('Stop bot and website services, then use --services-stopped.')
    nigeria = dt.timezone(dt.timedelta(hours=1))
    tomorrow = dt.datetime.now(nigeria).date() + dt.timedelta(days=1)
    next_midnight = dt.datetime.combine(tomorrow, dt.time.min, tzinfo=nigeria)
    latest_cutoff = int(next_midnight.timestamp() * 1000)
    if args.next_nigeria_day:
        args.since_ms = latest_cutoff
    if not 0 < args.since_ms <= latest_cutoff:
        parser.error('--since-ms must be positive and no later than the next Nigeria midnight.')
    paths = list(dict.fromkeys(Path(value).resolve(strict=True) for value in args.db))
    summaries = []
    # Inspect every database before making backups or changing any database.
    for path in paths:
        with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError(f'Integrity check failed: {path}')
            columns = {row[1] for row in db.execute('PRAGMA table_info(daily_streak_archive)')}
            if columns != {'day', 'summary_json', 'outcomes_json'}:
                raise RuntimeError(f'Unexpected calendar schema: {path}')
            count = db.execute('SELECT COUNT(*) FROM daily_streak_archive').fetchone()[0]
            has_settings = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='daily_streak_archive_settings'").fetchone()
            cutoff = db.execute('SELECT reset_at FROM daily_streak_archive_settings WHERE id=1').fetchone() if has_settings else None
            old_cutoff = cutoff[0] if cutoff else 0
            if old_cutoff > args.since_ms:
                raise RuntimeError(f'Refusing to move the reset cutoff backwards: {path}')
            summaries.append({'database': str(path), 'calendarDays': count, 'previousResetAt': old_cutoff, 'resetAt': args.since_ms, 'startsAtNigeria': dt.datetime.fromtimestamp(args.since_ms / 1000, nigeria).isoformat()})
    if not args.apply:
        print(json.dumps({'dryRun': True, 'databases': summaries}, indent=2))
        return
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    # Consistent SQLite backups of BOTH databases before the first delete.
    for path, summary in zip(paths, summaries):
        if summary['previousResetAt'] == args.since_ms:
            continue
        directory = path.parent / 'retirement-backups' / ('calendar-' + stamp)
        directory.mkdir(parents=True, mode=0o700)
        backup = directory / path.name
        with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(backup) as target:
            source.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError(f'Backup integrity failed: {backup}')
        backup.chmod(0o600)
        summary['backup'] = str(backup)
    for path, summary in zip(paths, summaries):
        if summary['previousResetAt'] == args.since_ms:
            summary['status'] = 'Already reset; no records changed'
            continue
        with sqlite3.connect(path, timeout=5) as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('CREATE TABLE IF NOT EXISTS daily_streak_archive_settings (id INTEGER PRIMARY KEY CHECK(id=1), reset_at INTEGER NOT NULL)')
            db.execute('DELETE FROM daily_streak_archive')
            db.execute('INSERT INTO daily_streak_archive_settings(id,reset_at) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET reset_at=excluded.reset_at', (args.since_ms,))
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError(f'Integrity check failed; rolling back: {path}')
        summary['status'] = 'Calendar cleared; other tables preserved'
    print(json.dumps({'applied': True, 'databases': summaries}, indent=2))


if __name__ == '__main__':
    main()
