#!/usr/bin/env python3
"""Create a private SQLite/state backup and verify its encrypted Drive upload.

Run as root on the VPS. Uses the balls49 user's existing rclone configuration.
Does not stop services, restore live files, or delete old backups.
"""
import datetime
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import pwd
import sqlite3
import subprocess
import tarfile
import tempfile
import time

USER = 'balls49'
WORKER = Path('/home/balls49/balls49')
SITE = Path('/home/balls49/balls49-site')
DESTINATION = 'gdrive_backup:application-backups/'
STATE_NAMES = (
    'session_state.json', 'site_users.json', 'draws.json', 'predictions.json',
    'last_prediction.json', 'streaks.json', 'win_steps.json', 'ml_streaks.json',
    'ml_retraining_model.json', 'telegram_prediction_outbox.json',
    'collector_daily_reset.json', 'daily_pending_settlements.json',
)


def service_env(service):
    pid = subprocess.check_output(
        ['systemctl', 'show', service, '--property=MainPID', '--value'], text=True).strip()
    if not pid.isdigit() or int(pid) <= 0:
        raise RuntimeError(f'{service} is not running; cannot resolve its live configuration')
    entries = Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
    return dict(entry.decode().split('=', 1) for entry in entries if b'=' in entry)


def configured_path(env, name, fallback, cwd):
    path = Path(env.get(name) or fallback)
    return path if path.is_absolute() else cwd / path


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run with sudo python3 scripts/backup-vps.py')
    os.umask(0o077)
    lock = open('/run/lock/balls49-backup.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    account = pwd.getpwnam(USER)
    config = Path(account.pw_dir) / '.config/rclone/rclone.conf'
    if not config.is_file():
        raise RuntimeError('Expected rclone configuration is missing')
    if config.stat().st_uid != account.pw_uid or config.stat().st_mode & 0o077:
        raise RuntimeError('rclone.conf must belong to balls49 with permissions 600')
    rclone = ['runuser', '-u', USER, '--', 'rclone', '--config', str(config)]
    remotes = subprocess.check_output(rclone + ['listremotes'], text=True).splitlines()
    if 'gdrive_backup:' not in remotes:
        raise RuntimeError('Encrypted gdrive_backup remote is missing')
    # Never send the archive through an unencrypted remote of the same name.
    import configparser
    settings = configparser.ConfigParser(interpolation=None)
    settings.read(config)
    if settings.get('gdrive_backup', 'type', fallback='') != 'crypt':
        raise RuntimeError('gdrive_backup must be an rclone crypt remote')
    worker_env = service_env('balls49-bot')
    site_env = service_env('balls49-site')
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    manifest = {'createdUtc': timestamp, 'files': [], 'missingOptional': [],
                'consistency': 'Each SQLite database is consistent. Live JSON files are validated individually; this is not an atomic snapshot across services.',
                'restoreWarning': 'Restore offline. Do not start restored betting services until credentials, pending bets and sessions have been reviewed.'}
    with tempfile.TemporaryDirectory(prefix='balls49-backup-') as temporary:
        stage = Path(temporary)
        archive = stage / f'backup-{timestamp}.tar.gz'
        added = set()
        with tarfile.open(archive, 'w:gz') as tar:
            def add_bytes(source, content):
                source = Path(source).absolute()
                if str(source) in added:
                    return
                added.add(str(source))
                name = 'files/' + source.as_posix().lstrip('/')
                info = tarfile.TarInfo(name)
                info.size, info.mode, info.mtime = len(content), 0o600, int(time.time())
                tar.addfile(info, io.BytesIO(content))
                manifest['files'].append({'path': str(source), 'sha256': hashlib.sha256(content).hexdigest()})

            def add_file(path, optional=False, validate_json=False):
                path = Path(path)
                if not path.exists() and optional:
                    manifest['missingOptional'].append(str(path))
                    return
                for attempt in range(5):
                    try:
                        content = path.read_bytes()
                        if validate_json:
                            json.loads(content)
                        add_bytes(path, content)
                        return
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        if attempt == 4:
                            raise RuntimeError(f'Could not capture valid JSON: {path}') from None
                        time.sleep(0.2)

            for label, env, cwd, fallback in (
                ('website', site_env, SITE, '/var/lib/balls49-site/site_users.sqlite'),
                ('worker', worker_env, WORKER, str(WORKER / 'site_users.sqlite')),
            ):
                database = configured_path(env, 'SITE_DB_PATH', fallback, cwd)
                key = configured_path(env, 'SITE_VAULT_KEY_FILE', str(database) + '.security-key', cwd)
                key_before = key.read_bytes()
                if len(key_before) != 32:
                    raise RuntimeError(f'Invalid vault key length for {label}')
                snapshot = stage / f'{label}.sqlite'
                deadline = time.monotonic() + 180
                def progress(status, remaining, total):
                    if time.monotonic() > deadline:
                        raise RuntimeError('SQLite backup exceeded three minutes')
                with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as source:
                    with sqlite3.connect(snapshot) as target:
                        source.backup(target, pages=256, progress=progress)
                        if target.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                            raise RuntimeError(f'Integrity check failed for {label}')
                if key.read_bytes() != key_before:
                    raise RuntimeError('Vault key changed during backup; retry')
                add_bytes(database, snapshot.read_bytes())
                add_bytes(key, key_before)
            for name in STATE_NAMES:
                add_file(WORKER / name, optional=True, validate_json=True)
            keys = configured_path(worker_env, 'EXTENSION_KEYS_FILE', str(WORKER / 'extension-users.json'), WORKER)
            add_file(keys, validate_json=True)
            add_file(WORKER / 'cookies.txt', optional=True)
            for path in ('/etc/balls49.env', '/etc/balls49/site.env',
                         '/etc/balls49/extension.env', '/etc/balls49/site-publisher.env'):
                add_file(path)
            for root in (Path('/etc/nginx'), Path('/etc/letsencrypt')):
                for path in sorted(root.rglob('*')):
                    if path.is_file() and not path.is_symlink():
                        add_file(path)
                    elif path.is_symlink():
                        manifest.setdefault('symlinks', []).append({'path': str(path), 'target': os.readlink(path)})
            for service in ('balls49-site', 'balls49-bot', 'balls49-collector'):
                add_file(f'/etc/systemd/system/{service}.service')
                for path in Path(f'/etc/systemd/system/{service}.service.d').glob('*.conf'):
                    add_file(path)
            for cwd in (SITE, WORKER):
                manifest.setdefault('commits', {})[str(cwd)] = subprocess.check_output(
                    ['runuser', '-u', USER, '--', 'git', '-C', str(cwd), 'rev-parse', 'HEAD'], text=True).strip()
            data = json.dumps(manifest, indent=2).encode()
            info = tarfile.TarInfo('manifest.json')
            info.size, info.mode = len(data), 0o600
            tar.addfile(info, io.BytesIO(data))
        remote = DESTINATION + archive.name
        with archive.open('rb') as stream:
            subprocess.run(rclone + ['rcat', remote], stdin=stream, check=True, timeout=1800)
        # Download through crypt again and compare every byte without printing contents.
        expected = hashlib.sha256()
        with archive.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                expected.update(block)
        restored = stage / 'downloaded.tar.gz'
        with restored.open('wb') as stream:
            subprocess.run(rclone + ['cat', remote], stdout=stream, check=True, timeout=1800)
        actual = hashlib.sha256()
        with restored.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                actual.update(block)
        if expected.digest() != actual.digest():
            raise RuntimeError('Downloaded backup checksum did not match')
        print(f'Backup uploaded and download verified: {remote}', flush=True)
        print(f'Files: {len(manifest["files"])}; optional files absent: {len(manifest["missingOptional"])}')
        print('No live files were restored. No old backups were deleted.')


if __name__ == '__main__':
    main()
