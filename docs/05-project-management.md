# Balls49 Project Management and Current Structure

## Source of Truth for the Current Workspace

The real workspace structure in this project is currently flat but organized by role:

```text
balls49/
  bot.js                      # main runtime server and prediction engine
  collector.js                # draw collection and normalization
  ml_retrainer.py             # Python artifact retrainer
  ml_retraining_model.json   # artifact model output
  predictions.json            # prediction and result log
  draws.json                  # normalized draw data
  last_prediction.json        # latest prediction snapshot
  session_state.json          # persistent session snapshots
  streaks.json                # streak bookkeeping
  win_steps.json              # step win-history bookkeeping
  ml_streaks.json             # ML streak bookkeeping
  balls49-extension/         # Chrome extension UI and automation bridge
  web/                       # static HTML/CSS/JS UI assets
  docs/                      # design and project documentation
```

This is the current project shape and should be treated as the source-of-truth structure for maintenance and future changes.

## Current Runtime Model

The current runtime model is centered around:

1. `collector.js` fetching draw data.
2. `bot.js` computing predictions and confidence signals.
3. `ml_retrainer.py` refreshing the model artifact from `predictions.json`.
4. `balls49-extension/content.js` delivering the `EXECUTE_BET` event to the betting page.
5. `web/` static pages presenting dashboards and strategy details.

## Delivery and Release Workflow

For the current repo, the workflow should be:

1. Read or generate draw data with `collector.js`.
2. Run `bot.js` as the worker/server.
3. Let `bot.js` persist session and runtime state in JSON files.
4. Refresh `ml_retraining_model.json` through `ml_retrainer.py` whenever predictions history updates enough to reach 10, 50, or 100 draw milestones.
5. Load the extension from `balls49-extension/` to carry automated DOM actions.
6. Keep the static web UI in `web/` aligned to the server and extension messaging model.

## Documentation and Code Ownership

Documentation should describe the current implemented structure, not just a future architecture. The developer should update the docs when:

- new runtime files are added,
- the artifact schema changes,
- the extension and web asset folder structure changes,
- or the prediction/automation routes change.

## Testing and Validation Expectations

The current project should validate:

- `node --check bot.js` parser integrity,
- Python retrainer creation and artifact write integrity,
- `predictions.json` and `draws.json` load successfully,
- extension route integration with `/stream` and `/ack`,
- and page-level UI loading in the static `web/` assets.

## Refactoring Priorities

The current priorities are more realistic than the earlier design target:

1. Keep `bot.js` as the source of truth for prediction and execution orchestration.
2. Continue to formalize the artifact retraining model and tie it into the confidence path.
3. Add a proper dependency and environment manifest if the project is moved toward real packaging.
4. Separate static page assets from automation runtime assets in a later cleanup.
5. Centralize authentication, session, and authorization handling before treating the project as production-ready.

- Tag each release.
- Keep the previous extension package and server build available.
- Back up state before migrations.
- Record configuration schema changes.
- Provide a kill switch that blocks new bets without deleting state.
- Roll back code and configuration independently where possible.
