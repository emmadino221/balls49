'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
    STRATEGIES,
    createBetZeroLab,
    probabilityAllAbsent,
    validateBetZeroPrediction,
    predictionFromStrategy, validSelections, seededRandom, randomSelections
} = require('./betzero-lab');

function openLab(t, now = Date.now()) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'balls49-betzero-lab-'));
    const databasePath = path.join(directory, 'lab.sqlite');
    let db = new DatabaseSync(databasePath);
    let lab = createBetZeroLab(db, { now: () => now });
    t.after(() => {
        db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return {
        get db() { return db; },
        get lab() { return lab; },
        reopen() {
            db.close();
            db = new DatabaseSync(databasePath);
            lab = createBetZeroLab(db, { now: () => now });
        }
    };
}

function record(drawId, balls, settledAt) {
    return {
        drawId: String(drawId),
        settledAt: new Date(settledAt).toISOString(),
        result: { balls }
    };
}

function snapshot(lab, { currentId, sourceRecord, snapshotAt, targetRecord = null, timeLeft = 100 }) {
    const historyUpdates = [...new Map([sourceRecord, targetRecord].filter(Boolean)
        .map(item => [String(item.drawId), item])).values()];
    return lab.ingestSnapshot({
        current: { drawId: String(currentId) },
        clock: { drawId: String(currentId), timeLeftSeconds: timeLeft, observedAt: snapshotAt },
        historyUpdates,
        snapshotAt
    });
}

test('BetZero lab registry includes tutorial strategies and disables unverified rules', t => {
    const { lab } = openLab(t);
    const definitions = lab.strategies();
    assert.equal(definitions.length, STRATEGIES.length);
    for (const id of [
        'single_color_add_10', 'smallest_number_add_10', 'color_pattern',
        'maximum_minimum', 'timing_skip_filter', 'combined_strategy'
    ]) {
        const strategy = definitions.find(item => item.id === id);
        assert.equal(strategy.status, 'UNVERIFIED');
        assert.equal(strategy.enabled, false);
        assert.ok(strategy.missingInformation.length > 0);
    }
    const research = definitions.find(item => item.id === 'simple_smallest_number_add_10');
    assert.equal(research.status, 'RESEARCH_ONLY');
    assert.equal(research.enabled, true);
    assert.deepEqual(research.config.alertThresholds, [3, 5, 7, 10]);
    assert.match(research.missingInformation, /not the instructor-verified strategy/i);
});

test('strategy configuration cannot enable an unverified rule', t => {
    const { lab } = openLab(t);
    assert.throws(() => lab.setStrategyEnabled('color_pattern', true), /Unverified strategies cannot be enabled/);
    assert.equal(lab.setStrategyEnabled('simple_smallest_number_add_10', false).enabled, false);
    assert.equal(lab.setStrategyEnabled('simple_smallest_number_add_10', true).enabled, true);
});

test('simplified research prediction adds ten to the smallest prior-draw number or skips over 49', t => {
    const { lab } = openLab(t, 1000);
    const source = record(200, [8, 20, 25, 30, 35, 40], 1001);
    snapshot(lab, { currentId: 201, sourceRecord: source, snapshotAt: 1002 });
    let prediction = lab.listForwardPredictions({ strategyId: 'simple_smallest_number_add_10' })[0];
    assert.deepEqual(prediction.selections, [18]);
    assert.equal(prediction.status, 'PENDING');
    assert.deepEqual(prediction.sourceInput.balls, source.result.balls);

    const highSource = record(201, [40, 41, 42, 43, 44, 49], 1003);
    snapshot(lab, { currentId: 202, sourceRecord: highSource, snapshotAt: 1004 });
    prediction = lab.listForwardPredictions({ strategyId: 'simple_smallest_number_add_10' })[0];
    assert.equal(prediction.status, 'SKIP');
    assert.deepEqual(prediction.selections, []);
    assert.match(prediction.conditions.reason, /exceeds 49/);
});

test('lab settlement requires an explicit one-number contract or exactly four BetZero selections', () => {
    assert.equal(validateBetZeroPrediction([18], [1, 2, 3, 4, 5, 6], 1), 'WIN');
    assert.equal(validateBetZeroPrediction([18], [18, 2, 3, 4, 5, 6], 1), 'LOSS');
    assert.equal(validateBetZeroPrediction([18], [1, 2, 3, 4, 5, 6]), 'INVALID');
    assert.equal(validateBetZeroPrediction([18, 19, 20, 21], [1, 2, 3, 4, 5, 6]), 'WIN');
    assert.equal(validateBetZeroPrediction([18, 19, 20, 21], [1, 2, 3, 4, 5, 21]), 'LOSS');
    assert.equal(validateBetZeroPrediction([], [1, 2, 3, 4, 5, 6]), 'INVALID');
    assert.equal(validateBetZeroPrediction([18, 18], [1, 2, 3, 4, 5, 6]), 'INVALID');
    assert.equal(validateBetZeroPrediction([18], [1, 2, 3, 4, 5]), 'INVALID');
});

test('forward predictions settle once, duplicate result deliveries are idempotent', t => {
    const start = Date.now();
    const { lab, db } = openLab(t, start);
    const source = record(300, [8, 20, 25, 30, 35, 40], start + 1);
    snapshot(lab, { currentId: 301, sourceRecord: source, snapshotAt: start + 2 });
    assert.equal(lab.stats().simple_smallest_number_add_10.totalPredictions, 1);
    assert.equal(lab.stats().simple_smallest_number_add_10.lastPredictionResult, 'PENDING');
    const target = record(301, [18, 2, 3, 4, 5, 6], start + 3);
    snapshot(lab, { currentId: 302, sourceRecord: target, targetRecord: target, snapshotAt: start + 4 });
    const statsAfterSettlement = lab.stats().simple_smallest_number_add_10;
    assert.equal(statsAfterSettlement.wins, 0);
    assert.equal(statsAfterSettlement.losses, 1);
    assert.equal(statsAfterSettlement.currentLosingStreak, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM betzero_lab_forward_predictions WHERE strategy_id = ? AND target_draw_id = ?')
        .get('simple_smallest_number_add_10', '301').count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM betzero_lab_result_revisions').get().count, 0);

    snapshot(lab, { currentId: 302, sourceRecord: target, targetRecord: target, snapshotAt: start + 5 });
    assert.equal(lab.stats().simple_smallest_number_add_10.losses, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM betzero_lab_result_revisions').get().count, 0);
});

test('changed official results are audited and recompute lab streaks in draw order', t => {
    const start = Date.now();
    const { lab, db } = openLab(t, start);
    const source300 = record(300, [8, 20, 25, 30, 35, 40], start + 1);
    snapshot(lab, { currentId: 301, sourceRecord: source300, snapshotAt: start + 2 });
    const source301 = record(301, [18, 8, 20, 25, 30, 35], start + 3);
    snapshot(lab, { currentId: 302, sourceRecord: source301, targetRecord: source301, snapshotAt: start + 4 });
    const source302 = record(302, [18, 8, 20, 25, 30, 35], start + 5);
    snapshot(lab, { currentId: 303, sourceRecord: source302, targetRecord: source302, snapshotAt: start + 6 });
    const source303 = record(303, [1, 2, 3, 4, 5, 6], start + 7);
    snapshot(lab, { currentId: 304, sourceRecord: source303, targetRecord: source303, snapshotAt: start + 8 });

    const strategyId = 'simple_smallest_number_add_10';
    let stats = lab.stats()[strategyId];
    assert.equal(stats.losses, 2);
    assert.equal(stats.wins, 1);
    assert.equal(stats.currentWinningStreak, 1);
    assert.equal(stats.worstLosingStreak, 2);

    snapshot(lab, {
        currentId: 304,
        sourceRecord: source303,
        targetRecord: record(302, [1, 2, 3, 4, 5, 6], start + 9),
        snapshotAt: start + 10
    });
    stats = lab.stats()[strategyId];
    assert.equal(stats.losses, 1);
    assert.equal(stats.wins, 2);
    assert.equal(stats.currentWinningStreak, 2);
    assert.equal(stats.worstLosingStreak, 1);
    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM betzero_lab_result_revisions').get().count >= 1);
    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM betzero_lab_streak_events').get().count >= 3);
});

test('skipped, pending, and invalid predictions do not become losses or reset streaks', t => {
    const start = Date.now();
    const { lab } = openLab(t, start);
    const source400 = record(400, [30, 31, 32, 33, 34, 35], start + 1);
    snapshot(lab, { currentId: 401, sourceRecord: source400, snapshotAt: start + 2 });
    const loss = record(401, [40, 41, 42, 43, 44, 49], start + 3);
    snapshot(lab, { currentId: 402, sourceRecord: loss, targetRecord: loss, snapshotAt: start + 4 });
    let stats = lab.stats().simple_smallest_number_add_10;
    assert.equal(stats.losses, 1);
    assert.equal(stats.currentLosingStreak, 1);

    const source402 = record(402, [7, 20, 25, 30, 35, 40], start + 5);
    snapshot(lab, { currentId: 403, sourceRecord: source402, targetRecord: source402, snapshotAt: start + 6 });
    stats = lab.stats().simple_smallest_number_add_10;
    assert.equal(stats.skipped, 1);
    assert.equal(stats.losses, 1);
    assert.equal(stats.currentLosingStreak, 1);
    assert.equal(stats.totalPredictions, 2);

    const invalidTarget = { drawId: '403', settledAt: new Date(start + 7).toISOString(), result: { balls: [1, 1, 2, 3, 4, 5] } };
    snapshot(lab, { currentId: 404, sourceRecord: invalidTarget, targetRecord: invalidTarget, snapshotAt: start + 8 });
    stats = lab.stats().simple_smallest_number_add_10;
    assert.equal(stats.invalid, 1);
    assert.equal(stats.losses, 1);
    assert.equal(stats.currentLosingStreak, 1);
    assert.equal(stats.wins, 0);

    snapshot(lab, { currentId: 405, sourceRecord: record(404, [7, 20, 25, 30, 35, 40], start + 10), snapshotAt: start + 11, timeLeft: 0 });
    assert.equal(lab.stats().simple_smallest_number_add_10.totalPredictions, 1);
});

test('forward testing requires a newly settled source draw and the matching live target', t => {
    const start = Date.now();
    const { lab } = openLab(t, start);
    const oldSource = record(500, [8, 20, 25, 30, 35, 40], start - 100);
    snapshot(lab, { currentId: 501, sourceRecord: oldSource, snapshotAt: start + 1 });
    assert.equal(lab.listForwardPredictions().length, 0);

    const noTimestamp = { drawId: '501', result: { balls: [8, 20, 25, 30, 35, 40] } };
    snapshot(lab, { currentId: 502, sourceRecord: noTimestamp, snapshotAt: start + 2 });
    assert.equal(lab.listForwardPredictions().length, 0);

    const tooLateSource = record(502, [8, 20, 25, 30, 35, 40], start + 4);
    snapshot(lab, { currentId: 503, sourceRecord: tooLateSource, snapshotAt: start + 5, timeLeft: 301 });
    assert.equal(lab.listForwardPredictions().length, 0);
    const freshSource = record(503, [8, 20, 25, 30, 35, 40], start + 7);
    snapshot(lab, { currentId: 504, sourceRecord: freshSource, snapshotAt: start + 8 });
    assert.equal(lab.listForwardPredictions({ strategyId: 'simple_smallest_number_add_10' }).length, 1);
});

test('forward predictions and streaks survive database restart', t => {
    const start = Date.now();
    const state = openLab(t, start);
    const source = record(600, [8, 20, 25, 30, 35, 40], start + 1);
    snapshot(state.lab, { currentId: 601, sourceRecord: source, snapshotAt: start + 2 });
    const result = record(601, [1, 2, 3, 4, 5, 6], start + 3);
    snapshot(state.lab, { currentId: 602, sourceRecord: result, targetRecord: result, snapshotAt: start + 4 });
    state.reopen();
    const stats = state.lab.stats().simple_smallest_number_add_10;
    assert.equal(stats.wins, 1);
    assert.equal(stats.currentWinningStreak, 1);
    assert.equal(state.lab.listForwardPredictions({ strategyId: 'simple_smallest_number_add_10' })
        .find(prediction => prediction.targetDrawId === '601').status, 'WIN');
});

test('backtests are reproducible, chronological, split by period, and exclude unverified strategies', t => {
    const { lab } = openLab(t);
    const records = [];
    for (let id = 1; id <= 101; id++) {
        const balls = id === 1
            ? [8, 20, 25, 30, 35, 40]
            : [1, 2, 3, 4, 5, 6];
        records.push({ drawId: String(id), result: { balls } });
    }
    const first = lab.runBacktest(records, { window: '100', seed: 'repeatable' });
    const second = lab.runBacktest(records, { window: '100', seed: 'repeatable' });
    assert.deepEqual(first.data.split, { development: 60, validation: 20, finalTest: 20 });
    assert.equal(first.datasetHash, second.datasetHash);
    const firstResearch = first.results.filter(row => row.strategyId === 'simple_smallest_number_add_10');
    const secondResearch = second.results.filter(row => row.strategyId === 'simple_smallest_number_add_10');
    assert.deepEqual(firstResearch.map(row => row.result), secondResearch.map(row => row.result));
    assert.ok(firstResearch.every(row => row.result.predictions > 0 && row.result.randomBaseline.trials > 0));
    assert.ok(first.results.filter(row => row.result.status === 'UNVERIFIED')
        .every(row => row.result.predictions === 0 && row.result.randomBaseline === null));
    assert.equal(lab.getBacktestRun(first.runId).results.length, STRATEGIES.length * 3);
    assert.equal(lab.getBacktestRun(first.runId).predictionTotal, 100 * STRATEGIES.length);
    assert.equal(lab.listBacktestRuns().length, 2);
});

test('backtests persist per-draw picks and outcomes separately from forward predictions', t => {
    const { lab, db } = openLab(t);
    const records = [];
    for (let id = 1; id <= 8; id++) {
        records.push({ drawId: String(id), result: { balls: [18, 8, 20, 25, 30, 35] } });
    }
    const run = lab.runBacktest(records, { window: 'all', seed: 'no-lookahead' });
    const stored = lab.getBacktestRun(run.runId, { limit: 500, offset: 0 });
    const prediction = stored.predictions.find(item =>
        item.strategyId === 'simple_smallest_number_add_10' && item.targetDrawId === '2');
    assert.equal(prediction.status, 'LOSS');
    assert.deepEqual(prediction.selections, [18]);
    assert.deepEqual(prediction.strategyConfig.alertThresholds, [3, 5, 7, 10]);
    assert.equal(prediction.sourceDrawId, '1');
    assert.deepEqual(prediction.sourceInput.balls, [18, 8, 20, 25, 30, 35]);
    assert.ok(prediction.predictedAt);
    assert.ok(prediction.actualBalls.includes(18));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM betzero_lab_forward_predictions').get().count, 0);
    assert.equal(stored.predictionTotal, 7 * STRATEGIES.length);

    const changedFuture = records.map(row => ({ ...row, result: { balls: [...row.result.balls] } }));
    changedFuture[1].result.balls[0] = 19;
    const alternate = lab.runBacktest(changedFuture, { window: 'all', seed: 'no-lookahead' });
    const alternatePrediction = lab.getBacktestRun(alternate.runId).predictions.find(item =>
        item.strategyId === 'simple_smallest_number_add_10' && item.targetDrawId === '2');
    assert.deepEqual(alternatePrediction.selections, prediction.selections);
    assert.equal(alternatePrediction.status, 'WIN');
});

test('forward streak alerts include configured loss milestones and new worst runs', t => {
    const start = Date.now();
    const { lab } = openLab(t, start);
    lab.setStrategyConfig('simple_smallest_number_add_10', { alertThresholds: [2] });
    let source = record(700, [8, 20, 25, 30, 35, 40], start + 1);
    for (let target = 701; target <= 704; target++) {
        const actual = record(target, [18, 8, 20, 25, 30, 35], start + 2 * (target - 700) + 1);
        snapshot(lab, {
            currentId: target,
            sourceRecord: source,
            targetRecord: target === 701 ? null : source,
            snapshotAt: start + 2 * (target - 700)
        });
        source = actual;
    }
    const stats = lab.stats().simple_smallest_number_add_10;
    assert.equal(stats.losses, 3);
    assert.equal(stats.currentLosingStreak, 3);
    assert.equal(stats.worstLosingStreak, 3);
    const strategyAlerts = lab.alerts().filter(alert => alert.strategyId === 'simple_smallest_number_add_10');
    assert.ok(strategyAlerts.some(alert => alert.type === 'LOSS_STREAK_2'));
    assert.ok(!strategyAlerts.some(alert => alert.type === 'LOSS_STREAK_3'));
    assert.ok(strategyAlerts.some(alert => alert.type === 'NEW_WORST_LOSS_STREAK'));
});

test('random baseline theoretical probabilities use the selection count', () => {
    assert.ok(Math.abs(probabilityAllAbsent(1) - 43 / 49) < 1e-12);
    assert.ok(probabilityAllAbsent(2) < probabilityAllAbsent(1));
    assert.ok(probabilityAllAbsent(4) < probabilityAllAbsent(3));
    assert.equal(probabilityAllAbsent(5), null);
});

test('lab tables and operations remain separate from production streak data', t => {
    const { db, lab } = openLab(t);
    db.exec('CREATE TABLE production_streaks (market TEXT PRIMARY KEY, losses INTEGER NOT NULL); INSERT INTO production_streaks VALUES (\'betzero\', 7);');
    const records = [];
    for (let id = 1; id <= 12; id++) records.push({ drawId: String(id), result: { balls: [1, 2, 3, 4, 5, 6] } });
    lab.runBacktest(records, { window: 'all' });
    assert.equal(db.prepare('SELECT losses FROM production_streaks WHERE market = ?').get('betzero').losses, 7);
    assert.ok(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'betzero_lab_%'").get().count >= 7);
});

const FOUR = 'smallest_add10_step10_four';
const SINGLE = 'simple_smallest_number_add_10';
const fourDefinition = () => ({ ...STRATEGIES.find(strategy => strategy.id === FOUR), enabled: true });

test('four-number variant starts disabled and original experiment is relabeled without changing its identity', t => {
    const state = openLab(t, 1000);
    assert.equal(state.lab.strategies().length, 8);
    assert.equal(state.lab.strategies().find(s => s.id === FOUR).enabled, false);
    assert.equal(state.lab.strategies().find(s => s.id === FOUR).selectionCount, 4);
    assert.match(state.lab.strategies().find(s => s.id === SINGLE).label, /Single-number absence experiment/);
    assert.equal(state.lab.strategies().find(s => s.id === SINGLE).selectionCount, 1);
    snapshot(state.lab, { currentId: 101, sourceRecord: record(100, [3, 8, 17, 25, 36, 44], 1001), snapshotAt: 1002 });
    assert.equal(state.lab.listForwardPredictions({ strategyId: FOUR })[0].status, 'SKIP');
    state.reopen();
    assert.equal(state.lab.strategies().find(s => s.id === FOUR).enabled, false);
    for (const strategy of state.lab.strategies().filter(s => s.status === 'UNVERIFIED')) {
        assert.equal(strategy.enabled, false);
        assert.throws(() => state.lab.setStrategyEnabled(strategy.id, true), /Unverified/);
    }
});

test('four-number calculation matches all approved examples and every feasible minimum', () => {
    for (const [balls, expected] of [
        [[3, 8, 17, 25, 36, 44], [13, 23, 33, 43]],
        [[12, 18, 24, 30, 42, 49], [22, 32, 42, 3]],
        [[39, 40, 41, 42, 43, 49], [49, 10, 20, 30]],
    ]) {
        assert.deepEqual(predictionFromStrategy(fourDefinition(), { balls }).selections, expected);
        assert.deepEqual(predictionFromStrategy(fourDefinition(), { balls: [...balls].reverse() }).selections, expected);
    }
    for (let minimum = 1; minimum <= 44; minimum++) {
        const source = { balls: Array.from({ length: 6 }, (_, i) => minimum + i) };
        const pick = predictionFromStrategy(fourDefinition(), source);
        if (minimum > 39) {
            assert.equal(pick.status, 'SKIP');
            assert.deepEqual(pick.selections, []);
        } else {
            assert.equal(pick.status, 'PENDING');
            assert.equal(pick.selections[0], minimum + 10);
            assert.equal(validSelections(pick.selections, 4), true);
            assert.deepEqual(pick, predictionFromStrategy(fourDefinition(), source));
        }
    }
    for (const balls of [[], [1, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 50], [1, 2, 3, 4, 5, 6.5]]) {
        assert.equal(predictionFromStrategy(fourDefinition(), { balls }).status, 'SKIP');
    }
});

test('strict counts, distinctness and range apply to both research contracts', () => {
    const actual = [1, 2, 3, 4, 5, 6];
    for (const selections of [[], [13], [13, 23], [13, 23, 33], [13, 23, 33, 43, 44], [13, 23, 33, 33], [0, 23, 33, 43], [13, 23, 33, 50], [13, 23, 33, 43.5], ['13', 23, 33, 43]]) {
        assert.equal(validateBetZeroPrediction(selections, actual, 4), 'INVALID');
    }
    assert.equal(validateBetZeroPrediction([13, 23, 33, 43], actual, 1), 'INVALID');
    assert.equal(validateBetZeroPrediction([13, 23], actual, 2), 'INVALID');
    assert.equal(validateBetZeroPrediction([13, 23, 33, 43], actual, 4), 'WIN');
    for (const hit of [13, 23, 33, 43]) assert.equal(validateBetZeroPrediction([13, 23, 33, 43], [1, 2, 3, 4, 5, hit], 4), 'LOSS');
});

test('single and four-number forward histories and loss streaks settle independently', t => {
    const state = openLab(t, 1000);
    state.lab.setStrategyEnabled(FOUR, true);
    const balls = [3, 8, 17, 23, 36, 44]; // 13 absent; 23 present: single WIN, four LOSS.
    for (let i = 0; i < 4; i++) snapshot(state.lab, {
        currentId: 101 + i, sourceRecord: record(100 + i, balls, 1001 + 2 * i), snapshotAt: 1002 + 2 * i
    });
    assert.equal(state.lab.stats()[SINGLE].wins, 3);
    assert.equal(state.lab.stats()[SINGLE].worstLosingStreak, 0);
    assert.equal(state.lab.stats()[FOUR].losses, 3);
    assert.equal(state.lab.stats()[FOUR].currentLosingStreak, 3);
    assert.equal(state.lab.stats()[FOUR].worstLosingStreak, 3);
    assert.equal(state.lab.listForwardPredictions({ strategyId: FOUR }).length, 4);
    const invalid = record(104, [1, 1, 2, 3, 4, 5], 1009);
    snapshot(state.lab, { currentId: 105, sourceRecord: invalid, snapshotAt: 1010 });
    assert.equal(state.lab.stats()[FOUR].invalid, 1);
    assert.equal(state.lab.stats()[FOUR].currentLosingStreak, 3);
    snapshot(state.lab, { currentId: 106, sourceRecord: record(105, [40, 41, 42, 43, 44, 49], 1011), snapshotAt: 1012 });
    assert.equal(state.lab.stats()[FOUR].skipped, 1);
    assert.equal(state.lab.stats()[FOUR].currentLosingStreak, 3);
    snapshot(state.lab, { currentId: 107, sourceRecord: record(106, balls, 1013), snapshotAt: 1014 });
    snapshot(state.lab, { currentId: 108, sourceRecord: record(107, [1, 2, 3, 4, 5, 6], 1015), snapshotAt: 1016 });
    assert.equal(state.lab.stats()[FOUR].wins, 1);
    assert.equal(state.lab.stats()[FOUR].currentLosingStreak, 0);
    assert.equal(state.lab.stats()[FOUR].worstLosingStreak, 3);
    state.reopen();
    assert.equal(state.lab.stats()[FOUR].worstLosingStreak, 3);
});

test('initialization preserves original registry, records, statistics and saved backtests byte-for-byte', t => {
    const state = openLab(t, 1000);
    const balls = [3, 8, 17, 23, 36, 44];
    snapshot(state.lab, { currentId: 101, sourceRecord: record(100, balls, 1001), snapshotAt: 1002 });
    snapshot(state.lab, { currentId: 102, sourceRecord: record(101, balls, 1003), snapshotAt: 1004 });
    const history = Array.from({ length: 12 }, (_, i) => record(i + 1, balls, 1));
    state.lab.runBacktest(history);
    // Simulate an installation predating the new registry entry.
    state.db.prepare('DELETE FROM betzero_lab_strategy_configs WHERE strategy_id=?').run(FOUR);
    state.db.prepare('DELETE FROM betzero_lab_strategies WHERE strategy_id=?').run(FOUR);
    const tables = ['betzero_lab_forward_predictions', 'betzero_lab_backtest_runs', 'betzero_lab_backtest_results', 'betzero_lab_backtest_predictions', 'betzero_lab_streak_events', 'betzero_lab_alerts'];
    const before = tables.map(table => state.db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all());
    const registry = state.db.prepare('SELECT * FROM betzero_lab_strategies WHERE strategy_id=?').get(SINGLE);
    const stats = state.lab.stats()[SINGLE];
    state.reopen();
    assert.deepEqual(tables.map(table => state.db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()), before);
    assert.deepEqual(state.db.prepare('SELECT * FROM betzero_lab_strategies WHERE strategy_id=?').get(SINGLE), registry);
    assert.deepEqual(state.lab.stats()[SINGLE], stats);
    assert.equal(state.lab.strategies().find(s => s.id === FOUR).enabled, false);
});

test('archived versions do not contaminate active statistics or receive rewritten settlements', t => {
    const { db, lab } = openLab(t, 1000);
    snapshot(lab, { currentId: 101, sourceRecord: record(100, [3, 8, 17, 23, 36, 44], 1001), snapshotAt: 1002 });
    db.prepare("INSERT INTO betzero_lab_strategies SELECT strategy_id, '0.9.0', label, status, kind, description, missing_information FROM betzero_lab_strategies WHERE strategy_id=?").run(SINGLE);
    db.prepare("INSERT INTO betzero_lab_strategy_configs SELECT strategy_id, '0.9.0', enabled, config_json, updated_at FROM betzero_lab_strategy_configs WHERE strategy_id=? AND version='1.0.0'").run(SINGLE);
    const original = db.prepare('SELECT * FROM betzero_lab_forward_predictions WHERE strategy_id=?').get(SINGLE);
    const columns = Object.keys(original);
    const archived = { ...original, prediction_id: 'archived', strategy_version: '0.9.0', status: 'LOSS' };
    db.prepare('INSERT INTO betzero_lab_forward_predictions (' + columns.join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')').run(...columns.map(key => archived[key]));
    db.prepare("INSERT INTO betzero_lab_streak_events VALUES ('archived', ?, '0.9.0', '101', 'LOSS', 1, 1, 0, 0)").run(SINGLE);
    db.prepare("INSERT INTO betzero_lab_alerts (strategy_id,strategy_version,target_draw_id,alert_type,message,created_at) VALUES (?, '0.9.0', '101', 'NEW_WORST_LOSS_STREAK', 'Original archived wording', 'original')").run(SINGLE);
    const oldEvents = db.prepare("SELECT * FROM betzero_lab_streak_events WHERE strategy_version='0.9.0'").all();
    const oldAlerts = db.prepare("SELECT * FROM betzero_lab_alerts WHERE strategy_version='0.9.0'").all();
    snapshot(lab, { currentId: 102, sourceRecord: record(101, [1, 2, 3, 4, 5, 6], 1003), snapshotAt: 1004 });
    assert.equal(lab.stats()[SINGLE].losses, 0);
    assert.equal(lab.stats()[SINGLE].wins, 1);
    assert.equal(lab.statsForVersion(SINGLE, '0.9.0').losses, 1);
    assert.deepEqual({ ...db.prepare("SELECT * FROM betzero_lab_forward_predictions WHERE prediction_id='archived'").get() }, archived);
    assert.ok(lab.listForwardPredictions({ strategyId: SINGLE }).every(row => row.strategyVersion === '1.0.0'));
    assert.equal(lab.listForwardPredictions({ strategyId: SINGLE, strategyVersion: '0.9.0' }).length, 1);
    assert.deepEqual(db.prepare("SELECT * FROM betzero_lab_streak_events WHERE strategy_version='0.9.0'").all(), oldEvents);
    assert.deepEqual(db.prepare("SELECT * FROM betzero_lab_alerts WHERE strategy_version='0.9.0'").all(), oldAlerts);
});

test('stored malformed selection counts settle INVALID and never become losses', t => {
    const { lab, db } = openLab(t, 1000);
    lab.setStrategyEnabled(FOUR, true);
    snapshot(lab, { currentId: 101, sourceRecord: record(100, [3, 8, 17, 23, 36, 44], 1001), snapshotAt: 1002 });
    db.prepare("UPDATE betzero_lab_forward_predictions SET selections_json='[13]' WHERE strategy_id=?").run(FOUR);
    db.prepare("UPDATE betzero_lab_forward_predictions SET selections_json='[13,23,33,43]' WHERE strategy_id=?").run(SINGLE);
    snapshot(lab, { currentId: 102, sourceRecord: record(101, [13, 23, 33, 43, 1, 2], 1003), snapshotAt: 1004 });
    for (const id of [SINGLE, FOUR]) {
        assert.equal(lab.stats()[id].invalid, 1);
        assert.equal(lab.stats()[id].wins, 0);
        assert.equal(lab.stats()[id].losses, 0);
        assert.equal(lab.stats()[id].worstLosingStreak, 0);
    }
});

test('four-number baselines are reproducible, entry-matched, and use the correct probability', t => {
    const { lab } = openLab(t);
    lab.setStrategyEnabled(FOUR, true);
    const records = Array.from({ length: 101 }, (_, i) => record(i + 1, i % 7 === 0 ? [40, 41, 42, 43, 44, 49] : [3, 8, 17, 23, 36, 44], 1));
    const a = lab.runBacktest(records, { seed: 'four-baseline' });
    const b = lab.runBacktest(records, { seed: 'four-baseline' });
    const results = run => run.results.filter(row => row.strategyId === FOUR).map(row => row.result);
    assert.deepEqual(results(a), results(b));
    const expected = (43 * 42 * 41 * 40) / (49 * 48 * 47 * 46);
    for (const result of results(a)) {
        assert.ok(Math.abs(result.theoreticalBaseline.expectedWinRate - expected) < 1e-12);
        assert.equal(result.randomBaseline.matchingEntries, result.predictions);
        assert.equal(result.randomBaseline.trials, result.predictions * 64);
        assert.ok(result.skipped > 0);
    }
    for (let i = 0; i < 100; i++) {
        const numbers = randomSelections(4, seededRandom('four-' + i));
        assert.equal(validSelections(numbers, 4), true);
        assert.deepEqual(numbers, randomSelections(4, seededRandom('four-' + i)));
    }
    const rows = lab.getBacktestRun(a.runId, { limit: 500 }).predictions.filter(row => row.strategyId === FOUR);
    assert.ok(rows.length > 0);
    assert.ok(rows.every(row => row.status === 'SKIP' ? row.selections.length === 0 : validSelections(row.selections, 4)));
    const first = rows.find(row => row.targetDrawId === '3');
    const changed = records.map(row => ({ ...row, result: { balls: [...row.result.balls] } }));
    changed[2].result.balls = [1, 2, 3, 4, 5, 6];
    const alternate = lab.runBacktest(changed, { seed: 'four-baseline' });
    assert.deepEqual(lab.getBacktestRun(alternate.runId, { limit: 500 }).predictions.find(row => row.strategyId === FOUR && row.targetDrawId === '3').selections, first.selections);
});
