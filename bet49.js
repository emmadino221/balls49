'use strict';

// Main Bet49: same selection calculation as the single-number Lab experiment,
// but graded as appearance by the existing Bet49 settlement path.
function predictBet49SmallestAdd10(draws, targetDrawId) {
    const target = Number(targetDrawId);
    const strategy = 'SMALLEST_ADD10_APPEARANCE_V1';
    const skip = reason => ({ status: 'SKIP', numbers: [], reason, strategy });
    if (!Number.isSafeInteger(target) || target <= 1) return skip('Invalid target draw');
    const sources = (Array.isArray(draws) ? draws : []).filter(draw => Number(draw?.id) === target - 1);
    if (!sources.length) return skip('Previous completed draw is missing');
    let previous;
    for (const draw of sources) {
        const balls = typeof draw.dr === 'string' ? draw.dr.split(',').map(Number) : [];
        if (balls.length !== 6 || new Set(balls).size !== 6 || balls.some(n => !Number.isInteger(n) || n < 1 || n > 49))
            return skip('Previous completed draw is invalid');
        const sorted = [...balls].sort((a,b) => a-b);
        if (previous && previous.some((n,i) => n !== sorted[i])) return skip('Conflicting previous draw results');
        previous = sorted;
    }
    const number = previous[0] + 10;
    if (number > 49) return skip('Smallest number plus 10 exceeds 49');
    return { status: 'ACTIVE', numbers: [number], reason: '', strategy, sourceDrawId: target - 1, smallest: previous[0] };
}

// Main Bet49 (LONGEST_GAP_V1). Over the 100 draws before the target, each number has a
// longest run of draws without appearing and a current run since it last appeared.
// Numbers are ranked by longest run (then current run, then lowest number); the first whose
// current run is at least half its longest run is played, one number, graded on appearance.
// Once chosen it is kept, whatever its ranking, until it appears; then a new number is chosen.
const BET49_GAP_STRATEGY = 'LONGEST_GAP_V1', BET49_GAP_WINDOW = 100;
function bet49Draw(draw) {
    const balls = typeof draw?.dr === 'string' ? draw.dr.split(',').map(Number) : Array.isArray(draw?.balls) ? draw.balls.map(Number) : [];
    return balls.length === 6 && new Set(balls).size === 6 && balls.every(n => Number.isInteger(n) && n >= 1 && n <= 49) ? balls : null;
}
function bet49Gaps(draws, targetDrawId) {
    const target = Number(targetDrawId), first = target - BET49_GAP_WINDOW;
    const byId = new Map();
    for (const draw of Array.isArray(draws) ? draws : []) {
        const id = Number(draw?.id);
        if (!Number.isSafeInteger(id) || id < first || id >= target) continue;
        const balls = bet49Draw(draw);
        if (!balls) return { error: `Draw ${id} has an invalid result` };
        if (byId.has(id) && byId.get(id).some(n => !balls.includes(n))) return { error: `Draw ${id} has conflicting results` };
        byId.set(id, balls);
    }
    if (byId.size !== BET49_GAP_WINDOW) return { error: `Need the last ${BET49_GAP_WINDOW} draws (have ${byId.size})` };
    const longest = Array(50).fill(0), current = Array(50).fill(0), seenAt = Array(50).fill(null);
    for (let id = first; id < target; id++) {
        const balls = byId.get(id);
        for (let n = 1; n <= 49; n++) {
            if (balls.includes(n)) { current[n] = 0; seenAt[n] = id; }
            else longest[n] = Math.max(longest[n], ++current[n]);
        }
    }
    return { longest, current, seenAt, byId };
}
function predictBet49LongestGap(draws, targetDrawId, lock = null) {
    const target = Number(targetDrawId);
    const skip = reason => ({ status: 'SKIP', numbers: [], reason, strategy: BET49_GAP_STRATEGY, lock: null });
    if (!Number.isSafeInteger(target) || target <= BET49_GAP_WINDOW) return skip('Invalid target draw');
    const gaps = bet49Gaps(draws, target);
    if (gaps.error) return skip(gaps.error);
    const { longest, current, seenAt } = gaps;
    const facts = (number, since, kept) => ({ status: 'ACTIVE', numbers: [number], reason: '', strategy: BET49_GAP_STRATEGY,
        longestStreak: longest[number], currentStreak: current[number], playingSince: since, kept,
        lock: { number, since } });
    // Keep the number being played until it has appeared in a draw since it was first played.
    const held = Number(lock?.number), since = Number(lock?.since);
    if (Number.isInteger(held) && held >= 1 && held <= 49 && Number.isSafeInteger(since) && since <= target
        && since >= target - BET49_GAP_WINDOW && !(seenAt[held] !== null && seenAt[held] >= since)) {
        return facts(held, since, true);
    }
    const ranked = Array.from({ length: 49 }, (_, i) => i + 1)
        .sort((a, b) => longest[b] - longest[a] || current[b] - current[a] || a - b);
    const chosen = ranked.find(n => current[n] > 0 && current[n] * 2 >= longest[n]);
    return chosen ? facts(chosen, target, false) : skip('No number has been missing for half its longest streak');
}

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
    return numbers.length >= 4 ? { status: 'ACTIVE', numbers, counts, reason: '' }
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
module.exports = { predictBet49, predictBet49SmallestAdd10, predictBet49LongestGap, bet49Gaps, bet49Draw, BET49_GAP_STRATEGY, BET49_GAP_WINDOW, bet49Numbers };
