'use strict';

// targetDrawId prevents using the target or future results.
function predictBet49(draws, targetDrawId, totalColor2Prediction) {
    const target = Number(targetDrawId);
    const skip = reason => ({ status: 'SKIP', numbers: [], reason });
    const selectedColors = totalColor2Prediction?.top2;
    if (totalColor2Prediction?.status !== 'ACTIVE') return skip('Total Color 2-way is not active');
    if (!Array.isArray(selectedColors) || selectedColors.length !== 2
        || new Set(selectedColors).size !== 2
        || !selectedColors.every(color => ['red', 'blue', 'green'].includes(color))) {
        return skip('Total Color 2-way needs two valid colors');
    }
    if (!Number.isSafeInteger(target) || target <= 10) return skip('Need 10 completed draws');
    const window = new Map();
    for (const draw of Array.isArray(draws) ? draws : []) {
        const id = Number(draw?.id);
        if (!Number.isSafeInteger(id) || id < target - 10 || id >= target) continue;
        const balls = typeof draw.dr === 'string' ? draw.dr.split(',').map(Number) : [];
        if (balls.length !== 6 || new Set(balls).size !== 6 || balls.some(n => !Number.isInteger(n) || n < 1 || n > 49)) {
            return skip('Invalid result in the last 10 draws');
        }
        if (window.has(id) && window.get(id).some(n => !balls.includes(n))) return skip('Conflicting draw results');
        window.set(id, balls);
    }
    if (window.size !== 10) return skip('Need 10 consecutive completed draws');
    const colors = ['red', 'blue', 'green', 'yellow'];
    const colorOf = n => n === 49 ? 'yellow' : colors[(n - 1) % 3];
    const counts = Array(50).fill(0);
    const latest = Array(50).fill(0);
    for (const [id, balls] of window) for (const n of balls) {
        counts[n]++;
        latest[n] = Math.max(latest[n], id);
    }
    // Equal-recency candidates use ascending number order for stable picks.
    const numbers = Array.from({ length: 49 }, (_, i) => i + 1)
        .filter(n => counts[n] >= 2 && selectedColors.includes(colorOf(n)))
        .sort((a, b) => latest[b] - latest[a] || a - b).slice(0, 6);
    return numbers.length >= 4 ? { status: 'ACTIVE', numbers, reason: '' }
        : skip('Fewer than four eligible numbers');
}

// Accept legacy single-number records for settlement and history display.
function bet49Numbers(value) {
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    if (values.length > 6) return [];
    const numbers = values.map(Number);
    return numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 49)
        && new Set(numbers).size === numbers.length ? numbers : [];
}
module.exports = { predictBet49, bet49Numbers };
