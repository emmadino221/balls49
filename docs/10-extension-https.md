# Extension access without an SSH tunnel

The HTTPS gateway at https://159.65.25.30 supports an owner key and separate,
revocable member keys. A copy of the extension folder alone does not grant access.
Each member key maps to its own server-side automation session. This is manual
access management, not website subscription or payment integration.
Never share the owner's environment key: it controls the owner's session.

## Create, list and revoke member access

After deploying the updated bot, run these as the bot service account (`balls49`)
in `~/balls49`. Do not use sudo to create a root-owned registry that the bot cannot read.

```bash
node extension-users.js create "John"
node extension-users.js list
node extension-users.js revoke user_ext_REPLACE_WITH_ID_FROM_LIST
```

`create` prints a new key once. Send it privately to that person. The registry
stores only its SHA-256 hash; `list` does not disclose keys. To replace a lost key,
revoke it and create a new account (this starts a new session).
Names containing spaces must be quoted. Revoked entries remain as an audit record.

Members choose VPS HTTPS and enter their own key. They can manage their own games,
stakes, sniper settings, start/stop and reset their own session. The server derives
their session from their key, ignoring IDs supplied by the browser. Member access
does not permit owner/admin routes, Telegram recipient changes, or server backtests.
Owner environment settings and saved martingale/sniper state are retained.

Changes take effect without restarting the bot. Revoked keys fail subsequent API
requests and the next bot tick halts their session. Already delivered/executed bets
cannot be recalled; existing settlement history and progression are retained.
The key is a bearer credential: anyone who receives a member key can use that
member's session. Use one active automation browser per key.

The registry defaults to `extension-users.json` beside the bot and is gitignored.
Back it up privately alongside `session_state.json`. `EXTENSION_KEYS_FILE` can
override the path, but must match for both service and CLI. Missing/unreadable
records block member access; owner authentication remains independent.
Writes use a lock and atomic replacement. If a crashed CLI leaves a `.lock`, ensure
no CLI writer is running before removing that lock. Never delete the registry to
resolve a lock problem.

## Prepare the existing session

Pause automation and allow outstanding bets to settle before changing connections.
Reload the updated extension at chrome://extensions, refresh the game tab, and
open the popup. If necessary use Logout to display the connection form.
Copy **Existing session ID**. Do not clear extension storage or reset bets.
That ID must be used below to preserve the VPS session's martingale/sniper state.
The bot restores that session from session_state.json; keep that file.

## Server requirements

- Deploy bot.js, extension-access.js, extension-key-store.js and extension-users.js together.
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

New browsers use the session bound to their key regardless of their new
local ID. Use one active automation browser per key. The folder does not contain
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
