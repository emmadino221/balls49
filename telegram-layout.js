'use strict';

function labels(summary) {
    const parts = [];
    if (['ENTER', 'HOLD', 'LEARNING'].includes(summary)) {
        parts.push(`🧠 ${{ ENTER: '🟢', HOLD: '🟠', LEARNING: '⚪' }[summary]} <b>${summary}</b>`);
    }
    return parts.join(' | ');
}

function predictionBlock({ name, step, pick, summary }) {
    return [`<b>${name} · STEP ${step}</b>`, pick || '⏳ No pick this draw',
        labels(pick ? summary : null)].filter(Boolean).join('\n');
}

function resultBlock({ name, active, won, pick, step, maxLosses, summary, summaryStats }) {
    const value = bucket => bucket?.settled > 0 ? bucket.maxLosingStreak : '—';
    const lines = [
        `<b>${name}</b> · ${!active ? '⚪ SKIP' : won ? '✅ WIN' : '❌ LOSS'}`,
        active ? pick : '',
        `${active ? 'Next' : 'Step'} <b>${step}</b> | Game max <b>${maxLosses}</b>`,
        labels(active ? summary : null)
    ];
    if (active && ['ENTER', 'HOLD', 'LEARNING'].includes(summary)) {
        lines.push(`Summary max: 🟢 ENTER <b>${value(summaryStats?.ENTER)}</b> | 🟠 HOLD <b>${value(summaryStats?.HOLD)}</b>`);
    }
    return lines.filter(Boolean).join('\n');
}

function resultLegend(_strategyMarkets, hasSummary) {
    const lines = [];
    lines.push('Steps and max losses use the current tracking period. — = no settled data.');
    if (hasSummary) lines.push('Summary streaks track each label separately.');
    return lines.join('\n');
}

module.exports = { predictionBlock, resultBlock, resultLegend };
