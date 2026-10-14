'use strict';

const SUMMARY_LABELS = ['ENTER', 'HOLD'];
const UNIFIED_MARKETS = { u4: 'betzero', color: 'rainbow', sum: 'hilo', totalColor: 'totalColor' };

function getPublicSummaryLabel(value) {
    if (value === 'ENTER' || value === 'HOLD' || value === 'LEARNING') return value;
    if (!value || typeof value !== 'object') return null;
    if (value.recommendation === 'ENTER' || value.recommendation === 'HOLD') return value.recommendation;
    if (value.status === 'LEARNING' || value.status === 'INSUFFICIENT_BUCKET_DATA') return 'LEARNING';
    return null;
}

function buildPublicSummaryModel(source, unifiedKey = null) {
    const model = source && typeof source === 'object' ? source : {};
    const labels = {
        betzero: getPublicSummaryLabel(model.u4 ?? model.betzero),
        bet49: getPublicSummaryLabel(model.bet49),
        rainbow: getPublicSummaryLabel(model.color ?? model.rainbow),
        hilo: getPublicSummaryLabel(model.sum ?? model.hilo),
        totalColor: getPublicSummaryLabel(model.totalColor),
        totalColor2: getPublicSummaryLabel(model.totalColor2),
        unified: getPublicSummaryLabel(model.unified)
    };
    const unifiedMarket = UNIFIED_MARKETS[unifiedKey];
    if (unifiedMarket) labels.unified = labels[unifiedMarket];
    return labels;
}

function getPublicSummaryLabelForMarket(summaryModel, market, unifiedKey = null) {
    if (market === 'unified') {
        const sourceMarket = UNIFIED_MARKETS[unifiedKey];
        return sourceMarket ? summaryModel?.[sourceMarket] || null : summaryModel?.unified || null;
    }
    return summaryModel?.[market] || null;
}

function getRecordSummaryModel(record) {
    // Use the labels saved when the prediction was issued. Older local records
    // may only contain mlShadow; hosted records only contain summaryModel.
    return buildPublicSummaryModel(record?.summaryModel || record?.mlShadow, record?.predicted?.unified?.key);
}

function calculateSummaryLossStats(records, marketResultKeys, resetAt = 0) {
    const stats = Object.fromEntries(Object.keys(marketResultKeys).map(market => [market,
        Object.fromEntries(SUMMARY_LABELS.map(label => [label, {
            currentLosingStreak: 0, maxLosingStreak: 0, settled: 0
        }]))
    ]));
    const seenDrawIds = new Set();
    // History is newest first. Keep the newest copy of each draw, then count
    // in draw order, including results that arrived late after a restart.
    const history = records.filter(record => {
        if (!record?.result || typeof record.result !== 'object') return false;
        const id = record.drawId === undefined || record.drawId === null ? null : String(record.drawId);
        if (id !== null && seenDrawIds.has(id)) return false;
        if (id !== null) seenDrawIds.add(id);
        const settledAt = Date.parse(record.settledAt || record.timestamp || '');
        return !resetAt || (Number.isFinite(settledAt) && settledAt > resetAt);
    }).reverse().sort((left, right) => {
        const leftId = Number(left.drawId);
        const rightId = Number(right.drawId);
        return Number.isSafeInteger(leftId) && Number.isSafeInteger(rightId) ? leftId - rightId : 0;
    });

    for (const record of history) {
        const labels = getRecordSummaryModel(record);
        for (const [market, resultKey] of Object.entries(marketResultKeys)) {
            const label = labels[market];
            const outcome = record.result[resultKey];
            if (!SUMMARY_LABELS.includes(label) || (outcome !== 'WIN' && outcome !== 'LOSS')) continue;
            const bucket = stats[market][label];
            bucket.settled += 1;
            bucket.currentLosingStreak = outcome === 'WIN' ? 0 : bucket.currentLosingStreak + 1;
            bucket.maxLosingStreak = Math.max(bucket.maxLosingStreak, bucket.currentLosingStreak);
        }
    }
    return stats;
}

function formatTelegramSummaryStats(labels, stats, market) {
    const value = label => stats[market]?.[label]?.settled > 0 ? stats[market][label].maxLosingStreak : '—';
    const label = getPublicSummaryLabel(labels?.[market]);
    return `🧠 Summary${label ? ` ${label}` : ''} · Max losses: ENTER ${value('ENTER')} | HOLD ${value('HOLD')}`;
}

module.exports = {
    getPublicSummaryLabel,
    buildPublicSummaryModel,
    getPublicSummaryLabelForMarket,
    getRecordSummaryModel,
    calculateSummaryLossStats,
    formatTelegramSummaryStats
};
