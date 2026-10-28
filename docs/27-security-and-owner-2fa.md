# Security update and owner two-factor authentication

This update requires both worker and website deployments. It does not activate
2FA until the owner enrolls and confirms a code. Existing owner sessions will be
signed out once because they lack the new credential version; member sessions
are unaffected. No production security changes have been deployed by writing
this document.

## Before deployment

Back up the website SQLite database using a consistent SQLite backup, the worker
extension key store, and existing server environment configuration. Keep the
current SITE_ADMIN_KEY for the first startup: existing automation links must be
decrypted with it before migration. Do not change that key during this deployment.

The website creates a separate random 32-byte vault key with Unix mode 0600 at
`<SITE_DB_PATH>.security-key`. Set SITE_VAULT_KEY_FILE to a persistent absolute path
if necessary. Its directory must be writable by the service user. The worker's
separate database also gets its own key. Back up each vault key securely alongside
its corresponding database, with restricted access. Never commit or share a key.
Losing it makes encrypted links and authenticator secrets unreadable. Subsequent
SITE_ADMIN_KEY rotations invalidate owner sessions without changing this vault key.

## Trusted Nginx client address (required to fix shared login limits)

In the website server's Nginx `location` blocks proxying requests to port 3002,
overwrite the client address header:

```nginx
proxy_set_header X-Real-IP $remote_addr;
```

Keep the existing Host and X-Forwarded-Proto headers. Do not use an incoming
X-Real-IP value or blindly trust incoming X-Forwarded-For. If a CDN sits before
Nginx, configure its trusted address ranges separately before changing this.

In `/etc/balls49/site.env`, add:

```dotenv
SITE_TRUSTED_PROXIES=127.0.0.1,::1,::ffff:127.0.0.1
HOST=127.0.0.1
```

Confirm ports 3001 and 3002 are not publicly exposed. Validate Nginx with
`sudo nginx -t` before reloading it, then restart the site service after changing
its environment. The application trusts only the configured socket peers and
a single valid X-Real-IP address. Without this configuration it keeps the previous
socket-IP behavior; do not consider the proxy-rate-limit issue deployed until
this step is complete.

## Owner setup

1. Sign in again under Predictions > Owner tools using the existing owner key.
2. Open Owner security and enter that key again.
3. Choose Set up authenticator. In an authenticator app, choose Add account and
   scan the displayed QR code. It is generated locally in the browser, without
   sending the secret to a QR service. If scanning is unavailable, expand the
   manual setup option and add a time-based account using its setup secret.
4. Enter its six-digit code and choose Confirm and enable 2FA within ten minutes.
5. Save the ten recovery codes somewhere private outside the website. They are
   shown once. Each can replace an authenticator code once, alongside the owner key.

Future owner logins require both the owner key and an authenticator/recovery code.
Codes use a 30-second period with one adjacent period of clock tolerance and cannot
be replayed after acceptance. Second-factor attempts are also limited across IPs
after a correct owner key, to ten failures per ten-minute window. A successful setup keeps the enrolling session but
revokes other owner sessions. Recovery-code login revokes older owner sessions.
Wait for a new authenticator code before performing another protected action.
Keep VPS and phone clocks synchronized. The website never sends the setup secret
to an external QR-code service.

Owner security can disable 2FA or sign out all owner sessions, with fresh owner
key and second factor when enabled. Disable signs out the current session too.
The user account deletion panel still has its own typed-email confirmation.

## Emergency recovery

Use an unused recovery code first. If both phone and recovery codes are lost,
an authorized VPS operator can run, as the website service user:

```sh
cd ~/balls49-site
node owner-security-recovery.js --disable-2fa /absolute/path/to/site_users.sqlite
```

Replace the database path with the configured SITE_DB_PATH. This intentionally
disables owner 2FA and invalidates owner sessions. It does not reveal the owner key
or restore a missing vault key. Sign in and enroll again immediately. No recovery
endpoint is exposed over HTTP.

## Other fixes and limits

- Worker member keys retain accountEmail ownership independently of the website
  link. Linking or unlinking binds legacy keys without changing their expiry.
  Deletion always asks the worker to revoke account-owned keys, including unlinked
  ones. A worker outage blocks deletion for retry instead of silently leaving keys
  active. Keys unlinked before this update without any historical ownership cannot
  be automatically attributed; manually revoke those legacy keys by their known ID.
- Members cannot bind owner keys or another account's bound key. Owner sessions
  can still link the owner extension key.
- HTML responses prohibit framing. A broader CSP is report-only for compatibility
  review; framing, object embedding and base-URL restrictions are enforced now.
  Check browser CSP messages before tightening scripts, styles, external APIs or
  video sources. This is defense in depth, not proof that XSS is impossible.
- All owner sessions are checked against the current login key and a revocable
  security version. Changing SITE_ADMIN_KEY requires a service restart and
  invalidates existing owner sessions at their next request.

Syntax checks and the production build are local checks only. Authenticator
enrollment, recovery, proxy address handling and deployed headers still need
end-to-end verification. No live accounts or bets were exercised during implementation.

References: [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238),
[OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).
