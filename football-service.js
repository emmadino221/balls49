'use strict';
const { createFootballTickets } = require('./football-tickets');
const { buildFootballCombinations } = require('./football-combinations');
const { fitRatings, estimateStrength } = require('./football-model');
const LEAGUES = [
    { code: 'PL', name: 'Premier League' }, { code: 'PD', name: 'La Liga' },
    { code: 'BL1', name: 'Bundesliga' }, { code: 'SA', name: 'Serie A' },
    { code: 'FL1', name: 'Ligue 1' }, { code: 'CL', name: 'Champions League' }
];

// The first model (last ten matches per team). New picks use football-model.js instead;
// this stays so scripts/football-backtest.js can compare the two.
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
    // Finished matches of earlier seasons, used only to rate teams.
    db.exec('CREATE TABLE IF NOT EXISTS football_past (code TEXT NOT NULL, season INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (code, season))');
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
    const pastMatches = code => db.prepare('SELECT data FROM football_past WHERE code=?').all(code).flatMap(row => JSON.parse(row.data));
    const hasPast = (code, season) => !!db.prepare('SELECT 1 AS found FROM football_past WHERE code=? AND season=?').get(code, season);
    const pastRetryAt = {};
    let pastCallAt = 0;
    // Earlier seasons make the team ratings much better early in a season. They are optional:
    // if the data plan refuses them, picks are made from the current season alone.
    async function refreshPast(states, now) {
        for (const { code, state } of states) {
            const kickoffs = (state.matches || []).map(m => Date.parse(m.kickoff)).filter(Number.isFinite);
            if (!kickoffs.length || state.accessDenied || state.error || now < (pastRetryAt[code] || 0)) continue;
            const start = new Date(Math.min(...kickoffs)).getUTCFullYear();
            const season = [start - 1, start - 2].find(year => !hasPast(code, year));
            if (!season) continue;
            busy = true; pastCallAt = now;
            try {
                const response = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches?season=${season}`, {
                    headers: { 'X-Auth-Token': apiKey }, signal: AbortSignal.timeout(15000), redirect: 'error'
                });
                if (!response.ok) { const failure = new Error(`HTTP ${response.status}`); failure.status = response.status; throw failure; }
                const payload = await response.json();
                if (!Array.isArray(payload.matches)) throw new Error('unexpected response');
                const rows = payload.matches.filter(m => m.status === 'FINISHED' && m.homeTeam?.id && m.awayTeam?.id && Number.isFinite(Date.parse(m.utcDate))).map(m => {
                    const score = m.score?.regularTime || (m.score?.duration === 'REGULAR' ? m.score?.fullTime : null);
                    return { kickoff: m.utcDate, homeId: m.homeTeam.id, awayId: m.awayTeam.id, homeGoals: score?.home, awayGoals: score?.away };
                }).filter(m => Number.isInteger(m.homeGoals) && m.homeGoals >= 0 && Number.isInteger(m.awayGoals) && m.awayGoals >= 0);
                db.prepare('INSERT OR REPLACE INTO football_past VALUES (?, ?, ?)').run(code, season, JSON.stringify(rows));
                console.log(`[Football] Stored ${rows.length} finished matches of ${code} season ${season} for team ratings.`);
            } catch (error) {
                pastRetryAt[code] = now + ([403, 404].includes(error.status) ? 7 * 86400000 : 6 * 3600000);
                if (error.status === 429) for (const item of states) pastRetryAt[item.code] = now + 3600000;
                console.log(`[Football] Earlier season ${season} of ${code} is not available (${error.message}); using the current season only.`);
            } finally { busy = false; }
            return;
        }
    }
    async function refresh() {
        if (!apiKey || busy) return;
        const now = Date.now();
        const states = LEAGUES.map(league => ({ ...league, state: getState(league.code) }));
        // Global spacing survives restarts and limits this service to six calls/minute.
        if (states.some(item => now < (item.state.globalRetryAt || 0))
            || now - Math.max(pastCallAt, ...states.map(item => item.state.attemptAt || 0)) < 10000) return;
        const next = states.filter(item => now >= (item.state.retryAt || 0) && now - (item.state.attemptAt || 0) >= 30 * 60000)
            .sort((a, b) => (a.state.attemptAt || 0) - (b.state.attemptAt || 0))[0];
        if (!next) return refreshPast(states, now);
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
            let ratings = null;
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
                        ratings = ratings || fitRatings([...pastMatches(code), ...matches.filter(x => x.status === 'FINISHED')], now);
                        const estimateResult = estimateStrength(m, null, now, ratings);
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
            // Each team's last ten finished matches in this competition, newest first, for the match analysis.
            const finished = (state.matches || []).filter(m => m.status === 'FINISHED' && m.homeGoals !== null && m.awayGoals !== null)
                .sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff));
            const teamForm = id => finished.filter(m => m.homeId === id || m.awayId === id).slice(0, 10).map(m => {
                const atHome = m.homeId === id, scored = atHome ? m.homeGoals : m.awayGoals, conceded = atHome ? m.awayGoals : m.homeGoals;
                return { kickoff: m.kickoff, atHome, opponent: atHome ? m.away : m.home, opponentId: atHome ? m.awayId : m.homeId,
                    scored, conceded, result: scored > conceded ? 'W' : scored < conceded ? 'L' : 'D' };
            });
            return { combinations, leagues: LEAGUES, league: code, accessDenied: !!state.accessDenied, configured: !!apiKey, updatedAt: state.updatedAt || null, error: state.error || null,
                stale: !state.updatedAt || now - state.updatedAt > 3600000,
                upcoming: next.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).map(m => ({ ...m, prediction: picks.find(p => p.id === m.id) || null, form: { home: teamForm(m.homeId), away: teamForm(m.awayId) } })),
                history: picks.filter(p => Date.parse(p.kickoff) <= now || p.outcome !== 'PENDING').slice(0, 100) };
        }
    };
}
module.exports = { createFootballService, estimate };
