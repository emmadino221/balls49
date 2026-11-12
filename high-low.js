'use strict';
const minmax = require('./betzero-minmax');

// This is a deterministic historical signal, not a calibrated win probability.
function predictHighLow(draws, targetDrawId) {
    const unavailable = { status: 'SKIP', range: null, reason: 'No valid completed draw history', analysis: null };
    const target = Number(targetDrawId);
    if (!Array.isArray(draws) || !Number.isSafeInteger(target) || target <= 0) return unavailable;
    const seen = new Set();
    const history = draws.flatMap(draw => {
        const id = Number(draw?.id);
        const numbers = typeof draw?.dr === 'string' ? draw.dr.split(',').map(Number) : [];
        if (!Number.isSafeInteger(id) || id <= 0 || id >= target || seen.has(id)
            || numbers.length !== 6 || new Set(numbers).size !== 6
            || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 49)) return [];
        seen.add(id);
        const total = numbers.reduce((sum, n) => sum + n, 0);
        return [{ id, total, range: total <= 148 ? 'LOW' : total <= 151 ? 'MID' : 'HIGH' }];
    }).sort((a, b) => b.id - a.id).slice(0, 100);
    if (!history.length) return unavailable;

    const windows = [{ size: 20, weight: 0.5 }, { size: 50, weight: 0.3 }, { size: 100, weight: 0.2 }]
        .map(({ size, weight }) => {
            const sample = history.slice(0, size);
            const high = sample.filter(draw => draw.range === 'HIGH').length;
            const low = sample.filter(draw => draw.range === 'LOW').length;
            // Ten neutral pseudo-observations temper very small samples. MID
            // stays in the denominator because it loses for either binary pick.
            return { size, weight, samples: sample.length, high, low,
                mid: sample.length - high - low, balance: (high - low) / (sample.length + 10) };
        });
    const balance = windows.reduce((sum, window) => sum + window.balance * window.weight, 0);
    // A fixed LOW tie-break avoids a skip without claiming a directional edge.
    const range = balance > 0 ? 'HIGH' : 'LOW';
    return { status: 'ACTIVE', range, reason: '', analysis: {
        method: 'ROLLING_HIGH_LOW_V1', samples: history.length, sourceDrawId: String(history[0].id),
        windows, balance, tieBreak: balance === 0 ? 'LOW' : null
    } };
}

function predictHighLowFromBet49(prediction) {
    const numbers = prediction?.numbers;
    if (prediction?.status !== 'ACTIVE' || !Array.isArray(numbers) || numbers.length !== 6
        || new Set(numbers).size !== 6 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 49)) {
        return { status: 'SKIP', range: null, reason: 'High/Low needs exactly six active Bet49 numbers', analysis: null };
    }
    const total = numbers.reduce((sum, number) => sum + number, 0);
    const analysis = { method: 'BET49_SIX_NUMBER_SUM_V1', total, numbers: [...numbers] };
    if (total >= 149 && total <= 151) {
        return { status: 'SKIP', range: null, reason: 'Bet49 total is in the middle range (149-151)', analysis };
    }
    return { status: 'ACTIVE', range: total <= 148 ? 'LOW' : 'HIGH', reason: '', analysis };
}

// The High/Low result of one draw: the six balls total 148 or less (LOW), 149-151 (MID) or 152+ (HIGH).
function highLowRange(balls) {
    if (!Array.isArray(balls) || balls.length !== 6 || new Set(balls).size !== 6
        || balls.some(n => !Number.isInteger(n) || n < 1 || n > 49)) return null;
    const total = balls.reduce((sum, n) => sum + n, 0);
    return total <= 148 ? 'LOW' : total <= 151 ? 'MID' : 'HIGH';
}

// A HIGH or LOW pick wins only when the draw lands in that range; MID loses for either pick.
function gradeHighLow(pick, balls) {
    const range = highLowRange(balls);
    if (!range || (pick !== 'HIGH' && pick !== 'LOW')) return 'INVALID';
    return range === pick ? 'WIN' : 'LOSS';
}

// The Lab's HIGH/LOW rule: follow Minimum/Maximum v2. MAX gives LOW, MIN gives HIGH.
const highLowForMethod = method => method === 'MAX' ? 'LOW' : method === 'MIN' ? 'HIGH' : null;

