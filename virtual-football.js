'use strict';
const crypto = require('crypto');
function createVirtualFootball(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS site_virtual_matches (
        id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, payload TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS site_virtual_feed (id INTEGER PRIMARY KEY CHECK(id=1), accepted_at INTEGER NOT NULL, source_at INTEGER NOT NULL);`);
    const error = (message, status = 400) => Object.assign(new Error(message), { status });
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
            return { id, home: m.home.trim(), away: m.away.trim(), week: m.week.trim(), createdAt: m.createdAt, pick: m.pick, goals15: m.goals15 ?? null, btts: m.btts, confidence, status: m.status, score: m.status === 'REPORTED' ? score : null };
        });
        db.exec('BEGIN IMMEDIATE');
        try {
            for (const row of rows) {
                const old = db.prepare('SELECT payload FROM site_virtual_matches WHERE id=?').get(row.id);
                if (old) {
                    const saved = JSON.parse(old.payload);
                    if (saved.home !== row.home || saved.away !== row.away || saved.createdAt !== row.createdAt) throw error('Match identity changed. Use a new source ID after replacing the source database.', 409);
                    // Picks are immutable once published; later snapshots can update scores only.
                    if (row.status === 'REPORTED') { saved.status = row.status; saved.score = row.score; }
                    db.prepare('UPDATE site_virtual_matches SET payload=? WHERE id=?').run(JSON.stringify(saved), row.id);
                } else db.prepare('INSERT INTO site_virtual_matches VALUES (?,?,?)').run(row.id, row.createdAt, JSON.stringify(row));
            }
            db.prepare('INSERT INTO site_virtual_feed VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET accepted_at=excluded.accepted_at, source_at=excluded.source_at').run(Number(timestamp), input.sourceAt);
            db.prepare('DELETE FROM site_virtual_matches WHERE id NOT IN (SELECT id FROM site_virtual_matches ORDER BY created_at DESC, id DESC LIMIT 5000)').run();
            db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return { ok: true, received: rows.length };
    }
    function view() {
        const feed = db.prepare('SELECT * FROM site_virtual_feed WHERE id=1').get();
        const stale = !feed || Date.now() - feed.accepted_at > 120000 || Date.now() - feed.source_at > 180000;
        const matches = db.prepare('SELECT payload FROM site_virtual_matches ORDER BY created_at DESC, id DESC LIMIT 200').all().map(row => {
            const m = JSON.parse(row.payload);
            const expired = m.status === 'UPCOMING' && (stale || Date.now() - m.createdAt > 180000);
            return { ...m, status: expired ? 'EXPIRED' : m.status };
        });
        return { updatedAt: feed?.accepted_at || null, sourceAt: feed?.source_at || null, stale, matches };
    }
    return { ingest, view };
}
module.exports = { createVirtualFootball };
