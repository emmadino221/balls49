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
    validateBetZeroPrediction
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
        clock: { drawId: String(currentId), timeLeftSeconds: timeLeft },
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

test('BetZero settlement validates one or multiple selections and rejects invalid input', () => {
    assert.equal(validateBetZeroPrediction([18], [1, 2, 3, 4, 5, 6]), 'WIN');
    assert.equal(validateBetZeroPrediction([18], [18, 2, 3, 4, 5, 6]), 'LOSS');
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
