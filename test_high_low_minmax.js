'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const minmax = require('./betzero-minmax');
const { predictHighLowFromMinmax, highLowForMethod } = require('./high-low');
// Small deterministic generator for repeatable test draws.
function seededRandom(seed) {
    let h = 2166136261;
    for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => { h += 0x6D2B79F5; let x = h; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

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

test('main High/Low continues from the Lab state and matches the Lab even when the Lab missed draws', () => {
    const draws = randomDraws('main-high-low-lab-state', 9000, 400);
    const parsed = draws.map(d => ({ id: d.id, balls: d.dr.split(',').map(Number) }));
    const random = seededRandom('lab-misses');
    let state = {}, compared = 0, replayDiffers = 0;
    for (let i = 10; i < parsed.length; i++) {
        const target = parsed[i].id, source = parsed[i - 1];
        // What the worker holds when the draw opens: the Lab state from the previous draw.
        const labState = { active: true, method: state.method || null, pending: state.pending ?? null, afterTargetId: 0, asOfDrawId: target - 1 };
        const main = predictHighLowFromMinmax(draws, target, labState);
        assert.equal(main.analysis.stateSource, 'LAB');
        // The Lab: settle the finished draw, then (unless it misses this draw) predict.
        if (state.pending === target - 1) {
            state = minmax.settle(state, target - 1, minmax.outcome(minmax.candidate(parsed[i - 2].balls, state.method), source.balls), '2.0.0');
        }
        if (random() < 0.15) continue;
        const history = parsed.slice(i - 6, i).slice(1).map((t, k) => ({ source: parsed[i - 6 + k], target: t }));
        const pick = minmax.decide(source, target, history, state, '2.0.0');
        state = minmax.afterDecision(state, pick, target);
        compared++;
        assert.equal(main.range, pick.status === 'PENDING' ? highLowForMethod(pick.conditions.method) : null);
        if (predictHighLowFromMinmax(draws, target).range !== main.range) replayDiffers++;
        // Once the Lab has predicted the draw, the worker still gives the same pick.
        const after = { active: true, method: state.method || null, pending: state.pending ?? null, afterTargetId: 0, asOfDrawId: target };
        if (pick.status === 'PENDING') assert.equal(predictHighLowFromMinmax(draws, target, after).range, main.range);
    }
    assert.ok(compared > 300 && replayDiffers > 0, `${compared} ${replayDiffers}`);
});

test('main High/Low falls back to the replay when the Lab state cannot be used', () => {
    const draws = randomDraws('main-high-low-fallback', 100, 80);
    const replay = predictHighLowFromMinmax(draws, 180);
    for (const labState of [null, { active: false, method: 'MIN', pending: null, asOfDrawId: 179 },
        { active: true, method: 'MIN', pending: null, asOfDrawId: 170 },
        { active: true, method: 'MIN', pending: 175, asOfDrawId: 179 },
        { active: true, method: 'MIN', pending: null, afterTargetId: 180, asOfDrawId: 179 }]) {
        const result = predictHighLowFromMinmax(draws, 180, labState);
        assert.equal(result.analysis.stateSource, 'REPLAY');
        assert.equal(result.range, replay.range);
    }
});
