"""Clear website virtual history only, with a backup and persistent replay cutoff."""
import argparse
from pathlib import Path
import sqlite3
import time

parser = argparse.ArgumentParser()
parser.add_argument('--database', required=True)
args = parser.parse_args()
path = Path(args.database).resolve(strict=True)
started = int(time.time() * 1000)
backup = path.with_name(f'{path.name}.before-virtual-reset-{started}')
with sqlite3.connect(path.as_uri() + '?mode=rw', uri=True, timeout=30) as db:
    # Only this table is deleted. Account data and collector training data stay intact.
    db.execute('SELECT count(*) FROM site_virtual_matches').fetchone()
    with backup.open('xb'):
        pass
    backup.chmod(0o600)
    with sqlite3.connect(backup) as saved:
        db.backup(saved)
    db.execute('BEGIN IMMEDIATE')
    db.execute('CREATE TABLE IF NOT EXISTS site_virtual_history_epoch (id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL)')
    db.execute('INSERT INTO site_virtual_history_epoch VALUES (1,?) ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at', (started,))
    deleted = db.execute('DELETE FROM site_virtual_matches').rowcount
    db.commit()
print(f'Cleared {deleted} website virtual match records. Fresh history starts at Unix milliseconds {started}.')
print(f'Backup: {backup}')
