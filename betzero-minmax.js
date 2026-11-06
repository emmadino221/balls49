'use strict';

// User-specified research rules. No production or database dependencies.
const ID = 'minimum_maximum_three';
const valid = balls => Array.isArray(balls) && balls.length === 6 && new Set(balls).size === 6
    && balls.every(n => Number.isInteger(n) && n >= 1 && n <= 49);
const opposite = method => method === 'MIN' ? 'MAX' : 'MIN';
function candidate(balls, method) {
    if (!valid(balls) || !['MIN', 'MAX'].includes(method)) return null;
    const n = method === 'MIN' ? Math.min(...balls) : Math.max(...balls);
    return n === 1 || n === 49 ? null : [n - 1, n, n + 1];
}
function outcome(selections, balls) {
    if (!selections || !valid(balls)) return null;
    return selections.some(n => balls.includes(n)) ? 'LOSS' : 'WIN';
}
function decide(source, targetId, history, state = {}) {
    const skip = (reason, extra = {}) => ({ status: 'SKIP', selections: [], conditions: { reason, ...extra } });
    if (state.paused) return skip('RESULT_CONFLICT_REVIEW_REQUIRED');
    if (state.pending) return skip('UNRESOLVED_PREDICTION');
    if (!valid(source.balls) || source.id + 1 !== targetId) return skip('INVALID_SOURCE');
    let method = state.method;
    let evidence = [];
    if (!method) {
        evidence = history.filter(p => p.source.id + 1 === p.target.id && p.target.id < targetId
            && valid(p.source.balls) && valid(p.target.balls)).slice(-5).map(p => ({
                sourceDrawId: p.source.id, targetDrawId: p.target.id,
                MIN: outcome(candidate(p.source.balls, 'MIN'), p.target.balls),
                MAX: outcome(candidate(p.source.balls, 'MAX'), p.target.balls)
            }));
        if (evidence.length < 5) return skip('INSUFFICIENT_HISTORY', { evidence });
        for (const row of evidence.slice().reverse()) {
            if (row.MIN === 'WIN' && row.MAX === 'WIN') return skip('BOTH_METHODS_WIN', { evidence });
            if (row.MIN === 'WIN') { method = 'MAX'; break; }
            if (row.MAX === 'WIN') { method = 'MIN'; break; }
        }
        if (!method) return skip('NO_STARTING_METHOD', { evidence });
    }
    const selections = candidate(source.balls, method);
    if (!selections) return skip('BOUNDARY', { method, evidence });
    return { status: 'PENDING', selections, conditions: { method, evidence, model: 'MINIMUM_MAXIMUM_THREE_V1' } };
}
function afterDecision(state, pick, targetId) {
    if (pick.status === 'PENDING') return { ...state, method: pick.conditions.method, pending: targetId };
    if (['BOUNDARY', 'BOTH_METHODS_WIN', 'NO_STARTING_METHOD', 'INSUFFICIENT_HISTORY'].includes(pick.conditions.reason))
        return { ...state, method: null };
    return state;
}
function settle(state, targetId, result) {
    if (state.paused || state.pending !== targetId || !['WIN', 'LOSS'].includes(result)) return state;
    return { ...state, pending: null, method: result === 'WIN' ? opposite(state.method) : state.method, lastSettled: targetId };
}
function simulate(opportunities, context, onProgress = () => {}) {
    let state = {};
    let cursor = 0;
    const history = [];
    const picks = new Map();
    for (const [index, p] of opportunities.entries()) {
        while (cursor < context.length && context[cursor].target.id < p.target.id) {
            history.push(context[cursor++]);
            if (history.length > 5) history.shift();
        }
        const pick = decide(p.source, p.target.id, history, state);
        picks.set(p.target.id, pick);
        state = afterDecision(state, pick, p.target.id);
        if (pick.status === 'PENDING') state = settle(state, p.target.id, outcome(pick.selections, p.target.balls));
        if (index % 100 === 0) onProgress(index / Math.max(1, opportunities.length));
    }
    return picks;
}
module.exports = { ID, candidate, outcome, decide, afterDecision, settle, simulate };
