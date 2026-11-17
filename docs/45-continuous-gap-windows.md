# Continuous gap playing windows (local implementation)

Policy: CONTINUOUS_GAP_WINDOWS_V2. This replaces loss/gap entry gating for explicitly saved sessions. Existing V1 state is blocked until the user reviews and saves settings while stopped; no automatic live conversion.

The loss level selects a historical statistic, not an entry condition. Up to 100 latest continuous inter-occurrence gaps, minimum two, determine ceil(mean) draw slots. Each window starts at the next draw after the latest processed completed result. On completing its final draw (including SKIP), sample the current history and open the next window immediately. WIN/LOSS do not alter window length mid-window. Window updates never write martingale, stakes, losses, or profit counters. Actual settlement retains its existing behavior.

An unresolved draw waits; a missing draw or corrected observed result pauses for review. Duplicate claims retain existing claim-token rules. State is persisted via the existing gapEntryState snapshot. Stopped periods still follow observed draw time; resuming does not replay historical bets.

The website estimator uses the chosen level, not profitability ranking: continuous windows do not select different bets after initialization. Old trigger backtest profits are no longer offered for application. Saved settings use exact V2 policy and existing revision guards; settings are read back after save. Other market settings are preserved.

No production deployment or data changes. Node syntax and frontend build are the local validation; automated execution/restart scenarios and demo browser validation remain outstanding. Main and the separately maintained bot release must both receive compatible window code before activation. Require an explicit settings save after upgrade. Rollback requires reviewing saved V2 state; do not assume an older bot interprets it safely.