const MINMAX_SKIP_TEXT = {
    INSUFFICIENT_HISTORY: 'Minimum/Maximum v2 needs five completed draw pairs first',
    BOTH_METHODS_WIN: 'Minimum/Maximum v2 has no starting method (both methods won)',
    NO_STARTING_METHOD: 'Minimum/Maximum v2 has no starting method',
    BOUNDARY: 'Minimum/Maximum v2 skipped: the number is 1 or 49',
    INVALID_SOURCE: 'The previous draw result is not available yet'
};

// Continues from the Lab's own running Minimum/Maximum v2 state, so the pick is the one the
// Lab makes for the same draw, without waiting for the Lab. Returns null when that state
// cannot be used (missing, out of date, or an older prediction is still unsettled).
function pickFromLabState(labState, byId, last, pairs, target) {
    const asOf = Number(labState?.asOfDrawId);
    if (!labState?.active || (asOf !== target && asOf !== target - 1) || target <= Number(labState.afterTargetId)) return null;
    let state = { method: labState.method || null, pending: labState.pending ?? null };
    if (state.pending === target) {
        // The Lab has already predicted this draw.
        const selections = minmax.candidate(last.balls, state.method);
        return selections && { status: 'PENDING', selections, conditions: { method: state.method } };
    }
    if (state.pending === target - 1) {
        // The Lab's prediction for the draw that just finished: settle it the way the Lab will.
        const result = minmax.outcome(minmax.candidate(byId.get(target - 2)?.balls, state.method), last.balls);
        if (!result) return null;
        state = minmax.settle(state, target - 1, result, '2.0.0');
    } else if (state.pending !== null) return null;
    return minmax.decide(last, target, pairs.slice(-5), state, '2.0.0');
}

// Main High/Low prediction. Follows the Lab's running Minimum/Maximum v2 state when the
// website has sent it; otherwise replays Minimum/Maximum v2 over the completed draws (same
// rules as the Lab). Either way it follows the method used for the target draw.
function predictHighLowFromMinmax(draws, targetDrawId, labState = null) {
    const skip = (reason, analysis = null) => ({ status: 'SKIP', range: null, reason, analysis });
    const target = Number(targetDrawId);
    if (!Array.isArray(draws) || !Number.isSafeInteger(target) || target <= 0) return skip('No valid completed draw history');
    const byId = new Map();
    for (const draw of draws) {
        const id = Number(draw?.id);
        const balls = typeof draw?.dr === 'string' ? draw.dr.split(',').map(Number) : draw?.balls;
        if (!Number.isSafeInteger(id) || id <= 0 || id >= target || byId.has(id) || !highLowRange(balls)) continue;
        byId.set(id, { id, balls: [...balls] });
    }
    const history = [...byId.values()].sort((a, b) => a.id - b.id).slice(-300);
    const last = history[history.length - 1];
    if (!last || last.id !== target - 1) return skip(MINMAX_SKIP_TEXT.INVALID_SOURCE);
    const pairs = [];
    for (let i = 1; i < history.length; i++) {
        if (history[i - 1].id + 1 === history[i].id) pairs.push({ source: history[i - 1], target: history[i] });
    }
    const labPick = pickFromLabState(labState, byId, last, pairs, target);
    const pick = labPick || minmax.simulate([...pairs, { source: last, target: { id: target, balls: null } }], pairs, () => {}, '2.0.0').get(target);
    const analysis = { method: 'MINMAX_V2_HIGH_LOW_V1', sourceDrawId: String(last.id), samples: history.length,
        stateSource: labPick ? 'LAB' : 'REPLAY',
        minmaxMethod: pick.conditions.method || null, minmaxSelections: pick.selections, minmaxReason: pick.conditions.reason || null };
    if (pick.status !== 'PENDING') return skip(MINMAX_SKIP_TEXT[pick.conditions.reason] || 'Minimum/Maximum v2 has no prediction', analysis);
    return { status: 'ACTIVE', range: highLowForMethod(pick.conditions.method), reason: '', analysis };
}

// Retain the earlier functions for historical/offline callers only.
module.exports = { predictHighLow, predictHighLowFromBet49, predictHighLowFromMinmax, highLowForMethod, highLowRange, gradeHighLow };
