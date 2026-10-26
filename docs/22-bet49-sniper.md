# Bet49 per-market sniper

In the extension's Expert Settings, enable **Bet49** under **Per-market sniper
settings**, enter a target step (1–10) and pause-after-losses count (1–50), then
save settings. Existing installations default this new control to OFF; legacy
shared sniper settings do not silently enable it.

Initial entry uses the existing sniper rule: Bet49's global step must be at least
the selected target. After the configured number of played losing draws, Bet49
waits until its global step equals the target again. Global prediction steps are
not reset by this setting. Recovery stake and progression are preserved while
waiting. Normal stop-loss, take-profit and maximum-step limits still apply.

One losing draw counts once even if several numbers were bet. Settlement uses
the actual placed number list, including partial execution. Unplayed results do
not clear the personal loss count. Overnight pending bets use this same rule.

History-based presets can now populate Bet49 sniper controls (flat mode keeps
sniper off). Preview and review before saving. This update requires deploying
the bot worker and reloading the updated extension; website rebuild is not needed.
