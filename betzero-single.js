'use strict';
// BetZero Single: the Bet49 number played on BetZero, which wins when that number is NOT drawn.
// Derived from the Bet49 prediction and the drawn balls, so older records get it too.
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
function enrich(record) {
    if (!record || typeof record !== 'object' || !record.predicted || typeof record.predicted !== 'object') return record;
    record.predicted.betzeroSingle = pick(record.predicted.bet49);
    if (record.result && typeof record.result === 'object') record.result.betzeroSingle = outcome(record.predicted.bet49, record.result);
    return record;
}
module.exports = { pick, outcome, enrich };
