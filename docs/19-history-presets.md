# Click-to-apply history presets

The extension reads settled, deduplicated prediction outcomes from the worker
through authenticated `GET /extension/stats?presetHistory=1&draws=1000` (or the
local `/stats` equivalent). It returns aggregate counts only, not selection
logic, credentials or user records. Existing nginx routes require no change.

1. Choose games, profile, capital, base percentage, history window and risk budget.
2. Click **Preview from history**.
3. Review the sample counts, wins/losses, maximum loss runs and proposed settings.
4. Click **Apply preview to settings**. This changes only the form.
5. Click **Save Settings**. The bot checks the session again before accepting;
   automation stays paused. Start manually when ready.

There is no automatic retuning. The preview expires after ten minutes or a history
reset. It uses only outcomes after the current tracking reset. Insufficient data
after midnight leaves settings unchanged. Previews require 50 settled outcomes
per enabled game. Missing-ID gaps break losing runs; skipped picks preserve them.

## Recommendation rules and limits

- Supports each individual game (including Bet49 and Winning Color), all eligible
  individual games together, or Unified's four existing source games.
- Unified requires 50 outcomes for itself and each source game. Unsupported
  combinations are rejected; Winning Color and Bet49 are never silently mapped
  to a different Unified market.
- Planned recovery steps use observed worst losses plus one, bounded to 2-20.
  This cap can be lower than a historical loss run; it is a risk limit, not a
  promise to recover every run.
- The selected capital risk budget is split across individual games; any existing
  lower stop-loss is respected. Base stakes are reduced in units of 50 until the
  estimated loss sequence fits. If even the minimum does not fit, no plan applies.
- Summary ENTER/HOLD requires 30 settled results for that label, at least five
  percentage points higher win rate than the whole market, and no larger observed
  losing streak. Missing/unsupported labels stay off. This comparison is a
  descriptive heuristic and does not validate a trading advantage.
- Sniper entry is half the observed maximum loss run rounded up, limited to 1-10.
  Reset losses is a third rounded up, limited to 1-5. Bet49 has no sniper setting.
  These suggestions are not a simulation of actual sniper progression.
- Flat mode disables sniper; Winning Color has separate fixed/accumulating
  recovery and is excluded from flat mode. High/Low uses 2x.
- Expert flags follow the chosen profile: shadow CB for Anti-Volatility, weighted
  stakes for High-Roller, TC3 rollover (two stages) only for TC3 Rollover Hunter.
  ML override and BZ/RB/HL rollover remain off. Take-profit is left unchanged.
  Hidden dynamic staking and legacy High/Low rollover are disabled on preset save.
- The weighted/rollover profiles reserve extra estimated exposure, but do not
  simulate every compound path. The normal server stop-loss remains authoritative.
- The legacy dry-run backtest is a separate model; unsupported game/profile
  combinations are blocked rather than silently backtesting a fallback game.

Saving a preset is blocked during pending execution, unresolved settlement,
martingale/master deficits, rollover, shadow recovery, or sniper recovery. No
execution/reset endpoint is called by preview/apply. Martingale and sniper state
are not reset. The server is updated before Chrome saves a preset, so a server
rejection does not leave a rejected preset queued in local storage.

Deploy the worker and reload the unpacked extension. No website build is needed.
No automated tests or real betting were performed during implementation.
