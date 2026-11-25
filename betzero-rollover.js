'use strict';
// BetZero Single Number Rollover.
// Uses the saved single-number Lab selection and its own WIN/LOSS history.
// Every eligible prediction can start a run; win-level gaps or a manual count size it.
// Wins roll the entire return at 1.10. Losses multiply the next starting stake.
// Skips consume an active draw slot without changing stake.
const { seed } = require('./automation-gap-entry');
const { bet49Numbers } = require('./bet49');

const SOURCE_POLICY = 'SINGLE_CONTINUOUS_WIN_GAPS_V3';
const ODDS = 1.1, LEVEL = 1, STALE_ARM = 3, MAX_BASE = 50000, MAX_STEPS = 20, DEFAULT_STEPS = 4;
const fail = message => Object.assign(new Error(message), { status: 409 });

function normalize(input = {}) {
    // maxDoublings is the old setting (doublings before a pause), which is lossSteps - 1.
    const baseStake = Number(input.baseStake ?? 0), lossSteps = Number(input.lossSteps ?? (input.maxDoublings != null ? Number(input.maxDoublings) + 1 : DEFAULT_STEPS));
    if (!Number.isSafeInteger(baseStake) || baseStake < 0 || baseStake > MAX_BASE) throw fail(`Rollover base stake must be a whole amount from 0 to ${MAX_BASE}.`);
    if (!Number.isSafeInteger(lossSteps) || lossSteps < 1 || lossSteps > MAX_STEPS) throw fail(`Rollover loss steps must be 1 to ${MAX_STEPS}.`);
    const gapLosses = Number(input.gapLosses ?? LEVEL);
    if (!Number.isSafeInteger(gapLosses) || gapLosses < 1 || gapLosses > 100) throw fail('Rollover gap win level must be 1 to 100.');
    const enabled = input.enabled === true;
    if (enabled && baseStake < 1) throw fail('Enter a rollover base stake before enabling it.');
    const windowMode = input.windowMode ?? 'automatic';
    const manualDraws = Number(input.manualDraws ?? 10);
    if (!['automatic', 'manual'].includes(windowMode)) throw fail('Unknown rollover window mode.');
    if (!Number.isSafeInteger(manualDraws) || manualDraws < 1 || manualDraws > 100) throw fail('Manual rollover window must be 1 to 100 draws.');
    const recoveryMultiplier = Number(input.recoveryMultiplier ?? 2);
    if (!Number.isFinite(recoveryMultiplier) || recoveryMultiplier <= 1) throw fail('Recovery multiplier must be a finite number greater than 1.');
    if (!Number.isSafeInteger(Math.ceil(Math.max(1, baseStake) * recoveryMultiplier ** (lossSteps - 1)))) throw fail('Recovery progression exceeds the supported stake range. Reduce the multiplier or loss steps.');
    return { enabled, baseStake, lossSteps, gapLosses, windowMode, manualDraws, recoveryMultiplier };
}
function config(s) {
    const c = s.config.rollover ||= { enabled: false, baseStake: 0, lossSteps: DEFAULT_STEPS };
    if (c.lossSteps == null) { c.lossSteps = Math.min(MAX_STEPS, Math.max(1, Number(c.maxDoublings ?? DEFAULT_STEPS - 1) + 1)); delete c.maxDoublings; }
    if (c.gapLosses == null) c.gapLosses = LEVEL;
    c.windowMode ??= 'automatic';
    c.manualDraws ??= 10;
    c.recoveryMultiplier ??= 2;
    return c;
}
function fresh() { return { sourcePolicy: SOURCE_POLICY, phase: 'WAITING', armedAt: null, run: null, doublings: 0, plan: null, placed: null, lastObserved: 0, history: [], profit: 0, completed: 0, lost: 0, reason: 'Waiting for an eligible BetZero Single prediction' }; }
function state(s) {
    const st = s.rollover ||= fresh();
    // Finish an already planned run without rewriting its window or its placed bet.
    // On return to idle discard the old Bet49 trigger/estimate, keeping money/history.
    if (st.sourcePolicy !== SOURCE_POLICY && !st.run && !st.plan && !st.placed) {
        Object.assign(st, { sourcePolicy: SOURCE_POLICY, armedAt: null, lastObserved: 0, estimate: null });
        if (st.phase !== 'PAUSED') st.reason = 'Waiting for an eligible BetZero Single prediction';
    }
    return st;
}
function reset(s) { s.rollover = fresh(); }
// Settings saved: a new base or switching it on/off starts over; the counters are kept.
function configure(s, next) {
    const before = config(s), st = state(s);
    s.config.rollover = next;
    if (st.phase === 'PAUSED' || before.enabled !== next.enabled || before.baseStake !== next.baseStake || before.lossSteps !== next.lossSteps || before.gapLosses !== next.gapLosses || before.windowMode !== next.windowMode || before.manualDraws !== next.manualDraws || before.recoveryMultiplier !== next.recoveryMultiplier) {
        Object.assign(st, { sourcePolicy: SOURCE_POLICY, lastObserved: 0, estimate: null, phase: 'WAITING', armedAt: null, run: null, doublings: 0, plan: null, placed: null, reason: 'Waiting for an eligible BetZero Single prediction' });
    }
}
const enabled = s => config(s).enabled && config(s).baseStake > 0;
const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
const rolled = stake => Math.floor(stake * ODDS);          // whole naira, never more than the return

