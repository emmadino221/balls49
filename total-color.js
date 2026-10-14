'use strict';

const COLORS = ['red', 'blue', 'green'];
const OUTCOMES = [...COLORS, 'black'];

function getTotalColorOutcome(numbers) {
    // A completed Balls49 draw contains six distinct numbers. Missing or partial
    // results must never be interpreted as a tie.
    if (!Array.isArray(numbers) || numbers.length !== 6 || new Set(numbers).size !== 6
        || numbers.some(number => !Number.isInteger(number) || number < 1 || number > 49)) return null;
    const counts = { red: 0, blue: 0, green: 0 };
    for (const number of numbers) {
        if (number !== 49) counts[COLORS[(number - 1) % 3]] += 1;
    }
    const max = Math.max(...Object.values(counts));
    const winners = COLORS.filter(color => counts[color] === max);
    return winners.length === 1 ? winners[0] : 'black';
}

function applyPreviousDrawRule(prediction, draws, targetDrawId) {
    const target = Number(targetDrawId);
    if (!Number.isSafeInteger(target) || target <= 0 || !Array.isArray(draws)) return prediction;
    const previous = draws.find(draw => Number(draw?.id) === target - 1);
    const numbers = typeof previous?.dr === 'string' ? previous.dr.split(',').map(Number) : [];
    if (getTotalColorOutcome(numbers) !== 'black') return prediction;
    return {
        ...prediction, status: 'ACTIVE', topColors: [...COLORS], noWinColor: 'black',
        selectionRule: 'AFTER_DRAW', sourceDrawId: String(previous.id)
    };
}

function getTotalColorTargets(prediction) {
    if (prediction?.status !== 'ACTIVE' || !Array.isArray(prediction.topColors)) return [];
    const targets = [...prediction.topColors];
    // Legacy records store two colors; their third selection was always DRAW.
    if (targets.length === 2 && targets.every(color => COLORS.includes(color))) targets.push('black');
    if (targets.length !== 3 || new Set(targets).size !== 3
        || targets.some(color => !OUTCOMES.includes(color)) || targets.includes(prediction.noWinColor)) return [];
    return targets;
}

function totalColorWins(prediction, numbers) {
    const outcome = getTotalColorOutcome(numbers);
    return outcome !== null && getTotalColorTargets(prediction).includes(outcome);
}

function totalColorName(color) {
    return color === 'black' ? 'NO WINNING COLOR' : String(color || '').toUpperCase();
}

module.exports = { getTotalColorOutcome, applyPreviousDrawRule, getTotalColorTargets, totalColorWins, totalColorName };
