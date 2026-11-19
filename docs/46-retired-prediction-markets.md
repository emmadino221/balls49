# Retirement: Total Color 2-way and Unified

Six supported public markets remain: BetZero, Bet49, Rainbow, High/Low, Total Color 3-way, Winning Color. Subscription prices are unchanged. Elite comparison is now six Premium games (NGN 108,000), saving NGN 28,000 at the existing NGN 80,000 price.

Website market lists, history, gaps, simulator, calculator, account plan choices, pricing and guide are updated. Telegram prediction/result sections and plan menu no longer offer the retired products. Extension controls and 2-way bet execution are removed; legacy settings cannot reactivate these markets. Server output and persistence remove retired prediction fields. The shared color ranking is preserved under colorRanking for the remaining 3-way and Winning Color rules. Some legacy branches remain unreachable for compatibility and settlement handling; this is not a wholesale removal of every historical identifier from source.

## History removal

scripts/purge-retired-markets.py defaults to dry-run. --directory selects one application checkout; --database can select additional actual SQLite paths. Without --database it uses site_users.sqlite in that directory. Apply requires --apply --services-stopped. Stop automation, settle outstanding bets, stop all application services writing these files, and perform a fresh verified system backup before applying on BOTH VPS checkouts. Never run an older binary after cleanup without a reviewed rollback.

The script validates SQLite integrity and schemas, backs up affected JSON files and databases, removes retired fields and retired market entries from the prediction/history stores and daily archive, and removes retired plan entitlements. It preserves other market data, raw draw archives, Lab protocols and jobs. Existing outbox messages containing retired sections are discarded rather than sent stale. Database writes use transactions, secure_delete, foreign-key/integrity checks and WAL checkpoint. JSON files are replaced atomically; a cross-file failure requires recovery from the backup directory. Backups can contain credentials: retirement-backups is gitignored.

Local cleanup completed after a no-writer process check. Production cleanup is NOT executed by importing the module and has not been performed. Production requires deployment of matching site and bot releases and reloading the extension. Mixed-market session aggregate financial totals are retained (not falsely recomputed); individual retired market records are removed. Existing Google Sheets exports, downloaded CSVs, backup archives and already delivered Telegram messages are outside the local database/file purge and have not been erased.

Syntax checks and frontend build only. No automated tests or browser/execution checks were requested or run. Before production rollout, regression verification and a coordinated downtime/rollback plan remain necessary. Existing npm dependency advisory remains outstanding.
