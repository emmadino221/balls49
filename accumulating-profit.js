"use strict";
// Independent, opt-in recovery for the three ordinary single-selection markets.
const markets = { u4: 'betzero', color: 'rainbow', sum: 'hilo' };
function normalize(value = {}) {
    return Object.fromEntries(Object.values(markets).map(key => [key, value?.[key] === true]));
}
function quote(session, key, base, odds, step) {
    const market = markets[key];
    if (!market) return null;
    const state = session.martingaleState[key];
    // Never reinterpret losses from a recovery sequence that began under the old formula.
    if (!state.accumulatingCycle && session.config.accumulatingProfit?.[market] === true && step <= 1 && base > 0) {
        state.accumulatingCycle = { base, odds, losses: 0, count: 0, lastSettled: null };
    }
    const cycle = state.accumulatingCycle;
    if (!cycle) return null;
    const target = cycle.base * (cycle.odds - 1) + cycle.count * cycle.base;
    const stake = Math.ceil((cycle.losses + target) / (cycle.odds - 1) - 1e-9);
    return { stake: Number.isSafeInteger(stake) && stake > 0 ? stake : 0, odds: cycle.odds };
}
function settle(session, key, drawId, won, stake) {
    const state = session.martingaleState[key], cycle = state?.accumulatingCycle;
    if (!cycle || !markets[key] || !(Number(stake) > 0)) return;
    if (cycle.lastSettled !== null && Number(drawId) <= cycle.lastSettled) return;
    if (won) { delete state.accumulatingCycle; return; }
    cycle.losses += Number(stake);
    cycle.count++;
    cycle.lastSettled = Number(drawId);
}
module.exports = { normalize, quote, settle };
