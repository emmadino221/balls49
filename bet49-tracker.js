'use strict';
// Keeps what Bet49 LONGEST_GAP_V1 needs between draws and restarts: its own rolling record of
// recent results (the collector's list is cleared at the daily reset; the 100-draw window must
// not be) and the number currently being played until it appears.
const fs = require('fs');
const { predictBet49LongestGap, bet49Draw, BET49_GAP_WINDOW } = require('./bet49');
const KEEP = BET49_GAP_WINDOW + 50;

function createBet49Tracker(file) {
    let state = { draws: {}, lock: null };
    try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (saved && typeof saved.draws === 'object') state = { draws: saved.draws, lock: saved.lock || null };
    } catch {}
    const save = () => {
        try { fs.writeFileSync(file + '.tmp', JSON.stringify(state)); fs.renameSync(file + '.tmp', file); }
        catch (error) { console.error('[Bet49] Could not save tracker state:', error.message); }
    };
    function observe(draws) {
        let changed = false;
        for (const draw of Array.isArray(draws) ? draws : []) {
            const id = Number(draw?.id), balls = bet49Draw(draw);
            if (!Number.isSafeInteger(id) || id <= 0 || !balls) continue;
            const dr = balls.join(',');
            if (state.draws[id] !== dr) { state.draws[id] = dr; changed = true; }
        }
        const ids = Object.keys(state.draws).map(Number).sort((a, b) => b - a);
        if (ids.length > KEEP) { for (const id of ids.slice(KEEP)) delete state.draws[id]; changed = true; }
        if (changed) save();
        return changed;
    }
    function predict(draws, targetDrawId) {
        observe(draws);
        const records = Object.entries(state.draws).map(([id, dr]) => ({ id: Number(id), dr }));
        const result = predictBet49LongestGap(records, targetDrawId, state.lock);
        // A skip (e.g. missing draws after downtime) keeps the number being played.
        if (result.status === 'ACTIVE' && JSON.stringify(result.lock) !== JSON.stringify(state.lock)) { state.lock = result.lock; save(); }
        return result;
    }
    return { observe, predict, lock: () => state.lock, size: () => Object.keys(state.draws).length };
}
module.exports = { createBet49Tracker };
