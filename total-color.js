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
    const skipped = { status: 'SKIP', topColors: [], noWinColor: null, confidence: 0, gap: 0,
        selectionRule: 'EXCLUDE_PREVIOUS_OUTCOME', skipReason: 'Previous completed draw unavailable' };
    if (!Number.isSafeInteger(target) || target <= 0 || !Array.isArray(draws)) return skipped;
    const previous = draws.find(draw => Number(draw?.id) === target - 1);
    const numbers = typeof previous?.dr === 'string' ? previous.dr.split(',').map(Number) : [];
    const outcome = getTotalColorOutcome(numbers);
    if (!outcome) return skipped;
    return {
        status: 'ACTIVE', topColors: OUTCOMES.filter(color => color !== outcome), noWinColor: outcome,
        confidence: 0, gap: 0, selectionRule: 'EXCLUDE_PREVIOUS_OUTCOME', sourceDrawId: String(previous.id)
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

function singleColorPrediction(threeWay) {
    const targets = getTotalColorTargets(threeWay);
    const excluded = OUTCOMES.filter(color => !targets.includes(color));
    return targets.length === 3 && excluded.length === 1
        ? { status: 'ACTIVE', top1: excluded }
        : { status: 'SKIP', top1: [] };
}

function singleColorWins(prediction, numbers) {
    const outcome = getTotalColorOutcome(numbers);
    return prediction?.status === 'ACTIVE' && prediction.top1?.length === 1
        && outcome !== null && prediction.top1[0] === outcome;
}

module.exports = { getTotalColorOutcome, applyPreviousDrawRule, getTotalColorTargets, totalColorWins, totalColorName, singleColorPrediction, singleColorWins };
