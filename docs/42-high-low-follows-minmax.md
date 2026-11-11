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

The Lab's saved state lives in the website database, which the worker cannot
read. The worker instead replays Minimum/Maximum v2 over the completed draws
it already has (`predictHighLowFromMinmax` in `high-low.js`, same
`betzero-minmax.js` rules). It also includes the last 40 archive results so
the pick keeps going across the daily history reset.

Two replays that start from different points settle onto the same method
after a few draws, so the live pick matches the Lab card in normal running.
They can differ for a short time after the Lab's HIGH/LOW or
Minimum/Maximum v2 history is reset or the Lab misses draws.
