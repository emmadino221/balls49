'use strict';
const { getTotalColorOutcome } = require('./total-color');
const aliases = { u4: 'betzero', color: 'rainbow', sum: 'hilo' };
const colorOf = n => n === 49 ? 'yellow' : n % 3 === 1 ? 'red' : n % 3 === 2 ? 'blue' : 'green';

function marketItems(pred, market, compareRainbow = false) {
    if (market === 'unified') {
        const source = aliases[pred.unifiedPick?.key] || pred.unifiedPick?.key;
        return source && source !== 'unified' ? marketItems(pred, source) : [];
    }
    if (market === 'betzero') return pred.betzeroStatus === 'ACTIVE'
        ? (pred.unlikely4 || []).map(item => ({ value: Number(item.number), type: 'number', rule: 'absent' })) : [];
    if (market === 'bet49') return Number.isInteger(pred.bet49Pick) && pred.bet49Pick > 0 && pred.bet49Pick <= 49
        ? [{ value: pred.bet49Pick, type: 'number', rule: 'present' }] : [];
    if (market === 'rainbow' && compareRainbow) return ['red', 'blue', 'green'].map(value => ({
        value, type: 'color', rule: 'twoPlus',
        selected: pred.rainbowStatus === 'ACTIVE' && pred.topColor?.name === value,
    }));
    if (market === 'rainbow') return pred.rainbowStatus === 'ACTIVE'
        ? [{ value: pred.topColor?.name, type: 'color', rule: 'twoPlus' }] : [];
    if (market === 'totalColor' || market === 'totalColor2' || market === 'totalColor1') {
        const prediction = market === 'totalColor' ? pred.totalColorPred : market === 'totalColor1' ? pred.totalColor1Pred : pred.totalColor2Pred;
        return prediction?.status === 'ACTIVE'
            ? (prediction.topColors || prediction.top2 || prediction.top1 || []).map(value => ({ value, type: 'color', rule: 'winner' })) : [];
    }
    return market === 'hilo' && pred.hiloStatus === 'ACTIVE'
        ? [{ value: pred.sumRange, type: 'range', rule: 'range' }] : [];
}

function analyzeMarket(pred, market, records, drawId) {
    const seen = new Set();
    const sample = records.filter(record => {
        const id = Number(record.drawId);
        if (!record.result || !Number.isSafeInteger(id) || id >= Number(drawId) || seen.has(id)) return false;
        seen.add(id);
        return true;
    }).sort((a, b) => Number(b.drawId) - Number(a.drawId)).slice(0, 100);
    const validBalls = sample.map(record => record.result.balls).filter(balls =>
        Array.isArray(balls) && balls.length === 6 && new Set(balls).size === 6
        && balls.every(n => Number.isInteger(n) && n >= 1 && n <= 49));
    const descriptions = { absent: 'Draws without this number', present: 'Draws containing this number',
        twoPlus: 'Draws with at least two balls of this color', winner: 'Draws with this winning color outcome', range: 'Draws in this total range' };
    const items = marketItems(pred, market, market === 'rainbow').filter(item => item.type === 'number'
        ? Number.isInteger(item.value) && item.value >= 1 && item.value <= 49
        : item.type === 'color' ? ['red', 'blue', 'green', 'black'].includes(item.value)
            : ['HIGH', 'LOW'].includes(item.value)).map(item => {
        const count = validBalls.filter(balls => {
            if (item.rule === 'absent') return !balls.includes(item.value);
            if (item.rule === 'present') return balls.includes(item.value);
            if (item.rule === 'twoPlus') return balls.filter(n => colorOf(n) === item.value).length >= 2;
            if (item.rule === 'winner') return getTotalColorOutcome(balls) === item.value;
            const sum = balls.reduce((a, b) => a + b, 0);
            return item.value === 'HIGH' ? sum >= 152 : sum <= 148;
        }).length;
        return { value: item.value, type: item.type, color: item.type === 'number' ? colorOf(item.value) : item.type === 'color' ? item.value : null,
            ...(market === 'rainbow' ? { selected: item.selected === true } : {}),
            description: descriptions[item.rule], count, sampleSize: validBalls.length,
            support: validBalls.length ? Math.round(count / validBalls.length * 100) : null };
    });
    const outcomes = sample.map(record => record.result[market]).filter(value => ['WIN', 'LOSS'].includes(value));
    const wins = outcomes.filter(value => value === 'WIN').length;
    return { market, items, wins, losses: outcomes.length - wins, settled: outcomes.length,
        recentWinRate: outcomes.length ? Math.round(wins / outcomes.length * 100) : null,
        recentResults: outcomes.slice(0, 12), historyDraws: sample.length };
}
module.exports = { analyzeMarket };
