# Encrypted application backups

## Current status

The operator configured `gdrive` with `drive.file` and `gdrive_backup` with
rclone crypt. An encrypted sample-file round trip succeeded. Production OAuth
status is enabled. Previously disclosed OAuth client secrets still need retiring.
The script below is prepared; no application backup schedule or 30-day automatic
retention is installed by adding these files.

## First manual backup on the VPS

After pulling this update into `/home/balls49/balls49`, run:

```sh
chmod 600 /home/balls49/.config/rclone/rclone.conf
cd /home/balls49/balls49
sudo python3 scripts/backup-vps.py
```

The script uses the running worker and website's environment to resolve database,
vault and extension-key-store paths. It expects the known service and environment
files, an unencrypted rclone configuration owned by balls49 with mode 600, and a
crypt remote named gdrive_backup. The rclone configuration contains sensitive
credentials and crypt keys; it must never be shared or committed. Rclone's crypt
password obfuscation is not encryption of that local configuration file.

Output must report upload and download verification before a backup is treated
as successful. Review errors locally and redact credentials before sharing logs.
The script does not print archive contents or secrets. A failed verification can
leave a remote archive; do not treat it as verified.

## Contents and consistency

- Website and worker SQLite databases are captured with SQLite's online backup
  API, checked with integrity_check, and paired with their 32-byte vault keys.
- Known worker JSON files are parsed before inclusion, with retries for writes.
  This is not an atomic snapshot across the two databases and worker files.
- Includes extension member keys, cookies if present, four environment files,
  Nginx configuration, certificate files, and systemd service units/drop-ins.
- Records source commit IDs, original file paths, per-file checksums and symlink
  targets in the archive manifest. Missing optional state files are recorded.
- Code is restored from Git at the recorded revisions. Custom untracked code and
  arbitrary files outside the listed locations are not included.
- Does not include rclone.conf. Save crypt password, salt, remote settings, and
  OAuth recovery information separately in a password manager outside the VPS.

Private temporary files are created with restrictive permissions under /tmp and
removed on normal exit or handled exceptions. Ensure enough disk space for two
archive copies plus SQLite snapshots. A crash or forced kill may leave temporary
files that require careful cleanup by an administrator.

## Verification and next steps

The uploaded archive is read back through rclone crypt and checked against the
local archive's SHA-256. This verifies transfer and decryption, not full service
restoration. Before scheduling or pruning, perform an isolated restore rehearsal:
validate manifest hashes, open both restored databases, and verify the vaults
against restored encrypted data without printing secrets. Never start a recovered
bot with live Telegram, website publishing, or betting credentials during a test.

Plan: daily uploads, 30-day application archive retention, failure reporting and
periodic isolated restore checks. Configure retention only within the dedicated
`gdrive_backup:application-backups/` folder after a verified backup and restore
rehearsal. Do not use sync against the whole Drive. Restoring account deletions,
revocations, pending bets and automation states requires explicit review to avoid
reintroducing revoked access or executing old actions.
