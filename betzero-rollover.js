'use strict';
// BetZero Single Number Rollover.
// Uses the saved single-number Lab selection and its own WIN/LOSS history.
// A fresh Single WIN arms a run; its own selected loss-level spacing sizes the run.
// Wins roll the entire return at 1.10. A losing run doubles the next start, but
// waits for another Single WIN. Skips consume a draw slot without changing stake.
const { seed } = require('./automation-gap-entry');
const { bet49Numbers } = require('./bet49');

const SOURCE_POLICY = 'SINGLE_WIN_OWN_GAPS_V1';
const ODDS = 1.1, LEVEL = 1, STALE_ARM = 3, MAX_BASE = 50000, MAX_STEPS = 20, DEFAULT_STEPS = 4;
const fail = message => Object.assign(new Error(message), { status: 409 });

function normalize(input = {}) {
    // maxDoublings is the old setting (doublings before a pause), which is lossSteps - 1.
    const baseStake = Number(input.baseStake ?? 0), lossSteps = Number(input.lossSteps ?? (input.maxDoublings != null ? Number(input.maxDoublings) + 1 : DEFAULT_STEPS));
    if (!Number.isSafeInteger(baseStake) || baseStake < 0 || baseStake > MAX_BASE) throw fail(`Rollover base stake must be a whole amount from 0 to ${MAX_BASE}.`);
    if (!Number.isSafeInteger(lossSteps) || lossSteps < 1 || lossSteps > MAX_STEPS) throw fail(`Rollover loss steps must be 1 to ${MAX_STEPS}.`);
    const gapLosses = Number(input.gapLosses ?? LEVEL);
    if (!Number.isSafeInteger(gapLosses) || gapLosses < 1 || gapLosses > 100) throw fail('Rollover gap loss level must be 1 to 100.');
    const enabled = input.enabled === true;
    if (enabled && baseStake < 1) throw fail('Enter a rollover base stake before enabling it.');
    return { enabled, baseStake, lossSteps, gapLosses };
}
function config(s) {
    const c = s.config.rollover ||= { enabled: false, baseStake: 0, lossSteps: DEFAULT_STEPS };
    if (c.lossSteps == null) { c.lossSteps = Math.min(MAX_STEPS, Math.max(1, Number(c.maxDoublings ?? DEFAULT_STEPS - 1) + 1)); delete c.maxDoublings; }
    if (c.gapLosses == null) c.gapLosses = LEVEL;
    return c;
}
function fresh() { return { sourcePolicy: SOURCE_POLICY, phase: 'WAITING', armedAt: null, run: null, doublings: 0, plan: null, placed: null, lastObserved: 0, history: [], profit: 0, completed: 0, lost: 0, reason: 'Waiting for a BetZero Single win' }; }
function state(s) {
    const st = s.rollover ||= fresh();
    // Finish an already planned run without rewriting its window or its placed bet.
    // On return to idle discard the old Bet49 trigger/estimate, keeping money/history.
    if (st.sourcePolicy !== SOURCE_POLICY && !st.run && !st.plan && !st.placed) {
        Object.assign(st, { sourcePolicy: SOURCE_POLICY, armedAt: null, lastObserved: 0, estimate: null });
        if (st.phase !== 'PAUSED') st.reason = 'Waiting for a fresh BetZero Single win';
    }
    return st;
}
function reset(s) { s.rollover = fresh(); }
// Settings saved: a new base or switching it on/off starts over; the counters are kept.
function configure(s, next) {
    const before = config(s), st = state(s);
    s.config.rollover = next;
    if (st.phase === 'PAUSED' || before.enabled !== next.enabled || before.baseStake !== next.baseStake || before.lossSteps !== next.lossSteps || before.gapLosses !== next.gapLosses) {
        Object.assign(st, { sourcePolicy: SOURCE_POLICY, lastObserved: 0, estimate: null, phase: 'WAITING', armedAt: null, run: null, doublings: 0, plan: null, placed: null, reason: 'Waiting for a BetZero Single win' });
    }
}
const enabled = s => config(s).enabled && config(s).baseStake > 0;
const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
const rolled = stake => Math.floor(stake * ODDS);          // whole naira, never more than the return

// Average BetZero Single gap at the selected loss level, from settled records up to and including `through`.
function windowLength(records, through, level = LEVEL) {
    let settled = [], previous = null;
    for (const r of [...records].sort((a,b) => Number(a.drawId)-Number(b.drawId))) {
        const id = Number(r.drawId);
        if (!Number.isSafeInteger(id) || id < 1 || id > through) continue;
        if (id === previous) return null;
        if (!['WIN','LOSS','SKIP'].includes(r.result?.betzeroSingle)) break;
        if (previous !== null && id !== previous + 1) settled = [];
        settled.push(r); previous = id;
    }
    const { history } = seed(settled, 'betzeroSingle', level);
    if (history.gaps.length < 2) return null;
    const average = history.gaps.reduce((a, b) => a + b, 0) / history.gaps.length;
    return { length: Math.max(1, Math.ceil(average)), average, samples: history.gaps.length, level };
}

function closeRun(st, at, result, collected, number) {
    const run = st.run, profit = money(collected - run.stakeStart);
    st.history = [{ start: run.start, end: at, length: run.length, played: run.played, bets: run.bets,
        sourcePolicy: run.sourcePolicy || 'LEGACY_BET49_GAPS', gapLosses: run.gapLosses || 1, stakeStart: run.stakeStart, collected: money(collected), profit, result, number }, ...st.history].slice(0, 50);
    st.profit = money(st.profit + profit);
    st.run = null; st.plan = null; st.placed = null; st.phase = 'WAITING'; st.armedAt = null;
}

