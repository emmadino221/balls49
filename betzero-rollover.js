'use strict';
// BetZero Single Number Rollover.
// The number is the Bet49 prediction, played on BetZero (wins when it is NOT drawn) at 1.10.
// A run starts on the draw after a Bet49 win. Its length is the average Bet49 draw gap at loss
// level 1 (rounded up). Every win rolls the whole return into the next draw until the length is
// reached; then the run is collected and the automation waits for the next Bet49 win.
// A loss (the number is drawn, which is also a Bet49 win) starts a new run at once with the
// starting stake doubled; after maxDoublings losses in a row the rollover pauses.
// Draws where Bet49 has no prediction are not bet but count toward the length.
const { seed } = require('./automation-gap-entry');
const { bet49Numbers } = require('./bet49');

const ODDS = 1.1, LEVEL = 1, STALE_ARM = 3, MAX_BASE = 50000, MAX_DOUBLINGS = 10;
const fail = message => Object.assign(new Error(message), { status: 409 });

function normalize(input = {}) {
    const baseStake = Number(input.baseStake ?? 0), maxDoublings = Number(input.maxDoublings ?? 3);
    if (!Number.isSafeInteger(baseStake) || baseStake < 0 || baseStake > MAX_BASE) throw fail(`Rollover base stake must be a whole amount from 0 to ${MAX_BASE}.`);
    if (!Number.isSafeInteger(maxDoublings) || maxDoublings < 0 || maxDoublings > MAX_DOUBLINGS) throw fail(`Rollover doublings must be 0 to ${MAX_DOUBLINGS}.`);
    const enabled = input.enabled === true;
    if (enabled && baseStake < 1) throw fail('Enter a rollover base stake before enabling it.');
    return { enabled, baseStake, maxDoublings };
}
function config(s) { return s.config.rollover ||= { enabled: false, baseStake: 0, maxDoublings: 3 }; }
function fresh() { return { phase: 'WAITING', armedAt: null, run: null, doublings: 0, plan: null, placed: null, lastObserved: 0, history: [], profit: 0, completed: 0, lost: 0, reason: 'Waiting for a Bet49 win' }; }
function state(s) { return s.rollover ||= fresh(); }
function reset(s) { s.rollover = fresh(); }
// Settings saved: a new base or switching it on/off starts over; the counters are kept.
function configure(s, next) {
    const before = config(s), st = state(s);
    s.config.rollover = next;
    if (st.phase === 'PAUSED' || before.enabled !== next.enabled || before.baseStake !== next.baseStake || before.maxDoublings !== next.maxDoublings) {
        Object.assign(st, { phase: 'WAITING', armedAt: null, run: null, doublings: 0, plan: null, placed: null, reason: 'Waiting for a Bet49 win' });
    }
}
const enabled = s => config(s).enabled && config(s).baseStake > 0;
const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
const rolled = stake => Math.floor(stake * ODDS);          // whole naira, never more than the return

// Average Bet49 gap at loss level 1, from settled records up to and including `through`.
function windowLength(records, through) {
    const settled = records.filter(r => Number(r.drawId) <= through && r.result);
    const { history } = seed(settled, 'bet49', LEVEL);
    if (history.gaps.length < 2) return null;
    const average = history.gaps.reduce((a, b) => a + b, 0) / history.gaps.length;
    return { length: Math.max(1, Math.ceil(average)), average, samples: history.gaps.length };
}

function closeRun(st, at, result, collected, number) {
    const run = st.run, profit = money(collected - run.stakeStart);
    st.history = [{ start: run.start, end: at, length: run.length, played: run.played, bets: run.bets,
        stakeStart: run.stakeStart, collected: money(collected), profit, result, number }, ...st.history].slice(0, 50);
    st.profit = money(st.profit + profit);
    st.run = null; st.plan = null; st.placed = null; st.phase = 'WAITING'; st.armedAt = null;
}

