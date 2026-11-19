# High/Low follows Minimum/Maximum v2

The main (live) High/Low prediction now uses the same rule as the Lab's
HIGH/LOW card. It replaces the rule in `24-high-low-bet49.md`.

- Minimum/Maximum v2 on **MAX** for the next draw -> High/Low predicts **LOW**.
- Minimum/Maximum v2 on **MIN** for the next draw -> High/Low predicts **HIGH**.
- Minimum/Maximum v2 has no pick (number is 1 or 49, no starting method,
  fewer than five completed draw pairs, previous result missing) -> High/Low
  is **SKIP** for that draw, with the reason shown.

Win/loss is unchanged: six-ball total 148 or less is LOW, 152 or more is HIGH,
149-151 is MID and loses for either pick.

## How the worker gets the method

The Lab's saved state lives in the website database. The website includes
`labMinmax` in its signed-feed ingestion response; the private worker keeps that
state with the snapshot draw ID. `predictHighLowFromMinmax` in `high-low.js`
uses it when its validation permits (`stateSource: LAB`). It does not directly
open the website database.

When transmitted state cannot be used, the helper replays Minimum/Maximum v2
over completed history (`stateSource: REPLAY`, same `betzero-minmax.js` rules).
The worker also includes the last 40 archive results across daily history reset.
Replay uses up to 300 earlier valid draws and consecutive pairs. It cannot use
the target result to select that target's method.

Different starting histories, missing results or a Lab reset can produce
different state. Do not promise eventual agreement merely because both paths
use the same transition rule. Check the recorded state source, target draw,
method and skip reason when investigating a mismatch.
