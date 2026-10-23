#!/usr/bin/env bash
# Run as the existing balls49 Linux user, never with `sudo bash`.
set -euo pipefail
if [ "$(id -un)" != balls49 ]; then
  echo 'Run this script as the balls49 user.' >&2; exit 1
fi
command -v node >/dev/null
command -v npm >/dev/null
command -v python3 >/dev/null
node_binary=$(command -v node)
source_repo=$(cd "$(dirname "$0")/.." && pwd)
site_repo=/home/balls49/balls49-site
if [ -e "$site_repo" ]; then
  echo "$site_repo already exists. Stop here and use the update instructions." >&2; exit 1
fi
sudo -v
sudo test -f /etc/letsencrypt/live/159.65.25.30/fullchain.pem
sudo test -f /etc/nginx/sites-available/balls49-extension
if sudo test -e /etc/balls49/site.env; then
  echo 'site.env already exists; refusing to replace credentials.' >&2; exit 1
fi

# A clean checkout excludes the private bot's ignored accounts and runtime files.
git clone --no-local "$source_repo" "$site_repo"
git -C "$site_repo" remote set-url origin https://github.com/emmadino221/balls49.git
npm --prefix "$site_repo/web" ci
npm --prefix "$site_repo/web" run build:same-origin
sudo install -d -m 700 -o balls49 -g balls49 /var/lib/balls49-site
sudo install -d -m 700 /etc/balls49
sudo python3 - <<'PY'
import os, secrets
secret = secrets.token_hex(32)
files = {
    '/etc/balls49/site.env': '\n'.join([
        'NODE_ENV=production', 'SITE_PUBLIC_MODE=true', 'SITE_SERVE_WEB=true',
        'HOST=127.0.0.1', 'PORT=3002',
        'SITE_DB_PATH=/var/lib/balls49-site/site_users.sqlite',
        'SITE_PUBLIC_URL=https://159.65.25.30',
        'SITE_ALLOWED_ORIGINS=https://159.65.25.30',
        'SITE_ADMIN_KEY=' + secrets.token_hex(32),
        'PREDICTION_INGEST_SECRET=' + secret, '']),
    '/etc/balls49/site-publisher.env': '\n'.join([
        'PREDICTION_INGEST_URL=https://159.65.25.30/internal/prediction-snapshot',
        'PREDICTION_INGEST_SECRET=' + secret, ''])
}
for filename, contents in files.items():
    fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as target:
        target.write(contents)
PY

sudo tee /etc/systemd/system/balls49-site.service >/dev/null <<EOF
[Unit]
Description=Balls49 public website
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=balls49
Group=balls49
WorkingDirectory=$site_repo
EnvironmentFile=/etc/balls49/site.env
ExecStart=$node_binary $site_repo/bot.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now balls49-site.service

# Check only the new website process before changing the reverse proxy.
ready=false
for attempt in {1..15}; do
  if curl --fail --silent http://127.0.0.1:3002/ >/dev/null; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo 'Website did not start. Existing proxy and bot are unchanged.' >&2
  sudo journalctl -u balls49-site.service -n 30 --no-pager
  exit 1
fi
proxy_backup="/etc/nginx/sites-available/balls49-extension.before-site-$(date +%s)"
sudo cp -p /etc/nginx/sites-available/balls49-extension "$proxy_backup"
sudo install -m 644 "$site_repo/deploy/balls49-site.nginx.conf" /etc/nginx/sites-available/balls49-extension
if ! sudo nginx -t; then
  sudo cp -p "$proxy_backup" /etc/nginx/sites-available/balls49-extension
  echo 'Previous nginx configuration restored. Website process remains available on localhost.' >&2
  exit 1
fi
sudo systemctl reload nginx

sudo install -m 644 "$site_repo/deploy/balls49-site-backup.service" /etc/systemd/system/balls49-site-backup.service
sudo install -m 644 "$site_repo/deploy/balls49-site-backup.timer" /etc/systemd/system/balls49-site-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now balls49-site-backup.timer
sudo systemctl start balls49-site-backup.service

# Keep all existing bot environment settings; override only its feed destination.
sudo install -d /etc/systemd/system/balls49-bot.service.d
sudo tee /etc/systemd/system/balls49-bot.service.d/zz-site-publisher.conf >/dev/null <<'EOF'
[Service]
EnvironmentFile=/etc/balls49/site-publisher.env
EOF
sudo systemctl daemon-reload
sudo systemctl restart balls49-bot.service
echo 'Website installed at https://159.65.25.30'
echo 'The bot now publishes to the VPS website. Users can register again.'
echo 'Owner credentials are stored in /etc/balls49/site.env (root-readable only).'
echo 'Daily database backups are enabled; keep additional copies off this VPS.'
