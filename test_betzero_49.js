'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bz49 = require('./betzero-49');
const { bet49Gaps, predictBet49LongestGap } = require('./bet49');
const { createBetZeroLab } = require('./betzero-lab');

function random(seed) { let x = seed; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }
function draws(count, seed = 7, first = 1) {
    const r = random(seed);
    return Array.from({ length: count }, (_, i) => {
        const balls = new Set(); while (balls.size < 6) balls.add(1 + Math.floor(r() * 49));
        return { id: first + i, balls: [...balls] };
    });
}

test('the gap counts match the main Bet49 calculation', () => {
    const history = draws(300);
    const byId = bz49.drawMap(history);
    for (const target of [101, 150, 237, 301]) {
        const fast = bz49.gapsFrom(byId, target), slow = bet49Gaps(history, target);
        assert.deepEqual([fast.longest.slice(1), fast.current.slice(1), fast.seenAt.slice(1)], [slow.longest.slice(1), slow.current.slice(1), slow.seenAt.slice(1)]);
    }
});

test('with nothing kept, it takes the first four qualifying numbers; the first is the Bet49 number', () => {
    const history = draws(200);
    let checked = 0;
    for (let target = 101; target <= 201; target++) {
        const four = bz49.decide(history, target, []), one = predictBet49LongestGap(history.map(d => ({ id: d.id, dr: d.balls.join(',') })), target, null);
        if (four.status !== 'PENDING') continue;
        assert.equal(four.selections.length, 4);
        assert.equal(new Set(four.selections).size, 4);
        assert.equal(four.selections[0], one.numbers[0]);
        for (const pick of four.conditions.picks) assert.ok(pick.currentStreak * 2 >= pick.longestStreak && pick.currentStreak > 0);
        checked++;
    }
    assert.ok(checked > 50, `checked ${checked}`);
});

test('each number is kept until it appears; then only its place changes', () => {
    const history = draws(400, 11);
    const picks = bz49.simulate(history);
    let replaced = 0;
    for (let target = 102; target <= 401; target++) {
        const before = picks.get(target - 1), now = picks.get(target);
        if (before?.status !== 'PENDING' || now?.status !== 'PENDING') continue;
        const drawn = history.find(d => d.id === target - 1).balls;
        for (const n of before.selections) {
            if (drawn.includes(n)) { assert.ok(!now.selections.includes(n) || now.conditions.picks.find(p => p.number === n).kept === false); replaced++; }
            else assert.ok(now.selections.includes(n), `#${target}: ${n} was not drawn and must be kept`);
        }
    }
    assert.ok(replaced > 20);
});

test('fewer than four qualifying numbers: no prediction', () => {
    // Draws 1-52 are 1-6 only, so every other number has a long absence; 53-99 rotate 7-46, which
    // keeps their current absence short; draw 100 is 1-6 again. Only 47, 48 and 49 qualify.
    const history = Array.from({ length: 100 }, (_, i) => {
        const id = i + 1;
        const balls = id <= 52 || id === 100 ? [1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5].map(k => 7 + ((id - 53) * 6 + k) % 40);
        return { id, balls };
    });
    const result = bz49.decide(history, 101, []);
    assert.equal(result.status, 'SKIP');
    assert.match(result.conditions.reason, /Only 3 of 4 numbers/);
    assert.deepEqual(result.conditions.picks.map(p => p.number), [47, 48, 49]);
    assert.deepEqual(result.locks, []);                                     // not played, so nothing is kept
    assert.equal(bz49.decide(history.slice(1), 101, []).status, 'SKIP');     // a missing draw
});

function openLab(t, now) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'balls49-bz49-'));
    const db = new DatabaseSync(path.join(dir, 'lab.sqlite'));
    const lab = createBetZeroLab(db, { now: () => now });
    t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    return lab;
}

