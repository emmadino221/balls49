# History stake simulator

Open History > Stake simulator. Select an individual market, a base stake, a draw range and an available recovery mode, then Run simulation. The report is a frozen snapshot; edit inputs and run again to update it.

## Coverage

BetZero, Bet49, Rainbow, High/Low, Total Color 3-way, Total Color 2-way and Winning Color. Unified, sniper gates, summary filters, rollover and automation stop limits are not simulated. Nothing is saved to an execution session and no bets are placed.

Uses settled public history, deduplicated by draw ID and sorted oldest first. Skips preserve the sequence. Missing draw IDs or incomplete results stop the replay instead of inventing results. All available loads paginated history; deleted daily history cannot be recreated from streak summaries. Counts disclose available and replayed records.

## Calculations

- BetZero 1.65 and Rainbow 1.50: recover accumulated losses plus base profit, using two-decimal calculator rounding.
- Bet49 7.80 per number: total cost is unit stake times recorded selection count. The cycle profit target is locked using the first draw's count. Subsequent stakes use the actual count and accumulated loss, rounded up to whole naira. Every selected number found among actual balls pays out, including multiple hits. Legacy single-number picks remain supported. Inconsistent WIN/LOSS records stop replay.
- High/Low 2.00: 2x or 1.4x progression. A win resets even when 1.4x does not recover all losses.
- Total Color 3-way 3.80 per selection: three stakes, recovery targets break-even after losses.
- Total Color 2-way 3.80: two stakes, recovery targets accumulated loss plus one base stake.
- Winning Color 3.80: shared TC1Staking helper supports fixed or accumulating profit, with whole-naira rounding.

Recorded wins reset progression; skipped draws have zero cost. Current stated odds are assumed for all historical draws. Report is calculator-style, not a reconstruction of real automation sessions, bookmaker limits, failed placements or fees.

Net is returns minus total staked. Maximum drawdown is the largest peak-to-trough net decline. Starting funds needed includes the money necessary to place each draw's full stake before its payout. Largest stake is total exposure for one draw, not per selection. Numerical limits stop replay before unreliable currency calculations. No funding limit is imposed; required funding is an output, not a recommendation.
