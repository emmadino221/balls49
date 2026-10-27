'use strict';

function buildFootballCombinations(picks, leagues, now = Date.now()) {
    const ranked = [], seen = new Set();
    for (const p of picks) {
        const league = leagues.find(l => l.code === (p.league || 'PL'));
        const state = league?.state;
        const fixture = state?.matches?.find(m => m.id === p.id);
        const kickoff = Date.parse(p.kickoff);
        if (!state?.updatedAt || now - state.updatedAt > 3600000 || state.error
            || !fixture || !['SCHEDULED', 'TIMED'].includes(fixture.status)
            || fixture.kickoff !== p.kickoff || p.outcome !== 'PENDING'
            || !Number.isFinite(kickoff) || kickoff <= now + 15 * 60000 || kickoff > now + 7 * 86400000
            || !Number.isFinite(p.generatedAt) || p.generatedAt >= kickoff || seen.has(p.id)) continue;
        const options = [];
        const add = (market, values, labels) => {
            for (const [key, label] of Object.entries(labels)) {
                const probability = values?.[key];
                if (typeof probability === 'number' && Number.isFinite(probability) && probability >= 0 && probability <= 100) {
                    options.push({ market, outcome: key, label, probability });
                }
            }
        };
        add('Match result', p.probabilities, { HOME: 'Home win (1)', DRAW: 'Draw (X)', AWAY: 'Away win (2)' });
        if (p.markets?.goals25?.outcome === 'PENDING') add('Goals 2.5', p.markets.goals25.probabilities, { OVER: 'Over 2.5', UNDER: 'Under 2.5' });
        if (p.markets?.btts?.outcome === 'PENDING') add('Both teams score', p.markets.btts.probabilities, { YES: 'Yes', NO: 'No' });
        // Equal estimates retain the explicit market/outcome order above.
        options.sort((a, b) => b.probability - a.probability);
        if (!options.length) continue;
        seen.add(p.id);
        ranked.push({ id: p.id, home: p.home, away: p.away, kickoff: p.kickoff,
            league: league.name, generatedAt: p.generatedAt, ...options[0] });
    }
    ranked.sort((a, b) => b.probability - a.probability || Date.parse(a.kickoff) - Date.parse(b.kickoff) || a.id - b.id);
    return { generatedAt: now, eligible: ranked.length,
        lists: [3, 5, 10, 20].map(size => ({ size, selections: ranked.slice(0, size) })) };
}
module.exports = { buildFootballCombinations };
