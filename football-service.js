'use strict';
const { createFootballTickets } = require('./football-tickets');
const { buildFootballCombinations } = require('./football-combinations');
const LEAGUES = [
    { code: 'PL', name: 'Premier League' }, { code: 'PD', name: 'La Liga' },
    { code: 'BL1', name: 'Bundesliga' }, { code: 'SA', name: 'Serie A' },
    { code: 'FL1', name: 'Ligue 1' }, { code: 'CL', name: 'Champions League' }
];

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
    let over = 0, both = 0;
    for (let i = 0; i < hp.length; i++) for (let j = 0; j < ap.length; j++) {
        const weight = hp[i] * ap[j];
        probabilities[i > j ? 'HOME' : i === j ? 'DRAW' : 'AWAY'] += weight;
        if (i + j >= 3) over += weight;
        if (i > 0 && j > 0) both += weight;
    }
    const total = Object.values(probabilities).reduce((sum, p) => sum + p, 0);
    for (const key of Object.keys(probabilities)) probabilities[key] = Math.round(probabilities[key] / total * 1000) / 10;
    const pick = Object.keys(probabilities).sort((a, b) => probabilities[b] - probabilities[a])[0];
    const binary = (value, yes, no) => {
        const percentage = Math.round(value / total * 1000) / 10;
        return { pick: value / total >= 0.5 ? yes : no,
            probabilities: { [yes]: percentage, [no]: Math.round((100 - percentage) * 10) / 10 }, outcome: 'PENDING' };
    };
    return { pick, probabilities, markets: { goals25: binary(over, 'OVER', 'UNDER'), btts: binary(both, 'YES', 'NO') }, homeSamples: home.length, awaySamples: away.length,
        model: 'goals-baseline-v2', explanation: `Based on ${home.length} recent home-team results and ${away.length} recent away-team results, with a home advantage adjustment.` };
}

