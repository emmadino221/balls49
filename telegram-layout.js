'use strict';

function labels(strategy, summary) {
    const parts = [];
    if (strategy) parts.push(`📌 ${strategy.label}`);
    if (['ENTER', 'HOLD', 'LEARNING'].includes(summary)) {
        parts.push(`🧠 ${{ ENTER: '🟢', HOLD: '🟠', LEARNING: '⚪' }[summary]} <b>${summary}</b>`);
    }
    return parts.join(' | ');
}

function predictionBlock({ name, step, pick, strategy, summary }) {
    return [`<b>${name} · STEP ${step}</b>`, pick || '⏳ No pick this draw',
        labels(strategy, pick ? summary : null)].filter(Boolean).join('\n');
}

function resultBlock({ name, active, won, pick, step, maxLosses, strategy, summary, summaryStats, strategyStats }) {
    const value = bucket => bucket?.settled > 0 ? bucket.maxLosingStreak : '—';
    const lines = [
        `<b>${name}</b> · ${!active ? '⚪ SKIP' : won ? '✅ WIN' : '❌ LOSS'}`,
        active ? pick : '',
        `${active ? 'Next' : 'Step'} <b>${step}</b> | Game max <b>${maxLosses}</b>`,
        labels(strategy, active ? summary : null)
    ];
    if (active && ['ENTER', 'HOLD', 'LEARNING'].includes(summary)) {
        lines.push(`Summary max: 🟢 ENTER <b>${value(summaryStats?.ENTER)}</b> | 🟠 HOLD <b>${value(summaryStats?.HOLD)}</b>`);
    }
    if (strategy && strategyStats) {
        lines.push(`Strategy max: Current <b>${value(strategyStats.current)}</b> | Alternative <b>${value(strategyStats.alternative)}</b>`);
    }
    return lines.filter(Boolean).join('\n');
}

function resultLegend(strategyMarkets, hasSummary) {
    const lines = [];
    if (strategyMarkets.includes('betzero')) lines.push('BetZero: Current = Weighted frequency + absence; Alternative = Least frequent 100.');
    if (strategyMarkets.includes('rainbow')) lines.push('Rainbow: Current = Weighted color frequency; Alternative = Most 2+ ball outcomes.');
    lines.push('Steps and max losses use the current tracking period. — = no settled data.');
    if (hasSummary) lines.push('Summary streaks track each label separately.');
    if (strategyMarkets.length) lines.push('Strategy streaks include unselected candidate picks.');
    return lines.join('\n');
}

module.exports = { predictionBlock, resultBlock, resultLegend };
