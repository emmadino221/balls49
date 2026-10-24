'use strict';

const { randomInt } = require('crypto');

// Only completed draws immediately before the target belong to this window.
function predictBetZero(draws, records, targetDrawId) {
    const target = Number(targetDrawId);
    const skip = { status: 'SKIP', numbers: [], poolSize: 0,
        reason: 'Need the last 10 consecutive valid completed draws for BetZero' };
    if (!Number.isSafeInteger(target) || target <= 10) return skip;
    const window = new Map();
    for (const draw of Array.isArray(draws) ? draws : []) {
        const id = Number(draw?.id);
        if (!Number.isSafeInteger(id) || id < target - 10 || id >= target) continue;
        const balls = typeof draw.dr === 'string' ? draw.dr.split(',').map(Number) : [];
        if (balls.length !== 6 || new Set(balls).size !== 6
            || !balls.every(n => Number.isInteger(n) && n >= 1 && n <= 49)) return skip;
        if (window.has(id)) {
            if (window.get(id).some(n => !balls.includes(n))) return skip;
        } else window.set(id, balls);
    }
    if (window.size !== 10) return skip;

    const counts = Array(50).fill(0);
    for (const balls of window.values()) for (const number of balls) counts[number]++;
    const eligible = Array.from({ length: 49 }, (_, i) => i + 1).filter(n => counts[n] <= 1);

    // Published picks survive restarts and skipped draws. Never use a future pick.
    const previous = (Array.isArray(records) ? records : []).filter(record => {
        const id = Number(record?.drawId);
        const picks = record?.predicted?.betzero;
        return Number.isSafeInteger(id) && id < target && Array.isArray(picks)
            && picks.length === 4 && new Set(picks).size === 4
            && picks.every(n => Number.isInteger(n) && n >= 1 && n <= 49);
    }).sort((a, b) => Number(b.drawId) - Number(a.drawId))[0];
    const numbers = (previous?.predicted.betzero || []).filter(n => counts[n] <= 1);
    const replacements = eligible.filter(n => !numbers.includes(n));
    while (numbers.length < 4 && replacements.length) {
        numbers.push(replacements.splice(randomInt(replacements.length), 1)[0]);
    }
    return numbers.length === 4
        ? { status: 'ACTIVE', numbers, poolSize: eligible.length, reason: '' }
        : { ...skip, poolSize: eligible.length, reason: 'Fewer than four eligible BetZero numbers' };
}

module.exports = { predictBetZero };