// Average BetZero Single gap at the selected win level, from settled records up to and including `through`.
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
    const { history } = seed(settled.map(r => ({ ...r, result: { ...r.result, betzeroSingle: r.result.betzeroSingle === 'WIN' ? 'LOSS' : r.result.betzeroSingle === 'LOSS' ? 'WIN' : r.result.betzeroSingle } })), 'betzeroSingle', level);
    if (history.gaps.length < 2) return null;
    const average = history.gaps.reduce((a, b) => a + b, 0) / history.gaps.length;
    return { length: Math.max(1, Math.ceil(average)), average, samples: history.gaps.length, level };
}

function configuredWindow(records, through, cfg) {
    return cfg.windowMode === 'manual'
        ? { length: cfg.manualDraws, average: null, samples: 0, level: cfg.gapLosses, mode: 'manual' }
        : windowLength(records, through, cfg.gapLosses);
}

function closeRun(st, at, result, collected, number) {
    const run = st.run, profit = money(collected - run.stakeStart);
    st.history = [{ start: run.start, end: at, length: run.length, played: run.played, bets: run.bets,
        recoveryMultiplier: run.recoveryMultiplier ?? 2, sourcePolicy: run.sourcePolicy || 'LEGACY_BET49_GAPS', gapLosses: run.gapLosses || 1, windowMode: run.windowMode || 'automatic', stakeStart: run.stakeStart, collected: money(collected), profit, result, number }, ...st.history].slice(0, 50);
    st.profit = money(st.profit + profit);
    st.run = null; st.plan = null; st.placed = null; st.phase = 'WAITING'; st.armedAt = null;
}

// Settled records advance the run and arm the next start. Safe to call every tick.
function observe(s, records) {
    const st = state(s), cfg = config(s);
    const settled = records.filter(r => r?.result && Array.isArray(r.result.balls) && Number(r.drawId) > st.lastObserved)
        .sort((a, b) => Number(a.drawId) - Number(b.drawId));
    // Baseline the history without replaying old draws as new placements.
    if (!st.lastObserved && settled.length) {
        st.lastObserved = Number(settled.at(-1).drawId);
        const size = configuredWindow(records, st.lastObserved, cfg);
        st.estimate = size ? { ...size, through: st.lastObserved } : null;
        return;
    }
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
                    if (st.doublings >= cfg.lossSteps) { st.phase = 'PAUSED'; st.reason = `Paused: all ${cfg.lossSteps} loss steps lost in a row. Save the rollover settings to start again from step 1.`; }
                    else { st.armedAt = null; st.reason = `Lost step ${st.doublings} of ${cfg.lossSteps} on #${id}. Step ${st.doublings + 1} starts at ${cfg.recoveryMultiplier ** st.doublings}x the base stake on the next eligible BetZero Single prediction.`; }
                } else {
                    run.played++;
                    run.stake = rolled(stake);
                    if (run.played >= run.length) {
                        closeRun(st, id, 'COMPLETE', money(stake * ODDS), number); st.completed++;
                        st.doublings = 0; st.reason = `Run collected on #${id}. Waiting for an eligible BetZero Single prediction.`;
                    }
                }
            } else {
                // Expected bet was not placed (stopped, failed or cut short): collect what was rolled.
                closeRun(st, id, 'STOPPED', run.bets ? run.stake : run.stakeStart, plan.number);
                st.reason = 'Run ended because its bet was not placed. Waiting for an eligible BetZero Single prediction.';
            }
            if (st.run && st.run.played >= st.run.length) {     // a counted skip can finish the run
                closeRun(st, id, 'COMPLETE', st.run.bets ? st.run.stake : st.run.stakeStart, null); st.completed++;
                st.doublings = 0; st.reason = `Run collected on #${id}. Waiting for an eligible BetZero Single prediction.`;
            }
            if (st.plan && Number(st.plan.drawId) === id) { st.plan = null; st.placed = null; }
        }
        st.lastObserved = id;
    }
    // The window the next run would get, from the same BetZero Single history, so it can be shown while waiting.
    if (settled.length || st.estimate === undefined) {
        const size = configuredWindow(records, st.lastObserved, cfg);
        st.estimate = size ? { ...size, through: st.lastObserved } : null;
    }
}

