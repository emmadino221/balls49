# Encrypted application backups

## Current status

The operator configured `gdrive` with `drive.file` and `gdrive_backup` with
rclone crypt. An encrypted sample-file round trip succeeded. Production OAuth
status is enabled. Previously disclosed OAuth client secrets still need retiring.
The daily timer and failure email delivery were subsequently confirmed by the operator.
The retention implementation below takes effect when deployed to the worker checkout.

Operator subsequently confirmed manual archive and database checks, successful
decryption of three website records, and a working daily systemd timer at 02:30
Africa/Lagos. The worker backup contained no encrypted records to validate its
vault against. A full service restore remains pending. Automatic retention is implemented locally
and must be deployed before it runs.

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
backups. Alert failures remain visible in the backup-alert service journal. Failure alerts also cover cleanup errors because they fail the backup service.

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
restoration. For additional restore verification:
validate manifest hashes, open both restored databases, and verify the vaults
against restored encrypted data without printing secrets. Never start a recovered
bot with live Telegram, website publishing, or betting credentials during a test.

## Thirty-day retention

After upload/download SHA-256 verification, the script lists only the immediate
application-backups folder and considers exact backup-YYYYMMDDTHHMMSSZ.tar.gz
names. Both the filename date and modification time must be older than 30 days.
It preserves the newest seven archives plus the current verified archive. Duplicate
names, future/invalid timestamps, or a missing current archive stop cleanup.
Each eligible file is moved individually to Google Drive trash. No directory is
purged, and no unrelated Drive trash is emptied. Trash can continue using storage
until Google or the account owner removes it. Failed cleanup exits nonzero and
triggers the existing failure-email hook; the freshly verified backup remains.

Deploy the worker update before the policy-page update so the published retention
policy reflects the installed implementation. No worker restart is required for
this Python script. A manual service run confirms upload and retention execution;
it does not prove the timer fired. Inspect timer LAST and service journal together.

## Scheduled-run evidence and old credentials

Run on the VPS (read-only):

```sh
systemctl list-timers --all balls49-backup.timer
sudo journalctl -u balls49-backup.service --since '48 hours ago' --no-pager
```

Match a timer firing at 01:30 UTC / 02:30 Africa/Lagos with a successful upload,
download verification and successful service completion. Do not publish credentials
from logs. After a later scheduled run succeeds with fresh authorization, the owner
can delete only the disabled old client secrets in Google Auth Platform. Keep the
fresh active secret and the OAuth client itself. This cannot be confirmed from Git.

## Full service rehearsal (still pending)

File checks, SQLite integrity and three website vault decryptions have passed in
operator-run checks. The worker contained no encrypted records. These checks do
not substitute for starting the complete restored application.

Use a separate fresh Linux test host or VM, with no public ingress and outbound
network denied by its hypervisor/cloud firewall before starting restored code.
Do not boot a production snapshot with unrestricted networking: its enabled services
can immediately publish, poll Telegram or place actions. Do not use the live VPS
as the rehearsal destination. Agree on this test machine before any provisioning.

Prepare the recorded repository revisions and required dependencies before locking
down outbound access. Transfer a verified archive securely; do not copy rclone's
crypt passwords into the test application environment. Verify every manifest checksum
and extract only regular files to a private staging directory; never use an unchecked
tar extraction or recreate arbitrary archive symlinks as root.

Prepare separate test configuration and databases, remove production cookies,
Telegram/email credentials and publishing targets, use test owner keys, bind HTTP
listeners to localhost and leave automation stopped. Preserve backed-up vault keys
with their matching databases. Never enable restored systemd units verbatim.
Use synthetic draw fixtures rather than the live upstream collector; verify the
website can read restored users/plans/history and the worker can load restored
state. Check authorization and rendering without sending emails, Telegram messages,
or betting commands. This rehearsal has not been executed and needs explicit
results from the isolated machine. Record any routes that cannot be verified offline.

After the rehearsal remove test credentials and restored personal data from that
machine. A real recovery must reconcile deletions, revocations and pending bets
since the chosen backup before enabling automation or issuing access.
