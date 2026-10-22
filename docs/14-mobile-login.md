# Same-address website and login

The separate balls49.onrender.com frontend and emmybet.onrender.com API depend on
cross-site session cookies. A browser can accept the login response but block the
cookie, causing the next account request to be unauthenticated. SameSite=None and
credentials:include do not override third-party-cookie blocking.

## Deployment on the existing emmybet Render web service

Keep this existing service and its persistent database; do not create a replacement
database, delete accounts, or regenerate approval data. The VPS worker and extension
gateway do not need this mode enabled.

After pushing this update, configure **emmybet**:

- Build command: `npm --prefix web ci && npm --prefix web run build:same-origin`
- Start command: `node bot.js` (unchanged)
- `SITE_PUBLIC_MODE=true` (already configured)
- `SITE_SERVE_WEB=true`
- `SITE_PUBLIC_URL=https://emmybet.onrender.com`
- `SITE_ALLOWED_ORIGINS=https://emmybet.onrender.com,https://balls49.onrender.com`
  Keep any other currently trusted site origins until migration is complete.

Keep the existing SITE_DB_PATH, persistent disk, admin key, ingest secret and other
service settings. Save and deploy the latest commit. The specialized build command
forces all three browser API URLs to `/api/...`, even if old VITE_* variables are
still configured on Render. No API or admin credentials go into the browser build.

Open **https://emmybet.onrender.com/login.html** directly on the phone. Login should
remain active when opening Account, Predictions and Analysis. Requests now go to
the same hostname at `/api/auth/login`, `/api/auth/me`, etc. The existing HttpOnly,
Secure session cookie and server-side origin/auth checks remain enabled. The login
form checks `/auth/me` before navigating to avoid an unexplained login loop.

Only after confirming the new website works, redirect the old balls49 static site
to the new address using Render Redirects/Rewrites:

| Source | Destination | Action |
| --- | --- | --- |
| `/` | `https://emmybet.onrender.com` | Redirect |
| `/*` | `https://emmybet.onrender.com/*` | Redirect |

Render does not override existing static resources with redirect rules. Therefore
do not assume adding these rules to the old site's existing build redirects its
HTML files. Until a deliberate redirect-only static build is deployed, distribute
the new address directly. Do not shut down the old site before migration is ready.

## Server boundaries

Serving web files is opt-in and permitted only in public mode. Only known built
HTML pages and selected asset types under web/dist/assets are served; repository
files, .env files, account databases and source maps are not served. API requests
retain the existing public route allowlist and session permissions. The existing
unprefixed API/ingestion routes remain available for the publisher and old clients.
Missing web/dist fails startup rather than exposing a repository directory.

## Rollback

Disable SITE_SERVE_WEB and restore the previous build command to return to the
separate-site deployment. Keep the database and original allowed origin intact.
This restores the prior setup, including its mobile-cookie limitation.

No browser verification or deployment has been performed by this implementation.
Reference: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