// The bet for the upcoming draw, or null. Call after observe().
function decide(s, drawId, prediction, records) {
    const st = state(s), cfg = config(s), id = Number(drawId);
    if (!enabled(s) || st.phase === 'PAUSED' || !Number.isSafeInteger(id) || id < 1) return null;
    if (st.plan && Number(st.plan.drawId) === id) return st.plan.skip ? null : { number: st.plan.number, stake: st.plan.stake };
    if (st.plan && id > Number(st.plan.drawId) + STALE_ARM && st.run) {
        closeRun(st, Number(st.plan.drawId), 'STOPPED', st.run.bets ? st.run.stake : st.run.stakeStart, st.plan.number);
        st.reason = 'Run ended: a result never arrived. Waiting for an eligible BetZero Single prediction.';
    }
    if (st.plan) { st.reason = `Waiting for the result of #${st.plan.drawId}.`; return null; }
    if (st.phase === 'PLAYING' && st.run?.lastDraw && id > st.run.lastDraw + 1 + STALE_ARM) {
        closeRun(st, st.run.lastDraw, 'STOPPED', st.run.bets ? st.run.stake : st.run.stakeStart, null);
        st.reason = 'Run ended after missed draws. Waiting for an eligible BetZero Single prediction.';
    }
    if (st.phase === 'WAITING') {
        // Never replay a settled draw or create a new window without a valid pick.
        if (id <= Math.max(st.lastObserved || 0, st.history?.[0]?.end || 0)) return null;
        if (bet49Numbers(prediction?.betzeroSinglePick).length !== 1) { st.reason = 'Waiting for an eligible BetZero Single prediction'; return null; }
        const size = configuredWindow(records, id - 1, cfg);
        if (!size) { st.reason = `Need at least two BetZero Single gaps at win level ${cfg.gapLosses} in the current history.`; return null; }
        const stakeStart = Math.ceil(cfg.baseStake * cfg.recoveryMultiplier ** st.doublings);
        if (!Number.isSafeInteger(stakeStart) || stakeStart < 1) { st.phase = 'PAUSED'; st.reason = 'Recovery stake exceeds the supported range. Review rollover settings.'; return null; }
        st.run = { recoveryMultiplier: cfg.recoveryMultiplier, sourcePolicy: SOURCE_POLICY, gapLosses: cfg.gapLosses, windowMode: cfg.windowMode, start: id, length: size.length, average: size.average, samples: size.samples, played: 0, bets: 0, stakeStart, stake: stakeStart, lastDraw: null };
        st.phase = 'PLAYING'; st.armedAt = null;
    }
    if (!Number.isSafeInteger(st.run.stake) || st.run.stake < 1) { st.phase = 'PAUSED'; st.reason = 'Rollover stake exceeds the supported range. Review settings.'; return null; }
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
        nextStartStake: Math.ceil(cfg.baseStake * cfg.recoveryMultiplier ** st.doublings), armedAt: st.armedAt,
        run: st.run ? { ...st.run, average: st.run.average } : null,
        plan: st.plan, profit: st.profit, completed: st.completed, lost: st.lost, history: st.history.slice(0, 20) };
}

module.exports = { ODDS, MAX_STEPS, normalize, config, state, reset, configure, enabled, observe, decide, placed, view, windowLength, rolled };
