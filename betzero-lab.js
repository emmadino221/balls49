'use strict';

const crypto = require('node:crypto');
const minmax = require('./betzero-minmax');
const transitions = require('./betzero-statistics-transition');
const { gradeHighLow } = require('./high-low');

// HIGH/LOW follows Minimum/Maximum v2: its MAX method predicts HIGH, its MIN method predicts LOW.
const HIGH_LOW_ID = 'minmax_high_low';
// Chance that six different balls from 1-49 total 148 or less (the same as 152 or more, by symmetry).
const HIGH_LOW_PROBABILITY = (() => {
    const ways = Array.from({ length: 7 }, () => new Array(301).fill(0));
    ways[0][0] = 1;
    for (let ball = 1; ball <= 49; ball++) for (let count = 6; count >= 1; count--)
        for (let sum = 300; sum >= ball; sum--) ways[count][sum] += ways[count - 1][sum - ball];
    const total = ways[6].reduce((sum, value) => sum + value, 0);
    return ways[6].slice(0, 149).reduce((sum, value) => sum + value, 0) / total;
})();

const RANDOM_REPETITIONS = 64;
const ALERT_THRESHOLDS = [3, 5, 7, 10];
// A MIN/MAX prediction whose result is still missing this long after its draw stops blocking new ones.
const MINMAX_RESULT_OVERDUE_MS = 15 * 60 * 1000;
const MAX_LAB_RESULTS = 60;
function describeEvaluation(data) {
    return data.evaluationMode ? data : { ...data, evaluationMode: 'LEGACY_EXPLORATORY',
        methodology: 'Legacy exploratory historical simulation. Its final_test segment is a reused holdout, not an enforced untouched final test.' };
}
const STRATEGIES = [
    ...transitions.definitions,
    { id: minmax.ID, version: '2.0.0', selectionCount: 3, label: '3-Number Minimum/Maximum v2 - New switching strategy',
      status: 'RESEARCH_ONLY', kind: 'PREDICTION',
      description: 'MIN/MAX v2 research: keep after WIN, switch after LOSS. Independent state; explicit safe cutover required.',
      missingInformation: 'Research specification; not independently instructor-verified.' },
    { id: minmax.ID, version: '1.0.0', selectionCount: 3, label: '3-Number Minimum/Maximum',
      status: 'RESEARCH_ONLY', kind: 'PREDICTION',
      description: 'User-specified MIN/MAX research: three adjacent numbers, five settled opportunities, switch after WIN and repeat after LOSS.',
      missingInformation: 'Research specification; not independently instructor-verified.' },
    { id: HIGH_LOW_ID, version: '1.0.0', selectionCount: 1, market: 'HIGH_LOW', label: 'HIGH/LOW - follows Minimum/Maximum v2',
      status: 'RESEARCH_ONLY', kind: 'PREDICTION',
      description: 'Follows Minimum/Maximum v2 for the same draw: HIGH when v2 uses its MAX method, LOW when it uses its MIN method. No prediction when v2 has none.',
      missingInformation: 'Research specification; not independently instructor-verified.' },
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
    return [1, 2, 3, 4].includes(count) && Array.isArray(selections) && selections.length === count
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
    if (transitions.isStrategy(strategy.id)) return { status:'SKIP', selections:[], conditions:{reason:'MISSING_STATISTICS_SNAPSHOTS'} };
    if (strategy.id === minmax.ID || strategy.id === HIGH_LOW_ID) return { status: 'SKIP', selections: [], conditions: { reason: 'STATEFUL_CONTEXT_REQUIRED' } };
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

// Turns a Minimum/Maximum decision (a fresh one or a saved row) into the HIGH/LOW pick for the same draw.
function highLowFromMinmax(decision) {
    const method = ['PENDING', 'WIN', 'LOSS'].includes(decision?.status) ? decision.conditions?.method : null;
    if (method !== 'MAX' && method !== 'MIN') return { status: 'SKIP', selections: [], conditions: {
        reason: 'MINMAX_V2_HAS_NO_PREDICTION', minmaxStatus: decision?.status || 'NONE', minmaxReason: decision?.conditions?.reason || null } };
    return { status: 'PENDING', selections: [method === 'MAX' ? 'HIGH' : 'LOW'],
        conditions: { model: 'MINMAX_V2_HIGH_LOW', followsMethod: method, minmaxSelections: decision.selections } };
}

function gradeStrategy(strategy, selections, balls) {
    const count = Array.isArray(selections) ? selections.length : 0;
    if (strategy?.id === HIGH_LOW_ID) return gradeHighLow(count === 1 ? selections[0] : null, balls);
    if (!transitions.acceptsCount(strategy, count)) return 'INVALID';
    const status = validateBetZeroPrediction(selections, balls, count);
    return strategy.id === transitions.HIT && status !== 'INVALID' ? (status === 'WIN' ? 'LOSS' : 'WIN') : status;
}
// A random pick of the same kind as the strategy's own, for the matched random baseline.
function randomPickFor(strategy, count, random) {
    return strategy?.id === HIGH_LOW_ID ? [random() < 0.5 ? 'HIGH' : 'LOW'] : randomSelections(count, random);
}
function strategyProbability(strategy, count = strategy.selectionCount) {
    if (strategy?.id === HIGH_LOW_ID) return count === 1 ? HIGH_LOW_PROBABILITY : null;
    if (!transitions.acceptsCount(strategy, count)) return null;
    return strategy.id === transitions.HIT ? 6 / 49 : probabilityAllAbsent(count);
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
        const outcome = gradeStrategy(strategy, pick.selections, target.balls);
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
        expectedWins += strategyProbability(strategy, count);
        for (let repetition = 0; repetition < RANDOM_REPETITIONS; repetition++) {
            const entryRandom = strategy.id === 'smallest_add10_step10_four'
                ? seededRandom(`${seed}:${strategy.id}:${strategy.version}:${target.id}:${repetition}`) : random;
            const randomPick = randomPickFor(strategy, count, entryRandom);
            if (gradeStrategy(strategy, randomPick, target.balls) === 'WIN') randomWins++;
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
            probabilityByPickCount: strategy.id === HIGH_LOW_ID ? { 1: HIGH_LOW_PROBABILITY } : { 1: strategy.id === transitions.HIT ? 6 / 49 : probabilityAllAbsent(1), 2: probabilityAllAbsent(2), 3: probabilityAllAbsent(3), 4: probabilityAllAbsent(4) }
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
    // Validate existing historical tables before CREATE IF NOT EXISTS can mask a missing object.
    require('./betzero-version-migration').inspectVersionSchema(db, { allowEmpty: true });
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
            PRIMARY KEY(run_id, strategy_id, strategy_version, segment),
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
            UNIQUE(run_id, strategy_id, strategy_version, target_draw_id),
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
        -- Rows removed by an administrator's "reset history"; kept so a reset can be recovered.
        CREATE TABLE IF NOT EXISTS betzero_lab_forward_predictions_archive (
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
            status TEXT NOT NULL,
            actual_balls_json TEXT,
            validated_at TEXT,
            reset_at INTEGER NOT NULL
        );
    `);

    require('./betzero-version-migration').migrateVersionKeys(db);
    const statisticsStore = transitions.createStore(db);

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
    // One-time retirement: streak-drop v1/v2 stop predicting now that streak-1 v3 replaces them. History is kept.
    if (db.prepare(`INSERT OR IGNORE INTO betzero_lab_state(state_key, state_value) VALUES ('streak_drop_v1_v2_retired_at', ?)`).run(String(now())).changes) {
        db.prepare(`UPDATE betzero_lab_strategy_configs SET enabled=0, updated_at=? WHERE enabled=1 AND strategy_id IN (?,?) AND version IN ('1.0.0','2.0.0')`)
            .run(now(), transitions.ZERO, transitions.HIT);
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
            USING(strategy_id, version) ORDER BY s.strategy_id`).all().filter(row => STRATEGIES.some(strategy => strategy.id === row.id)).map(row => ({
            ...row, label: strategyDefinition(row.id, row.version)?.displayLabel || row.label,
            market: strategyDefinition(row.id, row.version)?.market || 'BETZERO',
            selectionCount: strategyDefinition(row.id, row.version)?.selectionCount || null,
            selectionCounts: row.id === transitions.ZERO && row.version === '3.0.0' ? [1,2,3,4] : row.id === transitions.ZERO && row.version === '2.0.0' ? [3,4] : [strategyDefinition(row.id, row.version)?.selectionCount].filter(Boolean),
            enabled: row.enabled === 1, config: JSON.parse(row.configJson)
        }));
    }

    function setStrategyConfig(strategyId, updates) {
        db.exec('BEGIN IMMEDIATE');
        try { const result=setStrategyConfigImpl(strategyId,updates);db.exec('COMMIT');return result; }
        catch(error){db.exec('ROLLBACK');throw error;}
    }
    function setStrategyConfigImpl(strategyId, updates) {
        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            throw Object.assign(new Error('Invalid strategy configuration.'), { status: 400 });
        }
        if ((strategyId === minmax.ID || transitions.isStrategy(strategyId)) && !updates.version) throw Object.assign(new Error('Choose an exact strategy version.'),{status:400});
        const version = updates.version || '1.0.0';
        const strategy = strategies().find(item => item.id === strategyId && item.version === version && strategyDefinition(item.id, item.version));
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
        if (strategyId === minmax.ID && enabled) {
            if (version === '2.0.0') {
                if (!minmaxState(version).cutoverAt) throw Object.assign(new Error('Use the confirmed version cutover before enabling v2.'),{status:409});
                assertMinmaxClear();
                if (strategies().some(s=>s.id===minmax.ID && s.version==='1.0.0' && s.enabled)) throw Object.assign(new Error('v1 is still enabled.'),{status:409});
            } else if (minmaxState('2.0.0').cutoverAt) throw Object.assign(new Error('v1 is retired after cutover; rollback requires separate review.'),{status:409});
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

    function setStrategyEnabled(strategyId, enabled, version = '1.0.0') {
        return setStrategyConfig(strategyId, { enabled, version });
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
                if (row?.strategy_id === minmax.ID && minmaxState(row.strategy_version).paused) { db.exec('ROLLBACK'); decision.action='WAIT'; decision.reason='RESULT_CONFLICT_REVIEW_REQUIRED'; continue; }
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
                if (decision.strategyId === minmax.ID) saveMinmaxState(minmax.settle(minmaxState(decision.strategyVersion), Number(decision.targetDrawId), decision.outcome, decision.strategyVersion), decision.strategyVersion);
                rebuildStreakEvents(0, { id: decision.strategyId, version: decision.strategyVersion });
                db.exec('COMMIT'); applied++;
            } catch (error) { db.exec('ROLLBACK'); throw error; }
        }
        return { ...plan, dryRun: false, applied };
    }

    // Only the prediction a version is actively waiting on blocks a cutover. Abandoned
    // PENDING rows (released because their result never arrived) no longer block forever.
    function assertMinmaxClear() {
        const problems = [];
        for (const version of ['1.0.0','2.0.0']) {
            const state = minmaxState(version), label = version === '1.0.0' ? 'v1' : 'v2';
            if (state.paused) problems.push(`${label} is paused for review of a conflicting result${state.conflictDrawId ? ` (draw ${state.conflictDrawId})` : ''}`);
            else if (state.pending) problems.push(`${label} is still waiting for the result of draw ${state.pending}`);
        }
        const invalid = db.prepare("SELECT COUNT(*) n FROM betzero_lab_forward_predictions WHERE strategy_id=? AND status='INVALID'").get(minmax.ID).n;
        if (invalid) problems.push(`${invalid} MIN/MAX prediction${invalid === 1 ? ' has' : 's have'} an invalid saved result`);
        if (problems.length) throw Object.assign(new Error(`Cutover blocked: ${problems.join('; ')}. Unresolved MIN/MAX predictions or correction conflicts require review.`),{status:409});
    }
    function resolveMinmaxReview({confirmed} = {}) {
        if (confirmed !== true) throw Object.assign(new Error('Explicit confirmation is required to resolve the MIN/MAX review.'),{status:400});
        db.exec('BEGIN IMMEDIATE');
        try {
            const resolved = [];
            for (const version of ['1.0.0','2.0.0']) {
                const state = minmaxState(version);
                if (!state.paused) continue;
                const { paused, conflictDrawId, ...rest } = state;
                const reviewed = [...new Set([...(Array.isArray(state.reviewedConflictDrawIds) ? state.reviewedConflictDrawIds : []), conflictDrawId]
                    .filter(Number.isSafeInteger))].slice(-50);
                // The conflicting draw stays excluded from history; the method restarts from clean evidence.
                saveMinmaxState({ ...rest, pending: null, method: null, reviewedConflictDrawIds: reviewed,
                    reviewResolvedAt: now(), lastReviewedConflictDrawId: conflictDrawId ?? null }, version);
                resolved.push({ version, conflictDrawId: conflictDrawId ?? null });
            }
            if (!resolved.length) throw Object.assign(new Error('MIN/MAX is not paused; there is nothing to resolve.'),{status:409});
            db.exec('COMMIT');
            return { resolved };
        } catch(error) {db.exec('ROLLBACK');throw error;}
    }
    // Starts one strategy version's forward history again from zero. The removed rows move to
    // the archive table (recoverable); other strategies and versions are untouched.
    function resetStrategyHistory({ strategyId, version, confirmed } = {}) {
        if (confirmed !== true) throw Object.assign(new Error('Explicit confirmation is required to reset prediction history.'),{status:400});
        const strategy = strategies().find(item => item.id === strategyId && item.version === version && strategyDefinition(item.id, item.version));
        if (!strategy) throw Object.assign(new Error('Unknown lab strategy.'),{status:404});
        db.exec('BEGIN IMMEDIATE');
        try {
            const time = now();
            const archived = db.prepare(`INSERT OR REPLACE INTO betzero_lab_forward_predictions_archive
                SELECT prediction_id, strategy_id, strategy_version, source_draw_id, target_draw_id, predicted_at,
                    strategy_config_json, selections_json, conditions_json, source_input_json, status,
                    actual_balls_json, validated_at, ?
                FROM betzero_lab_forward_predictions WHERE strategy_id=? AND strategy_version=?`).run(time, strategy.id, strategy.version).changes;
            for (const table of ['betzero_lab_forward_predictions','betzero_lab_streak_events','betzero_lab_alerts'])
                db.prepare(`DELETE FROM ${table} WHERE strategy_id=? AND strategy_version=?`).run(strategy.id, strategy.version);
            if (strategy.id === minmax.ID) {
                // Nothing is left to wait for, so the method restarts from the latest five draws.
                // A pause for a conflicting result and the v2 cutover markers are kept.
                const { released, ...rest } = minmaxState(strategy.version);
                saveMinmaxState({ ...rest, pending: null, method: null }, strategy.version);
            }
            setState.run(`history_reset_at:${strategy.id}@${strategy.version}`, String(time));
            db.exec('COMMIT');
            return { strategyId: strategy.id, version: strategy.version, archived, resetAt: time };
        } catch(error) {db.exec('ROLLBACK');throw error;}
    }
    const historyResetAt = (strategyId, version) => Number(getState.get(`history_reset_at:${strategyId}@${version}`)?.state_value) || null;
    // Repairs a MIN/MAX version that is stuck waiting on a prediction. Runs only while a
    // snapshot is being ingested, inside its transaction.
    function healMinmax(snapshotAt, validatedAt) {
        let changedFromTarget = null;
        for (const version of ['1.0.0','2.0.0']) {
            const state = minmaxState(version);
            if (!state.pending || state.paused) continue;
            const target = Number(state.pending);
            const row = db.prepare(`SELECT status, predicted_at, conditions_json FROM betzero_lab_forward_predictions
                WHERE strategy_id=? AND strategy_version=? AND target_draw_id=?`).get(minmax.ID, version, String(target));
            const release = reason => saveMinmaxState({ ...state, pending: null, method: null,
                released: { targetDrawId: target, at: snapshotAt, reason } }, version);
            if (!row || row.status === 'SKIP') { release('NO_OPEN_PREDICTION'); continue; }
            if (row.status === 'WIN' || row.status === 'LOSS') { saveMinmaxState(minmax.settle(state, target, row.status, version), version); continue; }
            if (row.status !== 'PENDING') continue;
            const stored = db.prepare('SELECT balls_json, conflicted FROM betzero_lab_minmax_draws WHERE draw_id=?').get(target);
            if (stored && !stored.conflicted) {
                const changed = settleRecord({ drawId: target, result: { balls: JSON.parse(stored.balls_json) } }, validatedAt, { pendingOnly: true, minmaxOnly: true });
                if (changed !== null && (changedFromTarget === null || changed < changedFromTarget)) changedFromTarget = changed;
                continue;
            }
            let expected = NaN;
            try { expected = Number(JSON.parse(row.conditions_json)?.timing?.expectedTargetAt); } catch { /* fall back to the prediction time */ }
            if (!Number.isFinite(expected)) expected = Date.parse(row.predicted_at);
            // The result never arrived (for example the draw in flight at the daily reset).
            if (Number.isFinite(expected) && snapshotAt - expected >= MINMAX_RESULT_OVERDUE_MS) release('RESULT_NOT_RECEIVED');
        }
        return changedFromTarget;
    }
    function cutoverMinmax({fromVersion,toVersion,confirmed} = {}) {
        if (fromVersion !== '1.0.0' || toVersion !== '2.0.0' || confirmed !== true) throw Object.assign(new Error('Explicit confirmation of v1 to v2 cutover is required.'),{status:400});
        db.exec('BEGIN IMMEDIATE');
        try {
            assertMinmaxClear();
            if (minmaxState('2.0.0').cutoverAt || db.prepare("SELECT 1 FROM betzero_lab_forward_predictions WHERE strategy_id=? AND strategy_version='2.0.0' AND status IN ('PENDING','WIN','LOSS') LIMIT 1").get(minmax.ID)) throw Object.assign(new Error('v2 has already been initialized; use its exact-version controls.'),{status:409});
            const time=now();
            const latest=db.prepare('SELECT draw_id,balls_json FROM betzero_lab_minmax_draws WHERE conflicted=0 AND observed_at<=? ORDER BY draw_id DESC LIMIT 1').get(time);
            if (!latest) throw Object.assign(new Error('Cutover requires completed historical context.'),{status:409});
            const history=minmaxHistory(latest.draw_id+1,time);
            if (history.length < 5) throw Object.assign(new Error('Cutover requires five valid settled historical opportunities.'),{status:409});
            const initial=minmax.decide({id:latest.draw_id,balls:JSON.parse(latest.balls_json)},latest.draw_id+1,history,{},'2.0.0');
            const last=db.prepare('SELECT MAX(CAST(target_draw_id AS INTEGER)) n FROM betzero_lab_forward_predictions WHERE strategy_id=?').get(minmax.ID).n || 0;
            const state={method:initial.status==='PENDING'?initial.conditions.method:null,pending:null,cutoverAt:time,afterTargetId:Math.max(last,latest.draw_id+1),initialization:initial.conditions};
            saveMinmaxState(state,'2.0.0');
            db.prepare("UPDATE betzero_lab_strategy_configs SET enabled=0,updated_at=? WHERE strategy_id=? AND version='1.0.0'").run(time,minmax.ID);
            db.prepare("UPDATE betzero_lab_strategy_configs SET enabled=1,updated_at=? WHERE strategy_id=? AND version='2.0.0'").run(time,minmax.ID);
            db.exec('COMMIT');
            return {fromVersion,toVersion,cutoverAt:time,afterTargetId:state.afterTargetId,initialization:initial.conditions};
        } catch(error) {db.exec('ROLLBACK');throw error;}
    }
    function minmaxState(version = '1.0.0') {
        const row = db.prepare('SELECT state_json FROM betzero_lab_minmax_state WHERE strategy_id=? AND version=?').get(minmax.ID, version);
        return row ? JSON.parse(row.state_json) : {};
    }
    function saveMinmaxState(state, version = '1.0.0') {
        db.prepare(`INSERT INTO betzero_lab_minmax_state VALUES (?,?,?) ON CONFLICT(strategy_id,version)
            DO UPDATE SET state_json=excluded.state_json`).run(minmax.ID, version, JSON.stringify(state));
    }
    function rememberMinmaxResult(record, observedAt) {
        const id = drawIdFromRecord(record), balls = ballsFromRecord(record);
        if (!id || !validBalls(balls)) return;
        const settledAt = Date.parse(record.settledAt || '');
        if (Number.isFinite(settledAt) && settledAt > observedAt) return;
        const json = JSON.stringify([...balls].sort((a,b)=>a-b));
        const previous = db.prepare('SELECT balls_json, conflicted FROM betzero_lab_minmax_draws WHERE draw_id=?').get(id);
        if (previous && previous.balls_json !== json) {
            // Pause once, when the conflict is first seen; a repeated feed of the same
            // conflicting result must not undo an administrator's resolved review.
            if (previous.conflicted) return;
            db.prepare('UPDATE betzero_lab_minmax_draws SET conflicted=1 WHERE draw_id=?').run(id);
            for (const version of ['1.0.0','2.0.0']) saveMinmaxState({ ...minmaxState(version), paused: true, conflictDrawId: id }, version);
        } else if (!previous) db.prepare('INSERT OR IGNORE INTO betzero_lab_minmax_draws(draw_id,balls_json,observed_at) VALUES(?,?,?)').run(id,json,observedAt);
    }
    function minmaxHistory(target, recordedAt) {
        return db.prepare(`SELECT s.draw_id sid,s.balls_json sb,t.draw_id tid,t.balls_json tb
            FROM betzero_lab_minmax_draws t JOIN betzero_lab_minmax_draws s ON s.draw_id=t.draw_id-1
            WHERE t.draw_id<? AND s.conflicted=0 AND t.conflicted=0 AND s.observed_at<=? AND t.observed_at<=?
            ORDER BY t.draw_id DESC LIMIT 5`).all(target,recordedAt,recordedAt).reverse().map(r => ({
                source:{id:r.sid,balls:JSON.parse(r.sb)}, target:{id:r.tid,balls:JSON.parse(r.tb)} }));
    }
    function settleRecord(record, validatedAt, options = {}) {
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
            // Recovery sources may only settle open predictions; they never revise settled ones.
            if (options.pendingOnly && (row.status !== 'PENDING' || !actualBalls)) continue;
            if (options.minmaxOnly && row.strategy_id !== minmax.ID) continue;
            const selections = JSON.parse(row.selections_json);
            if (row.strategy_id === minmax.ID) {
                const state = minmaxState(row.strategy_version);
                if (!actualBalls || state.paused) continue;
                if (row.status !== 'PENDING') {
                    if (row.actual_balls_json && JSON.stringify(JSON.parse(row.actual_balls_json).sort((a,b)=>a-b)) !== JSON.stringify([...actualBalls].sort((a,b)=>a-b))
                        && !(Array.isArray(state.reviewedConflictDrawIds) && state.reviewedConflictDrawIds.includes(targetId)))
                        saveMinmaxState({ ...state, paused:true, conflictDrawId:targetId },row.strategy_version);
                    continue;
                }
                // A draw with two different reported results is never graded automatically.
                if (db.prepare('SELECT conflicted FROM betzero_lab_minmax_draws WHERE draw_id=?').get(targetId)?.conflicted) continue;
            }
            const nextStatus = actualBalls ? gradeStrategy(strategyDefinition(row.strategy_id, row.strategy_version), selections, actualBalls) : 'INVALID';
            const nextBallsJson = actualBalls ? JSON.stringify(actualBalls) : null;
            const nextStatusDiffers = row.status !== nextStatus;
            const nextBallsDiffer = row.actual_balls_json !== nextBallsJson;
            if (!nextStatusDiffers && !nextBallsDiffer) continue;
            if (row.status !== 'PENDING') {
                insertRevision.run(row.prediction_id, row.status, nextStatus, row.actual_balls_json,
                    nextBallsJson, validatedAt);
            }
            updatePrediction.run(nextStatus, nextBallsJson, validatedAt, row.prediction_id);
            if (row.strategy_id === minmax.ID) saveMinmaxState(minmax.settle(minmaxState(row.strategy_version), targetId, nextStatus, row.strategy_version), row.strategy_version);
            changed = true;
        }
        return changed ? targetId : null;
    }

    function saveForwardPrediction(strategy, sourceRecord, sourceBalls, targetDrawId, predictedAt, timing) {
        // Retired MIN/MAX v1 must not create new rows after the confirmed v2 cutover.
        if (strategy.id === minmax.ID && strategy.version === '1.0.0'
            && minmaxState('2.0.0').cutoverAt) return;
        const state = strategy.id === minmax.ID ? minmaxState(strategy.version) : null;
        if (state && strategy.version === '2.0.0' && strategy.enabled && (!state.cutoverAt || predictedAt <= state.cutoverAt || targetDrawId <= state.afterTargetId || Date.parse(sourceRecord.settledAt) <= state.cutoverAt)) return;
        const followed = strategy.id === HIGH_LOW_ID && strategy.enabled
            ? db.prepare(`SELECT status, selections_json, conditions_json FROM betzero_lab_forward_predictions
                WHERE strategy_id=? AND strategy_version='2.0.0' AND target_draw_id=?`).get(minmax.ID, String(targetDrawId)) : null;
        const prediction = strategy.id === HIGH_LOW_ID && strategy.enabled
            ? highLowFromMinmax(followed && { status: followed.status, selections: JSON.parse(followed.selections_json), conditions: JSON.parse(followed.conditions_json) })
            : state && strategy.enabled
            ? minmax.decide({ id: drawIdFromRecord(sourceRecord), balls: sourceBalls }, targetDrawId, minmaxHistory(targetDrawId, predictedAt), state, strategy.version)
            : transitions.isStrategy(strategy.id) && strategy.enabled
                ? statisticsStore.predict(strategy, targetDrawId, transitions.SEED, predictedAt + 1)
                : predictionFromStrategy(strategy, { balls: sourceBalls });
        const sourceId = drawIdFromRecord(sourceRecord);
        const predictionId = crypto.randomUUID();
        const sourceInput = {
            drawId: sourceId,
            settledAt: sourceRecord.settledAt,
            balls: sourceBalls,
            ...(transitions.isStrategy(strategy.id) ? {previousStatistics:statisticsStore.read(targetDrawId-2),statistics:statisticsStore.read(targetDrawId-1)} : {})
        };
        const inserted = db.prepare(`INSERT OR IGNORE INTO betzero_lab_forward_predictions
            (prediction_id, strategy_id, strategy_version, source_draw_id, target_draw_id, predicted_at,
            strategy_config_json, selections_json, conditions_json, source_input_json, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            predictionId, strategy.id, strategy.version, String(sourceId), String(targetDrawId),
            new Date(predictedAt).toISOString(), JSON.stringify(strategy.config), JSON.stringify(prediction.selections),
            JSON.stringify({ ...prediction.conditions, ...(state ? { stateBefore:state } : {}), timing }), JSON.stringify(sourceInput), prediction.status
        );
        if (state && strategy.enabled && inserted.changes) saveMinmaxState(minmax.afterDecision(state, prediction, targetDrawId), strategy.version);
    }

    // Recent completed results sent by the worker straight from the draw archive. They are a
    // recovery source only: complete, unique six-ball results for distinct draws.
    function normalizeLabResults(value) {
        if (!Array.isArray(value)) return [];
        const byId = new Map();
        for (const item of value.slice(-MAX_LAB_RESULTS)) {
            const id = Number(item?.drawId);
            const balls = Array.isArray(item?.balls) ? item.balls.map(Number) : null;
            if (!Number.isSafeInteger(id) || id < 1 || !validBalls(balls)) continue;
            byId.set(id, byId.has(id) ? null : balls);
        }
        return [...byId].filter(([, balls]) => balls).sort((a, b) => a[0] - b[0]).map(([drawId, balls]) => ({ drawId, balls }));
    }
    // Keeps the first decisive outcome per source draw so the 5-second feed repeats do not hide it.
    function recordStatisticsIngest(outcome, snapshotAt) {
        let previous = null;
        try { previous = JSON.parse(getState.get('statistics_last_ingest')?.state_value || 'null'); } catch { previous = null; }
        if (previous && previous.outcome === outcome.outcome && previous.reason === outcome.reason
            && previous.sourceDrawId === outcome.sourceDrawId) return;
        if (previous && outcome.sourceDrawId !== null && previous.sourceDrawId === outcome.sourceDrawId
            && !['STORED','CONFLICT'].includes(outcome.outcome)) return;
        setState.run('statistics_last_ingest', JSON.stringify({ ...outcome, at: snapshotAt }));
    }

    function ingestSnapshot({ current, clock, historyUpdates, snapshotAt, numberStatistics, labResults }) {
        if (!Number.isSafeInteger(snapshotAt) || snapshotAt <= 0) throw new Error('Invalid lab snapshot timestamp.');
        const validatedAt = new Date(snapshotAt).toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
            let changedFromTarget = null;
            const noteChange = changedTarget => {
                if (changedTarget !== null && (changedFromTarget === null || changedTarget < changedFromTarget)) changedFromTarget = changedTarget;
            };
            recordStatisticsIngest(numberStatistics
                ? statisticsStore.rememberDetailed(numberStatistics, now())
                : { stored: false, outcome: 'NOT_PROVIDED', reason: null, sourceDrawId: null, targetDrawId: null }, snapshotAt);
            const updates = Array.isArray(historyUpdates) ? historyUpdates : [];
            for (const record of updates) {
                rememberMinmaxResult(record, snapshotAt);
                noteChange(settleRecord(record, validatedAt));
            }
            // Results the normal history feed never delivered (daily reset, restarts) still
            // settle open predictions and keep the MIN/MAX result history continuous.
            const recentResults = normalizeLabResults(labResults);
            if (recentResults.length) {
                const updatedIds = new Set(updates.filter(record => record?.result && typeof record.result === 'object').map(drawIdFromRecord));
                const pendingTargets = new Set(db.prepare("SELECT DISTINCT target_draw_id AS target FROM betzero_lab_forward_predictions WHERE status='PENDING'")
                    .all().map(row => Number(row.target)));
                for (const item of recentResults) {
                    const record = { drawId: item.drawId, result: { balls: item.balls } };
                    rememberMinmaxResult(record, snapshotAt);
                    if (pendingTargets.has(item.drawId) && !updatedIds.has(item.drawId)) noteChange(settleRecord(record, validatedAt, { pendingOnly: true }));
                }
            }
            noteChange(healMinmax(snapshotAt, validatedAt));

            const targetDrawId = Number(current?.drawId);
            const clockDrawId = Number(clock?.drawId);
            const timeLeft = Number(clock?.timeLeftSeconds);
            const observedAt = Number(clock?.observedAt);
            const recordedAt = Math.max(snapshotAt, now());
            const expectedTargetAt = observedAt + timeLeft * 1000;
            const targetAlreadySettled = updates.some(record =>
                drawIdFromRecord(record) === targetDrawId && record?.result && typeof record.result === 'object')
                || recentResults.some(item => item.drawId === targetDrawId);
            if (Number.isSafeInteger(targetDrawId) && targetDrawId > 1 && clockDrawId === targetDrawId
                && !targetAlreadySettled && Number.isFinite(timeLeft) && timeLeft > 0 && timeLeft <= 300
                && Number.isSafeInteger(observedAt) && observedAt > 0 && observedAt <= snapshotAt
                && snapshotAt - observedAt <= 30000 && recordedAt < expectedTargetAt) {
                let sourceRecord = updates.find(record =>
                    drawIdFromRecord(record) === targetDrawId - 1 && record?.result && typeof record.result === 'object');
                let sourceBalls = ballsFromRecord(sourceRecord);
                let sourceVia = 'HISTORY_UPDATE';
                const settledAt = Date.parse(sourceRecord?.settledAt || '');
                const lastSnapshotAt = Number(getState.get('last_snapshot_at')?.state_value) || 0;
                const startedAt = Number(getState.get('started_at')?.state_value) || 0;
                let usable = Boolean(sourceRecord && validBalls(sourceBalls) && Number.isFinite(settledAt)
                    && settledAt > Math.max(lastSnapshotAt, startedAt) && settledAt <= snapshotAt);
                if (!usable) {
                    // The source result and the open draw can arrive in different snapshots, and
                    // after the daily reset the source is absent from the history feed. If nothing
                    // was recorded for this still-open target, use the archived source result.
                    const fallback = recentResults.find(item => item.drawId === targetDrawId - 1);
                    const stored = fallback && db.prepare('SELECT balls_json, observed_at, conflicted FROM betzero_lab_minmax_draws WHERE draw_id=?').get(targetDrawId - 1);
                    if (stored && !stored.conflicted && stored.observed_at <= snapshotAt
                        && stored.balls_json === JSON.stringify([...fallback.balls].sort((a, b) => a - b))
                        && !db.prepare('SELECT 1 FROM betzero_lab_forward_predictions WHERE target_draw_id=? LIMIT 1').get(String(targetDrawId))) {
                        sourceRecord = { drawId: String(targetDrawId - 1), result: { balls: fallback.balls }, settledAt: new Date(stored.observed_at).toISOString() };
                        sourceBalls = fallback.balls;
                        sourceVia = 'ARCHIVE_RESULT';
                        usable = true;
                    }
                }
                if (usable) {
                    // HIGH/LOW reads the Minimum/Maximum v2 prediction for this draw, so it is saved last.
                    for (const strategy of strategies().sort((a, b) => (a.id === HIGH_LOW_ID) - (b.id === HIGH_LOW_ID))) {
                        if (strategyDefinition(strategy.id, strategy.version)) saveForwardPrediction(strategy, sourceRecord, sourceBalls, targetDrawId, recordedAt,
                            { observedAt, expectedTargetAt, snapshotAt, recordedAt, sourceVia });
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
        const version = strategyVersion || '1.0.0';
        const rows = strategyId
            ? db.prepare(`SELECT * FROM betzero_lab_forward_predictions WHERE strategy_id = ? AND strategy_version = ?
                ORDER BY CAST(target_draw_id AS INTEGER) DESC, prediction_id DESC LIMIT ?`).all(strategyId, version, boundedLimit)
            : db.prepare(`SELECT * FROM betzero_lab_forward_predictions
                WHERE ${STRATEGIES.map(() => '(strategy_id=? AND strategy_version=?)').join(' OR ')}
                ORDER BY CAST(target_draw_id AS INTEGER) DESC, prediction_id DESC LIMIT ?`)
                .all(...STRATEGIES.flatMap(strategy => [strategy.id,strategy.version]),boundedLimit);
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

    function inputQuality(strategyId) {
        return transitions.isStrategy(strategyId) ? {provisional:true, provisionalReason:'Statistics are associated with the observed clock; provider draw alignment is not independently verified.'} : {};
    }
    function stats(versioned = false) {
        const strategyList = strategies().filter(strategy => strategyDefinition(strategy.id, strategy.version) && (versioned || strategy.version === '1.0.0'));
        return Object.fromEntries(strategyList.map(strategy => [
            versioned ? `${strategy.id}@${strategy.version}` : strategy.id,
            {
                ...strategy,
                ...(strategy.id === minmax.ID ? { decisionState: minmaxState(strategy.version) } : {}),
                ...require('./betzero-reconciliation').pendingQuality(db, strategy.id, strategy.version, now()),
                ...summarizePredictionRows(predictionRows(strategy.id)
                    .filter(row => row.strategy_version === strategy.version)),
                historyResetAt: historyResetAt(strategy.id, strategy.version),
                ...inputQuality(strategy.id)
            }
        ]));
    }

    function statsForVersion(strategyId, version) {
        const strategy = strategies().find(item => item.id === strategyId && item.version === version);
        if (!strategy) throw new Error('Unknown lab strategy version.');
        return { ...strategy, ...(strategyId === minmax.ID ? {decisionState:minmaxState(version)} : {}), ...require('./betzero-reconciliation').pendingQuality(db, strategyId, version, now()), ...summarizePredictionRows(predictionRows(strategyId).filter(row => row.strategy_version === version)), ...inputQuality(strategyId) };
    }

    function alerts(limit = 100) {
        const boundedLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100));
        return db.prepare(`SELECT strategy_id AS strategyId, strategy_version AS strategyVersion,
            target_draw_id AS targetDrawId, alert_type AS type, message, created_at AS createdAt
            FROM betzero_lab_alerts ORDER BY CAST(target_draw_id AS INTEGER) DESC, alert_id DESC LIMIT ?`)
            .all(boundedLimit);
    }

    function runBacktest(records, { window = 'all', seed = 'betzero-lab-v1', mode = 'EXPLORATORY', protocolId = null, strategyId = null, strategyVersion = '1.0.0', frozenStrategies = null, firstTarget = null, onProgress = () => {} } = {}) {
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
        if (strategyId && !STRATEGIES.some(s => s.id === strategyId && s.version === strategyVersion && s.status === 'RESEARCH_ONLY')) throw Object.assign(new Error('Unknown research strategy.'), {status:400});
        if (strategyId && mode === 'SEALED_FINAL') throw Object.assign(new Error('Sealed strategy selection must come from its frozen protocol.'), {status:409});
        const effectiveStrategies = strategies().filter(strategy => strategyDefinition(strategy.id, strategy.version))
            .filter(s => !strategyId || (s.id === strategyId && s.version === strategyVersion))
            .filter(s => !frozenStrategies || frozenStrategies.some(f=>f.id===s.id && f.version===s.version))
            .map(s => {
                const frozen = frozenStrategies?.find(f=>f.id===s.id && f.version===s.version);
                const snapshot = frozen ? {...s,enabled:frozen.enabled,config:frozen.config} : s;
                return strategyId ? {...snapshot,enabled:true} : snapshot;
            });
        const transitionStrategies = effectiveStrategies.filter(s => transitions.isStrategy(s.id) && s.enabled);
        if (transitionStrategies.length && mode === 'SEALED_FINAL') throw Object.assign(new Error('Statistics strategies currently support exploratory testing only; snapshot cohorts are not sealed.'), {status:409});
        if (transitionStrategies.length) {
            const firstInput = opportunities[0].target.id - 2, last = opportunities.at(-1).target.id;
            const protocols = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='betzero_lab_protocols'").get();
            if (protocols && db.prepare("SELECT 1 FROM betzero_lab_protocols WHERE COALESCE(json_extract(specification,'$.contextFirst'),first_draw)<=? AND last_draw>=?").get(last,firstInput))
                throw Object.assign(new Error('Statistics warm-up overlaps a protected cohort.'),{status:409});
            if (protocols) db.prepare('INSERT INTO betzero_lab_exposures VALUES (?,?)').run(firstInput,last);
        }
        const targetSettledTimes = new Map();
        for (const record of records) {
            const id = drawIdFromRecord(record), time = Date.parse(record.settledAt || '');
            if (id && Number.isFinite(time)) targetSettledTimes.set(id, Math.min(targetSettledTimes.get(id) ?? Infinity,time));
        }
        const transitionPicks = new Map(transitionStrategies.map(s => [`${s.id}@${s.version}`, new Map(opportunities.map(({target}) => {
            const snapshot=statisticsStore.read(target.id-1);
            const before = Math.min(snapshot?.deadline || 0, targetSettledTimes.get(target.id) ?? 0);
            // The capture deadline is fixed before this target; never reconstruct statistics from its result.
            return [target.id, statisticsStore.predict(s,target.id,safeSeed,before)];
        }))]));
        const mm = effectiveStrategies.find(s => s.id === minmax.ID && s.enabled);
        const minmaxPicks = new Map(effectiveStrategies.filter(s=>s.id===minmax.ID && s.enabled).map(s=>[s.version,minmax.simulate(opportunities, extracted.opportunities, f=>onProgress(f*5),s.version)]));
        // HIGH/LOW replays Minimum/Maximum v2 over the same draws, whether or not v2 itself is in this run.
        const highLowPicks = effectiveStrategies.some(s => s.id === HIGH_LOW_ID && s.enabled)
            ? new Map([...(minmaxPicks.get('2.0.0') || minmax.simulate(opportunities, extracted.opportunities, () => {}, '2.0.0'))]
                .map(([targetId, pick]) => [targetId, highLowFromMinmax(pick)])) : null;
        const picksFor = s => s.id === minmax.ID ? minmaxPicks.get(s.version) : s.id === HIGH_LOW_ID ? highLowPicks : transitionPicks.get(`${s.id}@${s.version}`);
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
                        ...metricsForSegment(rows, effectiveStrategy, `${safeSeed}:${segment}`, fraction => onProgress(5 + 65 * (resultRows.length + fraction) / (effectiveStrategies.length * Object.keys(segments).length)), picksFor(strategy))
                    };
                }
                resultRows.push({ runId, strategyId: strategy.id, strategyVersion: strategy.version, segment, result });
            }
        }
        const data = {
            overall: mm ? { strategyId:minmax.ID, strategyVersion:mm.version, ...metricsForSegment(opportunities,mm,`${safeSeed}:overall`,()=>{},minmaxPicks.get(mm.version)) } : null,
            overallByVersion: Object.fromEntries(effectiveStrategies.filter(s=>s.id===minmax.ID && s.enabled).map(s=>[
                `${s.id}@${s.version}`, {strategyId:s.id,strategyVersion:s.version,
                    ...metricsForSegment(opportunities,s,`${safeSeed}:overall`,()=>{},minmaxPicks.get(s.version))}
            ])),
            validDraws: extracted.draws.length,
            invalidDraws: extracted.invalidDraws,
            duplicateDraws: extracted.duplicates,
            conflictingDraws: extracted.conflictingDraws,
            gaps: extracted.gaps,
            eligibleOpportunities: opportunities.length,
            firstTargetDrawId: opportunities[0].target.id,
            lastTargetDrawId: opportunities.at(-1).target.id,
            statisticsInputWarning: transitionStrategies.length ? 'Observed statistics clock association is provisional. Missing snapshots are skipped; no past strk values reconstructed.' : null,
            evaluationMode: mode, protocolId, researchStrategyId: strategyId, researchStrategyVersion: strategyId ? strategyVersion : null, initialization: mm ? 'Five preceding valid consecutive pairs; fresh simulation state; state continues across segments.' : null,
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
                    const prediction = picksFor(strategy)?.get(target.id) || predictionFromStrategy(strategy, source);
                    const status = prediction.status === 'PENDING'
                        ? gradeStrategy(strategy, prediction.selections, target.balls)
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
                        sourceInput: { drawId: source.id, balls: source.balls, ...(transitions.isStrategy(strategy.id) ? {previousStatistics:statisticsStore.read(target.id-2),statistics:statisticsStore.read(target.id-1)} : {}) },
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
            strategyVersions: stats(true),
            forwardVersionWindows: require('./betzero-forward-metrics').forwardWindows(db, strategies(), now(), true),
            forwardWindows: require('./betzero-forward-metrics').forwardWindows(db, strategies(), now()),
            predictions: listForwardPredictions({ limit: 100 }),
            alerts: alerts(100),
            numberStatistics: {
                ...db.prepare('SELECT COUNT(*) AS snapshots, MIN(source_draw_id) AS firstSourceDraw, MAX(source_draw_id) AS lastSourceDraw, COALESCE(SUM(conflicted),0) AS conflicts FROM betzero_lab_number_statistics').get(),
                lastIngest: (() => { try { return JSON.parse(getState.get('statistics_last_ingest')?.state_value || 'null'); } catch { return null; } })()
            },
            backtestRuns: listBacktestRuns(20)
        };
    }

    return {
        strategies,
        setStrategyConfig,
        setStrategyEnabled,
        cutoverMinmax,
        resolveMinmaxReview,
        resetStrategyHistory,
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
    gradeStrategy, strategyProbability, randomPickFor, HIGH_LOW_ID,
    wilsonInterval
};
