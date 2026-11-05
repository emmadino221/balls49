# BetZero Stage 3: local historical research verification

Completed 2026-11-05. Exploratory analysis only. Nothing was deployed, pushed, enabled for forward prediction, or changed on the VPS.

## Dataset and reproducibility

- Source: existing local `predictions.json`, SHA-256 `525d92efe75d1b8cb3312b65898a09a5650ef9a1d13e75f7e3ae93d45a80a0df`.
- 4,330 records inspected: 3 incomplete/invalid excluded, 3 matching duplicate IDs deduplicated, zero conflicting IDs. 4,324 unique valid completed draws remained.
- Cross-check with the existing collector `draws.json`: 988 overlapping draw IDs, zero conflicting six-ball results. This is local archive corroboration, not independent verification against the bookmaker.
- Before looking at strategy outcomes, selected the latest uninterrupted block with at least 1,000 source/target pairs. Its final 1,001 draws were 5836698–5837698. Missing draw IDs were not bridged or fabricated.
- Target windows: 100 = 5837599–5837698; 500 = 5837199–5837698; 1,000 = 5836699–5837698. Source for each target is exactly target minus one. All selected results contain six distinct integers in 1–49.
- Recorded settlement times span October 4, 2026 21:45 UTC to October 5, 2026 11:40 UTC. These are archived results, not current November performance.
- The local website database has zero public history rows and no saved sealed protocols. The runner checks local protocols and excludes their target draws before constructing consecutive pairs. No VPS was accessed: the absence of VPS-only reservations cannot be established here. These local results make no untouched-final-test claim.
- Fixed seed: `emmy-betzero-stage3-fixed-v1`. Each window retains the lab's 60/20/20 exploratory segmentation. Random results are summed across its segment-specific seeds, with 64 matched random selections per entered target. They are not 64 independent historical datasets.
- Reported streaks are recomputed across the entire chronological window, including segment boundaries. Skipped opportunities do not reset a settled-prediction streak. Windows overlap and are not independent experiments.

No artificial results were used for these performance tables. Synthetic fixtures in regression tests are unrelated to the reported performance.

## Separate strategy definitions

**One-number research experiment**, `simple_smallest_number_add_10`, v1.0.0: choose the smallest number in the prior draw plus ten; skip if it exceeds 49. A win means that one number is absent from the next draw. This is not a four-number BetZero ticket.

**Four-number research variant**, `smallest_add10_step10_four`, v1.0.0: the same first selection and overflow skip; generate each subsequent selection as `((previous - 1 + 10) % 49) + 1`. Exactly four distinct valid numbers are required. A win means all four numbers are absent from the next draw. This is a newly designed research variant, not a verified instructor method.

Only frozen local backtest job specifications include the four-number strategy as enabled. Its saved configuration remains disabled, including in the isolated research queue database. The simulation child applies the specification to its private temporary calculation database. No forward snapshot ingestion is invoked. All six tutorial strategies remain disabled.

## Results

Eligible means valid consecutive source/target opportunities. Settled means eligible minus strategy skips. CL = current losing streak, WL = worst losing streak, LW = longest winning streak.

### One-number experiment

| Window | Eligible | Skipped | Settled | Wins | Losses | Win rate | 95% Wilson interval | CL | WL | LW |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 100 | 0 | 100 | 91 | 9 | 91.00% | 83.77–95.19% | 0 | 2 | 27 |
| 500 | 500 | 0 | 500 | 443 | 57 | 88.60% | 85.52–91.10% | 0 | 2 | 33 |
| 1,000 | 1,000 | 0 | 1,000 | 881 | 119 | 88.10% | 85.95–89.96% | 0 | 2 | 37 |

### Four-number research variant

| Window | Eligible | Skipped | Settled | Wins | Losses | Win rate | 95% Wilson interval | CL | WL | LW |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 100 | 0 | 100 | 53 | 47 | 53.00% | 43.29–62.49% | 0 | 5 | 5 |
| 500 | 500 | 0 | 500 | 279 | 221 | 55.80% | 51.42–60.09% | 0 | 7 | 10 |
| 1,000 | 1,000 | 0 | 1,000 | 555 | 445 | 55.50% | 52.40–58.55% | 0 | 7 | 11 |

### Matched baselines and uncertainty

For uniformly sampled six-ball draws without replacement, the chance that all k selections are absent is `C(49-k,6) / C(49,6)`. It is 87.7551% for one selection and 58.2460% for four. Entry/skip conditions and targets are identical for each strategy and its random baseline.

