# Balls49 Security and Runtime Safety Notes

## Current Scope

The project contains:

- a Node runtime in `bot.js`,
- a Python retrainer in `ml_retrainer.py`,
- a browser automation extension in `balls49-extension/`,
- static web assets in `web/`,
- bet data and prediction artifacts in JSON files such as `predictions.json`, `draws.json`, `session_state.json`, `streaks.json`, and `ml_retraining_model.json`.

That means secrets, browser automation, prediction history, state files, and betting operations all need to be protected at the same time.

## Current Secret and Credential Pattern

The Node and Python bot code read `TELEGRAM_BOT_TOKEN` from the environment; the Node worker reads personal and channel destinations from `TELEGRAM_CHAT_ID` and `TELEGRAM_CHANNEL_ID`. The optional Google Sheets endpoint is read from `GOOGLE_SHEET_URL`. Do not add these values to source files or frontend build variables. `cookies.txt`, account files, prediction history, and runtime state are excluded by `.gitignore` and must stay private.

## Current Runtime Security Gaps to Address

The current implementation should be considered an automation prototype rather than a hardened production system. The key security gaps are:

1. Telegram tokens must be rotated if they were previously committed or shared. The legacy Python source previously contained a token; it now requires the environment variable.
2. Browser client IDs are used as session selectors.
3. The extension contains browser automation selectors and browser storage flow.
4. JSON files hold state, prediction data, and possibly user-sensitive runtime context.
5. The browser automation path should not trust server strings or page DOM layout blindly.

## Required Safety Rules

### Secrets

- Store all live credentials in environment variables or a secret manager.
- Remove hard-coded fallback tokens from distributed files.
- Do not store secrets in the extension codebase or in browser persistent storage.

### Browser Automation

- Use extension permissions minimally.
- Avoid unsanitized DOM injection.
- Treat selectors and page layout as unstable.
- Validate payloads before handing them to the extension and then to the betting page.

### API and Session Flow

- Validate all route inputs and payloads before writing them to state.
- Keep user session isolation server-side.
- Do not allow one `clientId` or browser identity to bypass access control.
- Require fresh authorization for `stream`, `ack`, `config`, `reset`, and backtest actions.

### Data Persistence

- Keep `cookies.txt`, `session_state.json`, and sensitive logs out of public source control.
- Prefer atomic writes and safe file replacement.
- Support a secure backup and restore process for state data.
- Avoid exposing full prediction logs in public reports.

## Current Retrieval and Artifact Model

The retrainer writes `ml_retraining_model.json` with rolling windows and feature-vector summaries. This artifact should be treated as non-sensitive statistical output, but it should still be protected from accidental public access.

## Monitoring and Recovery

The project should monitor:

- bot exceptions,
- collector failures,
- balance mismatch warnings,
- failed acknowledgements,
- stalled prediction updates,
- and extension DOM failures.

On restart, the bot should restore `session_state.json` and then continue safely from the persisted session and latest prediction stream.


