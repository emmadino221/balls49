# Stage 5 — read-only VPS pre-deployment safety audit

Audit date: 2026-11-05, approximately 07:54–08:01 UTC. Access used the existing authorized SSH account. No deployment, installation, restart, service configuration change, backtest, database write, experimental activation, or Git push was performed. Only this local report was added.

## Decision

The VPS is healthy enough to prepare a controlled deployment, but **the proposed worker service is not installable unchanged**. Its `/usr/bin/node` executable does not exist. The installed executable is `/home/balls49/.nvm/versions/node/v24.21.0/bin/node`.

Before deployment, resolve the executable path, agree on a conservative initial memory budget, take and verify fresh recovery backups, and confirm the treatment of the already-enabled legacy one-number experiment. Before relying on unattended forward statistics, investigate the observed missing-result delivery gap. No activation approval is implied by this audit.

## 1. Host capacity and current health

| Item | Observed |
| --- | --- |
| OS | Ubuntu 24.04.5 LTS, kernel 6.8.0-146-generic |
| Process manager | systemd 255; website, bot and collector are systemd services |
| CPU | 2 logical CPUs; load averages approximately 0.29 / 0.36 / 0.34 |
| Memory | About 3.82 GiB total, 2.03 GiB available at initial sample |
| Swap | None |
| Disk | About 76.45 GiB total, 70.59 GiB free |
| Clock | UTC; NTP synchronized |
| System state | `running`; all four principal services active before and after inspection |
| Pressure | No current memory pressure in sampled PSI averages; low CPU/I/O pressure |

Website cgroup memory usage was approximately 85 MiB, bot 240 MiB, collector 45 MiB and Nginx 58 MiB. These are snapshots, not worst-case reservations. The reported service restart counts were zero. No PM2 executable was found on the inspection shell's PATH; the inspected applications are definitively managed by systemd, irrespective of any unrelated installation outside PATH.

Application ports 3000, 3001, 3002 and 8080 are bound to loopback. HTTP/HTTPS and SSH listen publicly. This was a listener inspection, not a firewall penetration test.

## 2. Startup configuration and version differences

| Service | Directory / script | Policy |
| --- | --- | --- |
| `balls49-site` | `/home/balls49/balls49-site/bot.js` | Restart on failure, 5 seconds |
| `balls49-bot` | `/home/balls49/balls49/bot.js` | Restart always, 5 seconds |
| `balls49-collector` | `/home/balls49/balls49/collector.js` | Restart always, 5 seconds |

All three run as `balls49` using Node v24.21.0 from the NVM path above. Existing stop timeouts are 90 seconds. Environment files are supplied by systemd; no values were printed.

- Website release: `690c837f020fb5bc9e7df410bdbfc2219967d86b`, clean checkout.
- Private bot release: `edcf1585230a79a93a126b48ef4b6be0ec3bcbd1`, clean checkout.
- Local checkpoint: `6eb7dd7f273265ce635f4e67176a6f74ad534feb`; later Stage 2–4 work is still uncommitted.
- Local Node is v24.14.1 on Windows; VPS Node is v24.21.0 on Linux. Local process/SQLite tests do not substitute for Linux service verification.
- VPS has the older lab implementation. Queue/worker modules and job/protocol tables are absent; `balls49-betzero-worker.service` is not installed.
- The four-number strategy is not yet registered on the VPS. Its new local definition defaults to disabled.
- All six unverified tutorial configurations are disabled.
- **The original one-number strategy is already enabled on the website.** The audit did not enable it. It has existing forward records, including an older unresolved pending record. Its configuration must be preserved or deliberately paused only with separate approval.

The website and private bot are separate checkouts. A future website-only rollout should not casually pull or restart the private betting/Telegram bot or collector.

## 3. SQLite and recovery evidence

| Database | Size at sample | WAL | Integrity |
| --- | --- | --- | --- |
| `/var/lib/balls49-site/site_users.sqlite` | 23,195,648 bytes | 10,468,952 bytes | `ok`, approximately 0.246 s |
| `/home/balls49/balls49/site_users.sqlite` | 827,392 bytes | 4,371,352 bytes | `ok`, approximately 0.001 s |

Both use WAL mode and file permission 0600. Read-only SQLite connections with `query_only` were used; integrity checks had bounded execution time. No checkpoint, vacuum, journal-mode change, transaction update or migration was issued.

Both companion `<database>.security-key` files exist, are 32 bytes, and have permission 0600. Only metadata was inspected; key contents were not displayed. No subscriber, authentication or payment records were queried for this audit.

### Existing backup procedures

