'use strict';

const { getRecordSummaryModel } = require('./summary-stats');
const MARKETS = ['betzero', 'bet49', 'rainbow', 'hilo', 'totalColor', 'totalColor2', 'totalColor1', 'unified'];

function presetSessionBusy(session) {
    return Boolean(session.pendingBetPayload || session.betExecutionClaim || session.lastBetDetails
        || session.failedBetRecovery || session.balanceVerification?.pendingWinSync
        || session.masterState?.active || session.masterState?.deficit > 0 || session.masterState?.step > 1
        || Object.values(session.martingaleState || {}).some(state => state.active || state.localStep > 1
            || state.isRollover || state.cycleLosses > 0 || state.inShadowMode)
        || Object.values(session.sniperState || {}).some(state => state.losses > 0 || state.waitingForTarget));
}

function buildPresetHistory(records, limit, resetAt) {
    const seen = new Set();
    const history = records.filter(record => {
        const id = Number(record?.drawId);
        const time = Date.parse(record?.settledAt || record?.timestamp || '');
        if (!record?.result || !Number.isSafeInteger(id) || seen.has(id)
            || (resetAt && (!Number.isFinite(time) || time <= resetAt))) return false;
        seen.add(id);
        return true;
    }).sort((a, b) => Number(b.drawId) - Number(a.drawId)).slice(0, limit).reverse();
    const bucket = () => ({ wins: 0, losses: 0, skipped: 0, settled: 0, worstLosses: 0, currentLosses: 0 });
    const markets = Object.fromEntries(MARKETS.map(market => [market, { ...bucket(), ENTER: bucket(), HOLD: bucket() }]));
    let previousId = null, gaps = 0;
    function recordOutcome(stats, outcome) {
        if (outcome !== 'WIN' && outcome !== 'LOSS') { stats.skipped++; return; }
        stats.settled++;
        if (outcome === 'WIN') { stats.wins++; stats.currentLosses = 0; }
        else { stats.losses++; stats.currentLosses++; stats.worstLosses = Math.max(stats.worstLosses, stats.currentLosses); }
    }
    for (const record of history) {
        if (previousId !== null && Number(record.drawId) !== previousId + 1) {
            gaps++;
            for (const stats of Object.values(markets)) for (const b of [stats, stats.ENTER, stats.HOLD]) b.currentLosses = 0;
        }
        const labels = getRecordSummaryModel(record);
        for (const market of MARKETS) {
            recordOutcome(markets[market], record.result[market]);
            if (labels[market] === 'ENTER' || labels[market] === 'HOLD') recordOutcome(markets[market][labels[market]], record.result[market]);
        }
        previousId = Number(record.drawId);
    }
    return { generatedAt: Date.now(), resetAt, draws: history.length, gaps, minimumSamples: 50, markets };
}

module.exports = { buildPresetHistory, presetSessionBusy };
