# Encrypted application backups

## Current status

The operator configured `gdrive` with `drive.file` and `gdrive_backup` with
rclone crypt. An encrypted sample-file round trip succeeded. Production OAuth
status is enabled. Previously disclosed OAuth client secrets still need retiring.
The script below is prepared; no application backup schedule or 30-day automatic
retention is installed by adding these files.

Operator subsequently confirmed manual archive and database checks, successful
decryption of three website records, and a working daily systemd timer at 02:30
Africa/Lagos. The worker backup contained no encrypted records to validate its
vault against. Automatic retention and a full service restore remain pending.

## Email failure alerts

Uses the existing RESEND_API_KEY and SITE_EMAIL_FROM from site.env. No emails are
sent merely by installing the files. Once enabled, systemd invokes the notifier
when the backup service fails, including a timeout or nonzero exit. It sends only
a generic message and journal inspection instructions, never exception details.

After deploying this update to the worker checkout:

```sh
sudo install -m 644 deploy/balls49-backup-alert.service /etc/systemd/system/
sudo install -d -m 755 /etc/systemd/system/balls49-backup.service.d
sudo install -m 644 deploy/balls49-backup-alert.conf /etc/systemd/system/balls49-backup.service.d/alert.conf
sudo install -m 600 /dev/null /etc/balls49/backup-alert.env
sudo nano /etc/balls49/backup-alert.env
```

Set BACKUP_ALERT_TO to the owner's chosen email (one address). Do not put an API
key in the unit file or repository. Preserve existing backup-alert.env on later
updates instead of rerunning the install-from-/dev/null command.

```sh
sudo systemctl daemon-reload
systemctl show balls49-backup.service -p OnFailure
```

No bot/site restart is necessary. A deliberate notification check can be performed
with `sudo systemctl start balls49-backup-alert.service`; this sends a failure
message even without a failed backup, so only do so when explicitly testing email
delivery. Resend acceptance is not proof of inbox delivery. The notifier retries
temporary failures up to three times using the same idempotency key.

If the VPS is offline, the timer is disabled, or networking/Resend is unavailable,
this on-server alert cannot guarantee notification. Independently check for stale
backups. Alert failures remain visible in the backup-alert service journal. No
automatic archive deletion is enabled by this change.

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
