'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { pick, outcome, enrich } = require('./betzero-single');

test('BetZero Single is the one Bet49 number and wins when it is not drawn', () => {
    assert.equal(pick([27]), 27);
    assert.equal(pick(27), 27);
    assert.equal(pick([]), 'SKIP');
    assert.equal(pick([4, 13, 22, 31]), 'SKIP');          // older multi-number Bet49 records
    assert.equal(outcome([27], { balls: [1, 2, 3, 4, 5, 6] }), 'WIN');
    assert.equal(outcome([27], { balls: [27, 2, 3, 4, 5, 6] }), 'LOSS');
    assert.equal(outcome([27], null), 'PENDING');
    assert.equal(outcome([], { balls: [1, 2, 3, 4, 5, 6] }), 'SKIP');
    assert.equal(outcome([27], { balls: [] }), 'SKIP');
});

test('records gain the market without changing anything else', () => {
    const record = { drawId: '5', predicted: { bet49: [9] }, result: { balls: [9, 1, 2, 3, 4, 5], bet49: 'WIN' } };
    assert.equal(enrich(record), record);
    assert.deepEqual(record, { drawId: '5', predicted: { bet49: [9], betzeroSingle: 9 }, result: { balls: [9, 1, 2, 3, 4, 5], bet49: 'WIN', betzeroSingle: 'LOSS' } });
    const pending = enrich({ drawId: '6', predicted: { bet49: [9] }, result: null });
    assert.deepEqual(pending, { drawId: '6', predicted: { bet49: [9], betzeroSingle: 9 }, result: null });
    assert.equal(enrich(null), null);
});
