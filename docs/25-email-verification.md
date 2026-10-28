# Signup email verification

## VPS configuration

Set these in `/etc/balls49/site.env` (edit existing entries rather than adding duplicates):

```ini
RESEND_API_KEY=your-private-key
SITE_EMAIL_FROM="Emmy-Bet <noreply@mail.emmyfxchart.com>"
SITE_PUBLIC_URL=https://predictions.emmyfxchart.com
```

The sending domain must be verified in Resend. Keep the API key out of Git and screenshots. Rebuild the website and restart `balls49-site` after deploying the code. The private bot process does not need the key.

## Signup flow

1. Name and email on signup; no credentials are stored yet.
2. Resend sends a six-digit code and a link to `/verify-email.html`. The link carries a random challenge in the fragment (not a server query parameter).
3. User enters the code and chooses/confirms a password. The code expires after 10 minutes.
4. Verification creates the account, hashes the password with the existing scrypt flow, marks the email verified, and creates the normal HTTP-only login session.
5. A separate welcome email is attempted after verification. Failure is logged without undoing account creation; welcome mail has no automatic retry queue.
6. Premium/Elite plan approval remains an owner action.

Resend is available from the verification page and linked from login. It requires a pending signup or an existing explicitly unverified user. Approved and legacy accounts retain their credentials and plan. Previously unverified users choose their own password only after email proof; submitting signup never overwrites an account. If an owner confirms the account while a code is pending, the code cannot replace its password.

## Limits and storage

`site_email_codes` is created additively in the existing SQLite site database. It stores challenge and code digests, email/name, expiry, attempts and send counters. The raw challenge is required to validate the code; neither raw code nor raw challenge is stored or logged. Old email-link endpoints no longer verify accounts; users request a new code. The old table is retained for compatibility but is not used to issue codes.

At most five code attempts per challenge. Resend replaces the old challenge, with a one-minute cooldown and three sends per email per hour persisted across restarts. Existing IP/email request throttles also apply. Pending code records older than 24 hours are pruned at startup and on issuance; a fresh signup is then needed if no user record exists. Password length remains 10 to 1024 characters. Code consumption/account update/session creation happen in one transaction, with a second challenge check after asynchronous password hashing.

No live emails were sent during implementation. After deployment, create a new account using an inbox you control, complete verification, check the welcome email, then confirm `/account.html` shows trial access. Provider failures log only HTTP status, not secrets, codes or response bodies. Check the Resend Emails dashboard for delivery details.
