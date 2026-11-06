'use strict';

const crypto = require('node:crypto');
const minmax = require('./betzero-minmax');

const RANDOM_REPETITIONS = 64;
const ALERT_THRESHOLDS = [3, 5, 7, 10];
function describeEvaluation(data) {
    return data.evaluationMode ? data : { ...data, evaluationMode: 'LEGACY_EXPLORATORY',
        methodology: 'Legacy exploratory historical simulation. Its final_test segment is a reused holdout, not an enforced untouched final test.' };
}
const STRATEGIES = [
    { id: minmax.ID, version: '1.0.0', selectionCount: 3, label: '3-Number Minimum/Maximum',
      status: 'RESEARCH_ONLY', kind: 'PREDICTION',
      description: 'User-specified MIN/MAX research: three adjacent numbers, five settled opportunities, switch after WIN and repeat after LOSS.',
      missingInformation: 'Research specification; not independently instructor-verified.' },
    {
        id: 'single_color_add_10',
        version: '1.0.0',
        label: 'Single-Color Add-10',
        status: 'UNVERIFIED',
        kind: 'PREDICTION',
        description: 'Add 10 to qualifying single-color numbers from the previous draw.',
        missingInformation: 'The exact definition of a qualifying single-color number is not verified.'
    },
    {
        id: 'smallest_number_add_10',
        version: '1.0.0',
        label: 'Smallest-Number Add-10',
        status: 'UNVERIFIED',
        kind: 'PREDICTION',
        description: 'Add 10 to the smallest number in the previous draw.',
        missingInformation: 'Additional instructor conditions are not verified.'
    },
    {
        id: 'color_pattern',
        version: '1.0.0',
        label: 'Color Pattern',
        status: 'UNVERIFIED',
        kind: 'PREDICTION',
        description: 'Use historical color groups and the stated 7-9 values.',
        missingInformation: 'The qualifying color groups and precise 7-9 rule are not verified.'
    },
    {
        id: 'maximum_minimum',
        version: '1.0.0',
        label: 'Maximum/Minimum',
        status: 'UNVERIFIED',
        kind: 'PREDICTION',
        description: 'Analyze alternating maximum/minimum sequences and changes.',
        missingInformation: 'The sequence, add/subtract rule, and switching conditions are not verified.'
    },
    {
        id: 'timing_skip_filter',
        version: '1.0.0',
        label: 'Timing and Skip Filter',
        status: 'UNVERIFIED',
        kind: 'FILTER',
        description: 'Filter entries based on recent sequences and timing.',
        missingInformation: 'The entry, waiting, and pattern-switch conditions are not verified.'
    },
    {
        id: 'combined_strategy',
        version: '1.0.0',
        label: 'Combined Strategy',
        status: 'UNVERIFIED',
        kind: 'COMBINED',
        description: 'Combine verified Add-10 signals and a verified timing filter.',
        missingInformation: 'Required component rules and combination conditions are not verified.'
    },
    {
        id: 'simple_smallest_number_add_10',
        version: '1.0.0',
        selectionCount: 1,
        displayLabel: 'Single-number absence experiment — Smallest +10',
        label: 'Simple Smallest-Number Add-10',
        status: 'RESEARCH_ONLY',
        kind: 'PREDICTION',
        description: 'Research model: add 10 to the smallest number in the immediately previous completed draw.',
        missingInformation: 'This simplified research model is not the instructor-verified strategy.'
    },
    {
        id: 'smallest_add10_step10_four', version: '1.0.0', selectionCount: 4,
        label: 'Smallest +10 / Step-10 Four-Number Research',
        status: 'RESEARCH_ONLY', kind: 'PREDICTION',
        description: 'New research variant: smallest previous-draw number +10, then three +10 steps wrapping within 1–49. Skip if the first selection exceeds 49.',
        missingInformation: 'Newly designed research variant, not the instructor-verified method.'
    }
];

function strategyDefinition(id, version) {
    return STRATEGIES.find(strategy => strategy.id === id && strategy.version === version);
}

function validSelections(selections, count) {
    return [1, 3, 4].includes(count) && Array.isArray(selections) && selections.length === count
        && new Set(selections).size === count
        && selections.every(number => Number.isInteger(number) && number >= 1 && number <= 49);
}

function validBalls(value) {
    return Array.isArray(value) && value.length === 6 && new Set(value).size === 6
        && value.every(number => Number.isInteger(number) && number >= 1 && number <= 49);
}

function ballsFromRecord(record) {
    const balls = record?.result?.balls;
    return Array.isArray(balls) ? balls.map(Number) : null;
}

