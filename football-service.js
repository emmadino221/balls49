'use strict';

// Experimental pre-match baseline, independent of the casino prediction loop.
function estimate(match, history) {
    const recent = id => history.filter(m => m.id !== match.id && m.status === 'FINISHED'
        && Date.parse(m.kickoff) < Date.parse(match.kickoff)
        && (m.homeId === id || m.awayId === id) && m.homeGoals !== null && m.awayGoals !== null)
        .sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)).slice(0, 10);
    const home = recent(match.homeId), away = recent(match.awayId);
    if (home.length < 5 || away.length < 5) return null;
    const averages = (rows, id) => rows.reduce((sum, m) => ({
        scored: sum.scored + (m.homeId === id ? m.homeGoals : m.awayGoals) / rows.length,
        conceded: sum.conceded + (m.homeId === id ? m.awayGoals : m.homeGoals) / rows.length
    }), { scored: 0, conceded: 0 });
    const h = averages(home, match.homeId), a = averages(away, match.awayId);
    const clamp = n => Math.max(0.2, Math.min(4.5, n));
    const homeMean = clamp((h.scored + a.conceded) / 2 * 1.1);
    const awayMean = clamp((a.scored + h.conceded) / 2);
    const poisson = mean => {
        const p = [Math.exp(-mean)];
        for (let i = 1; i <= 20; i++) p.push(p[i - 1] * mean / i);
        return p;
    };
    const hp = poisson(homeMean), ap = poisson(awayMean);
    const probabilities = { HOME: 0, DRAW: 0, AWAY: 0 };
    for (let i = 0; i < hp.length; i++) for (let j = 0; j < ap.length; j++) {
        probabilities[i > j ? 'HOME' : i === j ? 'DRAW' : 'AWAY'] += hp[i] * ap[j];
    }
    const total = Object.values(probabilities).reduce((sum, p) => sum + p, 0);
    for (const key of Object.keys(probabilities)) probabilities[key] = Math.round(probabilities[key] / total * 1000) / 10;
    const pick = Object.keys(probabilities).sort((a, b) => probabilities[b] - probabilities[a])[0];
    return { pick, probabilities, homeSamples: home.length, awaySamples: away.length,
        model: 'goals-baseline-v1', explanation: `Based on ${home.length} recent home-team results and ${away.length} recent away-team results, with a home advantage adjustment.` };
}

function createFootballService(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS football_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS football_picks (id INTEGER PRIMARY KEY, data TEXT NOT NULL)`);
    const getState = () => JSON.parse(db.prepare('SELECT data FROM football_state WHERE id=1').get()?.data || '{}');
    const saveState = value => db.prepare('INSERT OR REPLACE INTO football_state VALUES (1, ?)').run(JSON.stringify(value));
    const allPicks = () => db.prepare('SELECT data FROM football_picks').all().map(row => JSON.parse(row.data));
    const savePick = pick => db.prepare('INSERT OR REPLACE INTO football_picks VALUES (?, ?)').run(pick.id, JSON.stringify(pick));
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    let busy = false;
    async function refresh() {
        if (!apiKey || busy) return;
        const previous = getState();
        if (Date.now() - (previous.attemptAt || 0) < 30 * 60 * 1000) return;
        busy = true;
        saveState({ ...previous, attemptAt: Date.now() });
        try {
            const response = await fetch('https://api.football-data.org/v4/competitions/PL/matches', {
                headers: { 'X-Auth-Token': apiKey }, signal: AbortSignal.timeout(15000), redirect: 'error'
            });
            if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}. Check your token and plan access.`);
            const payload = await response.json();
            if (!Array.isArray(payload.matches)) throw new Error('Provider returned an unexpected fixture response.');
            const goal = value => Number.isInteger(value) && value >= 0 ? value : null;
            const matches = payload.matches.filter(m => Number.isSafeInteger(m.id) && m.homeTeam?.id && m.awayTeam?.id && Number.isFinite(Date.parse(m.utcDate))).map(m => {
                const score = m.score?.regularTime || (m.score?.duration === 'REGULAR' ? m.score?.fullTime : null);
                return { id: m.id, kickoff: m.utcDate, status: m.status,
                    homeId: m.homeTeam.id, awayId: m.awayTeam.id,
                    home: String(m.homeTeam.shortName || m.homeTeam.name).slice(0, 100),
                    away: String(m.awayTeam.shortName || m.awayTeam.name).slice(0, 100),
                    homeGoals: goal(score?.home), awayGoals: goal(score?.away) };
            });
            const now = Date.now(), existing = new Map(allPicks().map(p => [p.id, p]));
            db.exec('BEGIN IMMEDIATE');
            try {
                for (const m of matches) {
                    const saved = existing.get(m.id);
                    if (saved) {
                        if (saved.outcome !== 'VOID') {
                            if (['POSTPONED', 'CANCELLED', 'SUSPENDED'].includes(m.status) || m.kickoff !== saved.kickoff) saved.outcome = 'VOID';
                            else if (m.status === 'FINISHED' && m.homeGoals !== null && m.awayGoals !== null) {
                                const result = m.homeGoals > m.awayGoals ? 'HOME' : m.homeGoals === m.awayGoals ? 'DRAW' : 'AWAY';
                                saved.outcome = result === saved.pick ? 'WIN' : 'LOSS';
                                saved.score = `${m.homeGoals} - ${m.awayGoals}`;
                            }
                            savePick(saved);
                        }
                    } else if (['TIMED', 'SCHEDULED'].includes(m.status) && Date.parse(m.kickoff) > now + 15 * 60000
                        && Date.parse(m.kickoff) <= now + 7 * 86400000) {
                        // Only results already finished at generation time can enter the model.
                        const estimateResult = estimate(m, matches.filter(x => Date.parse(x.kickoff) < now));
                        if (estimateResult) savePick({ ...m, ...estimateResult, generatedAt: now, outcome: 'PENDING' });
                    }
                }
                saveState({ attemptAt: now, updatedAt: now, error: null, matches });
                db.exec('COMMIT');
            } catch (e) { db.exec('ROLLBACK'); throw e; }
        } catch (error) {
            saveState({ ...getState(), error: /^Provider returned/.test(error.message) ? error.message : 'Football update failed. Saved data is retained; the next scheduled refresh will retry.' });
        } finally { busy = false; }
    }
    return {
        start() { if (apiKey) { refresh(); setInterval(refresh, 60000).unref(); } },
        read() {
            const state = getState(), now = Date.now();
            const picks = allPicks().sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff));
            const next = (state.matches || []).filter(m => Date.parse(m.kickoff) > now && Date.parse(m.kickoff) <= now + 7 * 86400000);
            return { configured: !!apiKey, updatedAt: state.updatedAt || null, error: state.error || null,
                stale: !state.updatedAt || now - state.updatedAt > 3600000,
                upcoming: next.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).map(m => ({ ...m, prediction: picks.find(p => p.id === m.id) || null })),
                history: picks.filter(p => Date.parse(p.kickoff) <= now || p.outcome !== 'PENDING').slice(0, 100) };
        }
    };
}
module.exports = { createFootballService };
