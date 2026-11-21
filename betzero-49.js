'use strict';
// BetZero 49 (Lab research): the main Bet49 rule (LONGEST_GAP_V1), taking four numbers instead
// of one, graded as BetZero (a win when none of the four is drawn).
//
// Over the 100 draws before the target, each number has a longest run of draws without
// appearing and a current run since it last appeared. Numbers are ranked by longest run, then
// current run, then lowest number. A number qualifies when its current run is at least half its
// longest. Each chosen number is kept until it appears in a draw; then its place goes to the
// next qualifying number in the ranking. Fewer than four numbers available: no prediction.
const { bet49Draw, BET49_GAP_WINDOW } = require('./bet49');

const ID = 'betzero_49', VERSION = '1.0.0', COUNT = 4;
// Live predictions replay the rule over this many draws before the target, so the kept numbers
// match what a continuous run would hold.
const REPLAY = 400;

// The same counts as bet49Gaps (longest and current run without appearing, last draw seen) for
// the 100 draws before the target, from a Map(id -> balls). Faster: work from each number's appearances.
function gapsFrom(byId, target) {
    const first = target - BET49_GAP_WINDOW;
    for (let id = first; id < target; id++) if (!byId.has(id)) return { error: `Need the last ${BET49_GAP_WINDOW} draws (draw ${id} is missing)` };
    const longest = Array(50).fill(0), current = Array(50).fill(0), seenAt = Array(50).fill(null), last = Array(50).fill(first - 1);
    for (let id = first; id < target; id++) for (const n of byId.get(id)) {
        longest[n] = Math.max(longest[n], id - last[n] - 1); last[n] = id; seenAt[n] = id;
    }
    for (let n = 1; n <= 49; n++) { current[n] = target - 1 - last[n]; longest[n] = Math.max(longest[n], current[n]); }
    return { longest, current, seenAt };
}
function drawMap(draws) {
    const byId = new Map();
    for (const draw of draws) {
        const id = Number(draw?.id), balls = bet49Draw(draw);
        if (!Number.isSafeInteger(id) || !balls) continue;
        if (byId.has(id) && byId.get(id).some(n => !balls.includes(n))) byId.set(id, null);   // conflicting results: unusable
        else if (!byId.has(id)) byId.set(id, balls);
    }
    for (const [id, balls] of byId) if (!balls) byId.delete(id);
    return byId;
}

function decide(draws, targetDrawId, locks = []) {
    const target = Number(targetDrawId);
    const gaps = gapsFrom(draws instanceof Map ? draws : drawMap(draws), target);
    if (gaps.error) return { status: 'SKIP', selections: [], conditions: { reason: gaps.error }, locks };
    const { longest, current, seenAt } = gaps;
    // A number is kept while it has not appeared since it was chosen (and was chosen within the window).
    const kept = (Array.isArray(locks) ? locks : []).filter(lock => Number.isInteger(lock?.number) && lock.number >= 1 && lock.number <= 49
        && Number.isSafeInteger(lock.since) && lock.since <= target && lock.since >= target - BET49_GAP_WINDOW
        && !(seenAt[lock.number] !== null && seenAt[lock.number] >= lock.since)).slice(0, COUNT);
    const held = new Set(kept.map(lock => lock.number));
    const ranked = Array.from({ length: 49 }, (_, i) => i + 1)
        .sort((a, b) => longest[b] - longest[a] || current[b] - current[a] || a - b);
    const added = ranked.filter(n => !held.has(n) && current[n] > 0 && current[n] * 2 >= longest[n])
        .slice(0, COUNT - kept.length).map(number => ({ number, since: target }));
    const chosen = [...kept, ...added];
    const picks = chosen.map(lock => ({ number: lock.number, longestStreak: longest[lock.number], currentStreak: current[lock.number],
        playingSince: lock.since, kept: held.has(lock.number) }));
    if (chosen.length < COUNT) {
        // Not played, so only numbers already being played stay kept.
        return { status: 'SKIP', selections: [], locks: kept,
            conditions: { reason: `Only ${chosen.length} of ${COUNT} numbers have been missing for half their longest streak`, picks, model: 'BET49_LONGEST_GAP_FOUR' } };
    }
    return { status: 'PENDING', selections: chosen.map(lock => lock.number), locks: chosen,
        conditions: { picks, window: BET49_GAP_WINDOW, model: 'BET49_LONGEST_GAP_FOUR' } };
}

// Replays the rule over consecutive draws ({ id, balls }, any order) and returns
// Map(targetId -> prediction) for every draw from `from` on, carrying the kept numbers forward.
function simulate(draws, { from = -Infinity, through = Infinity } = {}) {
    const byId = drawMap(draws), ids = [...byId.keys()];
    const out = new Map();
    if (!ids.length) return out;
    let locks = [];
    const first = Math.min(...ids) + BET49_GAP_WINDOW, last = Math.min(Math.max(...ids) + 1, through);
    for (let target = first; target <= last; target++) {
        const prediction = decide(byId, target, locks);
        locks = prediction.locks;
        if (target >= from) out.set(target, { status: prediction.status, selections: prediction.selections, conditions: prediction.conditions });
    }
    return out;
}

// The prediction for one target, from the draws stored before it.
function predict(draws, targetDrawId) {
    const target = Number(targetDrawId);
    const recent = draws.filter(d => d.id < target && d.id >= target - REPLAY - BET49_GAP_WINDOW);
    return simulate(recent, { from: target, through: target }).get(target)
        || { status: 'SKIP', selections: [], conditions: { reason: `Need the last ${BET49_GAP_WINDOW} draws` } };
}

module.exports = { ID, VERSION, COUNT, REPLAY, decide, simulate, predict, gapsFrom, drawMap };
