'use strict';

const { randomInt } = require('crypto');
const { predictBet49SmallestAdd10 } = require('./bet49');
// Accept only the persisted Lab record returned by the authenticated feed receiver.
function predictBetZeroFromLab(record, targetDrawId, now = Date.now()) {
    const strategy = 'LAB_STREAK_ONE_EXACT_FOUR_V1';
    const skip = reason => ({ status: 'SKIP', numbers: [], strategy, reason });
    const target = Number(targetDrawId);
    if (!Number.isSafeInteger(target) || target <= 0) return skip('INVALID_TARGET_DRAW');
    if (!record) return skip('LAB_PREDICTION_UNAVAILABLE');
    if (record.strategyId !== 'statistics_streak_drop_betzero' || record.version !== '3.0.0'
        || Number(record.targetDrawId) !== target || Number(record.sourceDrawId) !== target - 1)
        return skip('LAB_PREDICTION_TARGET_OR_VERSION_MISMATCH');
    if (!record.enabled) return skip('LAB_STRATEGY_DISABLED');
    if (record.status !== 'PENDING') return skip(record.reason || 'LAB_PREDICTION_NOT_PENDING');
    const predictedAt = Date.parse(record.predictedAt);
    if (!record.predictionId || !Number.isFinite(predictedAt) || !Number.isFinite(now)
        || !Number.isFinite(record.deadline) || predictedAt > now || predictedAt >= record.deadline
        || now >= record.deadline) return skip('LAB_PREDICTION_EXPIRED_OR_INVALID_TIMING');
    const numbers = record.selections;
    if (!Array.isArray(numbers) || numbers.length !== 4 || new Set(numbers).size !== 4
        || !numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 49))
        return skip('LAB_REQUIRES_EXACTLY_FOUR_NUMBERS');
    return { status: 'ACTIVE', numbers: [...numbers], strategy, reason: '',
        sourceDrawId: Number(record.sourceDrawId), conditions: {
            labPredictionId: record.predictionId, labStrategyId: record.strategyId,
            labVersion: record.version, labPredictedAt: record.predictedAt, deadline: record.deadline
        } };
}

function predictBetZeroStep10(draws, targetDrawId) {
    const first = predictBet49SmallestAdd10(draws, targetDrawId);
    const strategy = 'SMALLEST_ADD10_STEP10_FOUR_V1';
    if (first.status !== 'ACTIVE') return { ...first, strategy };
    const numbers = [...first.numbers];
    while (numbers.length < 4) numbers.push(((numbers.at(-1) - 1 + 10) % 49) + 1);
    return { ...first, numbers, strategy };
}

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

module.exports = { predictBetZero, predictBetZeroStep10, predictBetZeroFromLab };
