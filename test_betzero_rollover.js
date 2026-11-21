'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const rollover = require('./betzero-rollover');

// Bet49 history: draws 1..40, predicting 7, which is drawn every fifth draw (a Bet49 win).
// Level-1 occurrences (first loss after a win) are 5 draws apart, so the window is 5 draws.
const NUMBER = 7, OTHER = [1, 2, 3, 4, 5, 6], WITH = [7, 2, 3, 4, 5, 6];
function record(id, number, drawn) {
    const balls = drawn ? WITH : OTHER;
    return { drawId: String(id), predicted: { bet49: number ? [number] : [] },
        result: { balls, bet49: number ? (balls.includes(number) ? 'WIN' : 'LOSS') : 'SKIP' } };
}
function setup(cfg = { enabled: true, baseStake: 100, maxDoublings: 2 }) {
    const s = { config: { rollover: rollover.normalize(cfg) } };
    const records = Array.from({ length: 39 }, (_, i) => record(i + 1, NUMBER, (i + 1) % 5 === 0));
    rollover.observe(s, records);                           // first look: history is not used to start
    records.unshift(record(40, NUMBER, true));              // a Bet49 win while watching
    rollover.observe(s, records);
    // One draw of the session: decide, the extension places, the result settles.
    const play = (id, { drawn = false, number = NUMBER, place = true } = {}) => {
        const bet = rollover.decide(s, id, { bet49Pick: number ? [number] : [] }, records);
        if (bet && place) rollover.placed(s, id, bet.number, bet.stake);
        records.unshift(record(id, number, drawn));
        rollover.observe(s, records);
        return bet;
    };
    return { s, records, play, st: () => rollover.state(s) };
}

test('window length is the average Bet49 gap at loss level 1, rounded up', () => {
    const { records } = setup();
    assert.deepEqual(rollover.windowLength(records, 40), { length: 5, average: 5, samples: 6 });
    // Kept up to date while waiting, so the website can show the next window before a run starts.
    const { s: session } = setup();
    assert.deepEqual(rollover.view(session).estimate, { length: 5, average: 5, samples: 6, through: 40 });
});

test('a run starts after a Bet49 win, rolls over every win and stops at the window length', () => {
    const { play, st } = setup();
    assert.equal(st().armedAt, 40);                         // draw 40 was a Bet49 win
    const stakes = [41, 42, 43, 44, 45].map(id => play(id).stake);
    assert.deepEqual(stakes, [100, 110, 121, 133, 146]);
    assert.equal(st().phase, 'WAITING');
    assert.equal(st().completed, 1);
    assert.deepEqual([st().history[0].result, st().history[0].collected, st().history[0].profit], ['COMPLETE', 160.6, 60.6]);
    // Waits: no bet until the next Bet49 win.
    assert.equal(play(46), null); assert.equal(play(47), null);
    play(48, { drawn: true });                              // Bet49 wins; nothing was staked
    assert.equal(play(49).stake, 100);                      // new run, base stake
});

test('a loss restarts at once with double the stake, then back to base after a completed run', () => {
    const { play, st } = setup();
    play(41); play(42);
    const lost = play(43, { drawn: true });                  // number drawn: BetZero loses
    assert.equal(lost.stake, 121);
    assert.deepEqual([st().history[0].result, st().history[0].profit], ['LOST', -100]);
    const doubled = [44, 45, 46, 47, 48].map(id => play(id).stake);
    assert.deepEqual(doubled, [200, 220, 242, 266, 292]);
    assert.equal(st().phase, 'WAITING'); assert.equal(st().doublings, 0);
    play(49, { drawn: true });
    assert.equal(play(50).stake, 100);
});

test('losses in a row keep doubling up to the cap, then pause', () => {
    const { s, play, st } = setup({ enabled: true, baseStake: 100, maxDoublings: 2 });
    assert.equal(play(41, { drawn: true }).stake, 100);
    assert.equal(play(42, { drawn: true }).stake, 200);
    assert.equal(play(43, { drawn: true }).stake, 400);
    assert.equal(st().phase, 'PAUSED');
    assert.equal(play(44), null);
    assert.equal(st().profit, -700);
    // Saving the same settings again clears the pause; it then waits for a Bet49 win at the base stake.
    rollover.configure(s, rollover.normalize({ enabled: true, baseStake: 100, maxDoublings: 2 }));
    assert.equal(st().phase, 'WAITING'); assert.equal(st().doublings, 0);
});

test('draws without a Bet49 number are not bet but count toward the window', () => {
    const { play, st } = setup();
    assert.equal(play(41).stake, 100);
    assert.equal(play(42, { number: null }), null);         // skipped, money held
    assert.equal(st().run.played, 2);
    assert.equal(play(43).stake, 110);                       // held amount continues
    play(44); play(45);
    assert.equal(st().phase, 'WAITING'); assert.equal(st().history[0].bets, 4);
});

test('an unplaced bet ends the run and keeps the doubling level', () => {
    const { play, st } = setup();
    play(41, { drawn: true });                               // loss -> doublings 1
    play(42); play(43, { place: false });
    assert.equal(st().history[0].result, 'STOPPED');
    assert.equal(st().history[0].collected, 220);            // the rolled 200 -> 220 is in the account
    assert.equal(st().doublings, 1);
    assert.equal(st().phase, 'WAITING');
});

