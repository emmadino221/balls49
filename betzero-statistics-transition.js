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
definitions.push(...definitions.map(s => ({ ...s, version: '2.0.0',
    label: s.id === ZERO ? 'BetZero - Streak drop v2 (3 or 4 numbers)' : 'Bet49 - Streak drop v2 (one from 3 or 4)',
    description: 'Consecutive observed 100-draw statistics: strk 2 or 3 to 1; use three when exactly three qualify, otherwise first four ascending. Skip fewer than three. Bet49 selects one seeded random candidate.'
})));
// v3 needs only the latest statistics: every number whose current streak is exactly 1.
// A number leaves the selection by itself as soon as its streak moves to 2 (or anything else).
definitions.push(...definitions.filter(s => s.version === '1.0.0').map(s => ({ ...s, version: '3.0.0',
    label: s.id === ZERO ? 'BetZero - Streak 1 v3 (up to 4 numbers)' : 'Bet49 - Streak 1 v3 (one of the streak-1 numbers)',
    description: 'Latest observed 100-draw statistics: numbers whose strk is exactly 1; first four ascending, fewer when fewer qualify. A number is dropped once its strk is no longer 1. Skip when none qualify. Bet49 selects one seeded random candidate.'
})));

function acceptsCount(strategy, count) {
    if (strategy.id === ZERO && strategy.version === '3.0.0') return count >= 1 && count <= 4;
    if (strategy.id === ZERO && strategy.version === '2.0.0') return count === 3 || count === 4;
    return count === strategy.selectionCount;
}

