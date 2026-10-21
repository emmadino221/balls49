# Account dashboard

`account.html` is the member landing page after login. The header's signed-in
action and footer link open it. The static build generates its HTML entry point.

The dashboard loads `/auth/me` using the existing cookie session. Only safe account
fields are returned: email, name, expiry, approval status, and effective plan.
An expired plan has trial access and an `expired` status; its original expiry is
retained for display. Keys, passwords, and extension credentials are not included.

Members see their current plan, available markets, expiry in local time, Telegram
entitlement, and links to predictions, trial, history, pricing, guide, and support.
Details refresh every minute while visible, when returning to the tab, or through
the refresh button. The prediction API remains responsible for access enforcement.

There is no payment or renewal-request tracker in this release. The renewal panel
describes the existing manual approval process and links to pricing. It does not
claim that a renewal request or payment has been received.

Owner sessions link to the existing approvals/preview controls. Signed-out visitors
see login/signup actions; network errors show retry controls rather than plan data.
The layout uses existing light/dark theme variables and stacks on smaller screens.

Deploy the backend account response and frontend together. Build the web project
with its existing `npm --prefix web run build` command. No database migration or
account reset is required. No extension or automation changes are required.
