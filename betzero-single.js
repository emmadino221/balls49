'use strict';
// BetZero Single uses the saved Smallest +10 Lab prediction. Legacy records retain their Bet49-derived pick.
const { bet49Numbers } = require('./bet49');

function pick(bet49) {
    const numbers = bet49Numbers(bet49);
    return numbers.length === 1 ? numbers[0] : 'SKIP';
}
function outcome(bet49, result) {
    if (!result || typeof result !== 'object') return 'PENDING';
    const number = pick(bet49), balls = Array.isArray(result.balls) ? result.balls.map(Number) : [];
    if (number === 'SKIP' || balls.length !== 6) return 'SKIP';
    return balls.includes(number) ? 'LOSS' : 'WIN';
}
// Adds predicted.betzeroSingle and, once settled, result.betzeroSingle. Returns the record.
function recordPick(record) {
    return Object.hasOwn(record?.predicted || {}, 'betzeroSingle')
        ? pick(record.predicted.betzeroSingle) : pick(record?.predicted?.bet49);
}
function fromLab(record, targetDrawId, now = Date.now()) {
    const target = Number(targetDrawId), predictedAt = Date.parse(record?.predictedAt);
    if (!Number.isSafeInteger(target) || target <= 1 || !record
        || record.strategyId !== 'simple_smallest_number_add_10' || record.version !== '1.0.0'
        || !record.enabled || record.status !== 'PENDING'
        || Number(record.targetDrawId) !== target || Number(record.sourceDrawId) !== target - 1
        || !record.predictionId || !Number.isFinite(predictedAt) || !Number.isFinite(now)
        || !Number.isFinite(record.deadline) || predictedAt > now || predictedAt >= record.deadline
        || now >= record.deadline || !Array.isArray(record.selections) || record.selections.length !== 1
        || !Number.isInteger(record.selections[0]) || record.selections[0] < 1 || record.selections[0] > 49) return 'SKIP';
    return record.selections[0];
}
function enrich(record) {
    if (!record || typeof record !== 'object' || !record.predicted || typeof record.predicted !== 'object') return record;
    record.predicted.betzeroSingle = recordPick(record);
    if (record.result && typeof record.result === 'object') record.result.betzeroSingle = outcome(record.predicted.betzeroSingle, record.result);
    return record;
}
module.exports = { pick, outcome, enrich, recordPick, fromLab };
