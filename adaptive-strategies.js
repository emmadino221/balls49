'use strict';

const VERSION = 1;
const COLORS = ['red', 'blue', 'green'];
const ballColor = n => n === 49 ? 'yellow' : COLORS[(n - 1) % 3];
const validBalls = balls => Array.isArray(balls) && balls.length === 6 && new Set(balls).size === 6
    && balls.every(n => Number.isInteger(n) && n >= 1 && n <= 49);

function outcome(market, pick, balls) {
    if (!validBalls(balls) || pick === null) return null;
    if (market === 'betzero') {
        if (!Array.isArray(pick) || pick.length !== 4 || new Set(pick).size !== 4
            || !pick.every(n => Number.isInteger(n) && n >= 1 && n <= 49)) return null;
        return pick.every(n => !balls.includes(n));
    }
    if (!COLORS.includes(pick)) return null;
    return balls.filter(n => ballColor(n) === pick).length >= 2;
}

function chooseStrategy(market, records, targetId) {
    const seen = new Set();
    const history = records.filter(record => {
        const id = Number(record?.drawId);
        if (!Number.isSafeInteger(id) || id >= targetId || seen.has(id)
            || record.adaptiveStrategies?.version !== VERSION || !record.adaptiveStrategies[market]) return false;
        seen.add(id);
        return true;
    }).sort((a, b) => Number(b.drawId) - Number(a.drawId));
    const latest = history[0]?.adaptiveStrategies[market];
    const incumbent = latest?.selected === 'alternative' ? 'alternative' : 'current';
    const challenger = incumbent === 'current' ? 'alternative' : 'current';
    const lastSwitchDrawId = latest?.lastSwitchDrawId || String(targetId);
    const issuedSinceSwitch = history.filter(r => Number(r.drawId) >= Number(lastSwitchDrawId)).length;
    const pairs = [];
    let currentPicks = 0, alternativePicks = 0;
    // One shared window of settled draws; never choose a different time range
    // for each strategy or count a skip as a loss.
    const settled = history.filter(r => validBalls(r.result?.balls)).slice(0, 200);
    for (const record of settled) {
        const picks = record.adaptiveStrategies[market].candidates;
        const current = outcome(market, picks?.current ?? null, record.result.balls);
        const alternative = outcome(market, picks?.alternative ?? null, record.result.balls);
        if (current !== null) currentPicks++;
        if (alternative !== null) alternativePicks++;
        if (current !== null && alternative !== null) pairs.push({ current, alternative });
    }
    const advantage = sample => sample.length
        ? sample.reduce((sum, p) => sum + Number(p[challenger]) - Number(p[incumbent]), 0) / sample.length : 0;
    const longAdvantage = advantage(pairs);
    const recentAdvantage = advantage(pairs.slice(0, 50));
    const switched = pairs.length >= 100 && issuedSinceSwitch >= 20
        && longAdvantage >= 0.05 && recentAdvantage >= 0.05;
    return {
        selected: switched ? challenger : incumbent,
        lastSwitchDrawId: switched ? String(targetId) : lastSwitchDrawId,
        switched, reason: switched ? 'sustained_paired_advantage' : pairs.length < 100 ? 'collecting_live_samples' : 'keep_incumbent',
        comparison: { settledDraws: settled.length, pairedDraws: pairs.length, currentPicks, alternativePicks,
            challenger, longAdvantage, recentAdvantage, issuedSinceSwitch }
    };
}

