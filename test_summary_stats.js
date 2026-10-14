'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildPublicSummaryModel, getRecordSummaryModel,
    calculateSummaryLossStats, formatTelegramSummaryStats
} = require('./summary-stats');

const markets = Object.fromEntries(['betzero', 'bet49', 'rainbow', 'totalColor', 'totalColor2', 'hilo', 'unified'].map(key => [key, key]));
const record = (drawId, label, outcome, extra = {}) => ({
    drawId, summaryModel: { betzero: label }, result: { betzero: outcome }, ...extra
});
const bucket = (currentLosingStreak, maxLosingStreak, settled) => ({ currentLosingStreak, maxLosingStreak, settled });

test('ENTER and HOLD count independently; only a win in the same label resets its current streak', () => {
    const draws = [
        ['ENTER', 'LOSS'], ['HOLD', 'LOSS'], ['HOLD', 'WIN'], ['ENTER', 'LOSS'],
        ['ENTER', 'WIN'], ['HOLD', 'LOSS'], ['HOLD', 'LOSS'], ['ENTER', 'LOSS']
    ].map(([label, outcome], index) => record(index + 1, label, outcome)).reverse();
    const stats = calculateSummaryLossStats(draws, markets);
    assert.deepEqual(stats.betzero.ENTER, bucket(1, 2, 4));
    assert.deepEqual(stats.betzero.HOLD, bucket(2, 2, 4));
    assert.deepEqual(stats.rainbow.ENTER, bucket(0, 0, 0));
});

test('SKIP, pending, LEARNING, missing labels and unknown outcomes do not affect either sequence', () => {
    const draws = [
        record(1, 'ENTER', 'LOSS'), record(2, 'ENTER', 'SKIP'),
        record(3, 'LEARNING', 'WIN'), record(4, null, 'LOSS'),
        record(5, 'ENTER', 'PENDING', { result: null }), record(6, 'ENTER', 'UNKNOWN'),
        record(7, 'ENTER', 'LOSS')
    ].reverse();
    assert.deepEqual(calculateSummaryLossStats(draws, markets).betzero.ENTER, bucket(2, 2, 2));
});

test('legacy model metadata uses the correct market and Unified uses the selected market label', () => {
    const draws = [{ drawId: 1,
        mlShadow: {
            u4: { recommendation: 'HOLD' }, color: { recommendation: 'ENTER' },
            sum: { status: 'INSUFFICIENT_BUCKET_DATA' }, totalColor: { recommendation: 'HOLD' }
        },
        predicted: { unified: { key: 'color' } },
        result: { betzero: 'LOSS', rainbow: 'WIN', hilo: 'LOSS', totalColor: 'LOSS', unified: 'WIN', bet49: 'LOSS', totalColor2: 'LOSS' }
    }];
    const stats = calculateSummaryLossStats(draws, markets);
    assert.deepEqual(stats.betzero.HOLD, bucket(1, 1, 1));
    assert.deepEqual(stats.rainbow.ENTER, bucket(0, 0, 1));
    assert.deepEqual(stats.totalColor.HOLD, bucket(1, 1, 1));
    assert.deepEqual(stats.unified.ENTER, bucket(0, 0, 1));
    for (const market of ['hilo', 'bet49', 'totalColor2']) {
        assert.deepEqual(stats[market], { ENTER: bucket(0, 0, 0), HOLD: bucket(0, 0, 0) });
    }
});

test('saved public labels take precedence over model metadata', () => {
    const draw = record(1, 'ENTER', 'LOSS', { mlShadow: { u4: { recommendation: 'HOLD' } } });
    const stats = calculateSummaryLossStats([draw], markets);
    assert.deepEqual(stats.betzero.ENTER, bucket(1, 1, 1));
    assert.deepEqual(stats.betzero.HOLD, bucket(0, 0, 0));
});

test('late results are counted in draw order and duplicate draw IDs count once', () => {
    const draws = [record('3', 'ENTER', 'LOSS'), record('1', 'ENTER', 'LOSS'),
        record('2', 'ENTER', 'WIN'), record(3, 'ENTER', 'LOSS')];
    assert.deepEqual(calculateSummaryLossStats(draws, markets).betzero.ENTER, bucket(1, 1, 3));
});

test('owner reset excludes earlier settlements, including the boundary, and accepts newly settled pending picks', () => {
    const resetAt = Date.parse('2026-10-14T10:00:00Z');
    const draws = [
        record(1, 'ENTER', 'LOSS', { settledAt: '2026-10-14T09:00:00Z' }),
        record(2, 'ENTER', 'LOSS', { settledAt: '2026-10-14T10:00:00Z' }),
        record(3, 'ENTER', 'LOSS', { timestamp: '2026-10-14T09:59:00Z', settledAt: '2026-10-14T10:01:00Z' }),
        record(4, 'HOLD', 'WIN', { timestamp: '2026-10-14T10:02:00Z' }),
        record(5, 'ENTER', 'LOSS', { timestamp: 'invalid date' })
    ].reverse();
    const stats = calculateSummaryLossStats(draws, markets, resetAt);
    assert.deepEqual(stats.betzero.ENTER, bucket(1, 1, 1));
    assert.deepEqual(stats.betzero.HOLD, bucket(0, 0, 1));
    assert.deepEqual(calculateSummaryLossStats(draws, markets, resetAt + 3600000).betzero.ENTER, bucket(0, 0, 0));
});

test('saved and published history reconstruct the same counters after a restart', () => {
    const draws = [{ drawId: 2, mlShadow: { color: { recommendation: 'HOLD' } },
        predicted: { unified: { key: 'color' } }, result: { rainbow: 'LOSS', unified: 'LOSS' } },
    { drawId: 1, mlShadow: { color: { recommendation: 'ENTER' } },
        predicted: { unified: { key: 'color' } }, result: { rainbow: 'LOSS', unified: 'LOSS' } }];
    const published = JSON.parse(JSON.stringify(draws.map(({ mlShadow, ...draw }) => ({
        ...draw, summaryModel: getRecordSummaryModel({ ...draw, mlShadow })
    }))));
    assert.deepEqual(calculateSummaryLossStats(published, markets), calculateSummaryLossStats(draws, markets));
});

test('all markets support saved summary labels, without borrowing labels from another market', () => {
    const draw = { drawId: 1, summaryModel: Object.fromEntries(Object.keys(markets).map(key => [key, 'HOLD'])),
        result: Object.fromEntries(Object.keys(markets).map(key => [key, 'LOSS'])) };
    const stats = calculateSummaryLossStats([draw], markets);
    for (const market of Object.keys(markets)) assert.deepEqual(stats[market].HOLD, bucket(1, 1, 1));
    assert.equal(buildPublicSummaryModel({ u4: { recommendation: 'ENTER' } }).bet49, null);
});

test('Telegram distinguishes zero losses from no data and includes the saved draw label', () => {
    const stats = calculateSummaryLossStats([record(1, 'ENTER', 'WIN')], markets);
    const text = formatTelegramSummaryStats({ betzero: 'ENTER' }, stats, 'betzero');
    assert.match(text, /Summary ENTER/);
    assert.match(text, /ENTER 0 \| HOLD —/);
    assert.match(formatTelegramSummaryStats({}, stats, 'bet49'), /ENTER — \| HOLD —/);
    assert.doesNotMatch(formatTelegramSummaryStats({ betzero: '<b>invalid</b>' }, stats, 'betzero'), /<b>/);
});