// Settled records advance the run and arm the next start. Safe to call every tick.
function observe(s, records) {
    const st = state(s), cfg = config(s);
    const settled = records.filter(r => r?.result && Array.isArray(r.result.balls) && Number(r.drawId) > st.lastObserved)
        .sort((a, b) => Number(a.drawId) - Number(b.drawId));
    for (const r of settled) {
        const id = Number(r.drawId), balls = r.result.balls.map(Number);
        if (st.plan && Number(st.plan.drawId) === id && st.run) {
            const plan = st.plan, run = st.run;
            if (plan.skip) { run.played++; run.lastDraw = id; }
            else if (st.placed && Number(st.placed.drawId) === id) {
                const stake = st.placed.stake, number = st.placed.number;
                run.bets++; run.lastDraw = id;
                if (balls.includes(number)) {
                    closeRun(st, id, 'LOST', 0, number); st.lost++;
                    st.doublings++;
                    if (st.doublings > cfg.maxDoublings) { st.phase = 'PAUSED'; st.reason = `Paused: ${st.doublings} losses in a row reached the doubling limit. Save the rollover settings to start again.`; }
                    else { st.armedAt = id; st.reason = `Lost on #${id}. Next run starts at ${2 ** st.doublings}x the base stake.`; }
                } else {
                    run.played++;
                    run.stake = rolled(stake);
                    if (run.played >= run.length) {
                        closeRun(st, id, 'COMPLETE', money(stake * ODDS), number); st.completed++;
                        st.doublings = 0; st.reason = `Run collected on #${id}. Waiting for a Bet49 win.`;
                    }
                }
            } else {
                // Expected bet was not placed (stopped, failed or cut short): collect what was rolled.
                closeRun(st, id, 'STOPPED', run.bets ? run.stake : run.stakeStart, plan.number);
                st.reason = 'Run ended because its bet was not placed. Waiting for a Bet49 win.';
            }
            if (st.run && st.run.played >= st.run.length) {     // a counted skip can finish the run
                closeRun(st, id, 'COMPLETE', st.run.bets ? st.run.stake : st.run.stakeStart, null); st.completed++;
                st.doublings = 0; st.reason = `Run collected on #${id}. Waiting for a Bet49 win.`;
            }
            if (st.plan && Number(st.plan.drawId) === id) { st.plan = null; st.placed = null; }
        }
        if (st.phase === 'WAITING' && r.result.bet49 === 'WIN') st.armedAt = id;
        st.lastObserved = id;
    }
    // The window the next run would get, from the same Bet49 history, so it can be shown while waiting.
    if (settled.length || st.estimate === undefined) {
        const size = windowLength(records, st.lastObserved);
        st.estimate = size ? { ...size, through: st.lastObserved } : null;
    }
}

// The bet for the upcoming draw, or null. Call after observe().
function decide(s, drawId, prediction, records) {
    const st = state(s), cfg = config(s), id = Number(drawId);
    if (!enabled(s) || st.phase === 'PAUSED' || !Number.isSafeInteger(id)) return null;
    if (st.plan && Number(st.plan.drawId) === id) return st.plan.skip ? null : { number: st.plan.number, stake: st.plan.stake };
    if (st.plan && id > Number(st.plan.drawId) + STALE_ARM && st.run) {
        closeRun(st, Number(st.plan.drawId), 'STOPPED', st.run.bets ? st.run.stake : st.run.stakeStart, st.plan.number);
        st.reason = 'Run ended: a result never arrived. Waiting for a Bet49 win.';
    }
    if (st.plan) { st.reason = `Waiting for the result of #${st.plan.drawId}.`; return null; }
    if (st.phase === 'PLAYING' && st.run?.lastDraw && id > st.run.lastDraw + 1 + STALE_ARM) {
        closeRun(st, st.run.lastDraw, 'STOPPED', st.run.bets ? st.run.stake : st.run.stakeStart, null);
        st.reason = 'Run ended after missed draws. Waiting for a Bet49 win.';
    }
    if (st.phase === 'WAITING') {
        if (!st.armedAt || id <= st.armedAt) { st.reason = 'Waiting for a Bet49 win'; return null; }
        if (id - st.armedAt > STALE_ARM) { st.armedAt = null; st.reason = 'Waiting for a Bet49 win'; return null; }
        const size = windowLength(records, id - 1);
        if (!size) { st.reason = 'Need at least two Bet49 gaps at loss level 1 in the current history.'; return null; }
        const stakeStart = cfg.baseStake * 2 ** st.doublings;
        st.run = { start: id, length: size.length, average: size.average, samples: size.samples, played: 0, bets: 0, stakeStart, stake: stakeStart, lastDraw: null };
        st.phase = 'PLAYING'; st.armedAt = null;
    }
    const picks = bet49Numbers(prediction?.bet49Pick);
    const number = picks.length === 1 ? picks[0] : null;
    st.plan = { drawId: id, number, stake: st.run.stake, skip: number === null };
    st.reason = number === null ? `Draw #${id}: Bet49 has no number; the draw counts toward the run.` : `Playing ${number} on BetZero, draw ${st.run.played + 1} of ${st.run.length}.`;
    return number === null ? null : { number, stake: st.run.stake };
}

// The extension confirmed the placement.
function placed(s, drawId, number, stake) {
    const st = state(s);
    if (st.plan && Number(st.plan.drawId) === Number(drawId) && st.plan.number === number) st.placed = { drawId: Number(drawId), number, stake };
}

function view(s) {
    const st = state(s), cfg = config(s);
    return { settings: { ...cfg }, odds: ODDS, phase: st.phase, reason: st.reason, doublings: st.doublings, estimate: st.estimate || null,
        nextStartStake: cfg.baseStake * 2 ** st.doublings, armedAt: st.armedAt,
        run: st.run ? { ...st.run, average: st.run.average } : null,
        plan: st.plan, profit: st.profit, completed: st.completed, lost: st.lost, history: st.history.slice(0, 20) };
}

module.exports = { ODDS, normalize, config, state, reset, configure, enabled, observe, decide, placed, view, windowLength, rolled };