function applyAdaptiveStrategies(pred, draws, records, targetDrawId) {
    const target = Number(targetDrawId);
    if (!Number.isSafeInteger(target) || target <= 0) return pred;
    const seen = new Set();
    const history = (Array.isArray(draws) ? draws : []).flatMap(draw => {
        const id = Number(draw?.id);
        const balls = typeof draw?.dr === 'string' ? draw.dr.split(',').map(Number) : [];
        if (!Number.isSafeInteger(id) || id <= 0 || id >= target || seen.has(id) || !validBalls(balls)) return [];
        seen.add(id);
        return [{ id, balls }];
    }).sort((a, b) => b.id - a.id).slice(0, 100);
    const complete = history.length === 100 && history.every((draw, i) => draw.id === target - i - 1);
    let betzeroAlternative = null, rainbowAlternative = null;
    if (complete) {
        const counts = Array(50).fill(0);
        const successes = { red: 0, blue: 0, green: 0 };
        for (const draw of history) {
            draw.balls.forEach(n => counts[n]++);
            for (const c of COLORS) if (draw.balls.filter(n => ballColor(n) === c).length >= 2) successes[c]++;
        }
        betzeroAlternative = Array.from({ length: 49 }, (_, i) => i + 1)
            .sort((a, b) => counts[a] - counts[b] || a - b).slice(0, 4);
        rainbowAlternative = [...COLORS].sort((a, b) => successes[b] - successes[a])[0];
    }
    const candidates = {
        betzero: { current: pred.betzeroStatus === 'ACTIVE' ? pred.unlikely4.map(n => n.number) : null, alternative: betzeroAlternative },
        rainbow: { current: pred.rainbowStatus === 'ACTIVE' ? pred.topColor.name : null, alternative: rainbowAlternative }
    };
    const adaptiveStrategies = { version: VERSION };
    for (const market of ['betzero', 'rainbow']) {
        const choice = chooseStrategy(market, records, target);
        adaptiveStrategies[market] = { ...choice, candidates: candidates[market] };
    }
    const result = { ...pred, brainData: { ...pred.brainData }, adaptiveStrategies };
    if (adaptiveStrategies.betzero.selected === 'alternative') {
        result.betzeroStatus = betzeroAlternative ? 'ACTIVE' : 'SKIP';
        result.unlikely4 = (betzeroAlternative || []).map(number => ({ number }));
        result.bzSkipReason = betzeroAlternative ? '' : 'Adaptive alternative requires 100 consecutive completed draws';
        result.brainData.betzero = { selected: betzeroAlternative || [], status: result.betzeroStatus,
            poolSize: betzeroAlternative ? 49 : 0, strategy: 'least_frequent_100' };
    }
    if (adaptiveStrategies.rainbow.selected === 'alternative') {
        result.rainbowStatus = rainbowAlternative ? 'ACTIVE' : 'SKIP';
        result.rbSkipReason = rainbowAlternative ? '' : 'Adaptive alternative requires 100 consecutive completed draws';
        const name = rainbowAlternative || pred.topColor.name;
        result.topColor = { ...pred.topColor, name, freq: pred.topColor.freqs?.[name] || 0 };
        result.brainData.rainbow = { ...pred.brainData.rainbow, selected: name,
            maxFreq: result.topColor.freq, strategy: 'most_two_ball_outcomes_100' };
    }
    return result;
}

const STRATEGY_NAMES = {
    betzero: { current: 'Weighted frequency + absence', alternative: 'Least frequent 100' },
    rainbow: { current: 'Weighted color frequency', alternative: 'Most 2+ ball outcomes' }
};

function getStrategyResults(record) {
    const result = {};
    for (const market of Object.keys(STRATEGY_NAMES)) {
        const local = record?.adaptiveStrategies?.version === VERSION ? record.adaptiveStrategies[market] : null;
        const supplied = record?.strategyResults?.[market];
        const selected = local?.selected ?? supplied?.selected;
        if (!['current', 'alternative'].includes(selected)) continue;
        result[market] = { selected };
        for (const key of ['current', 'alternative']) {
            const won = local ? outcome(market, local.candidates?.[key] ?? null, record?.result?.balls) : null;
            result[market][key] = local ? (won === null ? 'SKIP' : won ? 'WIN' : 'LOSS')
                : ['WIN', 'LOSS', 'SKIP'].includes(supplied?.[key]) ? supplied[key] : 'SKIP';
        }
    }
    return result;
}

function getSelectedStrategy(source, market, unifiedKey) {
    if (market === 'unified') market = ({ u4: 'betzero', color: 'rainbow' })[unifiedKey];
    const selected = source?.[market]?.selected;
    const label = STRATEGY_NAMES[market]?.[selected];
    return label ? { id: selected, label, market } : null;
}

function calculateStrategyStats(records, resetAt = 0) {
    const stats = Object.fromEntries(Object.entries(STRATEGY_NAMES).map(([market, names]) => [market,
        Object.fromEntries(Object.entries(names).map(([key, label]) => [key,
            { label, currentLosingStreak: 0, maxLosingStreak: 0, settled: 0 }]))]));
    const seen = new Set();
    const history = records.filter(record => {
        if (!record?.result || seen.has(String(record.drawId))) return false;
        seen.add(String(record.drawId));
        const time = Date.parse(record.settledAt || record.timestamp || '');
        return !resetAt || (Number.isFinite(time) && time > resetAt);
    }).sort((a, b) => Number(a.drawId) - Number(b.drawId));
    for (const record of history) {
        const results = getStrategyResults(record);
        for (const market of Object.keys(stats)) for (const key of ['current', 'alternative']) {
            const value = results[market]?.[key];
            if (value !== 'WIN' && value !== 'LOSS') continue;
            const bucket = stats[market][key];
            bucket.settled++;
            bucket.currentLosingStreak = value === 'WIN' ? 0 : bucket.currentLosingStreak + 1;
            bucket.maxLosingStreak = Math.max(bucket.maxLosingStreak, bucket.currentLosingStreak);
        }
    }
    return stats;
}

function formatStrategyStats(source, stats, market, unifiedKey) {
    const selected = getSelectedStrategy(source, market, unifiedKey);
    if (!selected) return '';
    const lines = [`📌 Strategy: <b>${selected.label}</b>`];
    if (market !== 'unified') for (const key of ['current', 'alternative']) {
        const bucket = stats[market]?.[key];
        if (bucket) lines.push(`${bucket.label} · Max losses: <b>${bucket.settled ? bucket.maxLosingStreak : '—'}</b>`);
    }
    return lines.join('\n');
}

module.exports = { applyAdaptiveStrategies, getStrategyResults, getSelectedStrategy, calculateStrategyStats, formatStrategyStats };
