# Move the public website from Render to the existing VPS

Users have agreed to register again. This procedure does not import Render
accounts or reset the private bot's records or extension progression.

## Architecture

- `https://159.65.25.30`: website and its API on the same origin.
- `balls49-site.service`: public mode, localhost port 3002.
- `/home/balls49/balls49-site`: separate clean application checkout.
- `/var/lib/balls49-site/site_users.sqlite`: persistent accounts, approvals,
  website history, sessions and reset settings, outside the Git checkout.
- Existing extension requests still go to the private bot on localhost port 3001.
- The private bot sends signed snapshots over HTTPS to the new website.
- Existing certificate renewal and ACME challenge directory remain in place.

The old Render website stops receiving new predictions after cutover. Its
onrender.com address cannot be moved to a different host. Share the VPS HTTPS
address with users; use a custom domain later if desired.

## First installation

Run in the VPS terminal as `balls49`. Pause extension auto-trading and let any
outstanding bet settle first: installation restarts the private bot once.
Do not run the installer through `sudo bash`.

```bash
cd ~/balls49
git pull --ff-only origin main
bash deploy/install-vps-site.sh
```

The installer builds the website, generates new secrets without printing them,
starts the public service, backs up the existing nginx configuration, validates
the replacement before reloading, then switches the signed publisher destination.
It requires the existing nginx site `/etc/nginx/sites-available/balls49-extension`
to be enabled and the current HTTPS certificate to be installed. If it fails,
stop and inspect the error; do not delete the new database or rerun blindly.

Open `https://159.65.25.30/signup.html`. Register and log in. To read the new
owner key privately in your VPS terminal:

```bash
sudo sed -n 's/^SITE_ADMIN_KEY=//p' /etc/balls49/site.env
```

Do not share that output. Use the key in the website owner controls to approve
accounts. If email verification is desired, configure `RESEND_API_KEY` and
`SITE_EMAIL_FROM` in `/etc/balls49/site.env`; those Render settings are not copied.

Check service and publisher messages if predictions have not appeared:

```bash
systemctl is-active balls49-site balls49-bot nginx
sudo journalctl -u balls49-site -n 30 --no-pager
sudo journalctl -u balls49-bot -n 30 --no-pager
```

Do not expose ports 3001 or 3002 through the firewall. Existing HTTPS port 443
and ACME port 80 are sufficient. Keep certificate renewal enabled.

## Backups

The installer enables daily backups automatically. To reinstall the timer later:

```bash
sudo cp ~/balls49-site/deploy/balls49-site-backup.service /etc/systemd/system/
sudo cp ~/balls49-site/deploy/balls49-site-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now balls49-site-backup.timer
sudo systemctl start balls49-site-backup.service
```

Daily consistent SQLite backups are kept under `/var/lib/balls49-site/backups`;
the newest 30 successful copies are retained. Download copies to a separate
computer regularly. Local backups do not protect against loss of the VPS disk.
Backups contain account credentials and must remain private, never in Git.

## Later website deployments

```bash
sudo systemctl start balls49-site-backup.service
cd ~/balls49-site
git pull --ff-only origin main
npm --prefix web ci
npm --prefix web run build:same-origin
sudo systemctl restart balls49-site
```

Run each command only if the preceding one succeeds. The database stays outside
the checkout. Private bot changes are deployed separately in `~/balls49` using
the existing bot service. Do not run the initial installer again for updates.

## Rollback

Keep Render until the VPS login, owner approval, history, predictions and extension
have been checked. To restore the old publisher, remove only the new override:

```bash
sudo rm /etc/systemd/system/balls49-bot.service.d/zz-site-publisher.conf
sudo systemctl daemon-reload
sudo systemctl restart balls49-bot
```

This restores the previous environment settings if they still point to Render.
Restore the timestamped nginx backup if needed, run `sudo nginx -t`, then reload
nginx. Keep the new website database; accounts created there do not automatically
appear on Render. No database or private bot state should be deleted.
