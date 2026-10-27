'use strict';

function legResult(leg, pick) {
    if (!pick) return 'PENDING';
    if (pick.outcome === 'VOID') return 'VOID';
    if (!['WIN', 'LOSS'].includes(pick.outcome) || !/^\d+ - \d+$/.test(pick.score || '')) return 'PENDING';
    const [home, away] = pick.score.split(' - ').map(Number);
    const actual = leg.market === 'Match result' ? (home > away ? 'HOME' : home === away ? 'DRAW' : 'AWAY')
        : leg.market === 'Goals 2.5' ? (home + away >= 3 ? 'OVER' : 'UNDER')
        : leg.market === 'Both teams score' ? (home > 0 && away > 0 ? 'YES' : 'NO') : null;
    return actual ? actual === leg.outcome ? 'WIN' : 'LOSS' : 'PENDING';
}

function createFootballTickets(db, allPicks) {
    db.exec(`CREATE TABLE IF NOT EXISTS football_tickets (
        id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, selections_json TEXT NOT NULL, size INTEGER NOT NULL
    )`);
    return {
        exists(id) { return db.prepare('SELECT id FROM football_tickets WHERE id=?').get(id); },
        save(list) {
            db.prepare('INSERT OR IGNORE INTO football_tickets VALUES (?, ?, ?, ?)')
                .run(list.fingerprint, Date.now(), JSON.stringify(list.selections), list.size);
            return list.fingerprint;
        },
        history(offset = 0) {
            const picks = new Map(allPicks().map(p => [p.id, p]));
            const total = db.prepare('SELECT COUNT(*) AS n FROM football_tickets').get().n;
            const tickets = db.prepare('SELECT * FROM football_tickets ORDER BY created_at DESC, id LIMIT 20 OFFSET ?').all(offset).map(row => {
                const selections = JSON.parse(row.selections_json).map(leg => {
                    const pick = picks.get(leg.id);
                    return { ...leg, result: legResult(leg, pick), score: pick?.score || null };
                });
                const results = selections.map(s => s.result);
                const result = results.includes('LOSS') ? 'LOSS' : results.includes('PENDING') ? 'PENDING'
                    : results.every(r => r === 'VOID') ? 'VOID' : 'WIN';
                return { id: row.id, createdAt: row.created_at, size: row.size, selections, result };
            });
            return { total, tickets, offset };
        }
    };
}
module.exports = { createFootballTickets };
