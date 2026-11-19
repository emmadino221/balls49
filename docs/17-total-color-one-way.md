# Winning Color

Market key: `totalColor1`. Winning Color predicts the first (top-ranked) color
from the shared internal color ranking. The ranking is not published as a
separate Total Color 2-way market. If it is skipped or invalid, Winning Color
also skips. A settled six-ball draw wins only if its winning color outcome
matches the issued one-way pick. Ties use No Winning Color, so they do not match
a color pick.

New predictions, results and independent streaks appear in Telegram and the
website. History starts with actually issued one-way picks; old records are not
reclassified as historical one-way predictions. Elite includes the new market;
Premium access requires the owner to approve this market. Free Trial uses the
existing last-10-seconds reveal rule. Analysis remains subscription protected.

Previously issued picks retain their original selections and settlement. This
rule change applies to newly generated predictions; historical performance still
includes the earlier excluded-color rule.

## Extension

Enable Winning Color, set its base stake and maximum step, choose its recovery mode,
and save settings. It is disabled by default and uses the existing Total Color
buttons. `black` selects No Winning Color. Calculations use 3.80 for all four
outcomes as requested; actual bookmaker payouts may differ.

- Same profit: next stake = (actual cycle losses + base stake * 2.8) / 2.8.
- Accumulating profit: next stake = (actual cycle losses + base stake * 2.8 *
  next actual bet number) / 2.8.
- Stakes round upward to whole naira, including the base stake.
- Base 100: fixed stakes 100, 136, 185; accumulating stakes 100, 236, 420.
- Waiting, skipped draws and sniper pauses do not add losses or bets.
- A placed winning bet resets the cycle. Global/statistical resets do not reset
  the extension's recovery ledger. Explicit Wipe Execution still clears it.
- The base and mode are pinned when the first bet is acknowledged; changing
  settings during a losing cycle takes effect after that cycle wins.
- Winning Color uses its own recovery calculation, not the flat-betting or rollover modes.
- Retired Unified prediction mode is not available; Winning Color uses its own
  progression.

The website calculator offers both modes. The prediction-card personal stake
plan uses the fixed-profit calculation and follows published outcomes; it is
separate from the extension's actually placed bets and sniper pauses.

## Deployment

Update and restart the private VPS bot. Update, rebuild and restart the separate
website checkout. Reload the unpacked Chrome extension and refresh the game tab
while automation is stopped, then save settings. Use the new extension with the
updated bot. No account database, history or existing progression reset is needed.

Syntax checks and website build do not establish successful live execution.
No real bets were placed and no automated tests were run during implementation.
