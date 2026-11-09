'use strict';
const crypto = require('node:crypto');
const ZERO = 'statistics_streak_drop_betzero';
const HIT = 'statistics_streak_drop_bet49';
const SEED = 'statistics-streak-drop-v1';
const isStrategy = id => id === ZERO || id === HIT;
const definitions = [
    { id: ZERO, selectionCount: 4, label: 'BetZero - Statistics streak drop', market: 'BETZERO' },
    { id: HIT, selectionCount: 1, label: 'Bet49 - Random from streak-drop four', market: 'BET49' }
].map(s => ({ ...s, version: '1.0.0', status: 'RESEARCH_ONLY', kind: 'PREDICTION',
    description: 'Consecutive observed 100-draw statistics: strk 2 or 3 to 1; first four ascending; skip fewer than four. Bet49 picks one with a recorded deterministic random seed.',
    missingInformation: 'Statistics have no provider draw ID. Clock association is observational; provider freshness is not independently verified.' }));

function normalize(sample) {
    if (!sample || sample.btc !== 11090 || sample.period !== '100' || sample.response?.status !== 1) return null;
    const rows = sample.response.data?.stats;
    if (!Array.isArray(rows) || rows.length !== 49) return null;
    const values = Array(49).fill(null);
    for (const row of rows) {
        if (!/^\d+$/.test(String(row?.sel)) || !/^\d+$/.test(String(row?.strk))) return null;
        const n = Number(row.sel), streak = Number(row.strk);
        if (n < 1 || n > 49 || values[n - 1] !== null || !Number.isSafeInteger(streak)) return null;
        values[n - 1] = streak;
    }
    const { sourceDrawId, targetDrawId, requestedAt, receivedAt, deadline } = sample;
    if (![sourceDrawId,targetDrawId,requestedAt,receivedAt,deadline].every(Number.isSafeInteger)
        || sourceDrawId < 1 || targetDrawId !== sourceDrawId + 1 || requestedAt <= 0
        || receivedAt < requestedAt || receivedAt >= deadline || receivedAt - requestedAt > 30000) return null;
    return { sourceDrawId, targetDrawId, requestedAt, receivedAt, deadline, values,
        signature: crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex') };
}

function pick(strategy, previous, current, targetId, seed = SEED) {
    const skip = reason => ({ status:'SKIP', selections:[], conditions:{reason, market:strategy.id === HIT ? 'BET49' : 'BETZERO'} });
    if (!previous || !current) return skip('MISSING_STATISTICS_SNAPSHOTS');
    if (previous.conflicted || current.conflicted) return skip('CONFLICTING_STATISTICS_SNAPSHOTS');
    if (current.targetDrawId !== targetId || previous.targetDrawId !== current.sourceDrawId
        || previous.receivedAt >= current.requestedAt) return skip('NONCONSECUTIVE_STATISTICS_SNAPSHOTS');
    const qualified = current.values.flatMap((v,i) => v === 1 && [2,3].includes(previous.values[i]) ? [i+1] : []);
    if (qualified.length < 4) return skip('FEWER_THAN_FOUR_TRANSITIONS');
    const four = qualified.slice(0,4);
    // Rejection sampling avoids modulo bias; version, seed and input hashes freeze the choice.
    const randomSeed = `${seed}:${strategy.version}:${targetId}:${previous.signature}:${current.signature}`;
    let index;
    for (let nonce=0; index === undefined; nonce++) {
        const bytes = crypto.createHash('sha256').update(`${randomSeed}:${nonce}`).digest();
        for (const byte of bytes) if (byte < 252) { index=byte % 4; break; }
    }
    return { status:'PENDING', selections:strategy.id === HIT ? [four[index]] : four,
        conditions:{model:'OBSERVED_STATISTICS_TRANSITION', market:strategy.id === HIT ? 'BET49' : 'BETZERO',
            qualified, betzeroFour:four, randomSeed:strategy.id === HIT ? randomSeed : null,
            previousHash:previous.signature,currentHash:current.signature,
            previousSourceDrawId:previous.sourceDrawId,sourceDrawId:current.sourceDrawId,
            inputReceivedAt:current.receivedAt, providerDrawAlignmentVerified:false} };
}

function createStore(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS betzero_lab_number_statistics (
        source_draw_id INTEGER PRIMARY KEY, sample_json TEXT NOT NULL, signature TEXT NOT NULL,
        recorded_at INTEGER NOT NULL, conflicted INTEGER NOT NULL DEFAULT 0)`);
    function read(id) {
        const row=db.prepare('SELECT * FROM betzero_lab_number_statistics WHERE source_draw_id=?').get(id);
        return row ? {...JSON.parse(row.sample_json),recordedAt:row.recorded_at,conflicted:!!row.conflicted} : null;
    }
    function remember(raw, now) {
        const sample=normalize(raw);
        if (!sample || sample.receivedAt > now || now >= sample.deadline) return false;
        const old=read(sample.sourceDrawId);
        if (old) {
            if (old.signature !== sample.signature) db.prepare('UPDATE betzero_lab_number_statistics SET conflicted=1 WHERE source_draw_id=?').run(sample.sourceDrawId);
            return false;
        }
        db.prepare('INSERT INTO betzero_lab_number_statistics(source_draw_id,sample_json,signature,recorded_at) VALUES(?,?,?,?)')
            .run(sample.sourceDrawId,JSON.stringify(sample),sample.signature,now);
        return true;
    }
    function predict(strategy, target, seed, before = Infinity) {
        const previous=read(target-2), current=read(target-1);
        if ([previous,current].some(s => s && (s.receivedAt >= before || s.recordedAt >= before)))
            return {status:'SKIP',selections:[],conditions:{reason:'STATISTICS_NOT_AVAILABLE_BEFORE_TARGET'}};
        return pick(strategy,previous,current,target,seed);
    }
    return {read,remember,predict};
}
module.exports={ZERO,HIT,SEED,isStrategy,definitions,normalize,pick,createStore};