- `balls49-site-backup.timer`: active, daily with up to five minutes of randomized delay, persistent catch-up. Most recent service completion: **2026-11-05 00:03:11 UTC**, successful.
- 25 local SQLite backup files were present. Latest: `site-20261105T000311258042Z.sqlite`, 20,930,560 bytes. Its read-only integrity check returned **ok**.
- The local backup script uses SQLite's backup API, so committed WAL transactions are included; it retains the newest 30 successful copies. This local database-only backup does not by itself constitute a complete vault-key/environment/server restore bundle.
- `balls49-backup.timer`: active, scheduled at 02:30 Africa/Lagos (01:30 UTC), persistent. Most recent service completion: **2026-11-05 01:30:12 UTC**, exit 0, Result=success. Failure notification is linked to `balls49-backup-alert.service`.
- The deployed full-backup script hash matches the local reviewed script. It snapshots both databases, checks integrity, includes the corresponding vault keys and configuration/state files, uploads through the encrypted Drive remote, downloads the archive and compares SHA-256 before successful completion and retention processing.
- The encrypted rclone remote is configured and its configuration is mode 0600. No remote Drive operation was invoked, avoiding credential refresh/config writes during a strictly read-only audit.

The full-backup service's current success status is strong operational evidence, but its root-owned recent log messages were not visible to this account. The archive itself was not downloaded/decrypted during this audit. DigitalOcean backup/snapshot availability was not checked through a provider API. A fresh pre-deployment backup and restore verification remain required later; this audit did not create a VPS backup.

## 4. Live draw clock and pre-deadline evidence

Eight low-rate public/loopback clock reads returned HTTP 200. Observed clock ages were approximately 2.05–6.11 seconds, with observations updating about every five seconds. `Date` headers matched the synchronized server clock. Both HTTPS and loopback delivered the same draw ID and observation data.

A separate 33-second read-only observation crossed a live draw boundary:

- Website snapshot ages were approximately 0.8–4.8 seconds; clock ages approximately 2.3–6.3 seconds.
- Draw 5890980 briefly retained a positive countdown of 1 while its estimated deadline was already 2.3–5.3 seconds in the past.
- One transition sample had current prediction target 5890980 but clock target 5890981.
- The next snapshot aligned both IDs to 5890981 with approximately 37.7 seconds remaining after subtracting observation age.

**A positive raw countdown alone is not proof that a draw is still open.** Stage 4's new guard is appropriate: require matching target IDs, valid/fresh observation time, no target result, valid prior draw, and server recording time strictly before `observedAt + countdown*1000`. Persist that evidence with the prediction and later compare settlement timing. During expired or mismatched transition snapshots, skip generation rather than infer a deadline from response arrival time.

An already-existing one-number prediction for target 5890981 was observed with timestamp 07:58:43.040 UTC, before the contemporaneous estimated deadline around 07:59:21.541 UTC. This corroborates one live legacy example; it does not validate four-number generation or establish bookmaker clock precision. Four-number live generation was not run. Older records lack Stage 4 timing metadata and must not be retroactively relabelled as verified evidence.

### Result-delivery gap

Pending legacy lab target **5890334**, predicted at **2026-11-04 22:59:34.021 UTC**, remained unresolved hours later. Its target record was absent from the website's public prediction history and the private bot's `predictions.json`, but a valid completed result for that ID was present in the collector's `draws.json`.

This indicates an observed gap between collector results and published prediction history, not proof of data loss at the collector. The audit did not backfill, settle, rewrite or mark this record. A separately reviewed reconciliation/monitoring plan is advisable before trusting unattended forward sample counts and streaks. Never classify a missing result as a loss, win or skip merely to complete statistics.

## 5. Responsiveness and contention risks

| Endpoint | Observed response |
| --- | --- |
| HTTPS `/api/public-clock` | 200; 12.4–58.0 ms across four requests |
| Loopback `/api/public-clock` | 200; 1.5–2.1 ms across four requests |
| HTTPS `/api/public-current-prediction` | 200; 17.2 ms |
| HTTPS homepage | 200; 12.5 ms |

These measurements originate on the VPS, include low-rate sequential checks, and are not a load test or external-client SLA. No backtests or stress workload were started. Services remained active afterward. Visible recent logs contained no SQLite-busy entries, but the website had zero visible entries in that interval: this does not prove absence of contention.

WAL supports concurrent reads, but SQLite still permits only one writer. The website's existing 5,000 ms busy timeout can stall its synchronous Node event loop under a long write lock. The proposed worker uses private computation, at most 100 imported rows per transaction, bounded retries, and a 100 ms writer busy timeout; its read connection uses 1,000 ms. These reduce risk without eliminating it.

Additional risks are shared CPU/storage, temporary simulation files, growing lab result tables, WAL growth while readers retain snapshots, and startup index creation. The current WAL sizes alone are not evidence of a fault. Start with small approved jobs after rollout and monitor both request latency and writer lock behavior before considering 50,000-pair runs. Do not run the historical simulation inside the production web process.

## 6. Worker CPU/memory enforceability

The VPS uses cgroup v2 and exposes CPU, memory, I/O and PID controllers under systemd 255. Therefore the proposed service CPUQuota, MemoryMax and TasksMax are supported in principle. No worker cgroup exists yet, so actual enforcement was not tested.

