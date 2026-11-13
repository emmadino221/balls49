'use strict';
const crypto = require('crypto');
function createVirtualFootball(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS site_virtual_matches (
        id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, payload TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS site_virtual_feed (id INTEGER PRIMARY KEY CHECK(id=1), accepted_at INTEGER NOT NULL, source_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS site_virtual_history_epoch (id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS site_virtual_matches_created ON site_virtual_matches (created_at DESC, id DESC);`);
    const error = (message, status = 400) => Object.assign(new Error(message), { status });
    // Every match of the newest rounds is kept for the live page. Older rows are kept only
    // when they carry a published pick, so the results archive can reach back this far.
    const RECENT_MATCHES = 5000;
    const HISTORY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
    const HISTORY_ROUNDS_SHOWN = 200;
    const HISTORY_MARKETS = ['over', 'gg', 'ng', 'win'];
    const SELECTED = "COALESCE(json_array_length(payload, '$.selectedMarkets'), 0) > 0";
    const historyCache = new Map();
    function ingest(raw, headers) {
        const secret = process.env.VIRTUAL_FEED_SECRET || '';
        if (secret.length < 32) throw error('Virtual football feed is not configured.', 503);
        const timestamp = String(headers['x-virtual-timestamp'] || ''), signature = String(headers['x-virtual-signature'] || '');
        if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60000 || !/^[a-f0-9]{64}$/.test(signature)) throw error('Invalid feed authentication.', 401);
        const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest();
        if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw error('Invalid feed authentication.', 401);
        const previous = db.prepare('SELECT accepted_at FROM site_virtual_feed WHERE id=1').get();
        if (previous && previous.accepted_at >= Number(timestamp)) throw error('Snapshot already received or out of order.', 409);
        const input = JSON.parse(raw);
        if (input.version !== 1 || !/^[a-zA-Z0-9_-]{8,64}$/.test(input.sourceId || '') || !Array.isArray(input.matches) || input.matches.length > 400 || !Number.isSafeInteger(input.sourceAt) || input.sourceAt > Date.now() + 60000 || input.sourceAt < 0) throw error('Invalid snapshot.');
        const seen = new Set();
        const rows = input.matches.map(m => {
            const id = `${input.sourceId}:${m.id}`;
            if (!Number.isSafeInteger(m.id) || m.id < 1 || seen.has(id)) throw error('Invalid match ID.');
            seen.add(id);
            for (const key of ['home', 'away', 'week']) if (typeof m[key] !== 'string' || !m[key].trim() || m[key].length > 100) throw error('Invalid match label.');
            if (!Number.isSafeInteger(m.createdAt) || m.createdAt < 0 || m.createdAt > Date.now() + 60000) throw error('Invalid match time.');
            if (!['HOME', 'DRAW', 'AWAY', null].includes(m.pick) || !['GG', 'NG', null].includes(m.btts)) throw error('Invalid pick.');
            if (m.goals15 !== undefined && !['OVER', 'UNDER', null].includes(m.goals15)) throw error('Invalid Over/Under 1.5 pick.');
            if (!['UPCOMING', 'REPORTED'].includes(m.status)) throw error('Invalid status.');
            const score = typeof m.score === 'string' && /^\d{1,2}\s*-\s*\d{1,2}$/.test(m.score) ? m.score.replace(/\s/g, '') : null;
            const confidence = typeof m.confidence === 'number' && Number.isFinite(m.confidence) && m.confidence >= 0 && m.confidence <= 100 ? m.confidence : null;
            const selectedMarkets = m.selectedMarkets == null ? null : m.selectedMarkets;
            const roundId = m.roundId == null ? null : m.roundId;
            const bttsConfidence = m.bttsConfidence == null ? null : m.bttsConfidence;
            const over15Confidence = m.over15Confidence == null ? null : m.over15Confidence;
            if (over15Confidence !== null && (typeof over15Confidence !== "number" || !Number.isFinite(over15Confidence) || over15Confidence < 0 || over15Confidence > 100)) throw error("Invalid Over 1.5 confidence.");
            const winOdds = m.winOdds == null ? null : m.winOdds;
            if (bttsConfidence !== null && (typeof bttsConfidence !== 'number' || !Number.isFinite(bttsConfidence) || bttsConfidence < 0 || bttsConfidence > 100)) throw error('Invalid BTTS confidence.');
            if (winOdds !== null && (typeof winOdds !== 'number' || !Number.isFinite(winOdds) || winOdds <= 1 || winOdds > 10000)) throw error('Invalid winner odds.');
            if (selectedMarkets !== null) {
                if (!Array.isArray(selectedMarkets) || selectedMarkets.length > 4 || new Set(selectedMarkets).size !== selectedMarkets.length || selectedMarkets.some(k => !['over','gg','ng','win'].includes(k)) || !/^[a-f0-9]{32}$/.test(roundId || '')) throw error('Invalid market shortlist.');
                if (selectedMarkets.includes('win') && (!(winOdds > 1.70) || confidence === null || !['HOME', 'AWAY'].includes(m.pick))) throw error('Winner shortlist requires a team winner, odds above 1.70 and model confidence.');
                if (selectedMarkets.includes('gg') && (m.btts !== 'GG' || bttsConfidence === null)) throw error('Invalid GG selection.');
                if (selectedMarkets.includes('ng') && (m.btts !== 'NG' || bttsConfidence === null)) throw error('Invalid NG selection.');
                if (selectedMarkets.includes('over')) {
                    const dedicated = over15Confidence !== null && over15Confidence >= 60 && m.goals15 === 'OVER';
                    const legacy = over15Confidence === null && m.goals15 == null && m.btts === 'GG' && bttsConfidence !== null && bttsConfidence >= 60;
                    if (!dedicated && !legacy) throw error('Over shortlist requires qualifying market confidence.');
                }
            }
            return { id, home: m.home.trim(), away: m.away.trim(), week: m.week.trim(), createdAt: m.createdAt, pick: m.pick, goals15: m.goals15 ?? null, btts: m.btts, confidence, bttsConfidence, over15Confidence, winOdds, selectedMarkets, roundId, status: m.status, score: m.status === 'REPORTED' ? score : null };
        });
        db.exec('BEGIN IMMEDIATE');
        try {
            const historyStart = db.prepare('SELECT started_at FROM site_virtual_history_epoch WHERE id=1').get()?.started_at || 0;
            for (const row of rows) {
                if (row.createdAt < historyStart) continue;
                const old = db.prepare('SELECT payload FROM site_virtual_matches WHERE id=?').get(row.id);
                if (old) {
                    const saved = JSON.parse(old.payload);
                    if (saved.home !== row.home || saved.away !== row.away || saved.createdAt !== row.createdAt) throw error('Match identity changed. Use a new source ID after replacing the source database.', 409);
                    // Picks are immutable once published; later snapshots can update scores only.
                    if (row.status === 'REPORTED') { saved.status = row.status; saved.score = row.score; }
                    db.prepare('UPDATE site_virtual_matches SET payload=? WHERE id=?').run(JSON.stringify(saved), row.id);
                } else db.prepare('INSERT INTO site_virtual_matches VALUES (?,?,?)').run(row.id, row.createdAt, JSON.stringify(row));
            }
            // Validate against saved selections too, preventing extra picks in later snapshots.
            // Only the rounds this snapshot can touch are checked; older rounds are settled history.
            const counts = new Map();
            const checkFrom = rows.reduce((earliest, row) => Math.min(earliest, row.createdAt), Date.now()) - 6 * 60 * 60 * 1000;
            for (const entry of db.prepare('SELECT payload FROM site_virtual_matches WHERE created_at >= ?').all(checkFrom)) {
                const match = JSON.parse(entry.payload);
                if (!match.selectedMarkets) continue;
                const source = match.id.split(':')[0];
                for (const market of match.selectedMarkets) {
                    const key = `${source}:${match.roundId}:${market}`;
                    const count = (counts.get(key) || 0) + 1;
                    if (count > (market === 'over' ? 2 : 1)) throw error('Too many selected picks for this round.');
                    counts.set(key, count);
                }
            }
            db.prepare('INSERT INTO site_virtual_feed VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET accepted_at=excluded.accepted_at, source_at=excluded.source_at').run(Number(timestamp), input.sourceAt);
            db.prepare('DELETE FROM site_virtual_matches WHERE created_at < ?').run(Date.now() - HISTORY_RETENTION_MS);
            const boundary = db.prepare('SELECT created_at FROM site_virtual_matches ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET ?').get(RECENT_MATCHES);
            if (boundary) db.prepare(`DELETE FROM site_virtual_matches WHERE created_at < ? AND NOT (${SELECTED})`).run(boundary.created_at);
            historyCache.clear();
            db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return { ok: true, received: rows.length };
    }
    function view() {
        const historyStart = db.prepare('SELECT started_at FROM site_virtual_history_epoch WHERE id=1').get()?.started_at || 0;
        const feed = db.prepare('SELECT * FROM site_virtual_feed WHERE id=1').get();
        const stale = !feed || Date.now() - feed.accepted_at > 120000 || Date.now() - feed.source_at > 180000;
        const matches = db.prepare('SELECT payload FROM site_virtual_matches WHERE created_at >= ? ORDER BY created_at DESC, id DESC LIMIT 200').all(historyStart).map(row => {
            const m = JSON.parse(row.payload);
            const expired = m.status === 'UPCOMING' && (stale || Date.now() - m.createdAt > 180000);
            return { ...m, status: expired ? 'EXPIRED' : m.status };
        });
        return { updatedAt: feed?.accepted_at || null, sourceAt: feed?.source_at || null, historyStart: historyStart || null, stale, matches };
    }
    function settle(match, market) {
        const score = typeof match.score === 'string' ? match.score.match(/^(\d{1,2})-(\d{1,2})$/) : null;
        if (!score) return 'NO SCORE';
        const home = Number(score[1]), away = Number(score[2]);
        if (market === 'win') return match.pick === (home > away ? 'HOME' : home < away ? 'AWAY' : 'DRAW') ? 'WIN' : 'LOSS';
        if (market === 'over') return home + away >= 2 ? 'WIN' : 'LOSS';
        return match.btts === (home > 0 && away > 0 ? 'GG' : 'NG') ? 'WIN' : 'LOSS';
    }
    function pickText(match, market) {
        if (market === 'win') return match.pick === 'HOME' ? `Home · ${match.home}` : match.pick === 'AWAY' ? `Away · ${match.away}` : null;
        if (market === 'over') return match.goals15 === 'OVER' ? 'Over 1.5 goals' : match.goals15 == null && match.btts === 'GG' ? 'Over 1.5 goals · GG signal' : null;
        if (market === 'gg') return match.btts === 'GG' ? 'Yes · GG' : null;
        return match.btts === 'NG' ? 'No · NG' : null;
    }
    // Results archive: every published pick with a reported score inside the requested
    // window. Totals and streaks cover the whole window; only the round list is capped.
    function history(query = {}) {
        const historyStart = db.prepare('SELECT started_at FROM site_virtual_history_epoch WHERE id=1').get()?.started_at || 0;
        const number = value => /^\d{1,15}$/.test(String(value ?? '')) ? Number(value) : null;
        const from = Math.max(number(query.from) ?? 0, historyStart);
        const to = number(query.to) ?? Number.MAX_SAFE_INTEGER;
        const week = typeof query.week === 'string' && query.week.length <= 100 ? query.week : '';
        const outcome = ['WIN', 'LOSS', 'INCOMPLETE'].includes(query.outcome) ? query.outcome : '';
        const cacheKey = JSON.stringify([from, to, week, outcome]);
        const cached = historyCache.get(cacheKey);
        if (cached && Date.now() - cached.at < 30000) return cached.value;

        const markets = Object.fromEntries(HISTORY_MARKETS.map(market => [market, new Map()]));
        const weeks = new Set();
        let oldest = null;
        const stored = db.prepare(`SELECT payload FROM site_virtual_matches WHERE created_at >= ? AND created_at <= ? AND ${SELECTED} ORDER BY created_at DESC, id DESC`).all(from, to);
        for (const entry of stored) {
            const match = JSON.parse(entry.payload);
            if (match.status !== 'REPORTED' || !match.roundId) continue;
            weeks.add(match.week);
            if (week && match.week !== week) continue;
            oldest = match.createdAt;
            for (const market of match.selectedMarkets) {
                const prediction = markets[market] && pickText(match, market);
                if (!prediction) continue;
                const key = `${match.id.split(':')[0]}:${match.roundId}`;
                if (!markets[market].has(key)) markets[market].set(key, { key, week: match.week, createdAt: match.createdAt, rows: [] });
                markets[market].get(key).rows.push({ id: match.id, home: match.home, away: match.away, createdAt: match.createdAt, prediction, score: match.score, result: settle(match, market) });
            }
        }
        const summary = {};
        for (const market of HISTORY_MARKETS) {
            const rounds = [...markets[market].values()];
            let current = 0, worst = 0, wins = 0, losses = 0;
            for (const round of rounds) {
                const results = round.rows.map(row => row.result);
                round.outcome = results.length !== (market === 'over' ? 2 : 1) || results.includes('NO SCORE')
                    ? 'INCOMPLETE' : results.every(result => result === 'WIN') ? 'WIN' : 'LOSS';
            }
            for (let index = rounds.length - 1; index >= 0; index--) {
                if (rounds[index].outcome === 'LOSS') { current += 1; losses += 1; worst = Math.max(worst, current); }
                else { current = 0; if (rounds[index].outcome === 'WIN') wins += 1; }
            }
            const matching = outcome ? rounds.filter(round => round.outcome === outcome) : rounds;
            summary[market] = {
                wins, losses, current, worst, rounds: matching.length,
                picks: matching.reduce((total, round) => total + round.rows.length, 0),
                groups: matching.slice(0, HISTORY_ROUNDS_SHOWN)
            };
        }
        const sortedWeeks = [...weeks].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const value = { historyStart: historyStart || null, oldest, roundsShown: HISTORY_ROUNDS_SHOWN, weeks: sortedWeeks, markets: summary };
        if (historyCache.size > 100) historyCache.clear();
        historyCache.set(cacheKey, { at: Date.now(), value });
        return value;
    }
    return { ingest, view, history };
}
module.exports = { createVirtualFootball };
