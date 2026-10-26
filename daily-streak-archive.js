'use strict';

const nigeriaDay = time => new Date(time + 3600000).toISOString().slice(0, 10);

function createDailyStreakArchive(db, keys) {
    db.exec(`CREATE TABLE IF NOT EXISTS daily_streak_archive (
        day TEXT PRIMARY KEY, summary_json TEXT NOT NULL, outcomes_json TEXT
    )`);
    const get = db.prepare('SELECT * FROM daily_streak_archive WHERE day = ?');
    const put = db.prepare(`INSERT INTO daily_streak_archive(day, summary_json, outcomes_json) VALUES (?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET summary_json=excluded.summary_json, outcomes_json=excluded.outcomes_json`);
    const list = db.prepare('SELECT day, summary_json FROM daily_streak_archive ORDER BY day DESC');
    let cursor = 0;
    function recordMany(records) {
        const groups = new Map();
        for (const record of records) {
            const time = Date.parse(record?.settledAt || record?.timestamp || '');
            if (!record?.result || !Number.isFinite(time) || !Number.isSafeInteger(Number(record.drawId))) continue;
            const day = nigeriaDay(time);
            if (!groups.has(day)) {
                const existing = get.get(day);
                // Closed days retain only aggregates; do not overwrite them with a partial replay.
                groups.set(day, existing && !existing.outcomes_json ? null : JSON.parse(existing?.outcomes_json || '{}'));
            }
            const outcomes = groups.get(day);
            if (outcomes) outcomes[String(record.drawId)] = Object.fromEntries(keys.map(key => [key,
                ['WIN', 'LOSS'].includes(record.result[key]) ? record.result[key] : 'SKIP']));
        }
        for (const [day, outcomes] of groups) {
            if (!outcomes) continue;
            const ordered = Object.entries(outcomes).sort((a, b) => Number(a[0]) - Number(b[0]));
            const markets = Object.fromEntries(keys.map(key => [key, { wins: 0, losses: 0, worstLosses: 0 }]));
            const runs = Object.fromEntries(keys.map(key => [key, 0]));
            for (const [, result] of ordered) for (const key of keys) {
                if (result[key] === 'WIN') { markets[key].wins++; runs[key] = 0; }
                else if (result[key] === 'LOSS') {
                    markets[key].losses++; runs[key]++;
                    markets[key].worstLosses = Math.max(markets[key].worstLosses, runs[key]);
                }
            }
            put.run(day, JSON.stringify({ day, draws: ordered.length, markets }), JSON.stringify(outcomes));
        }
    }
    return {
        recordMany,
        closeBefore(time) { db.prepare('UPDATE daily_streak_archive SET outcomes_json = NULL WHERE day < ?').run(nigeriaDay(time)); },
        dates() { return list.all().map(row => row.day).filter(day => day < nigeriaDay(Date.now())); },
        read(day) { const row = get.get(day); return row ? JSON.parse(row.summary_json) : null; },
        batch() {
            const rows = list.all();
            if (cursor >= rows.length) cursor = 0;
            const batch = rows.slice(cursor, cursor + 30).map(row => JSON.parse(row.summary_json));
            cursor += batch.length;
            return batch;
        },
        importSummaries(items) {
            if (!Array.isArray(items) || items.length > 30) throw new Error('Invalid daily archive batch');
            for (const item of items) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(item?.day) || !Number.isSafeInteger(item.draws) || item.draws < 0) throw new Error('Invalid daily archive');
                const markets = {};
                for (const key of keys) {
                    const m = item.markets?.[key];
                    if (!m || !['wins', 'losses', 'worstLosses'].every(k => Number.isSafeInteger(m[k]) && m[k] >= 0 && m[k] <= item.draws)) throw new Error('Invalid daily market');
                    markets[key] = { wins: m.wins, losses: m.losses, worstLosses: m.worstLosses };
                }
                put.run(item.day, JSON.stringify({ day: item.day, draws: item.draws, markets }), null);
            }
        }
    };
}
module.exports = { createDailyStreakArchive };
