-- Copied verbatim from 717932e betzero-lab.js initialization. Synthetic tests only.

        CREATE TABLE IF NOT EXISTS betzero_lab_minmax_state (
            strategy_id TEXT NOT NULL, version TEXT NOT NULL, state_json TEXT NOT NULL,
            PRIMARY KEY(strategy_id, version));
        CREATE TABLE IF NOT EXISTS betzero_lab_minmax_draws (
            draw_id INTEGER PRIMARY KEY, balls_json TEXT NOT NULL, observed_at INTEGER NOT NULL,
            conflicted INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS betzero_lab_strategies (
            strategy_id TEXT NOT NULL,
            version TEXT NOT NULL,
            label TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('UNVERIFIED', 'RESEARCH_ONLY')),
            kind TEXT NOT NULL,
            description TEXT NOT NULL,
            missing_information TEXT NOT NULL,
            PRIMARY KEY(strategy_id, version)
        );
        CREATE TABLE IF NOT EXISTS betzero_lab_strategy_configs (
            strategy_id TEXT NOT NULL,
            version TEXT NOT NULL,
            enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
            config_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(strategy_id, version),
            FOREIGN KEY(strategy_id, version) REFERENCES betzero_lab_strategies(strategy_id, version)
        );
        CREATE TABLE IF NOT EXISTS betzero_lab_forward_predictions (
            prediction_id TEXT PRIMARY KEY,
            strategy_id TEXT NOT NULL,
            strategy_version TEXT NOT NULL,
            source_draw_id TEXT NOT NULL,
            target_draw_id TEXT NOT NULL,
            predicted_at TEXT NOT NULL,
            strategy_config_json TEXT NOT NULL,
            selections_json TEXT NOT NULL,
            conditions_json TEXT NOT NULL,
            source_input_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('PENDING', 'WIN', 'LOSS', 'SKIP', 'INVALID')),
            actual_balls_json TEXT,
            validated_at TEXT,
            UNIQUE(strategy_id, strategy_version, target_draw_id)
        );
        CREATE INDEX IF NOT EXISTS betzero_lab_forward_target_idx
            ON betzero_lab_forward_predictions(target_draw_id, strategy_id);
        CREATE INDEX IF NOT EXISTS betzero_lab_forward_window_idx
            ON betzero_lab_forward_predictions(strategy_id, strategy_version, CAST(target_draw_id AS INTEGER) DESC)
            WHERE status IN ('WIN','LOSS','SKIP','INVALID');
        CREATE TABLE IF NOT EXISTS betzero_lab_backtest_runs (
            run_id TEXT PRIMARY KEY,
            status TEXT NOT NULL CHECK(status IN ('COMPLETED', 'FAILED')),
            requested_window TEXT NOT NULL,
            seed TEXT NOT NULL,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            dataset_hash TEXT NOT NULL,
            data_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS betzero_lab_backtest_results (
            run_id TEXT NOT NULL,
            strategy_id TEXT NOT NULL,
            strategy_version TEXT NOT NULL,
            segment TEXT NOT NULL,
            result_json TEXT NOT NULL,
            PRIMARY KEY(run_id, strategy_id, segment),
            FOREIGN KEY(run_id) REFERENCES betzero_lab_backtest_runs(run_id)
        );
        CREATE TABLE IF NOT EXISTS betzero_lab_backtest_predictions (
            prediction_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            strategy_id TEXT NOT NULL,
            strategy_version TEXT NOT NULL,
            segment TEXT NOT NULL,
            source_draw_id TEXT NOT NULL,
            target_draw_id TEXT NOT NULL,
            predicted_at TEXT NOT NULL,
            strategy_config_json TEXT NOT NULL,
            selections_json TEXT NOT NULL,
            conditions_json TEXT NOT NULL,
            source_input_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('WIN', 'LOSS', 'SKIP')),
            actual_balls_json TEXT NOT NULL,
            validated_at TEXT NOT NULL,
            UNIQUE(run_id, strategy_id, target_draw_id),
            FOREIGN KEY(run_id) REFERENCES betzero_lab_backtest_runs(run_id)
        );
        CREATE INDEX IF NOT EXISTS betzero_lab_backtest_prediction_target_idx
            ON betzero_lab_backtest_predictions(run_id, target_draw_id, strategy_id);
        CREATE TABLE IF NOT EXISTS betzero_lab_streak_events (
            prediction_id TEXT PRIMARY KEY,
            strategy_id TEXT NOT NULL,
            strategy_version TEXT NOT NULL,
            target_draw_id TEXT NOT NULL,
            outcome TEXT NOT NULL CHECK(outcome IN ('WIN', 'LOSS')),
            current_loss_streak INTEGER NOT NULL,
            worst_loss_streak INTEGER NOT NULL,
            current_win_streak INTEGER NOT NULL,
            longest_win_streak INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS betzero_lab_streak_strategy_idx
            ON betzero_lab_streak_events(strategy_id, strategy_version, target_draw_id);
        CREATE TABLE IF NOT EXISTS betzero_lab_alerts (
            alert_id INTEGER PRIMARY KEY,
            strategy_id TEXT NOT NULL,
            strategy_version TEXT NOT NULL,
            target_draw_id TEXT NOT NULL,
            alert_type TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(strategy_id, strategy_version, target_draw_id, alert_type)
        );
        CREATE TABLE IF NOT EXISTS betzero_lab_result_revisions (
            revision_id INTEGER PRIMARY KEY,
            prediction_id TEXT NOT NULL,
            previous_status TEXT NOT NULL,
            next_status TEXT NOT NULL,
            previous_balls_json TEXT,
            next_balls_json TEXT,
            changed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS betzero_lab_reconciliations (
            prediction_id TEXT PRIMARY KEY,
            source_name TEXT NOT NULL, source_hash TEXT NOT NULL, result_hash TEXT NOT NULL,
            observed_at TEXT NOT NULL, reconciled_at TEXT NOT NULL, outcome TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS betzero_lab_state (
            state_key TEXT PRIMARY KEY,
            state_value TEXT NOT NULL
        );