test('the Lab predicts BetZero 49 live from its stored draws and grades it as BetZero', t => {
    const lab = openLab(t, 1000);
    assert.equal(lab.strategies().find(s => s.id === bz49.ID).enabled, true);
    const history = draws(150, 3, 1001);
    const records = history.map((d, i) => ({ drawId: String(d.id), settledAt: new Date(1001 + i).toISOString(), result: { balls: d.balls } }));
    const at = 1200;
    lab.ingestSnapshot({ current: { drawId: '1151' }, clock: { drawId: '1151', timeLeftSeconds: 100, observedAt: at }, historyUpdates: records, snapshotAt: at });
    const row = lab.listForwardPredictions({ strategyId: bz49.ID })[0];
    const expected = bz49.predict(history, 1151);
    assert.equal(row.targetDrawId, '1151');
    assert.equal(row.status, expected.status);
    assert.deepEqual(row.selections, expected.selections);
    if (expected.status === 'PENDING') {
        const drawn = [...new Set([...expected.selections.slice(0, 1), 40, 41, 42, 43, 44, 45])].slice(0, 6);
        while (drawn.length < 6) drawn.push([46, 47, 48, 49].find(n => !drawn.includes(n)));
        const result = { drawId: '1151', settledAt: new Date(1301).toISOString(), result: { balls: drawn } };
        lab.ingestSnapshot({ current: { drawId: '1152' }, clock: { drawId: '1152', timeLeftSeconds: 100, observedAt: 1302 }, historyUpdates: [result], snapshotAt: 1302 });
        assert.equal(lab.listForwardPredictions({ strategyId: bz49.ID }).find(p => p.targetDrawId === '1151').status, 'LOSS');
    }
});

test('a Lab test run replays BetZero 49 over the history', t => {
    const lab = openLab(t, 1000);
    const history = draws(400, 5, 1);
    const records = history.map(d => ({ drawId: String(d.id), settledAt: new Date(d.id * 1000).toISOString(), result: { balls: d.balls } }));
    const run = lab.runBacktest(records, { window: 'all', seed: 'bz49', strategyId: bz49.ID, strategyVersion: bz49.VERSION });
    const rows = run.results.filter(r => r.strategyId === bz49.ID);
    assert.equal(rows.length, 3);
    const predictions = rows.reduce((sum, r) => sum + r.result.predictions, 0);
    const expected = [...bz49.simulate(history).entries()].filter(([id, p]) => id <= 400 && p.status === 'PENDING').length;
    assert.equal(predictions, expected);
    assert.ok(predictions > 100);
});

test('the main BetZero prediction gets exactly the Lab BetZero 49 numbers', t => {
    const { predictBetZeroFromLab } = require('./betzero');
    const lab = openLab(t, 1000);
    const history = draws(150, 3, 1001);
    const records = history.map((d, i) => ({ drawId: String(d.id), settledAt: new Date(1001 + i).toISOString(), result: { balls: d.balls } }));
    lab.ingestSnapshot({ current: { drawId: '1151' }, clock: { drawId: '1151', timeLeftSeconds: 100, observedAt: 1200 }, historyUpdates: records, snapshotAt: 1200 });
    const labRow = lab.listForwardPredictions({ strategyId: bz49.ID })[0];
    const handed = lab.mainBetzeroPrediction(1151);
    assert.equal(handed.strategyId, bz49.ID);
    assert.deepEqual(handed.selections, labRow.selections);
    const main = predictBetZeroFromLab(handed, 1151, Date.parse(handed.predictedAt) + 1);
    if (labRow.status === 'PENDING') {
        assert.equal(main.status, 'ACTIVE');
        assert.deepEqual(main.numbers, labRow.selections);
        assert.equal(main.strategy, 'LAB_BETZERO_49_V1');
    } else assert.equal(main.status, 'SKIP');
    assert.equal(lab.mainBetzeroPrediction(1152), null);                          // nothing for a later draw yet
});