// The provider envelope is not trusted for validity (its status field has no documented
// contract); the 49 complete, unique, numeric rows are what make a sample usable.
function inspect(sample) {
    const fail = reason => ({ sample: null, reason });
    if (!sample || typeof sample !== 'object') return fail('NO_SAMPLE');
    if (sample.btc !== 11090 || sample.period !== '100') return fail('WRONG_MARKET_OR_PERIOD');
    if (!sample.response || typeof sample.response !== 'object') return fail('NO_PROVIDER_RESPONSE');
    const rows = Array.isArray(sample.response.data?.stats) ? sample.response.data.stats : sample.response.stats;
    if (!Array.isArray(rows)) return fail('NO_STATS_ARRAY');
    if (rows.length !== 49) return fail('ROW_COUNT_NOT_49');
    const values = Array(49).fill(null);
    for (const row of rows) {
        if (!/^\d+$/.test(String(row?.sel)) || !/^\d+$/.test(String(row?.strk))) return fail('INVALID_ROW');
        const n = Number(row.sel), streak = Number(row.strk);
        if (n < 1 || n > 49 || !Number.isSafeInteger(streak)) return fail('INVALID_ROW');
        if (values[n - 1] !== null) return fail('DUPLICATE_NUMBER');
        values[n - 1] = streak;
    }
    const { sourceDrawId, targetDrawId, requestedAt, receivedAt, deadline } = sample;
    if (![sourceDrawId,targetDrawId,requestedAt,receivedAt,deadline].every(Number.isSafeInteger)
        || sourceDrawId < 1 || targetDrawId !== sourceDrawId + 1 || requestedAt <= 0
        || receivedAt < requestedAt || receivedAt >= deadline || receivedAt - requestedAt > 30000) return fail('INVALID_TIMING');
    return { reason: null, sample: { sourceDrawId, targetDrawId, requestedAt, receivedAt, deadline, values,
        signature: crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex') } };
}
function normalize(sample) { return inspect(sample).sample; }

// Small, bounded description of a rejected provider response for the admin diagnostics.
function describe(raw) {
    const text = value => String(value).slice(0, 24);
    const keys = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).slice(0, 12).map(text) : null;
    const response = raw?.response;
    const rows = Array.isArray(response?.data?.stats) ? response.data.stats : Array.isArray(response?.stats) ? response.stats : null;
    const first = rows?.[0];
    return {
        responseType: response === null ? 'null' : Array.isArray(response) ? 'array' : typeof response,
        responseKeys: keys(response),
        status: ['string','number','boolean'].includes(typeof response?.status) ? text(response.status) : null,
        dataType: response?.data === null ? 'null' : Array.isArray(response?.data) ? 'array' : typeof response?.data,
        dataKeys: keys(response?.data),
        rows: rows ? rows.length : null,
        firstRowKeys: keys(first),
        firstRow: first && typeof first === 'object' ? { sel: text(first.sel), strk: text(first.strk) } : null
    };
}

function pick(strategy, previous, current, targetId, seed = SEED) {
    const skip = reason => ({ status:'SKIP', selections:[], conditions:{reason, market:strategy.id === HIT ? 'BET49' : 'BETZERO'} });
    if (strategy.version === '3.0.0') {
        const market = strategy.id === HIT ? 'BET49' : 'BETZERO';
        if (!current) return skip('MISSING_LATEST_STATISTICS');
        if (current.conflicted) return skip('CONFLICTING_STATISTICS_SNAPSHOTS');
        if (current.targetDrawId !== targetId) return skip('MISSING_LATEST_STATISTICS');
        const qualified = current.values.flatMap((v,i) => v === 1 ? [i+1] : []);
        if (!qualified.length) return { ...skip('NO_NUMBER_WITH_STREAK_ONE'), conditions:{reason:'NO_NUMBER_WITH_STREAK_ONE',market,qualified,requiredMinimum:1} };
        const candidates = qualified.slice(0,4);
        const randomSeed = `${seed}:${strategy.version}:${targetId}:${current.signature}`;
        let index;
        for (let nonce=0; index === undefined; nonce++) {
            const bytes = crypto.createHash('sha256').update(`${randomSeed}:${nonce}`).digest();
            for (const byte of bytes) if (byte < 252) { index=byte % candidates.length; break; }
        }
        return { status:'PENDING', selections:strategy.id === HIT ? [candidates[index]] : candidates,
            conditions:{model:'OBSERVED_STATISTICS_STREAK_ONE', market, qualified, betzeroCandidates:candidates,
                randomSeed:strategy.id === HIT ? randomSeed : null, currentHash:current.signature,
                sourceDrawId:current.sourceDrawId, inputReceivedAt:current.receivedAt, providerDrawAlignmentVerified:false} };
    }
    if (!previous || !current) return skip('MISSING_STATISTICS_SNAPSHOTS');
    if (previous.conflicted || current.conflicted) return skip('CONFLICTING_STATISTICS_SNAPSHOTS');
    if (current.targetDrawId !== targetId || previous.targetDrawId !== current.sourceDrawId
        || previous.receivedAt >= current.requestedAt) return skip('NONCONSECUTIVE_STATISTICS_SNAPSHOTS');
    const qualified = current.values.flatMap((v,i) => v === 1 && [2,3].includes(previous.values[i]) ? [i+1] : []);
    const minimum = strategy.version === '2.0.0' ? 3 : 4;
    if (qualified.length < minimum) return { ...skip(minimum === 3 ? 'FEWER_THAN_THREE_TRANSITIONS' : 'FEWER_THAN_FOUR_TRANSITIONS'),
        conditions: { reason: minimum === 3 ? 'FEWER_THAN_THREE_TRANSITIONS' : 'FEWER_THAN_FOUR_TRANSITIONS',
            market: strategy.id === HIT ? 'BET49' : 'BETZERO', qualified, requiredMinimum: minimum } };
    const four = qualified.slice(0,4);
    // Rejection sampling avoids modulo bias; version, seed and input hashes freeze the choice.
    const randomSeed = `${seed}:${strategy.version}:${targetId}:${previous.signature}:${current.signature}`;
    let index;
    for (let nonce=0; index === undefined; nonce++) {
        const bytes = crypto.createHash('sha256').update(`${randomSeed}:${nonce}`).digest();
        for (const byte of bytes) if (byte < 252) { index=byte % four.length; break; }
    }
    return { status:'PENDING', selections:strategy.id === HIT ? [four[index]] : four,
        conditions:{model:'OBSERVED_STATISTICS_TRANSITION', market:strategy.id === HIT ? 'BET49' : 'BETZERO',
            qualified, ...(strategy.version === '1.0.0' ? {betzeroFour:four} : {betzeroCandidates:four}), randomSeed:strategy.id === HIT ? randomSeed : null,
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
    function rememberDetailed(raw, now) {
        const {sample,reason}=inspect(raw);
        const ids=value=>Number.isSafeInteger(value) ? value : null;
        const base={sourceDrawId:ids(sample?.sourceDrawId ?? raw?.sourceDrawId),targetDrawId:ids(sample?.targetDrawId ?? raw?.targetDrawId)};
        if (!sample) return {...base,stored:false,outcome:'REJECTED',reason,shape:describe(raw)};
        if (sample.receivedAt > now) return {...base,stored:false,outcome:'REJECTED',reason:'RECEIVED_IN_FUTURE'};
        if (now >= sample.deadline) return {...base,stored:false,outcome:'REJECTED',reason:'ARRIVED_AFTER_DRAW_DEADLINE'};
        const old=read(sample.sourceDrawId);
        if (old) {
            if (old.signature === sample.signature) return {...base,stored:false,outcome:'DUPLICATE',reason:null};
            db.prepare('UPDATE betzero_lab_number_statistics SET conflicted=1 WHERE source_draw_id=?').run(sample.sourceDrawId);
            return {...base,stored:false,outcome:'CONFLICT',reason:'DIFFERENT_VALUES_FOR_SAME_DRAW'};
        }
        db.prepare('INSERT INTO betzero_lab_number_statistics(source_draw_id,sample_json,signature,recorded_at) VALUES(?,?,?,?)')
            .run(sample.sourceDrawId,JSON.stringify(sample),sample.signature,now);
        return {...base,stored:true,outcome:'STORED',reason:null};
    }
    function remember(raw, now) { return rememberDetailed(raw, now).stored; }
    function predict(strategy, target, seed, before = Infinity) {
        const previous=strategy.version === '3.0.0' ? null : read(target-2), current=read(target-1);
        if ([previous,current].some(s => s && (s.receivedAt >= before || s.recordedAt >= before)))
            return {status:'SKIP',selections:[],conditions:{reason:'STATISTICS_NOT_AVAILABLE_BEFORE_TARGET'}};
        return pick(strategy,previous,current,target,seed);
    }
    return {read,remember,rememberDetailed,predict};
}
module.exports={ZERO,HIT,SEED,isStrategy,definitions,normalize,inspect,describe,pick,createStore,acceptsCount};