test('a Bet49 win already in the history does not start a run; the next one does', () => {
    const s = { config: { rollover: rollover.normalize({ enabled: true, baseStake: 100, maxDoublings: 2 }) } };
    const records = Array.from({ length: 40 }, (_, i) => record(i + 1, NUMBER, (i + 1) % 5 === 0));
    rollover.observe(s, records);                           // draw 40, the newest, was a Bet49 win
    assert.equal(rollover.state(s).armedAt, null);
    assert.equal(rollover.decide(s, 41, { bet49Pick: [NUMBER] }, records), null);
    assert.equal(rollover.view(s).estimate.length, 5);       // the next window is still shown
    for (const id of [41, 42, 43, 44]) { records.unshift(record(id, NUMBER, false)); rollover.observe(s, records); }
    records.unshift(record(45, NUMBER, true)); rollover.observe(s, records);
    assert.equal(rollover.decide(s, 46, { bet49Pick: [NUMBER] }, records).stake, 100);
});

test('Bet49 wins while switched off do not start a run once it is switched on', () => {
    const s = { config: { rollover: rollover.normalize({ enabled: false, baseStake: 100, maxDoublings: 2 }) } };
    const records = Array.from({ length: 39 }, (_, i) => record(i + 1, NUMBER, (i + 1) % 5 === 0));
    rollover.observe(s, records);
    records.unshift(record(40, NUMBER, true)); rollover.observe(s, records);
    assert.equal(rollover.state(s).armedAt, null);
    rollover.configure(s, rollover.normalize({ enabled: true, baseStake: 100, maxDoublings: 2 }));
    assert.equal(rollover.decide(s, 41, { bet49Pick: [NUMBER] }, records), null);
});

test('an old Bet49 win does not start a run after a long stop', () => {
    const { s, records, st } = setup();
    assert.equal(rollover.decide(s, 50, { bet49Pick: [NUMBER] }, records), null);
    assert.equal(st().armedAt, null);
});

test('settings are validated and a change starts over', () => {
    assert.throws(() => rollover.normalize({ enabled: true, baseStake: 0 }), /base stake/);
    assert.throws(() => rollover.normalize({ baseStake: 1.5 }), /whole amount/);
    assert.equal(rollover.normalize({ baseStake: 100, maxDoublings: 20 }).maxDoublings, 20);
    assert.throws(() => rollover.normalize({ baseStake: 100, maxDoublings: 21 }), /doublings/);
    assert.deepEqual(rollover.normalize({}), { enabled: false, baseStake: 0, maxDoublings: 3 });
    const { s, play, st } = setup();
    play(41, { drawn: true });
    rollover.configure(s, rollover.normalize({ enabled: true, baseStake: 50, maxDoublings: 2 }));
    assert.equal(st().doublings, 0); assert.equal(st().phase, 'WAITING');
});

test('dashboard: save, start with only the rollover, status and activity rows', () => {
    const control = require('./automation-control');
    const games = ['betzero', 'bet49', 'rainbow', 'hilo', 'totalColor', 'totalColor2', 'totalColor1'];
    const s = { config: { initialStakes: {}, maxSteps: {}, enabledGames: {}, gapEntry: {} }, stats: { isHalted: true },
        martingaleState: {}, masterState: { step: 1 }, automationControl: { controller: 'website', revision: 1, executorAt: Date.now(), executorToken: '' } };
    const settings = { stakes: Object.fromEntries(games.map(g => [g, 0])), gameSteps: Object.fromEntries(games.map(g => [g, 0])), enabledGames: {},
        takeProfit: 0, stopLoss: 0, hiloMultiplier: 2, sniperSettings: {}, gapEntry: {}, rollover: { enabled: true, baseStake: 100, maxDoublings: 3 } };
    const saved = control.command(s, { dashboardAction: 'save', revision: 1, settings }, false, []);
    assert.equal(saved.config.rollover, undefined);          // applied directly, not via the generic config copy
    assert.deepEqual(s.config.rollover, { enabled: true, baseStake: 100, maxDoublings: 3 });
    assert.deepEqual(control.settings(s).rollover, s.config.rollover);
    assert.deepEqual(control.command(s, { dashboardAction: 'start', revision: 2 }, false, []), { config: { running: true } });
    assert.throws(() => control.command(s, { dashboardAction: 'save', revision: 3, settings: { ...settings, rollover: { enabled: true, baseStake: 0 } } }, false, []), /base stake/);
    s.stats = { isHalted: false, wins: 0, losses: 0 };
    const v = control.view(s).rollover;
    assert.equal(v.phase, 'WAITING'); assert.equal(v.odds, 1.1); assert.equal(v.nextStartStake, 100);
    control.record(s, 41, { games: [], stakes: {}, rollover: { number: 7, stake: 110 } }, {});
    assert.deepEqual(s.automationHistory[0].games, [{ game: 'betzeroSingle', unitStake: 110, stake: 110, selections: [7], result: 'PENDING' }]);
    control.settle(s, { drawId: '41', result: { balls: [1, 2, 3, 4, 5, 6] } });
    assert.equal(s.automationHistory[0].games[0].result, 'WIN');
});