The example's CPUQuota=50% means approximately half of one CPU, not half of the whole two-CPU machine. MemoryMax=1536M could consume most of the approximately 2 GiB currently available, and there is no swap. For an initial deployment, consider MemoryMax=1G and child heap=512 MB with CPUQuota in the 25–50% range, then measure; final limits require approval and workload testing. The child heap must leave headroom for the supervisor, SQLite and native allocations.

Correct ExecStart to the installed Node path before installation. Keep the worker as a separate unprivileged service using the website database, a dedicated environment file, one running job and two waiting jobs. Do not supply bot, Telegram, subscriber or email secrets. OS limits and stop/restart behavior need a separately authorized post-installation test.

## 7. Environment variables — names only

Proposed worker:

- `SITE_DB_PATH`
- `BETZERO_WORKER_HEAP_MB`

Existing website configuration names observed:

- `HOST`, `PORT`, `NODE_ENV`
- `SITE_PUBLIC_MODE`, `SITE_SERVE_WEB`, `SITE_DB_PATH`, `SITE_PUBLIC_URL`
- `SITE_ALLOWED_ORIGINS`, `SITE_TRUSTED_PROXIES`, `SITE_ADMIN_KEY`
- `PREDICTION_INGEST_SECRET`, `VIRTUAL_FEED_SECRET`
- `RESEND_API_KEY`, `SITE_EMAIL_FROM`, `FOOTBALL_DATA_API_KEY`

Existing private bot configuration names observed:

- `PREDICTION_INGEST_URL`, `PREDICTION_INGEST_SECRET`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`
- `EXTENSION_ACCESS_KEY`, `EXTENSION_CLIENT_ID`, `PYTHON_CMD`

`SITE_VAULT_KEY_FILE` is an optional override; no such override was observed in the running application environments, and companion key files exist at the default database-derived paths. Environment values and secret file contents are intentionally omitted.

## 8. Proposed deployment procedure — not executed

1. Finish review of the local changes, produce a pinned release commit and retain the currently deployed commit IDs and built frontend assets. Do not deploy an uncommitted working tree.
2. Resolve the pending-result delivery gap or document an approved lab-only reconciliation plan. Decide explicitly whether the already-running one-number experiment should continue or be paused. Four-number and incomplete strategies must remain disabled unless separately approved.
3. Before any service change, create consistent SQLite snapshots of both databases, preserve matching vault keys and required environment/service configuration, and record hashes/release IDs. Verify integrity and encrypted upload/download. Validate recovery on an isolated copy. Never copy only a live `.sqlite` file while ignoring WAL.
4. Prepare/build the pinned website release separately from the active checkout using the target Node version. Review the additive lab tables/index and old-record preservation on a database copy. Verify an old-release rollback against the migrated copy before rollout.
5. With explicit deployment approval, replace the website release and restart only the website as needed. Do not update/restart the private bot, collector, or Nginx merely to install the lab. Preserve environment files and live database paths.
6. Install the separate worker only after its Node path, dedicated environment, resource limits and database access have been reviewed. Starting it can process queued work, so verify the queue first and obtain explicit operational approval. Deployment is not forward-activation approval.
7. Post-deployment: verify service health, public API latency and clock freshness across a rollover; confirm owner-only lab access, exact saved enablement, preserved historical counts, legacy/unverified timing labels, database integrity, backups and logs. Use only separately approved small exploratory jobs or isolated fixtures for worker validation; no sealed cohort should be consumed as a smoke test.

## 9. Proposed rollback — not executed

- Keep the prior website release and frontend build ready. Stop the new worker first under rollback authorization so it cannot write/import into the shared database during rollback.
- Prefer code/build rollback with the live database preserved, after compatibility has been validated on a copy. New tables/indexes are additive, but compatibility with older strategy-registry and run-reading code must not be assumed.
- Do not blindly restore a pre-deployment database: doing so would discard accounts, sessions, approvals, results and other changes recorded since the backup.
- If a database restore is necessary, explicitly stop all relevant writers, preserve a fresh forensic snapshot, restore a verified database/key pair under a coordinated recovery plan, and reconcile post-backup activity. Do not delete or overwrite WAL files while any connection is live.
- Recheck public service health, clock alignment, permissions, research enablement, backup timers and preserved production data after rollback.

## Access limitations and final status

Passwordless sudo is unavailable. Existing service properties, process metadata, permitted files, public endpoints and read-only databases were sufficient for most checks. Root-only logs, a fresh encrypted archive restore, provider snapshots and actual worker cgroup enforcement remain unverified. A non-interactive sudo availability probe failed; no elevated command succeeded. No credential was requested and no configuration change was attempted.

**Audit completed; deployment and activation remain unapproved.** The executable-path mismatch is a definite installation blocker. The result-delivery gap is a forward-statistics reliability concern. The VPS itself and inspected database/backups are currently healthy. Only this local report was added during Stage 5; all earlier implementation changes remain as they were.