function createFootballService(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS football_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS football_picks (id INTEGER PRIMARY KEY, data TEXT NOT NULL)`);
    db.exec('CREATE TABLE IF NOT EXISTS football_league_state (code TEXT PRIMARY KEY, data TEXT NOT NULL)');
    // Preserve the original Premier League cache and picks on upgrade.
    const legacy = db.prepare('SELECT data FROM football_state WHERE id=1').get();
    if (legacy) db.prepare('INSERT OR IGNORE INTO football_league_state VALUES (?, ?)').run('PL', legacy.data);
    const getState = code => JSON.parse(db.prepare('SELECT data FROM football_league_state WHERE code=?').get(code)?.data || '{}');
    const saveState = (code, value) => db.prepare('INSERT OR REPLACE INTO football_league_state VALUES (?, ?)').run(code, JSON.stringify(value));
    const allPicks = () => db.prepare('SELECT data FROM football_picks').all().map(row => JSON.parse(row.data));
    const savePick = pick => db.prepare('INSERT OR REPLACE INTO football_picks VALUES (?, ?)').run(pick.id, JSON.stringify(pick));
    const tickets = createFootballTickets(db, allPicks);
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    let busy = false;
    async function refresh() {
        if (!apiKey || busy) return;
        const now = Date.now();
        const states = LEAGUES.map(league => ({ ...league, state: getState(league.code) }));
        // Global spacing survives restarts and limits this service to six calls/minute.
        if (states.some(item => now < (item.state.globalRetryAt || 0))
            || now - Math.max(0, ...states.map(item => item.state.attemptAt || 0)) < 10000) return;
        const next = states.filter(item => now >= (item.state.retryAt || 0) && now - (item.state.attemptAt || 0) >= 30 * 60000)
            .sort((a, b) => (a.state.attemptAt || 0) - (b.state.attemptAt || 0))[0];
        if (!next) return;
        const code = next.code, previous = next.state;
        busy = true;
        saveState(code, { ...previous, attemptAt: Date.now() });
        try {
            const response = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches`, {
                headers: { 'X-Auth-Token': apiKey }, signal: AbortSignal.timeout(15000), redirect: 'error'
            });
            if (!response.ok) {
                const failure = new Error(`Provider returned HTTP ${response.status}. Check your token and plan access.`);
                failure.status = response.status;
                const retryHeader = response.headers.get('retry-after');
                const seconds = Number(retryHeader);
                failure.retryAt = Math.max(Date.now() + 30 * 60000,
                    Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryHeader) || 0);
                throw failure;
            }
            const payload = await response.json();
            if (!Array.isArray(payload.matches)) throw new Error('Provider returned an unexpected fixture response.');
            const goal = value => Number.isInteger(value) && value >= 0 ? value : null;
            const matches = payload.matches.filter(m => Number.isSafeInteger(m.id) && m.homeTeam?.id && m.awayTeam?.id && Number.isFinite(Date.parse(m.utcDate))).map(m => {
                const score = m.score?.regularTime || (m.score?.duration === 'REGULAR' ? m.score?.fullTime : null);
                return { league: code, id: m.id, kickoff: m.utcDate, status: m.status,
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
                        if ((saved.league || 'PL') !== code) continue;
                        if (saved.outcome !== 'VOID') {
                            if (['POSTPONED', 'CANCELLED', 'SUSPENDED'].includes(m.status) || m.kickoff !== saved.kickoff) {
                                saved.outcome = 'VOID';
                                for (const market of Object.values(saved.markets || {})) market.outcome = 'VOID';
                            }
                            else if (m.status === 'FINISHED' && m.homeGoals !== null && m.awayGoals !== null) {
                                const result = m.homeGoals > m.awayGoals ? 'HOME' : m.homeGoals === m.awayGoals ? 'DRAW' : 'AWAY';
                                saved.outcome = result === saved.pick ? 'WIN' : 'LOSS';
                                saved.score = `${m.homeGoals} - ${m.awayGoals}`;
                                const actual = { goals25: m.homeGoals + m.awayGoals >= 3 ? 'OVER' : 'UNDER', btts: m.homeGoals > 0 && m.awayGoals > 0 ? 'YES' : 'NO' };
                                for (const [key, result] of Object.entries(actual)) {
                                    if (saved.markets?.[key]) saved.markets[key].outcome = saved.markets[key].pick === result ? 'WIN' : 'LOSS';
                                }
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
                saveState(code, { attemptAt: now, updatedAt: now, error: null, matches });
                db.exec('COMMIT');
            } catch (e) { db.exec('ROLLBACK'); throw e; }
        } catch (error) {
            saveState(code, { ...getState(code), retryAt: error.retryAt || 0, globalRetryAt: error.status === 429 ? error.retryAt : 0, accessDenied: error.status === 403, error: /^Provider returned/.test(error.message) ? error.message : 'Football update failed. Saved data is retained; the next scheduled refresh will retry.' });
        } finally { busy = false; }
    }
    return {
        saveCombination(size, fingerprint) {
            if (![3, 5, 10, 20].includes(size) || !/^[a-f0-9]{64}$/.test(fingerprint || '')) throw new Error('Invalid combination.');
            if (tickets.exists(fingerprint)) return { id: fingerprint, alreadySaved: true };
            const current = buildFootballCombinations(allPicks(), LEAGUES.map(l => ({ ...l, state: getState(l.code) })));
            const list = current.lists.find(l => l.size === size);
            if (list.selections.length !== size) throw new Error('Not enough eligible matches to save this combination.');
            if (list.fingerprint !== fingerprint) throw new Error('Selections have changed. Refresh and review the list before saving.');
            return { id: tickets.save(list), alreadySaved: false };
        },
        combinationHistory(offset) { return tickets.history(offset); },
        start() { if (apiKey) { refresh(); setInterval(refresh, 10000).unref(); } },
        read(requested = 'PL') {
            const code = LEAGUES.some(l => l.code === requested) ? requested : 'PL';
            const state = getState(code), now = Date.now();
            const storedPicks = allPicks();
            const combinations = buildFootballCombinations(storedPicks, LEAGUES.map(l => ({ ...l, state: getState(l.code) })), now);
            const picks = storedPicks.filter(p => (p.league || 'PL') === code).sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff));
            const next = (state.matches || []).filter(m => Date.parse(m.kickoff) > now && Date.parse(m.kickoff) <= now + 7 * 86400000);
            return { combinations, leagues: LEAGUES, league: code, accessDenied: !!state.accessDenied, configured: !!apiKey, updatedAt: state.updatedAt || null, error: state.error || null,
                stale: !state.updatedAt || now - state.updatedAt > 3600000,
                upcoming: next.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).map(m => ({ ...m, prediction: picks.find(p => p.id === m.id) || null })),
                history: picks.filter(p => Date.parse(p.kickoff) <= now || p.outcome !== 'PENDING').slice(0, 100) };
        }
    };
}
module.exports = { createFootballService };
