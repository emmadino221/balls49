# Offline BetZero and Rainbow comparison

Run `backtest-markets.js` manually. It does not start the bot, make network
requests, send Telegram messages, place bets, or modify live state. Node.js and
the repository files are sufficient; no additional packages are needed.

## VPS commands

First push this script and documentation to GitHub from the development machine.
Then, in the trusted VPS terminal as the repository's normal user:

```bash
cd ~/balls49
git pull --ff-only origin main
```

After a successful pull, take a consistent input snapshot and run the report:

```bash
snapshot=$(mktemp /tmp/balls49-backtest.XXXXXX.json)
cp draws.json "$snapshot"
node backtest-markets.js --draws "$snapshot" --out "$HOME/balls49-backtest-$(date +%Y%m%d-%H%M%S).json"
```

If the JSON cannot be parsed because it was copied during a write, recopy it and
retry. The script validates all input before replaying any draws. Supply another
path with `--draws` if your saved draw history lives elsewhere. The output file
must not exist already; exclusive creation protects existing reports and data.
No service restart or Render deployment is needed to run this script. It can run
beside the bot; for large histories, run it during a quiet period because the
analysis uses CPU. `node backtest-markets.js --help` shows the options.

## Method

- Sort valid six-distinct-ball draws by numeric ID; identical duplicates are
  removed and conflicting duplicates stop the run.
- Use 100 preceding draws per target. Exclude targets without a contiguous
  100-draw lookback. Invalid rows and missing IDs are reported rather than filled.
- Reserve the newest 30% of eligible targets as holdout. Strategy definitions
  are fixed before running either period. Earlier holdout outcomes can enter
  later lookbacks, just as they would become available during live operation.
- Run the current `computePredictions` function extracted from `bot.js` in an
  isolated VM, without starting the module. Bet49's stateful helper is replaced
  with a null result because it is outside this comparison. External aggregate
  statistics are omitted: with 100 valid raw draws the BetZero/Rainbow selection
  paths use that raw history. This compares current selection rules, not old
  historical versions or ML/summary/sniper entry decisions.
- Compare current BetZero with least-frequent 100-draw, most-frequent 100-draw,
  and fixed 1/2/3/4 selections. Frequency ties choose the lower number.
- Compare current Rainbow with fixed Red/Blue/Green and the color with the most
  historical two-or-more-ball outcomes in 100 draws. Ties use Red, Blue, Green
  order. Number 49 is yellow and does not count toward RGB outcomes.
- A BetZero win means none of its four numbers appeared. Rainbow wins when at
  least two balls match its chosen color.
- Report picks, skips, coverage, win rate and maximum consecutive losses for
  each phase. Skips preserve the loss run; gaps and phase boundaries restart it.
- Reports contain source-generator and input hashes for reproducibility.

## Interpreting results

Do not choose a strategy from holdout results and then call the same data an
independent validation again. Compare new choices on future unseen draws. Win
rates alone do not measure profitability: this script does not model odds,
stakes, martingale, fees or execution. Observed worst loss runs are not future
limits. No statistical significance or predictive advantage is established by
this report.

## Initial local run — 20 October 2026

Input had 1,000 valid draws, no invalid rows or duplicates, 805 eligible targets
and 95 excluded targets after warm-up. Development used 563 targets; holdout used
242. These are local sample results, not VPS results.

| Market / strategy | Holdout picks | Skips | Win rate | Worst losses |
| --- | ---: | ---: | ---: | ---: |
| BetZero current | 242 | 0 | 54.55% | 7 |
| BetZero least frequent 100 | 242 | 0 | 64.05% | 5 |
| Rainbow current | 227 | 15 | 66.96% | 4 |
| Rainbow most 2+ ball outcomes | 242 | 0 | 66.12% | 5 |

The sample is insufficient to establish a reliable improvement. Live strategies
were not changed by this analysis.
