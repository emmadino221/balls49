# Extension access without an SSH tunnel

This is a single-owner gateway at https://159.65.25.30. It is not a
multi-customer licensing system. A copy of the extension folder alone does not
grant access: each browser needs the owner's access key entered privately.
The key controls the owner's automation session, including configuration and reset.

## Prepare the existing session

Pause automation and allow outstanding bets to settle before changing connections.
Reload the updated extension at chrome://extensions, refresh the game tab, and
open the popup. If necessary use Logout to display the connection form.
Copy **Existing session ID**. Do not clear extension storage or reset bets.
That ID must be used below to preserve the VPS session's martingale/sniper state.
The bot restores that session from session_state.json; keep that file.

## Server requirements

- The updated bot.js and extension-access.js must be deployed together.
- The bot must continue listening on 127.0.0.1:3001 in local mode.
- Nginx, Certbot 5.4+, ports 80/443, and a trusted IP certificate are required.
- /var/www/balls49-acme must serve /.well-known/acme-challenge/ over HTTP.
- Certbot renewal must be scheduled, with `systemctl reload nginx` as deploy hook.
  IP certificates expire after six days.

## Set the owner credentials on the VPS

Create a root-only environment file. This command refuses to replace an existing
one; rotate an existing key deliberately using sudoedit instead.

```bash
sudo install -d -m 700 /etc/balls49
sudo python3 - <<'PY'
import os, secrets
p = '/etc/balls49/extension.env'
fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write('EXTENSION_ACCESS_KEY=' + secrets.token_hex(32) + '\n')
    f.write('EXTENSION_CLIENT_ID=REPLACE_WITH_EXISTING_SESSION_ID\n')
PY
sudoedit /etc/balls49/extension.env
```

Replace only the session placeholder with the popup's `user_...` ID.
Copy the generated key privately for the popup. Never commit or share this file.
Missing/invalid settings cause the remote API to reject requests.

Add a separate systemd override:

```bash
sudo mkdir -p /etc/systemd/system/balls49-bot.service.d
sudo tee /etc/systemd/system/balls49-bot.service.d/extension.conf >/dev/null <<'EOF'
[Service]
EnvironmentFile=/etc/balls49/extension.env
EOF
sudo systemctl daemon-reload
sudo systemctl restart balls49-bot.service
sudo systemctl status balls49-bot.service --no-pager -l
```

## Enable HTTPS

From the updated ~/balls49 repository:

```bash
sudo cp /etc/nginx/sites-available/balls49-extension /etc/nginx/balls49-extension.before-https
sudo cp deploy/balls49-extension.nginx.conf /etc/nginx/sites-available/balls49-extension
sudo nginx -t
```

Only if the configuration check succeeds:

```bash
sudo systemctl reload nginx
```

The existing sites-enabled symlink must point to this sites-available file.
Keep port 3001 closed externally. Never proxy `/` to the bot.
Unprefixed API routes are for trusted loopback callers only.

## Connect

Select **VPS HTTPS (no tunnel)** and enter the generated access key.
The popup checks the bot's response before unlocking. Refresh the game tab after
changing connections. Resume automation only after confirming the expected
existing session state. No automation state is reset by selecting this connection.

New browsers use the same server-bound owner session regardless of their new
local ID. Use one active automation browser at a time. The folder does not contain
the access key; Chrome local storage contains the entered key.

## Troubleshooting / verification after deployment

- `curl -i https://159.65.25.30/extension/stats` should return 401 without a key.
- A 503 response means the key/session environment settings need correcting.
- `/stats`, `/admin/*`, `/internal/*`, and `/` must return 404 through Nginx.
- `sudo /snap/bin/certbot renew --dry-run` checks renewal.
- `sudo snap services certbot` and `systemctl list-timers --all | grep certbot`
  show the renewal schedule. Inactive between scheduled runs is normal.
- On connection errors check the bot, Nginx, certificate expiry, and firewall.
  Do not disable certificate validation.

To return to the tunnel, select **Local / SSH tunnel** and restart the original
SSH forwarding command. The local connection defaults are retained on upgrade.

References:
- https://letsencrypt.org/2026/03/11/shorter-certs-certbot
- https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
