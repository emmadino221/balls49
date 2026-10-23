# Winning Color

Market key: `totalColor1`. The prediction is the single outcome not selected by
Total Color 3-way: red, blue, green or black (No Winning Color). The existing
three-way rule is unchanged. Missing valid three-way picks produce a skipped
one-way pick. A settled six-ball draw wins only if its winning color outcome
matches the issued one-way pick. Ties use No Winning Color.

New predictions, results and independent streaks appear in Telegram and the
website. History starts with actually issued one-way picks; old records are not
reclassified as historical one-way predictions. Elite includes the new market;
Premium access requires the owner to approve this market. Free Trial uses the
existing last-10-seconds reveal rule. Analysis remains subscription protected.

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
- Use individual mode. Unified selects its existing source markets; the settings
  UI and API reject enabling Winning Color together with Unified mode.

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
