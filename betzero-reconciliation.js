'use strict';
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const id = value => /^(0|[1-9][0-9]*)$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? String(value) : null;

// Archive observation time is provenance, NEVER proof of the actual draw deadline.
function planReconciliation(db, archive, { now = Date.now(), overdueMs = 300000, target, limit = 100, source = 'collector archive' } = {}) {
    const { STRATEGIES, validBalls, validSelections, validateBetZeroPrediction } = require('./betzero-lab');
    if (!Array.isArray(archive)) throw new Error('Collector archive must be an array.');
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(overdueMs) || overdueMs < 300000
        || !Number.isInteger(limit) || limit < 1 || limit > 100 || (target !== undefined && !id(target))) throw new Error('Invalid reconciliation bounds.');
    const sourceHash = hash(JSON.stringify(archive));
    const byId = new Map();
    for (const record of archive) {
        const key = id(record?.id);
        if (!key) continue;
        const values = byId.get(key) || []; values.push(record); byId.set(key, values);
    }
    const rows = db.prepare(`SELECT * FROM betzero_lab_forward_predictions WHERE status='PENDING'
        ${target === undefined ? '' : 'AND target_draw_id=?'} ORDER BY CAST(target_draw_id AS INTEGER), prediction_id`).all(...(target === undefined ? [] : [String(target)]));
    const decisions = [];
    for (const row of rows) {
        if (decisions.length >= limit) break;
        const predicted = Date.parse(row.predicted_at);
        if (Number.isFinite(predicted) && predicted > now - overdueMs) continue;
        const decision = { predictionId: row.prediction_id, targetDrawId: row.target_draw_id, strategyId: row.strategy_id, strategyVersion: row.strategy_version, action: 'REJECT' };
        decisions.push(decision);
        if (!id(row.target_draw_id) || !Number.isFinite(predicted)) { decision.reason = 'INVALID_PREDICTION'; continue; }
        const matches = byId.get(row.target_draw_id) || [];
        if (!matches.length) { decision.action = 'WAIT'; decision.reason = 'MISSING_ARCHIVE_RESULT'; continue; }
        const parsed = matches.map(record => {
            const tokens = typeof record.dr === 'string' ? record.dr.split(',') : [];
            const balls = tokens.every(token => /^[1-9][0-9]*$/.test(token)) ? tokens.map(Number) : [];
            const observed = Date.parse(record.timestamp);
            return { balls, observed, valid: validBalls(balls) && Number.isFinite(observed) && observed <= now && observed > predicted,
                resultHash: hash(JSON.stringify([...balls].sort((a,b) => a-b))) };
        });
        if (parsed.some(value => !value.valid)) { decision.reason = 'MALFORMED_ARCHIVE_RESULT'; continue; }
        if (new Set(parsed.map(value => value.resultHash)).size !== 1) { decision.reason = 'CONFLICTING_ARCHIVE_RESULTS'; continue; }
        const settled = db.prepare("SELECT actual_balls_json FROM betzero_lab_forward_predictions WHERE target_draw_id=? AND status IN ('WIN','LOSS')").all(row.target_draw_id);
        if (settled.some(other => {
            try { const balls=JSON.parse(other.actual_balls_json); return !validBalls(balls) || hash(JSON.stringify([...balls].sort((a,b)=>a-b))) !== parsed[0].resultHash; }
            catch { return true; }
        })) { decision.reason = 'CONFLICTING_SAVED_RESULT'; continue; }
        const definition = STRATEGIES.find(strategy => strategy.id === row.strategy_id && strategy.version === row.strategy_version);
        let selections; try { selections = JSON.parse(row.selections_json); } catch { selections = null; }
        if (!definition?.selectionCount || !validSelections(selections, definition.selectionCount)) { decision.reason = 'INVALID_STRATEGY_OR_SELECTIONS'; continue; }
        Object.assign(decision, { action: 'SETTLE', outcome: validateBetZeroPrediction(selections, parsed[0].balls, definition.selectionCount),
            balls: parsed[0].balls, resultHash: parsed[0].resultHash, observedAt: new Date(Math.min(...parsed.map(value => value.observed))).toISOString(),
            original: row });
    }
    return { dryRun: true, source, sourceHash, evaluatedAt: new Date(now).toISOString(), decisions };
}

function pendingQuality(db, strategyId, version, now = Date.now()) {
    const row = db.prepare(`SELECT COUNT(*) AS pending, SUM(CASE WHEN julianday(predicted_at) IS NULL OR julianday(predicted_at)<=julianday(?)-5.0/1440
        OR CAST(target_draw_id AS INTEGER) < COALESCE((SELECT MAX(CAST(target_draw_id AS INTEGER)) FROM betzero_lab_forward_predictions
        WHERE strategy_id=? AND strategy_version=? AND status IN ('WIN','LOSS')),0) THEN 1 ELSE 0 END) AS unresolved
        FROM betzero_lab_forward_predictions WHERE strategy_id=? AND strategy_version=? AND status='PENDING'`)
        .get(new Date(now).toISOString(), strategyId, version, strategyId, version);
    return { pending: row.pending, unresolvedPending: row.unresolved || 0, provisional: (row.unresolved || 0) > 0,
        provisionalReason: row.unresolved ? 'Unresolved pending results may change win rates and chronological streaks.' : null };
}
module.exports = { planReconciliation, pendingQuality };
