'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createDailyStreakArchive } = require('./daily-streak-archive');

// The worker's daily summaries do not include markets the website derives (BetZero Single).
// Before this, one missing market rejected the whole prediction snapshot with a 500.
test('imported daily summaries may omit a derived market but not a worker market', () => {
    const archive = createDailyStreakArchive(new DatabaseSync(':memory:'), ['betzero', 'bet49', 'betzeroSingle'], ['betzeroSingle']);
    const stats = { wins: 3, losses: 2, worstLosses: 1 };
    archive.importSummaries([{ day: '2026-11-19', draws: 5, markets: { betzero: stats, bet49: stats } }]);
    assert.deepEqual(archive.read('2026-11-19').markets, { betzero: stats, bet49: stats });
    assert.throws(() => archive.importSummaries([{ day: '2026-11-18', draws: 5, markets: { betzero: stats } }]), /Invalid daily market/);
    assert.throws(() => archive.importSummaries([{ day: '2026-11-18', draws: 5, markets: { betzero: stats, bet49: stats, betzeroSingle: { wins: 9, losses: 0, worstLosses: 0 } } }]), /Invalid daily market/);
});
