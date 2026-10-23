"""Create a consistent SQLite backup, including committed WAL transactions."""
from datetime import datetime, timezone
from pathlib import Path
import os
import sqlite3

os.umask(0o077)
database = Path('/var/lib/balls49-site/site_users.sqlite')
directory = database.parent / 'backups'
directory.mkdir(mode=0o700, exist_ok=True)
name = datetime.now(timezone.utc).strftime('site-%Y%m%dT%H%M%S%fZ.sqlite')
temporary = directory / (name + '.partial')
with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as source:
    with sqlite3.connect(temporary) as target:
        source.backup(target)
temporary.rename(directory / name)
# Keep the newest 30 successful backups. Never delete the active database.
for old in sorted(directory.glob('site-*.sqlite'), reverse=True)[30:]:
    old.unlink()
print('Website database backup saved.')