// Settled records advance the run and arm the next start. Safe to call every tick.
function observe(s, records) {
    const st = state(s), cfg = config(s);
    const settled = records.filter(r => r?.result && Array.isArray(r.result.balls) && Number(r.drawId) > st.lastObserved)
        .sort((a, b) => Number(a.drawId) - Number(b.drawId));
    // First look at the history: start from its newest draw. A BetZero Single win from before the rollover
    // was watching must not start a run; it waits for the next one.
    if (!st.lastObserved && settled.length) {
        st.lastObserved = Number(settled.at(-1).drawId);
        const size = windowLength(records, st.lastObserved, cfg.gapLosses);
        st.estimate = size ? { ...size, through: st.lastObserved } : null;
        return;
    }
    for (const r of settled) {
        const wasWaiting = st.phase === 'WAITING';
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
                    if (st.doublings >= cfg.lossSteps) { st.phase = 'PAUSED'; st.reason = `Paused: all ${cfg.lossSteps} loss steps lost in a row. Save the rollover settings to start again from step 1.`; }
                    else { st.armedAt = null; st.reason = `Lost step ${st.doublings} of ${cfg.lossSteps} on #${id}. Step ${st.doublings + 1} starts at ${2 ** st.doublings}x the base stake after the next BetZero Single win.`; }
                } else {
                    run.played++;
                    run.stake = rolled(stake);
                    if (run.played >= run.length) {
                        closeRun(st, id, 'COMPLETE', money(stake * ODDS), number); st.completed++;
                        st.doublings = 0; st.reason = `Run collected on #${id}. Waiting for a BetZero Single win.`;
                    }
                }
            } else {
                // Expected bet was not placed (stopped, failed or cut short): collect what was rolled.
                closeRun(st, id, 'STOPPED', run.bets ? run.stake : run.stakeStart, plan.number);
                st.reason = 'Run ended because its bet was not placed. Waiting for a BetZero Single win.';
            }
            if (st.run && st.run.played >= st.run.length) {     // a counted skip can finish the run
                closeRun(st, id, 'COMPLETE', st.run.bets ? st.run.stake : st.run.stakeStart, null); st.completed++;
                st.doublings = 0; st.reason = `Run collected on #${id}. Waiting for a BetZero Single win.`;
            }
            if (st.plan && Number(st.plan.drawId) === id) { st.plan = null; st.placed = null; }
        }
        // Only while switched on: a win seen while off (or before a settings change) never starts a run.
        if (st.sourcePolicy === SOURCE_POLICY && wasWaiting && st.phase === 'WAITING' && enabled(s) && r.result.betzeroSingle === 'WIN') st.armedAt = id;
        st.lastObserved = id;
    }
    // The window the next run would get, from the same BetZero Single history, so it can be shown while waiting.
    if (settled.length || st.estimate === undefined) {
        const size = windowLength(records, st.lastObserved, cfg.gapLosses);
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
        st.reason = 'Run ended: a result never arrived. Waiting for a BetZero Single win.';
    }
    if (st.plan) { st.reason = `Waiting for the result of #${st.plan.drawId}.`; return null; }
    if (st.phase === 'PLAYING' && st.run?.lastDraw && id > st.run.lastDraw + 1 + STALE_ARM) {
        closeRun(st, st.run.lastDraw, 'STOPPED', st.run.bets ? st.run.stake : st.run.stakeStart, null);
        st.reason = 'Run ended after missed draws. Waiting for a BetZero Single win.';
    }
    if (st.phase === 'WAITING') {
        if (!st.armedAt || id <= st.armedAt) { st.reason = 'Waiting for a BetZero Single win'; return null; }
        if (id - st.armedAt > STALE_ARM) { st.armedAt = null; st.reason = 'Waiting for a BetZero Single win'; return null; }
        const size = windowLength(records, id - 1, cfg.gapLosses);
        if (!size) { st.reason = `Need at least two BetZero Single gaps at loss level ${cfg.gapLosses} in the current history.`; return null; }
        const stakeStart = cfg.baseStake * 2 ** st.doublings;
        st.run = { sourcePolicy: SOURCE_POLICY, gapLosses: cfg.gapLosses, start: id, length: size.length, average: size.average, samples: size.samples, played: 0, bets: 0, stakeStart, stake: stakeStart, lastDraw: null };
        st.phase = 'PLAYING'; st.armedAt = null;
    }
    const picks = bet49Numbers(prediction?.betzeroSinglePick);
    const number = picks.length === 1 ? picks[0] : null;
    st.plan = { drawId: id, number, stake: st.run.stake, skip: number === null };
    st.reason = number === null ? `Draw #${id}: BetZero Single has no number; the draw counts toward the run.` : `Playing ${number} on BetZero, draw ${st.run.played + 1} of ${st.run.length}.`;
    return number === null ? null : { number, stake: st.run.stake };
}

// The extension confirmed the placement.
function placed(s, drawId, number, stake) {
    const st = state(s);
    if (st.plan && Number(st.plan.drawId) === Number(drawId) && st.plan.number === number) st.placed = { drawId: Number(drawId), number, stake };
}

function view(s) {
    const st = state(s), cfg = config(s);
    return { sourcePolicy: st.sourcePolicy, settings: { ...cfg }, odds: ODDS, phase: st.phase, reason: st.reason, doublings: st.doublings, estimate: st.estimate || null,
        nextStartStake: cfg.baseStake * 2 ** st.doublings, armedAt: st.armedAt,
        run: st.run ? { ...st.run, average: st.run.average } : null,
        plan: st.plan, profit: st.profit, completed: st.completed, lost: st.lost, history: st.history.slice(0, 20) };
}

module.exports = { ODDS, MAX_STEPS, normalize, config, state, reset, configure, enabled, observe, decide, placed, view, windowLength, rolled };
