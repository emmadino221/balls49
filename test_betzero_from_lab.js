'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { predictBetZeroFromLab } = require('./betzero');

const record = (over = {}) => ({ predictionId: 'p1', strategyId: 'betzero_49', version: '1.0.0', enabled: true,
    sourceDrawId: '99', targetDrawId: '100', predictedAt: new Date(1000).toISOString(), status: 'PENDING',
    selections: [4, 17, 30, 42], deadline: 5000, ...over });

test('main BetZero plays the Lab BetZero 49 numbers', () => {
    const result = predictBetZeroFromLab(record(), 100, 2000);
    assert.equal(result.status, 'ACTIVE');
    assert.deepEqual(result.numbers, [4, 17, 30, 42]);
    assert.equal(result.strategy, 'LAB_BETZERO_49_V1');
});

test('anything other than the BetZero 49 record for this draw is skipped', () => {
    assert.equal(predictBetZeroFromLab(record({ strategyId: 'statistics_streak_drop_betzero', version: '3.0.0' }), 100, 2000).reason, 'LAB_PREDICTION_TARGET_OR_VERSION_MISMATCH');
    assert.equal(predictBetZeroFromLab(record({ targetDrawId: '101' }), 100, 2000).status, 'SKIP');
    assert.equal(predictBetZeroFromLab(record({ enabled: false }), 100, 2000).reason, 'LAB_STRATEGY_DISABLED');
    assert.equal(predictBetZeroFromLab(record({ status: 'SKIP', reason: 'Only 3 of 4 numbers qualify' }), 100, 2000).reason, 'Only 3 of 4 numbers qualify');
    assert.equal(predictBetZeroFromLab(record(), 100, 6000).reason, 'LAB_PREDICTION_EXPIRED_OR_INVALID_TIMING');
    assert.equal(predictBetZeroFromLab(null, 100, 2000).reason, 'LAB_PREDICTION_UNAVAILABLE');
});
