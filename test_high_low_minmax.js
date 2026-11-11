'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const minmax = require('./betzero-minmax');
const { predictHighLowFromMinmax, highLowForMethod } = require('./high-low');
const { seededRandom } = require('./betzero-lab');

function randomDraws(seed, firstId, count) {
    const random = seededRandom(seed);
    return Array.from({ length: count }, (_, index) => {
        const balls = new Set();
        while (balls.size < 6) balls.add(1 + Math.floor(random() * 49));
        return { id: firstId + index, dr: [...balls].join(',') };
    });
}

test('main High/Low maps Minimum/Maximum v2: MAX gives LOW, MIN gives HIGH', () => {
    assert.equal(highLowForMethod('MAX'), 'LOW');
    assert.equal(highLowForMethod('MIN'), 'HIGH');
    assert.equal(highLowForMethod(null), null);
});

test('main High/Low matches a Minimum/Maximum v2 replay on every draw', () => {
    const draws = randomDraws('main-high-low', 1000, 260);
    const parsed = draws.map(d => ({ id: d.id, balls: d.dr.split(',').map(Number) }));
    const pairs = parsed.slice(1).map((target, i) => ({ source: parsed[i], target }));
    const picks = minmax.simulate(pairs, pairs, () => {}, '2.0.0');
    const seen = { HIGH: 0, LOW: 0, SKIP: 0 };
    for (let i = 20; i < parsed.length; i++) {
        const target = parsed[i].id;
        // Newest-first, like the live draw feed; later draws must be ignored.
        const result = predictHighLowFromMinmax(draws.slice().reverse(), target);
        const pick = picks.get(target);
        if (pick.status === 'PENDING') {
            assert.equal(result.status, 'ACTIVE');
            assert.equal(result.range, pick.conditions.method === 'MAX' ? 'LOW' : 'HIGH');
            assert.deepEqual(result.analysis.minmaxSelections, pick.selections);
            seen[result.range]++;
        } else {
            assert.equal(result.status, 'SKIP');
            assert.equal(result.range, null);
            assert.ok(result.reason);
            seen.SKIP++;
        }
    }
    assert.ok(seen.HIGH > 10 && seen.LOW > 10 && seen.SKIP > 0, JSON.stringify(seen));
});

test('a shorter history converges to the same main High/Low pick', () => {
    const draws = randomDraws('main-high-low-converge', 5000, 400);
    let compared = 0, same = 0;
    for (let i = 300; i < 400; i++) {
        const target = draws[i].id;
        const full = predictHighLowFromMinmax(draws, target);
        const short = predictHighLowFromMinmax(draws.slice(i - 40, i), target);
        compared++;
        if (full.range === short.range) same++;
    }
    assert.ok(same / compared >= 0.95, `${same}/${compared}`);
});

test('main High/Low skips without the previous draw or enough history', () => {
    const draws = randomDraws('main-high-low-skip', 1, 60);
    assert.equal(predictHighLowFromMinmax(draws, 63).status, 'SKIP');
    assert.match(predictHighLowFromMinmax(draws, 63).reason, /previous draw/);
    assert.equal(predictHighLowFromMinmax(draws.slice(0, 3), 4).status, 'SKIP');
    assert.match(predictHighLowFromMinmax(draws.slice(0, 3), 4).reason, /five completed/);
    assert.equal(predictHighLowFromMinmax(null, 5).status, 'SKIP');
    assert.equal(predictHighLowFromMinmax([{ id: 4, dr: '1,2,3,4,5,5' }], 5).status, 'SKIP');
    // Ball arrays are accepted as well as the feed's "dr" strings.
    const asBalls = draws.map(d => ({ id: d.id, balls: d.dr.split(',').map(Number) }));
    assert.deepEqual(predictHighLowFromMinmax(asBalls, 61), predictHighLowFromMinmax(draws, 61));
});
