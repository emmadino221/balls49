'use strict';

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

module.exports = { predictHighLow };
