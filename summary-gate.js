'use strict';

const { buildPublicSummaryModel, getRecordSummaryModel } = require('./summary-stats');
const SUMMARY_MARKET_KEYS = { u4: 'betzero', color: 'rainbow', sum: 'hilo', totalColor: 'totalColor' };
const SUMMARY_MODEL_MARKETS = Object.keys(SUMMARY_MARKET_KEYS);
const makeDefaultSummaryModelMarkets = () => Object.fromEntries(SUMMARY_MODEL_MARKETS.map(key => [key, false]));
const normalizeSummaryModelTargets = targets => Object.fromEntries(SUMMARY_MODEL_MARKETS.map(key => [key,
    targets?.[key] === 'HOLD' ? 'HOLD' : 'ENTER'
]));

function getSummaryGateTarget(config, key) {
    if (!SUMMARY_MODEL_MARKETS.includes(key) || !config.summaryModelMarkets?.[key]) return null;
    // Existing boolean gates keep their original ENTER behavior.
    return config.summaryModelTargets?.[key] === 'HOLD' ? 'HOLD' : 'ENTER';
}

function summaryGateAllows(config, key, labels) {
    const target = getSummaryGateTarget(config, key);
    return target === null || labels?.[SUMMARY_MARKET_KEYS[key]] === target;
}

function getIssuedSummaryLabels(prediction, records) {
    if (prediction?.drawId === undefined || prediction.drawId === null) return {};
    const record = records.find(item => String(item.drawId) === String(prediction.drawId));
    return record ? getRecordSummaryModel(record)
        : buildPublicSummaryModel(prediction.summaryModel, prediction.pred?.unifiedPick?.key);
}

function applySummaryGateConfig(config, update) {
    const enabled = update.summaryModelMarkets;
    const targets = update.summaryModelTargets;
    for (const key of SUMMARY_MODEL_MARKETS) {
        if (enabled && !Array.isArray(enabled) && typeof enabled[key] === 'boolean') {
            config.summaryModelMarkets[key] = enabled[key];
        }
        if (targets && !Array.isArray(targets) && (targets[key] === 'ENTER' || targets[key] === 'HOLD')) {
            config.summaryModelTargets[key] = targets[key];
        }
    }
}

module.exports = {
    SUMMARY_MODEL_MARKETS, makeDefaultSummaryModelMarkets, normalizeSummaryModelTargets,
    getSummaryGateTarget, summaryGateAllows, getIssuedSummaryLabels, applySummaryGateConfig
};
