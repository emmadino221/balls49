'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { predictBet49LongestGap, bet49Gaps } = require('./bet49');
const { createBet49Tracker } = require('./bet49-tracker');

// Deterministic draws: id -> six distinct numbers.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function makeDraws(from, to, seed = 7, force = {}) {
    const r = rng(seed), out = [];
    for (let id = from; id <= to; id++) {
        let balls = force[id];
        if (!balls) { const set = new Set(); while (set.size < 6) set.add(1 + Math.floor(r() * 49)); balls = [...set]; }
        out.push({ id, dr: balls.join(',') });
    }
    return out;
}
// Reference: straightforward per-number scan.
function reference(draws, target) {
    const longest = {}, current = {};
    for (let n = 1; n <= 49; n++) {
        let run = 0, best = 0;
        for (let id = target - 100; id < target; id++) {
            const balls = draws.find(d => d.id === id).dr.split(',').map(Number);
            if (balls.includes(n)) run = 0; else best = Math.max(best, ++run);
        }
        longest[n] = best; current[n] = run;
    }
    return { longest, current };
}

test('streaks match a direct scan of the last 100 draws', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
        const draws = makeDraws(1000, 1199, seed), target = 1200, ref = reference(draws, target), got = bet49Gaps(draws, target);
        for (let n = 1; n <= 49; n++) { assert.equal(got.longest[n], ref.longest[n], `longest ${n}`); assert.equal(got.current[n], ref.current[n], `current ${n}`); }
        const result = predictBet49LongestGap(draws, target);
        const ranked = Object.keys(ref.longest).map(Number).sort((a, b) => ref.longest[b] - ref.longest[a] || ref.current[b] - ref.current[a] || a - b);
        const expected = ranked.find(n => ref.current[n] > 0 && ref.current[n] * 2 >= ref.longest[n]);
        assert.deepEqual(result.numbers, [expected]);
        assert.equal(result.longestStreak, ref.longest[expected]); assert.equal(result.currentStreak, ref.current[expected]);
        assert.deepEqual(result.lock, { number: expected, since: target });
    }
});

test('only the 100 draws before the target are used', () => {
    const draws = makeDraws(900, 1300, 9);
    const inWindow = draws.filter(d => d.id >= 1100 && d.id < 1200);
    assert.deepEqual(predictBet49LongestGap(draws, 1200).numbers, predictBet49LongestGap(inWindow, 1200).numbers);
});

test('top number below half its longest streak passes to the next number', () => {
    // 1 is missing for 60 draws early (longest 60) and recently seen (current 5): not half.
    // 2 is missing for the last 40 draws (longest 40, current 40): played.
    // Every other number (3..49) cycles through the draws and is never missing for long.
    const cycle = Array.from({ length: 47 }, (_, i) => i + 3);
    let next = 0;
    const draws = [];
    for (let id = 1100; id < 1200; id++) {
        const balls = [];
        if (id >= 1160 && id <= 1194) balls.push(1);
        if (id < 1160) balls.push(2);
        while (balls.length < 6) balls.push(cycle[next++ % cycle.length]);
        draws.push({ id, dr: balls.join(',') });
    }
    const gaps = bet49Gaps(draws, 1200);
    assert.deepEqual([gaps.longest[1], gaps.current[1], gaps.longest[2], gaps.current[2]], [60, 5, 40, 40]);
    assert.ok(cycle.every(n => gaps.longest[n] < 40));
    const result = predictBet49LongestGap(draws, 1200);
    assert.deepEqual(result.numbers, [2]);                       // 1 ranks first but 5 < 60 / 2
    assert.deepEqual([result.longestStreak, result.currentStreak], [40, 40]);
});

test('the chosen number is kept until it appears, then a new one is chosen', () => {
    let draws = makeDraws(1000, 1199, 11);
    const first = predictBet49LongestGap(draws, 1200);
    const n = first.numbers[0];
    let lock = first.lock;
    // Draws 1200..1204 without n: same number every time, even if its ranking changes.
    for (let id = 1200; id < 1205; id++) {
        const set = new Set(); const r = rng(id); while (set.size < 6) { const v = 1 + Math.floor(r() * 49); if (v !== n) set.add(v); }
        draws.push({ id, dr: [...set].join(',') });
        const next = predictBet49LongestGap(draws, id + 1, lock);
        assert.deepEqual(next.numbers, [n]); assert.equal(next.kept, true); assert.equal(next.playingSince, 1200);
        lock = next.lock;
    }
    // n appears in 1205: the next draw picks again (n itself now has current 0 and is not eligible).
    draws.push({ id: 1205, dr: [n, ...[1, 2, 3, 4, 5, 6, 7].filter(v => v !== n).slice(0, 5)].join(',') });
    const after = predictBet49LongestGap(draws, 1206, lock);
    assert.equal(after.kept, false); assert.notEqual(after.numbers[0], n); assert.equal(after.lock.since, 1206);
});

test('the draw a number was first played for counts as it appearing', () => {
    const draws = makeDraws(1000, 1199, 12);
    const first = predictBet49LongestGap(draws, 1200), n = first.numbers[0];
    draws.push({ id: 1200, dr: [n, ...[40, 41, 42, 43, 44, 45, 46].filter(v => v !== n).slice(0, 5)].join(',') });
    assert.equal(predictBet49LongestGap(draws, 1201, first.lock).kept, false);
});

test('missing, invalid or conflicting draws skip', () => {
    const draws = makeDraws(1100, 1199, 3);
    assert.match(predictBet49LongestGap(draws.filter(d => d.id !== 1150), 1200).reason, /last 100 draws \(have 99\)/);
    assert.match(predictBet49LongestGap([...draws, { id: 1150, dr: '1,2,3,4,5,5' }], 1200).reason, /invalid/);
    assert.match(predictBet49LongestGap([...draws, { id: 1150, dr: '1,2,3,4,5,6' }], 1200).reason, /conflicting|invalid/);
    assert.equal(predictBet49LongestGap(draws, 'x').status, 'SKIP');
});

test('tracker keeps its own rolling history and the played number across restarts and skips', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bet49-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'bet49_tracker.json');
    let tracker = createBet49Tracker(file);
    // Draws seen during earlier cycles (settlements, /draws) before the collector's daily reset.
    const seen = makeDraws(1000, 1199, 21);
    tracker.observe(seen.slice(0, 170));
    // After the reset the collector only lists the latest 30 draws; the tracker still has 100.
    const first = tracker.predict(seen.slice(170), 1200);
    assert.equal(first.status, 'ACTIVE');
    assert.equal(tracker.size(), 150);                               // trimmed to the newest 150
    tracker = createBet49Tracker(file);                               // restart
    assert.deepEqual(tracker.lock(), first.lock);
    const skipped = tracker.predict([], 1300);                        // big gap: skip, keep the number
    assert.equal(skipped.status, 'SKIP'); assert.deepEqual(tracker.lock(), first.lock);
    const n = first.numbers[0];
    const next = { id: 1200, dr: [1, 2, 3, 4, 5, 6, 7].filter(v => v !== n).slice(0, 6).join(',') };
    assert.deepEqual(tracker.predict([next], 1201).numbers, [n]);
});