function drawIdFromRecord(record) {
    const id = Number(record?.drawId ?? record?.id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function predictionFromStrategy(strategy, source) {
    if (strategy.status === 'UNVERIFIED') {
        return { status: 'SKIP', selections: [], conditions: { reason: strategy.missingInformation } };
    }
    if (!strategy.enabled) {
        return { status: 'SKIP', selections: [], conditions: { reason: 'Strategy is disabled.' } };
    }
    if (strategy.id === minmax.ID) return { status: 'SKIP', selections: [], conditions: { reason: 'STATEFUL_CONTEXT_REQUIRED' } };
    const definition = strategyDefinition(strategy.id, strategy.version);
    if (!definition?.selectionCount) {
        return { status: 'SKIP', selections: [], conditions: { reason: strategy.missingInformation } };
    }
    if (!validBalls(source.balls)) {
        return { status: 'SKIP', selections: [], conditions: { reason: 'Previous completed draw is invalid.' } };
    }
    const smallest = Math.min(...source.balls);
    const candidate = smallest + 10;
    if (candidate > 49) {
        return {
            status: 'SKIP',
            selections: [],
            conditions: { smallest, addition: 10, reason: 'Smallest number plus 10 exceeds 49.' }
        };
    }
    const selections = [candidate];
    while (selections.length < definition.selectionCount) selections.push(((selections.at(-1) - 1 + 10) % 49) + 1);
    if (!validSelections(selections, definition.selectionCount)) throw new Error('Invalid lab selection contract.');
    return {
        status: 'PENDING', selections,
        conditions: definition.selectionCount === 1
            ? { smallest, addition: 10, model: 'SIMPLIFIED_RESEARCH_MODEL' }
            : { smallest, addition: 10, step: 10, wrap: 49, model: 'STEP10_FOUR_RESEARCH_MODEL' }
    };
}

function validateBetZeroPrediction(selections, actualBalls, selectionCount = 4) {
    if (!validBalls(actualBalls) || !validSelections(selections, selectionCount)) return 'INVALID';
    return selections.some(number => actualBalls.includes(number)) ? 'LOSS' : 'WIN';
}

function summarizePredictionRows(rows) {
    const ordered = rows.slice().sort((a, b) => Number(a.targetDrawId) - Number(b.targetDrawId)
        || String(a.predictionId).localeCompare(String(b.predictionId)));
    let totalPredictions = 0, wins = 0, losses = 0, skipped = 0, invalid = 0;
    let currentLosingStreak = 0, worstLosingStreak = 0;
    let currentWinningStreak = 0, longestWinningStreak = 0;
    const evaluated = [];
    for (const row of ordered) {
        if (row.status === 'PENDING' || row.status === 'WIN' || row.status === 'LOSS') totalPredictions++;
        if (row.status === 'SKIP') skipped++;
        if (row.status === 'INVALID') invalid++;
        if (row.status === 'WIN') {
            wins++;
            currentLosingStreak = 0;
            currentWinningStreak++;
            longestWinningStreak = Math.max(longestWinningStreak, currentWinningStreak);
            evaluated.push(row);
        } else if (row.status === 'LOSS') {
            losses++;
            currentWinningStreak = 0;
            currentLosingStreak++;
            worstLosingStreak = Math.max(worstLosingStreak, currentLosingStreak);
            evaluated.push(row);
        }
    }
    const last100 = ordered.slice(-100).reverse().map(row => ({
        predictionId: row.predictionId,
        targetDrawId: row.targetDrawId,
        predictedAt: row.predictedAt,
        strategyConfig: JSON.parse(row.strategyConfigJson),
        conditions: JSON.parse(row.conditions_json || '{}'),
        selections: JSON.parse(row.selectionsJson),
        status: row.status,
        validatedAt: row.validatedAt
    }));
    const recent = evaluated.slice(-100);
    return {
        totalPredictions, wins, losses, skipped, invalid,
        currentLosingStreak, worstLosingStreak, currentWinningStreak, longestWinningStreak,
        winRate: wins + losses ? wins / (wins + losses) : null,
        lastPredictionResult: last100[0]?.status || null,
        recent100: {
            evaluated: recent.length,
            wins: recent.filter(row => row.status === 'WIN').length,
            losses: recent.filter(row => row.status === 'LOSS').length,
            winRate: recent.length ? recent.filter(row => row.status === 'WIN').length / recent.length : null
        },
        last100
    };
}

function wilsonInterval(wins, trials, z = 1.959963984540054) {
    if (!trials) return null;
    const rate = wins / trials;
    const divisor = 1 + z * z / trials;
    const center = (rate + z * z / (2 * trials)) / divisor;
    const margin = z * Math.sqrt((rate * (1 - rate) + z * z / (4 * trials)) / trials) / divisor;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function probabilityAllAbsent(selectionCount) {
    if (!Number.isInteger(selectionCount) || selectionCount < 1 || selectionCount > 4) return null;
    let probability = 1;
    for (let index = 0; index < selectionCount; index++) probability *= (43 - index) / (49 - index);
    return probability;
}

function seededRandom(seed) {
    let state = Number.parseInt(crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 8), 16) || 1;
    return () => {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function randomSelections(count, random) {
    const pool = Array.from({ length: 49 }, (_, index) => index + 1);
    for (let index = 0; index < count; index++) {
        const selected = index + Math.floor(random() * (pool.length - index));
        [pool[index], pool[selected]] = [pool[selected], pool[index]];
    }
    return pool.slice(0, count);
}

function normalizeHistoricalDraws(records) {
    const byId = new Map();
    const conflictingIds = new Set();
    let invalidDraws = 0, duplicates = 0;
    for (const record of Array.isArray(records) ? records : []) {
        const id = drawIdFromRecord(record);
        const balls = ballsFromRecord(record);
        if (id === null || !validBalls(balls)) {
            invalidDraws++;
            continue;
        }
        const signature = balls.slice().sort((a, b) => a - b).join(',');
        const existing = byId.get(id);
        if (!existing) byId.set(id, { id, balls, signature });
        else if (existing.signature === signature) duplicates++;
        else {
            conflictingIds.add(id);
            invalidDraws++;
        }
    }
    for (const id of conflictingIds) byId.delete(id);
    return { draws: [...byId.values()].sort((a, b) => a.id - b.id), invalidDraws, duplicates, conflictingDraws: conflictingIds.size };
}

function makeOpportunities(draws) {
    const opportunities = [];
    let gaps = 0;
    for (let index = 1; index < draws.length; index++) {
        const source = draws[index - 1], target = draws[index];
        if (target.id === source.id + 1) opportunities.push({ source, target });
        else gaps++;
    }
    return { opportunities, gaps };
}

function metricsForSegment(opportunities, strategy, seed, onProgress = () => {}, picks = null) {
    let predictions = 0, wins = 0, losses = 0, skipped = 0;
    let currentLosingStreak = 0, worstLosingStreak = 0, currentWinningStreak = 0, longestWinningStreak = 0;
    let expectedWins = 0, randomWins = 0, randomTrials = 0;
    const random = seededRandom(`${seed}:${strategy.id}:${strategy.version}:${opportunities[0]?.target.id || 0}`);
    for (const { source, target } of opportunities) {
        if ((predictions + skipped) % 100 === 0) onProgress((predictions + skipped) / Math.max(1, opportunities.length));
        const pick = picks?.get(target.id) || predictionFromStrategy(strategy, source);
        if (pick.status !== 'PENDING') {
            skipped++;
            continue;
        }
        predictions++;
        const outcome = validateBetZeroPrediction(pick.selections, target.balls, strategy.selectionCount ?? 0);
        if (outcome === 'WIN') {
            wins++;
            currentLosingStreak = 0;
            currentWinningStreak++;
            longestWinningStreak = Math.max(longestWinningStreak, currentWinningStreak);
        } else {
            losses++;
            currentWinningStreak = 0;
            currentLosingStreak++;
            worstLosingStreak = Math.max(worstLosingStreak, currentLosingStreak);
        }
        const count = pick.selections.length;
        expectedWins += probabilityAllAbsent(count);
        for (let repetition = 0; repetition < RANDOM_REPETITIONS; repetition++) {
            const entryRandom = strategy.id === 'smallest_add10_step10_four'
                ? seededRandom(`${seed}:${strategy.id}:${strategy.version}:${target.id}:${repetition}`) : random;
            const randomPick = randomSelections(count, entryRandom);
            if (randomPick.every(number => !target.balls.includes(number))) randomWins++;
            randomTrials++;
        }
    }
    const rate = wins + losses ? wins / (wins + losses) : null;
    const interval = wilsonInterval(wins, wins + losses);
    const theoreticalRate = predictions ? expectedWins / predictions : null;
    const randomRate = randomTrials ? randomWins / randomTrials : null;
    let researchSignal = 'INSUFFICIENT_SAMPLE';
    if (predictions >= 100 && interval && theoreticalRate !== null) {
        researchSignal = interval[0] > theoreticalRate ? 'FURTHER_INVESTIGATION' : 'NO_CLEAR_EVIDENCE';
    }
    return {
        eligibleOpportunities: opportunities.length,
        predictions, skipped, wins, losses,
        coverage: opportunities.length ? predictions / opportunities.length : null,
        winRate: rate,
        confidenceInterval95: interval,
        currentLosingStreak, worstLosingStreak, currentWinningStreak, longestWinningStreak,
        theoreticalBaseline: {
            expectedWinRate: theoreticalRate,
            probabilityByPickCount: { 1: probabilityAllAbsent(1), 2: probabilityAllAbsent(2), 3: probabilityAllAbsent(3), 4: probabilityAllAbsent(4) }
        },
        randomBaseline: {
            seed: String(seed),
            matchingEntries: predictions,
            repetitionsPerEntry: RANDOM_REPETITIONS,
            trials: randomTrials,
            wins: randomWins,
            winRate: randomRate,
            confidenceInterval95: wilsonInterval(randomWins, randomTrials)
        },
        researchSignal
    };
}

function extractResults(records) {
    const normalized = normalizeHistoricalDraws(records);
    const { opportunities, gaps } = makeOpportunities(normalized.draws);
    return { ...normalized, opportunities, gaps };
}

function createBetZeroLab(db, options = {}) {
    const now = options.now || (() => Date.now());
    db.exec(`
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
    `);

    const insertStrategy = db.prepare(`INSERT OR IGNORE INTO betzero_lab_strategies
        (strategy_id, version, label, status, kind, description, missing_information)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertConfig = db.prepare(`INSERT OR IGNORE INTO betzero_lab_strategy_configs
        (strategy_id, version, enabled, config_json, updated_at) VALUES (?, ?, ?, ?, ?)`);
    for (const strategy of STRATEGIES) {
        insertStrategy.run(strategy.id, strategy.version, strategy.label, strategy.status, strategy.kind,
            strategy.description, strategy.missingInformation);
        insertConfig.run(strategy.id, strategy.version, strategy.id === 'simple_smallest_number_add_10' ? 1 : 0,
            JSON.stringify({ alertThresholds: ALERT_THRESHOLDS }), now());
    }
    db.prepare(`INSERT OR IGNORE INTO betzero_lab_state(state_key, state_value) VALUES ('started_at', ?)`)
        .run(String(now()));
    db.prepare(`INSERT OR IGNORE INTO betzero_lab_state(state_key, state_value) VALUES ('last_snapshot_at', ?)`)
        .run(String(now()));

    const getState = db.prepare('SELECT state_value FROM betzero_lab_state WHERE state_key = ?');
    const setState = db.prepare(`INSERT INTO betzero_lab_state(state_key, state_value) VALUES (?, ?)
        ON CONFLICT(state_key) DO UPDATE SET state_value = excluded.state_value`);
    const predictionRows = strategyId => db.prepare(`SELECT *,
        prediction_id AS predictionId, strategy_version AS strategyVersion,
        target_draw_id AS targetDrawId, predicted_at AS predictedAt,
        strategy_config_json AS strategyConfigJson,
        selections_json AS selectionsJson, validated_at AS validatedAt
        FROM betzero_lab_forward_predictions
        WHERE strategy_id = ? ORDER BY CAST(target_draw_id AS INTEGER), prediction_id`).all(strategyId);
    const updatePrediction = db.prepare(`UPDATE betzero_lab_forward_predictions
        SET status = ?, actual_balls_json = ?, validated_at = ?
        WHERE prediction_id = ?`);
    const insertRevision = db.prepare(`INSERT INTO betzero_lab_result_revisions
        (prediction_id, previous_status, next_status, previous_balls_json, next_balls_json, changed_at)
        VALUES (?, ?, ?, ?, ?, ?)`);

    function strategies() {
        return db.prepare(`SELECT s.strategy_id AS id, s.version, s.label, s.status, s.kind,
            s.description, s.missing_information AS missingInformation,
            c.enabled, c.config_json AS configJson, c.updated_at AS updatedAt
            FROM betzero_lab_strategies s JOIN betzero_lab_strategy_configs c
            USING(strategy_id, version) ORDER BY s.strategy_id`).all().map(row => ({
            ...row, label: strategyDefinition(row.id, row.version)?.displayLabel || row.label,
            selectionCount: strategyDefinition(row.id, row.version)?.selectionCount || null,
            enabled: row.enabled === 1, config: JSON.parse(row.configJson)
        }));
    }

    function setStrategyConfig(strategyId, updates) {
        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            throw Object.assign(new Error('Invalid strategy configuration.'), { status: 400 });
        }
        const strategy = strategies().find(item => item.id === strategyId && strategyDefinition(item.id, item.version));
        if (!strategy) throw Object.assign(new Error('Unknown lab strategy.'), { status: 404 });
        const hasEnabled = Object.hasOwn(updates, 'enabled');
        const hasThresholds = Object.hasOwn(updates, 'alertThresholds');
        if (!hasEnabled && !hasThresholds) {
            throw Object.assign(new Error('Provide an enablement or alert-threshold setting.'), { status: 400 });
        }
        const enabled = hasEnabled ? updates.enabled : strategy.enabled;
        if (typeof enabled !== 'boolean') {
            throw Object.assign(new Error('Choose whether to enable the strategy.'), { status: 400 });
        }
        if (enabled && strategy.status === 'UNVERIFIED') {
            throw Object.assign(new Error('Unverified strategies cannot be enabled.'), { status: 400 });
        }
        const alertThresholds = hasThresholds ? updates.alertThresholds : strategy.config.alertThresholds || ALERT_THRESHOLDS;
        if (!Array.isArray(alertThresholds) || alertThresholds.length > 10
            || alertThresholds.some(value => !Number.isSafeInteger(value) || value < 1 || value > 100)
            || new Set(alertThresholds).size !== alertThresholds.length) {
            throw Object.assign(new Error('Alert thresholds must be unique whole numbers from 1 to 100.'), { status: 400 });
        }
        db.prepare(`UPDATE betzero_lab_strategy_configs SET enabled = ?, config_json = ?, updated_at = ?
            WHERE strategy_id = ? AND version = ?`).run(enabled ? 1 : 0,
            JSON.stringify({ ...strategy.config, alertThresholds: [...alertThresholds].sort((a, b) => a - b) }),
            now(), strategy.id, strategy.version);
        return strategies().find(item => item.id === strategy.id && item.version === strategy.version);
    }

    function setStrategyEnabled(strategyId, enabled) {
        return setStrategyConfig(strategyId, { enabled });
    }

    function rebuildStreakEvents(changedFromTarget, onlyStrategy = null) {
        const insertEvent = db.prepare(`INSERT INTO betzero_lab_streak_events
            (prediction_id, strategy_id, strategy_version, target_draw_id, outcome,
            current_loss_streak, worst_loss_streak, current_win_streak, longest_win_streak)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const insertAlert = db.prepare(`INSERT OR IGNORE INTO betzero_lab_alerts
            (strategy_id, strategy_version, target_draw_id, alert_type, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`);
        const deleteEvents = db.prepare(`DELETE FROM betzero_lab_streak_events
            WHERE strategy_id = ? AND strategy_version = ? AND CAST(target_draw_id AS INTEGER) >= ?`);
        const deleteAlerts = db.prepare(`DELETE FROM betzero_lab_alerts
            WHERE strategy_id = ? AND strategy_version = ? AND CAST(target_draw_id AS INTEGER) >= ?`);
        const previousEvent = db.prepare(`SELECT current_loss_streak AS currentLoss,
            worst_loss_streak AS worstLoss, current_win_streak AS currentWin,
            longest_win_streak AS longestWin FROM betzero_lab_streak_events
            WHERE strategy_id = ? AND strategy_version = ? AND CAST(target_draw_id AS INTEGER) < ?
            ORDER BY CAST(target_draw_id AS INTEGER) DESC LIMIT 1`);
        const settledRowsFrom = (strategyId, version) => db.prepare(`SELECT *,
            prediction_id AS predictionId, target_draw_id AS targetDrawId,
            validated_at AS validatedAt FROM betzero_lab_forward_predictions
            WHERE strategy_id = ? AND strategy_version = ? AND CAST(target_draw_id AS INTEGER) >= ?
            ORDER BY CAST(target_draw_id AS INTEGER), prediction_id`).all(strategyId, version, changedFromTarget);
        for (const strategy of strategies()) {
            if (onlyStrategy && (strategy.id !== onlyStrategy.id || strategy.version !== onlyStrategy.version)) continue;
            if (!strategyDefinition(strategy.id, strategy.version)) continue;
            deleteEvents.run(strategy.id, strategy.version, changedFromTarget);
            deleteAlerts.run(strategy.id, strategy.version, changedFromTarget);
            const previous = previousEvent.get(strategy.id, strategy.version, changedFromTarget);
            let currentLoss = previous?.currentLoss || 0;
            let worstLoss = previous?.worstLoss || 0;
            let currentWin = previous?.currentWin || 0;
            let longestWin = previous?.longestWin || 0;
            for (const row of settledRowsFrom(strategy.id, strategy.version)) {
                if (row.strategy_version !== strategy.version || !['WIN', 'LOSS'].includes(row.status)) continue;
                if (row.status === 'WIN') {
                    currentLoss = 0;
                    currentWin++;
                    longestWin = Math.max(longestWin, currentWin);
                } else {
                    currentWin = 0;
                    currentLoss++;
                    const isNewWorst = currentLoss > worstLoss;
                    worstLoss = Math.max(worstLoss, currentLoss);
                    for (const threshold of strategy.config.alertThresholds || ALERT_THRESHOLDS) {
                        if (currentLoss === threshold) insertAlert.run(strategy.id, strategy.version, row.target_draw_id,
                            `LOSS_STREAK_${threshold}`, `${strategy.label} reached ${threshold} consecutive losses.`,
                            row.validatedAt || new Date(now()).toISOString());
                    }
                    if (isNewWorst) insertAlert.run(strategy.id, strategy.version, row.target_draw_id, 'NEW_WORST_LOSS_STREAK',
                        `${strategy.label} recorded a new worst losing streak of ${currentLoss}.`,
                        row.validatedAt || new Date(now()).toISOString());
                }
                insertEvent.run(row.predictionId, strategy.id, strategy.version, row.targetDrawId, row.status,
                    currentLoss, worstLoss, currentWin, longestWin);
            }
        }
    }

    function reconcileArchive(archive, settings = {}) {
        const { planReconciliation } = require('./betzero-reconciliation');
        const plan = planReconciliation(db, archive, { ...settings, now: now() });
        if (settings.dryRun !== false) return plan;
        // One bounded pending-only repair per transaction. Re-read under the write lock.
        let applied = 0;
        for (const decision of plan.decisions.filter(item => item.action === 'SETTLE')) {
            db.exec('BEGIN IMMEDIATE');
            try {
                const row = db.prepare('SELECT * FROM betzero_lab_forward_predictions WHERE prediction_id=?').get(decision.predictionId);
                if (row?.strategy_id === minmax.ID && minmaxState().paused) { db.exec('ROLLBACK'); decision.action='WAIT'; decision.reason='RESULT_CONFLICT_REVIEW_REQUIRED'; continue; }
                if (!row || row.status !== 'PENDING' || JSON.stringify(row) !== JSON.stringify(decision.original)) {
                    db.exec('ROLLBACK'); decision.action = 'UNCHANGED'; continue;
                }
                const refreshed = planReconciliation(db, archive, { ...settings, now: now(), target: decision.targetDrawId }).decisions.find(item => item.predictionId === decision.predictionId);
                if (refreshed?.action !== 'SETTLE') {
                    db.exec('ROLLBACK'); decision.action = 'UNCHANGED'; decision.reason = refreshed?.reason || 'NO_LONGER_ELIGIBLE'; continue;
                }
                const historySize = db.prepare('SELECT COUNT(*) n FROM betzero_lab_forward_predictions WHERE strategy_id=? AND strategy_version=?').get(decision.strategyId, decision.strategyVersion).n;
                if (historySize > 50000) throw new Error('Reconciliation requires a separately reviewed rebuild above 50,000 strategy records.');
                db.prepare(`UPDATE betzero_lab_forward_predictions SET status=?, actual_balls_json=?, validated_at=?
                    WHERE prediction_id=? AND status='PENDING'`).run(decision.outcome, JSON.stringify(decision.balls), plan.evaluatedAt, decision.predictionId);
                db.prepare(`INSERT INTO betzero_lab_reconciliations
                    (prediction_id,source_name,source_hash,result_hash,observed_at,reconciled_at,outcome) VALUES(?,?,?,?,?,?,?)`)
                    .run(decision.predictionId, plan.source, plan.sourceHash, decision.resultHash, decision.observedAt, plan.evaluatedAt, decision.outcome);
                if (decision.strategyId === minmax.ID) saveMinmaxState(minmax.settle(minmaxState(), Number(decision.targetDrawId), decision.outcome));
                rebuildStreakEvents(0, { id: decision.strategyId, version: decision.strategyVersion });
                db.exec('COMMIT'); applied++;
            } catch (error) { db.exec('ROLLBACK'); throw error; }
        }
        return { ...plan, dryRun: false, applied };
    }

    function minmaxState() {
        const row = db.prepare('SELECT state_json FROM betzero_lab_minmax_state WHERE strategy_id=? AND version=?').get(minmax.ID, '1.0.0');
        return row ? JSON.parse(row.state_json) : {};
    }
    function saveMinmaxState(state) {
        db.prepare(`INSERT INTO betzero_lab_minmax_state VALUES (?,?,?) ON CONFLICT(strategy_id,version)
            DO UPDATE SET state_json=excluded.state_json`).run(minmax.ID, '1.0.0', JSON.stringify(state));
    }
    function rememberMinmaxResult(record, observedAt) {
        const id = drawIdFromRecord(record), balls = ballsFromRecord(record);
        if (!id || !validBalls(balls)) return;
        const settledAt = Date.parse(record.settledAt || '');
        if (Number.isFinite(settledAt) && settledAt > observedAt) return;
        const json = JSON.stringify([...balls].sort((a,b)=>a-b));
        const previous = db.prepare('SELECT balls_json FROM betzero_lab_minmax_draws WHERE draw_id=?').get(id);
        if (previous && previous.balls_json !== json) {
            db.prepare('UPDATE betzero_lab_minmax_draws SET conflicted=1 WHERE draw_id=?').run(id);
            saveMinmaxState({ ...minmaxState(), paused: true, conflictDrawId: id });
        } else db.prepare('INSERT OR IGNORE INTO betzero_lab_minmax_draws(draw_id,balls_json,observed_at) VALUES(?,?,?)').run(id,json,observedAt);
    }
    function minmaxHistory(target, recordedAt) {
        return db.prepare(`SELECT s.draw_id sid,s.balls_json sb,t.draw_id tid,t.balls_json tb
            FROM betzero_lab_minmax_draws t JOIN betzero_lab_minmax_draws s ON s.draw_id=t.draw_id-1
            WHERE t.draw_id<? AND s.conflicted=0 AND t.conflicted=0 AND s.observed_at<=? AND t.observed_at<=?
            ORDER BY t.draw_id DESC LIMIT 5`).all(target,recordedAt,recordedAt).reverse().map(r => ({
                source:{id:r.sid,balls:JSON.parse(r.sb)}, target:{id:r.tid,balls:JSON.parse(r.tb)} }));
    }
    function settleRecord(record, validatedAt) {
        const targetId = drawIdFromRecord(record);
        if (targetId === null || !record?.result || typeof record.result !== 'object') return null;
        const rows = db.prepare(`SELECT * FROM betzero_lab_forward_predictions
            WHERE target_draw_id = ? AND status IN ('PENDING', 'WIN', 'LOSS', 'INVALID')`).all(String(targetId));
        if (!rows.length) return null;
        const rawBalls = ballsFromRecord(record);
        const actualBalls = validBalls(rawBalls) ? rawBalls : null;
        let changed = false;
        for (const row of rows) {
            if (!strategyDefinition(row.strategy_id, row.strategy_version)?.selectionCount) continue;
            const selections = JSON.parse(row.selections_json);
            if (row.strategy_id === minmax.ID) {
                if (!actualBalls || minmaxState().paused) continue;
                if (row.status !== 'PENDING') {
                    if (row.actual_balls_json && JSON.stringify(JSON.parse(row.actual_balls_json).sort((a,b)=>a-b)) !== JSON.stringify([...actualBalls].sort((a,b)=>a-b)))
                        saveMinmaxState({ ...minmaxState(), paused:true, conflictDrawId:targetId });
                    continue;
                }
            }
            const nextStatus = actualBalls ? validateBetZeroPrediction(selections, actualBalls, strategyDefinition(row.strategy_id, row.strategy_version).selectionCount) : 'INVALID';
            const nextBallsJson = actualBalls ? JSON.stringify(actualBalls) : null;
            const nextStatusDiffers = row.status !== nextStatus;
            const nextBallsDiffer = row.actual_balls_json !== nextBallsJson;
            if (!nextStatusDiffers && !nextBallsDiffer) continue;
            if (row.status !== 'PENDING') {
                insertRevision.run(row.prediction_id, row.status, nextStatus, row.actual_balls_json,
                    nextBallsJson, validatedAt);
            }
            updatePrediction.run(nextStatus, nextBallsJson, validatedAt, row.prediction_id);
            if (row.strategy_id === minmax.ID) saveMinmaxState(minmax.settle(minmaxState(), targetId, nextStatus));
            changed = true;
        }
        return changed ? targetId : null;
    }

    function saveForwardPrediction(strategy, sourceRecord, sourceBalls, targetDrawId, predictedAt, timing) {
        const state = strategy.id === minmax.ID ? minmaxState() : null;
        const prediction = state && strategy.enabled
            ? minmax.decide({ id: drawIdFromRecord(sourceRecord), balls: sourceBalls }, targetDrawId, minmaxHistory(targetDrawId, predictedAt), state)
            : predictionFromStrategy(strategy, { balls: sourceBalls });
        const sourceId = drawIdFromRecord(sourceRecord);
        const predictionId = crypto.randomUUID();
        const sourceInput = {
            drawId: sourceId,
            settledAt: sourceRecord.settledAt,
            balls: sourceBalls
        };
        const inserted = db.prepare(`INSERT OR IGNORE INTO betzero_lab_forward_predictions
            (prediction_id, strategy_id, strategy_version, source_draw_id, target_draw_id, predicted_at,
            strategy_config_json, selections_json, conditions_json, source_input_json, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            predictionId, strategy.id, strategy.version, String(sourceId), String(targetDrawId),
            new Date(predictedAt).toISOString(), JSON.stringify(strategy.config), JSON.stringify(prediction.selections),
            JSON.stringify({ ...prediction.conditions, ...(state ? { stateBefore:state } : {}), timing }), JSON.stringify(sourceInput), prediction.status
        );
        if (state && strategy.enabled && inserted.changes) saveMinmaxState(minmax.afterDecision(state, prediction, targetDrawId));
    }

    function ingestSnapshot({ current, clock, historyUpdates, snapshotAt }) {
        if (!Number.isSafeInteger(snapshotAt) || snapshotAt <= 0) throw new Error('Invalid lab snapshot timestamp.');
        const validatedAt = new Date(snapshotAt).toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
            let changedFromTarget = null;
            for (const record of Array.isArray(historyUpdates) ? historyUpdates : []) {
                rememberMinmaxResult(record, snapshotAt);
                const changedTarget = settleRecord(record, validatedAt);
                if (changedTarget !== null && (changedFromTarget === null || changedTarget < changedFromTarget)) {
                    changedFromTarget = changedTarget;
                }
            }

            const targetDrawId = Number(current?.drawId);
            const clockDrawId = Number(clock?.drawId);
            const timeLeft = Number(clock?.timeLeftSeconds);
            const observedAt = Number(clock?.observedAt);
            const recordedAt = Math.max(snapshotAt, now());
            const expectedTargetAt = observedAt + timeLeft * 1000;
            const targetAlreadySettled = (Array.isArray(historyUpdates) ? historyUpdates : []).some(record =>
                drawIdFromRecord(record) === targetDrawId && record?.result && typeof record.result === 'object');
            if (Number.isSafeInteger(targetDrawId) && targetDrawId > 1 && clockDrawId === targetDrawId
                && !targetAlreadySettled && Number.isFinite(timeLeft) && timeLeft > 0 && timeLeft <= 300
                && Number.isSafeInteger(observedAt) && observedAt > 0 && observedAt <= snapshotAt
                && snapshotAt - observedAt <= 30000 && recordedAt < expectedTargetAt) {
                const sourceRecord = (Array.isArray(historyUpdates) ? historyUpdates : []).find(record =>
                    drawIdFromRecord(record) === targetDrawId - 1 && record?.result && typeof record.result === 'object');
                const sourceBalls = ballsFromRecord(sourceRecord);
                const settledAt = Date.parse(sourceRecord?.settledAt || '');
                const lastSnapshotAt = Number(getState.get('last_snapshot_at')?.state_value) || 0;
                const startedAt = Number(getState.get('started_at')?.state_value) || 0;
                if (sourceRecord && validBalls(sourceBalls) && Number.isFinite(settledAt)
                    && settledAt > Math.max(lastSnapshotAt, startedAt) && settledAt <= snapshotAt) {
                    for (const strategy of strategies()) {
                        if (strategyDefinition(strategy.id, strategy.version)) saveForwardPrediction(strategy, sourceRecord, sourceBalls, targetDrawId, recordedAt,
                            { observedAt, expectedTargetAt, snapshotAt, recordedAt });
                    }
                }
            }

            setState.run('last_snapshot_at', String(Math.max(snapshotAt, Number(getState.get('last_snapshot_at')?.state_value) || 0)));
            if (changedFromTarget !== null) rebuildStreakEvents(changedFromTarget);
            db.exec('COMMIT');
            return { settledChanged: changedFromTarget !== null };
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }

    function listForwardPredictions({ strategyId, strategyVersion, limit = 100 } = {}) {
        const boundedLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100));
        if (strategyId && !STRATEGIES.some(strategy => strategy.id === strategyId)) throw new Error('Unknown lab strategy.');
        if (strategyVersion && !strategyId) throw new Error('A version requires a strategy ID.');
        const version = strategyVersion || STRATEGIES.find(strategy => strategy.id === strategyId)?.version;
        const rows = strategyId
            ? db.prepare(`SELECT * FROM betzero_lab_forward_predictions WHERE strategy_id = ? AND strategy_version = ?
                ORDER BY CAST(target_draw_id AS INTEGER) DESC, prediction_id DESC LIMIT ?`).all(strategyId, version, boundedLimit)
            : db.prepare(`SELECT * FROM betzero_lab_forward_predictions
                ORDER BY CAST(target_draw_id AS INTEGER) DESC, prediction_id DESC LIMIT ?`).all(boundedLimit);
        return rows.map(row => ({
            predictionId: row.prediction_id,
            strategyId: row.strategy_id,
            strategyVersion: row.strategy_version,
            sourceDrawId: row.source_draw_id,
            targetDrawId: row.target_draw_id,
            predictedAt: row.predicted_at,
            strategyConfig: JSON.parse(row.strategy_config_json),
            selections: JSON.parse(row.selections_json),
            conditions: JSON.parse(row.conditions_json),
            sourceInput: JSON.parse(row.source_input_json),
            status: row.status,
            actualBalls: row.actual_balls_json ? JSON.parse(row.actual_balls_json) : null,
            validatedAt: row.validated_at
        }));
    }

    function stats() {
        const strategyList = strategies().filter(strategy => strategyDefinition(strategy.id, strategy.version));
        return Object.fromEntries(strategyList.map(strategy => [
            strategy.id,
            {
                ...strategy,
                ...(strategy.id === minmax.ID ? { decisionState: minmaxState() } : {}),
                ...require('./betzero-reconciliation').pendingQuality(db, strategy.id, strategy.version, now()),
                ...summarizePredictionRows(predictionRows(strategy.id)
                    .filter(row => row.strategy_version === strategy.version))
            }
        ]));
    }

    function statsForVersion(strategyId, version) {
        const strategy = strategies().find(item => item.id === strategyId && item.version === version);
        if (!strategy) throw new Error('Unknown lab strategy version.');
        return { ...strategy, ...require('./betzero-reconciliation').pendingQuality(db, strategyId, version, now()), ...summarizePredictionRows(predictionRows(strategyId).filter(row => row.strategy_version === version)) };
    }

    function alerts(limit = 100) {
        const boundedLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100));
        return db.prepare(`SELECT strategy_id AS strategyId, strategy_version AS strategyVersion,
            target_draw_id AS targetDrawId, alert_type AS type, message, created_at AS createdAt
            FROM betzero_lab_alerts ORDER BY CAST(target_draw_id AS INTEGER) DESC, alert_id DESC LIMIT ?`)
            .all(boundedLimit);
    }

    function runBacktest(records, { window = 'all', seed = 'betzero-lab-v1', mode = 'EXPLORATORY', protocolId = null, strategyId = null, firstTarget = null, onProgress = () => {} } = {}) {
        const requestedWindow = String(window);
        if (!['100', '500', '1000', 'all'].includes(requestedWindow)) {
            throw Object.assign(new Error('Choose a 100, 500, 1000, or all-draw window.'), { status: 400 });
        }
        const safeSeed = seed;
        if (typeof safeSeed !== 'string' || !safeSeed || safeSeed.length > 64) {
            throw Object.assign(new Error('Backtest seed must contain 1 to 64 characters.'), { status: 400 });
        }
        const extracted = extractResults(records);
        let opportunities = extracted.opportunities;
        if (firstTarget !== null) opportunities = opportunities.filter(p => p.target.id >= firstTarget);
        if (requestedWindow !== 'all') opportunities = opportunities.slice(-Number(requestedWindow));
        if (opportunities.length > 50000) throw Object.assign(new Error('Maximum 50,000 source/target pairs.'), { status: 413 });
        if (opportunities.length < 5) {
            throw Object.assign(new Error('At least five consecutive completed draw pairs are required for a backtest.'), { status: 422 });
        }
        const developmentEnd = Math.floor(opportunities.length * 0.6);
        const validationEnd = developmentEnd + Math.floor(opportunities.length * 0.2);
        const segments = mode === 'SEALED_FINAL' ? { final_test: opportunities } : {
            development: opportunities.slice(0, developmentEnd),
            validation: opportunities.slice(developmentEnd, validationEnd),
            final_test: opportunities.slice(validationEnd)
        };
        const dataSignatures = extracted.draws.map(draw => `${draw.id}:${draw.signature}`).join('|');
        const datasetHash = crypto.createHash('sha256').update(dataSignatures).digest('hex');
        const runId = crypto.randomUUID();
        const createdAt = new Date(now()).toISOString();
        if (strategyId && !STRATEGIES.some(s => s.id === strategyId && s.status === 'RESEARCH_ONLY')) throw Object.assign(new Error('Unknown research strategy.'), {status:400});
        if (strategyId && mode === 'SEALED_FINAL') throw Object.assign(new Error('Sealed strategy selection must come from its frozen protocol.'), {status:409});
        const effectiveStrategies = strategies().filter(strategy => strategyDefinition(strategy.id, strategy.version))
            .filter(s => !strategyId || s.id === strategyId).map(s => strategyId ? {...s, enabled:true} : s);
        const mm = effectiveStrategies.find(s => s.id === minmax.ID && s.enabled);
        const minmaxPicks = mm ? minmax.simulate(opportunities, extracted.opportunities, f => onProgress(f * 5)) : null;
        const resultRows = [];
        for (const strategy of effectiveStrategies) {
            const effectiveStrategy = effectiveStrategies.find(item => item.id === strategy.id && item.version === strategy.version);
            for (const [segment, rows] of Object.entries(segments)) {
                let result;
                if (strategy.status === 'UNVERIFIED') {
                    result = {
                        status: 'UNVERIFIED',
                        eligibleOpportunities: rows.length,
                        predictions: 0,
                        skipped: rows.length,
                        wins: 0,
                        losses: 0,
                        reason: strategy.missingInformation,
                        randomBaseline: null,
                        theoreticalBaseline: null,
                        researchSignal: 'NOT_EVALUATED'
                    };
                } else if (!effectiveStrategy.enabled) {
                    result = {
                        status: 'DISABLED',
                        eligibleOpportunities: rows.length,
                        predictions: 0,
                        skipped: rows.length,
                        wins: 0,
                        losses: 0,
                        reason: 'Strategy is disabled.',
                        randomBaseline: null,
                        theoreticalBaseline: null,
                        researchSignal: 'NOT_EVALUATED'
                    };
                } else {
                    result = {
                        status: 'RESEARCH_ONLY',
                        ...metricsForSegment(rows, effectiveStrategy, `${safeSeed}:${segment}`, fraction => onProgress(5 + 65 * (resultRows.length + fraction) / (effectiveStrategies.length * Object.keys(segments).length)), strategy.id === minmax.ID ? minmaxPicks : null)
                    };
                }
                resultRows.push({ runId, strategyId: strategy.id, strategyVersion: strategy.version, segment, result });
            }
        }
        const data = {
            overall: mm ? { strategyId:minmax.ID, ...metricsForSegment(opportunities,mm,`${safeSeed}:overall`,()=>{},minmaxPicks) } : null,
            validDraws: extracted.draws.length,
            invalidDraws: extracted.invalidDraws,
            duplicateDraws: extracted.duplicates,
            conflictingDraws: extracted.conflictingDraws,
            gaps: extracted.gaps,
            eligibleOpportunities: opportunities.length,
            firstTargetDrawId: opportunities[0].target.id,
            lastTargetDrawId: opportunities.at(-1).target.id,
            evaluationMode: mode, protocolId, researchStrategyId: strategyId, initialization: mm ? 'Five preceding valid consecutive pairs; fresh simulation state; state continues across segments.' : null,
            split: { development: segments.development?.length || 0, validation: segments.validation?.length || 0, finalTest: segments.final_test.length },
            strategies: effectiveStrategies.map(strategy => ({
                id: strategy.id,
                version: strategy.version,
                status: strategy.status,
                enabled: strategy.enabled,
                config: strategy.config
            })),
            randomRepetitionsPerEntry: RANDOM_REPETITIONS,
            methodology: mode === 'SEALED_FINAL' ? 'One consumed sealed protocol; frozen rules and seed, future target boundaries reserved before collection. This retrospective evaluation is not genuine forward prediction evidence.' : 'Exploratory historical simulation with 60/20/20 development, validation, and reused holdout segments. No untouched final-test claim. Only prior-draw inputs generate picks. Forward predictions remain separate.'
        };
        const runResult = db.prepare(`INSERT INTO betzero_lab_backtest_runs
            (run_id, status, requested_window, seed, created_at, completed_at, dataset_hash, data_json)
            VALUES (?, 'COMPLETED', ?, ?, ?, ?, ?, ?)`);
        const insertResult = db.prepare(`INSERT INTO betzero_lab_backtest_results
            (run_id, strategy_id, strategy_version, segment, result_json) VALUES (?, ?, ?, ?, ?)`);
        const insertPrediction = db.prepare(`INSERT INTO betzero_lab_backtest_predictions
            (prediction_id, run_id, strategy_id, strategy_version, segment, source_draw_id,
            target_draw_id, predicted_at, strategy_config_json, selections_json, conditions_json, source_input_json,
            status, actual_balls_json, validated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const simulatedPredictions = [];
        onProgress(72);
        for (const strategy of effectiveStrategies) {
            for (const [segment, rows] of Object.entries(segments)) {
                for (const { source, target } of rows) {
                    if (simulatedPredictions.length % 100 === 0) onProgress(72 + 20 * simulatedPredictions.length / (effectiveStrategies.length * opportunities.length));
                    const prediction = (strategy.id === minmax.ID && minmaxPicks?.get(target.id)) || predictionFromStrategy(strategy, source);
                    const status = prediction.status === 'PENDING'
                        ? validateBetZeroPrediction(prediction.selections, target.balls, strategy.selectionCount ?? 0)
                        : 'SKIP';
                    simulatedPredictions.push({
                        predictionId: crypto.randomUUID(),
                        runId,
                        strategyId: strategy.id,
                        strategyVersion: strategy.version,
                        segment,
                        sourceDrawId: String(source.id),
                        targetDrawId: String(target.id),
                        predictedAt: createdAt,
                        strategyConfig: strategy.config,
                        selections: prediction.selections,
                        conditions: prediction.conditions,
                        sourceInput: { drawId: source.id, balls: source.balls },
                        status,
                        actualBalls: target.balls
                    });
                }
            }
        }
        db.exec('BEGIN IMMEDIATE');
        try {
            runResult.run(runId, requestedWindow, safeSeed, createdAt, new Date(now()).toISOString(), datasetHash, JSON.stringify(data));
            for (const row of resultRows) insertResult.run(row.runId, row.strategyId, row.strategyVersion, row.segment, JSON.stringify(row.result));
            const validatedAt = new Date(now()).toISOString();
            for (const row of simulatedPredictions) {
                insertPrediction.run(row.predictionId, row.runId, row.strategyId, row.strategyVersion,
                    row.segment, row.sourceDrawId, row.targetDrawId, row.predictedAt, JSON.stringify(row.strategyConfig),
                    JSON.stringify(row.selections), JSON.stringify(row.conditions),
                    JSON.stringify(row.sourceInput), row.status, JSON.stringify(row.actualBalls), validatedAt);
            }
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        return { runId, status: 'COMPLETED', requestedWindow, seed: safeSeed, createdAt, datasetHash, data, results: resultRows };
    }

    function getBacktestRun(runId, { limit = 500, offset = 0 } = {}) {
        const run = db.prepare('SELECT * FROM betzero_lab_backtest_runs WHERE run_id = ?').get(String(runId || ''));
        if (!run || run.status !== 'COMPLETED') return null;
        const boundedLimit = Math.min(1000, Math.max(1, Number.parseInt(limit, 10) || 500));
        const boundedOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
        return {
            runId: run.run_id,
            status: run.status,
            requestedWindow: run.requested_window,
            seed: run.seed,
            createdAt: run.created_at,
            completedAt: run.completed_at,
            datasetHash: run.dataset_hash,
            data: describeEvaluation(JSON.parse(run.data_json)),
            results: db.prepare(`SELECT strategy_id AS strategyId, strategy_version AS strategyVersion,
                segment, result_json AS resultJson FROM betzero_lab_backtest_results WHERE run_id = ?
                ORDER BY strategy_id, segment`).all(run.run_id).map(row => ({
                strategyId: row.strategyId,
                strategyVersion: row.strategyVersion,
                segment: row.segment,
                result: JSON.parse(row.resultJson)
            })),
            predictionTotal: db.prepare('SELECT COUNT(*) AS count FROM betzero_lab_backtest_predictions WHERE run_id = ?')
                .get(run.run_id).count,
            predictions: db.prepare(`SELECT prediction_id AS predictionId, strategy_id AS strategyId,
                strategy_version AS strategyVersion, segment, source_draw_id AS sourceDrawId,
                target_draw_id AS targetDrawId, predicted_at AS predictedAt,
                strategy_config_json AS strategyConfigJson,
                selections_json AS selectionsJson, conditions_json AS conditionsJson,
                source_input_json AS sourceInputJson, status,
                actual_balls_json AS actualBallsJson, validated_at AS validatedAt
                FROM betzero_lab_backtest_predictions WHERE run_id = ?
                ORDER BY CAST(target_draw_id AS INTEGER), strategy_id LIMIT ? OFFSET ?`)
                .all(run.run_id, boundedLimit, boundedOffset).map(row => ({
                predictionId: row.predictionId,
                strategyId: row.strategyId,
                strategyVersion: row.strategyVersion,
                segment: row.segment,
                sourceDrawId: row.sourceDrawId,
                targetDrawId: row.targetDrawId,
                predictedAt: row.predictedAt,
                strategyConfig: JSON.parse(row.strategyConfigJson),
                selections: JSON.parse(row.selectionsJson),
                conditions: JSON.parse(row.conditionsJson),
                sourceInput: JSON.parse(row.sourceInputJson),
                status: row.status,
                actualBalls: JSON.parse(row.actualBallsJson),
                validatedAt: row.validatedAt
            }))
        };
    }

    function listBacktestRuns(limit = 20) {
        const boundedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
        return db.prepare(`SELECT run_id AS runId, status, requested_window AS requestedWindow, seed,
            created_at AS createdAt, completed_at AS completedAt, dataset_hash AS datasetHash, data_json AS dataJson
            FROM betzero_lab_backtest_runs WHERE status='COMPLETED' ORDER BY created_at DESC LIMIT ?`).all(boundedLimit).map(row => ({
            runId: row.runId, status: row.status, requestedWindow: row.requestedWindow, seed: row.seed,
            createdAt: row.createdAt, completedAt: row.completedAt, datasetHash: row.datasetHash,
            data: describeEvaluation(JSON.parse(row.dataJson))
        }));
    }

    function overview() {
        return {
            mode: 'EXPERIMENTAL_ONLY',
            warning: 'EXPERIMENTAL — NOT FOR REAL-MONEY BETTING. No bets or subscriber publishing are enabled.',
            strategies: stats(),
            forwardWindows: require('./betzero-forward-metrics').forwardWindows(db, strategies(), now()),
            predictions: listForwardPredictions({ limit: 100 }),
            alerts: alerts(100),
            backtestRuns: listBacktestRuns(20)
        };
    }

    return {
        strategies,
        setStrategyConfig,
        setStrategyEnabled,
        ingestSnapshot,
        reconcileArchive,
        listForwardPredictions,
        stats,
        statsForVersion,
        alerts,
        runBacktest,
        getBacktestRun,
        listBacktestRuns,
        overview
    };
}

module.exports = {
    ALERT_THRESHOLDS,
    normalizeHistoricalDraws, makeOpportunities,
    STRATEGIES,
    createBetZeroLab,
    probabilityAllAbsent,
    summarizePredictionRows,
    validBalls,
    validSelections,
    predictionFromStrategy,
    seededRandom,
    randomSelections,
    validateBetZeroPrediction,
    wilsonInterval
};
