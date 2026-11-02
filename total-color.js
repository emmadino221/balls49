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

function totalColor3WayPrediction(twoWayPrediction) {
    const skipped = { status: 'SKIP', topColors: [], noWinColor: null, confidence: 0, gap: 0,
        selectionRule: 'TOTAL_COLOR_2_WAY_PLUS_NO_WIN', skipReason: 'Total Color 2-way is not active' };
    const top2 = twoWayPrediction?.top2;
    if (twoWayPrediction?.status !== 'ACTIVE' || !Array.isArray(top2) || top2.length !== 2
        || new Set(top2).size !== 2 || top2.some(color => !COLORS.includes(color))) return skipped;
    const noWinColor = COLORS.find(color => !top2.includes(color));
    return {
        status: 'ACTIVE', topColors: [...top2, 'black'], noWinColor,
        confidence: Number.isFinite(twoWayPrediction.confidence) ? twoWayPrediction.confidence : 0,
        gap: Number.isFinite(twoWayPrediction.gap) ? twoWayPrediction.gap : 0,
        selectionRule: 'TOTAL_COLOR_2_WAY_PLUS_NO_WIN'
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

module.exports = { getTotalColorOutcome, totalColor3WayPrediction, getTotalColorTargets, totalColorWins, totalColorName, singleColorPrediction, singleColorWins };
