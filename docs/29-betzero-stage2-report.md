# BetZero Stage 2 implementation report

Completed locally on 2026-11-05. No push, deployment, service installation, or strategy activation was performed.

## Safety checkpoint

- Stage 1 checkpoint commit: `6eb7dd7`.
- Local tag: `checkpoint/betzero-stage2-start-20261104`.
- SQLite backup: `../local-backups/balls49-before-betzero-stage2-20261104T233435.sqlite`; integrity check passed before implementation.
- Stage 2 changes remain uncommitted. Tests use temporary databases; browser checks use synthetic localhost data.

## Changed files

| File | Purpose |
| --- | --- |
| `betzero-jobs.js` | Persistent bounded queue, atomic claims, cancellation, recovery, frozen protocols and exposure reservations |
| `betzero-worker.js` | Separate supervisor/child process, resource configuration, deadlines, private simulation DB and batched result import |
| `betzero-job-api.js` | Owner authorization, asynchronous endpoints and explicit synchronous workload cap |
| `betzero-lab.js` | Progress callbacks, evaluation labels, sealed cohort evaluation, completed-result visibility |
| `bot.js` | Lab-only queue initialization/routes and small synchronous backtest guard |
| `web/src/pages/BetZeroLabPage.jsx` | Job progress, cancellation, protocol creation/submission and clear evaluation labels |
| `web/src/pages/betzero-lab.css` | Responsive queue/protocol presentation |
| `deploy/balls49-betzero-worker.service` | Uninstalled example service with CPU/memory limits |
| `deploy/betzero-worker.env.example` | Dedicated worker configuration without production credentials |
| `test_betzero_jobs.js` | Twelve Stage 2 tests |
| `docs/27-betzero-strategy-lab.md` | Worker, API, protocol and operational documentation |
| `docs/29-betzero-stage2-report.md` | This report |

## Worker and database behavior

The queue permits one running job and two waiting jobs. Each job is limited to 50,000 pairs and ten minutes. A partial unique SQLite index enforces one running claim. Transactions are short; result imports use batches of at most 100 rows and bounded busy retries. Computation runs against a private temporary database. A failed or cancelled import cannot appear as a completed result.

Cancellation stops active computation. A lost heartbeat older than 30 seconds marks the claim failed (or cancelled), fences its completion token, and allows waiting jobs to proceed. Interrupted evaluations are not automatically replayed. A sealed cohort remains consumed after cancellation, timeout or failure.

Additive tables are `betzero_lab_jobs`, `betzero_lab_protocols`, and `betzero_lab_exposures`, plus the running-job unique index. Existing prediction/statistic records are not rewritten. Older result labels are clarified when read. Partial imports may remain as hidden failed diagnostic runs.

Protocols freeze strategy versions, code hash, selection counts/configuration, seeds and future target boundaries. Reserved cohorts cannot be evaluated through exploratory or synchronous lab paths. Submission consumes the protocol atomically. Sealed evaluation requires every source/target draw to be valid. Exploratory development/validation/holdout segments and genuine forward predictions remain separately labelled.

The existing synchronous API retains its completed-result shape for up to 100 pairs. Larger requests return an explicit 413 directing callers to the separate job endpoints.

## Verification results

- All JavaScript tests: **63 passed, 0 failed** (`node --test` across root `test_*.js`).
- Python unittest discovery: **1 passed**.
- Production build: `npm --prefix web run build:same-origin` **passed**, creating 23 entry points.
- Tests cover queue bounds, competing claims, lock contention, simulated ten-minute deadlines, cancellation, stale-claim recovery, actual child-process computation, frozen settings, sealed-test reuse, owner authorization, and synchronous response compatibility.
- Responsive browser checks used a synthetic owner session on localhost: 1440px desktop, 390px mobile, and 320px narrow mobile had no page overflow. Desktop/light and mobile/light/dark screenshots were visually inspected. Queue submission, cancellation and protocol creation succeeded.
- Browser artifacts and test output are under ignored `output/playwright/`. The preview's sole console error was a missing favicon; no application JavaScript errors were observed. The local preview and browser were stopped after verification.
- Build warning: the main bundle exceeds 500 kB. Node also reports its SQLite experimental warning.

## Preserved scope and outstanding items

Production prediction algorithms, staking, subscriber permissions, Telegram notifications and production settlement were not changed. One-number and four-number histories/baselines remain separate. The four-number research strategy and six unverified tutorial strategies remain disabled by default; this implementation does not activate any strategy.

The worker service still needs a separately approved installation, the actual VPS Node path, and resource settings appropriate for the VPS. Linux CPU/memory limits have not been exercised on this Windows workstation. No 50,000-pair production load benchmark or live VPS/browser test was performed. Deadline tests advance a controlled clock instead of waiting ten actual minutes.

Protocol controls prevent lab reuse, not external inspection of publicly available draws or privileged database edits. Any rule-module change fails frozen jobs closed. Hidden partial imports and abandoned OS temporary folders may eventually need a reviewed cleanup policy. No automated deletion policy was introduced.