| Strategy | Window | Theoretical | Seeded random | Difference from random | Two-sided exact binomial p |
| --- | --- | --- | --- | --- | --- |
| One number | 100 | 87.755% | 88.297% | +2.703 percentage points | 0.443705 |
| One number | 500 | 87.755% | 87.769% | +0.831 percentage points | 0.632791 |
| One number | 1,000 | 87.755% | 87.728% | +0.372 percentage points | 0.772369 |
| Four numbers | 100 | 58.246% | 57.641% | -4.641 percentage points | 0.310972 |
| Four numbers | 500 | 58.246% | 58.200% | -2.400 percentage points | 0.276569 |
| Four numbers | 1,000 | 58.246% | 58.130% | -2.630 percentage points | 0.083336 |

Exact p-values compare wins to the theoretical random-selection probability, not to a falsely enlarged sample made from 64 simulations per target. They sum binomial outcomes whose null probability is no larger than that of the observed outcome. All six are above 0.05 before multiplicity adjustment; Bonferroni adjustment for six comparisons gives a minimum of approximately 0.500. One-sided superiority p-values also all exceed 0.05. Every 95% interval includes its theoretical baseline.

**No statistically meaningful advantage was demonstrated.** The one-number differences are consistent with random variation. Four-number results are below random in every window, but do not establish a significant departure at the stated threshold either. These calculations assume independent fair draws; overlapping windows, a short archive period, possible serial dependence, and earlier exploratory inspection limit inference. Six-comparison adjustment does not undo any previous research/tuning exposure. No accuracy, profitability, or betting recommendation follows from these win rates; payout/stake profitability was not evaluated.

## Worker verification

- Started the actual separate supervisor and child processes against an isolated SQLite database populated only with the selected real archive records.
- Three performance jobs completed and imported independent versioned results. Observed RUNNING progress included 53–68%, 89–95%, and final 100%; small jobs may skip intermediate displayed percentages due to polling.
- Cancelled an actual running job: final state CANCELLED, no published run ID.
- Requested graceful shutdown during another active job: child cancelled, supervisor exited with code 0. Restarted and verified idle shutdown also exits with code 0.
- Added handling for SIGINT/SIGTERM and a local IPC shutdown message. The supervisor requests cancellation, waits for child cleanup, closes SQLite and disconnects IPC. The regression suite tests this lifecycle.
- No worker processes remained after verification.
- During jobs, 442 status reads from the separate local harness had p95 latency 2.13 ms and maximum 64.73 ms. This is a workstation responsiveness observation, not a production latency guarantee or CPU benchmark.
- Source archive SHA-256 and source lab configuration/protocol/forward-state hashes were unchanged. Saved research configurations were unchanged; research forward-row count stayed zero.
- Worker imports no production bot, subscription, betting, staking or messaging modules. It received a minimal environment without production credentials and used its own database path. No local bot/collector process was running to measure under simultaneous load; production/VPS contention and Linux resource limits remain unverified.

## Stage 3 changes and checks

Files changed in this stage only:

1. `betzero-worker.js`: graceful supervisor shutdown/cancellation and ready notification.
2. `scripts/betzero-stage3-local.js`: repeatable isolated real-data research runner; frozen-specification override without saved enablement.
3. `test_betzero_jobs.js`: actual-process idle/active graceful shutdown regression test.
4. `docs/30-betzero-stage3-results.md`: this report.

Stage 2 changes remain uncommitted separately in the working tree. Stage 3 introduces no production database schema changes. Local research SQLite files and reports are under ignored `output/betzero-stage3/2026-11-05T03-16-23-293Z/`. `results.json` contains full segment metrics, hashes, job states and preservation checks; `results-with-significance.json` adds exact-binomial calculations. An initial harness attempt completed simulations but failed its final audit because of a mistyped forward-table name; that harness typo was corrected and the identical fixed windows/seed were rerun. No rules or windows were tuned to outcomes.

- Full root JavaScript suite: **64 passed, 0 failed**.
- Python unittest discovery: **1 passed**.
- Production build: **passed**, 23 entry points.
- `git diff --check`: passed.
- Existing warnings: Node experimental SQLite; main client bundle greater than 500 kB.

Outstanding: actual VPS resource/load verification requires later authorization; newer data and genuinely reserved future evidence are needed before stronger conclusions. Do not activate either strategy on the basis of these exploratory results. No forward testing, deployment, push, VPS modification, or production-record rewrite occurred.
