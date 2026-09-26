# User Management and Prediction Access in the Current Codebase

## Current Runtime Identity and Session Model

The codebase currently has a local session model driven by a browser-generated `clientId` and a configuration map persisted in `session_state.json`.

In the current Node server in `bot.js`:

- A `userSessions` object is created for each `clientId`.
- Each session contains `userTracker`, `wallets`, `martingaleState`, `masterState`, `cooldowns`, `config`, `stats`, `lastBetDrawId`, and `lastBetDetails`.
- State is periodically persisted through `persistSessions()` into `session_state.json`.

The `balls49-extension` content script and popup send browser-originated configuration and user/session identifiers to the server endpoints.

## Current Resource Access Pattern

The current endpoint pattern is locally implemented with route-like handling and browser session identification, rather than a full production authentication model. The live structure is:

- `/stream` — returns pending instructions and automation payloads.
- `/ack` — accepts execution acknowledgements from the browser extension.
- `/config` — accepts configuration changes.
- `/backtest` — accepts backtest requests.
- `/balance` and balance verification update endpoints — used by the extension and server.

## Security Note

The files currently reflect a hybrid proof-of-concept implementation. A browser `clientId` is accepted for session routing and local session restoration, but the project should not be treated as a production-grade identity and access system.

## Recommended Production Model

The recommended direction is to add a full user record model with:

- Internal user ID.
- Email or username.
- Password hash and local credential storage separated from browser storage.
- Account status and license/subscription status.
- Last login, last activity, and audit timestamps.

The current architecture should remain session-based at the local server level, but the user account model should be upgraded toward a more secure access model before live production use.

## Roles and Access

The existing project may keep the following roles conceptually:

- Owner — owns deployment/configuration/license.
- Operator — can run automation and strategies.
- Viewer — can read reports and predictions.
- Administrator — may manage configuration and accounts.

These roles should be enforced server-side, not by the extension.

## Prediction Access Rules

1. The server should not trust a browser-supplied `clientId` alone for authorization.
2. The session should be tied to a verified authenticated user or a properly scoped token.
3. Prediction and result access should be filtered to only that user’s session or a safe shared view.
4. `/ack`, `/config`, `/reset`, and `/stream` execution should carry fresh authorization checks.
5. License status and feature access should be respected before allowing writes or execution.

## Current Improvement Target

The structure should evolve toward:

- a server-owned session store,
- authenticated sessions or tokens,
- authorization checks before `/stream` and `/ack`,
- permit/deny checks around market access and automation.

This will let the existing local JSON and browser-side model become closer to a production security model without changing the rest of the project structure.

## Current Gap

The current client ID and license-key flow is suitable for local development but should not be treated as production access control until server-side authentication and authorization are implemented.
