'use strict';
// Team-strength model for real football.
//
// Every team gets an attack and a defence rating, fitted so that goals scored against strong
// defences count for more than goals against weak ones. Recent matches weigh more than old ones,
// and teams with few matches are pulled towards the league average. Scores are then drawn from
// two Poisson distributions with the Dixon-Coles correction for low scores, which fixes the
// plain Poisson habit of predicting too few draws.
//
// The default settings were chosen with scripts/football-backtest.js on past seasons.

const DEFAULTS = {
    halfLifeDays: 365,  // a match this old counts half as much as one played today
    prior: 10,          // pseudo-goals pulling each rating towards the league average
    rho: -0.1,          // Dixon-Coles low-score correction; 0 turns it off
    meanHome: 1.5, meanAway: 1.2, meanPrior: 20, // league goal averages used until enough matches exist
    iterations: 20,
    maxGoals: 10
};

function fitRatings(matches, at, options = {}) {
    const o = { ...DEFAULTS, ...options };
    const rows = [];
    let weightSum = 0, homeGoals = 0, awayGoals = 0;
    for (const m of matches) {
        const time = typeof m.time === 'number' ? m.time : Date.parse(m.kickoff);
        if (!(time < at) || !Number.isInteger(m.homeGoals) || !Number.isInteger(m.awayGoals)) continue;
        const weight = Math.pow(0.5, (at - time) / 86400000 / o.halfLifeDays);
        if (weight < 0.01) continue;
        rows.push({ home: m.homeId, away: m.awayId, homeGoals: m.homeGoals, awayGoals: m.awayGoals, weight });
        weightSum += weight; homeGoals += weight * m.homeGoals; awayGoals += weight * m.awayGoals;
    }
    const meanHome = (homeGoals + o.meanPrior * o.meanHome) / (weightSum + o.meanPrior);
    const meanAway = (awayGoals + o.meanPrior * o.meanAway) / (weightSum + o.meanPrior);
    const teams = new Map();
    const team = id => {
        if (!teams.has(id)) teams.set(id, { attack: 1, defence: 1, weight: 0, scored: 0, scoredExpected: 0, conceded: 0, concededExpected: 0 });
        return teams.get(id);
    };
    for (const row of rows) { team(row.home).weight += row.weight; team(row.away).weight += row.weight; }
    for (let step = 0; step < o.iterations; step++) {
        for (const t of teams.values()) t.scored = t.scoredExpected = t.conceded = t.concededExpected = 0;
        for (const row of rows) {
            const home = teams.get(row.home), away = teams.get(row.away);
            home.scored += row.weight * row.homeGoals; home.scoredExpected += row.weight * meanHome * away.defence;
            away.conceded += row.weight * row.homeGoals; away.concededExpected += row.weight * meanHome * home.attack;
            away.scored += row.weight * row.awayGoals; away.scoredExpected += row.weight * meanAway * home.defence;
            home.conceded += row.weight * row.awayGoals; home.concededExpected += row.weight * meanAway * away.attack;
        }
        for (const t of teams.values()) {
            t.attack = (t.scored + o.prior) / (t.scoredExpected + o.prior);
            t.defence = (t.conceded + o.prior) / (t.concededExpected + o.prior);
        }
    }
    return { meanHome, meanAway, teams, rho: o.rho, maxGoals: o.maxGoals, matches: rows.length };
}

function poisson(mean, maxGoals) {
    const values = [Math.exp(-mean)];
    for (let i = 1; i <= maxGoals; i++) values.push(values[i - 1] * mean / i);
    return values;
}

// Chances (0..1) for one fixture. Teams the model has never seen are treated as average.
function predictMatch(model, homeId, awayId) {
    const unknown = { attack: 1, defence: 1, weight: 0 };
    const home = model.teams.get(homeId) || unknown, away = model.teams.get(awayId) || unknown;
    const clamp = value => Math.max(0.15, Math.min(4.5, value));
    const homeMean = clamp(model.meanHome * home.attack * away.defence);
    const awayMean = clamp(model.meanAway * away.attack * home.defence);
    const hp = poisson(homeMean, model.maxGoals), ap = poisson(awayMean, model.maxGoals);
    let homeWin = 0, draw = 0, awayWin = 0, over = 0, both = 0, total = 0;
    for (let i = 0; i < hp.length; i++) for (let j = 0; j < ap.length; j++) {
        let weight = hp[i] * ap[j];
        if (model.rho) {
            if (i === 0 && j === 0) weight *= 1 - homeMean * awayMean * model.rho;
            else if (i === 0 && j === 1) weight *= 1 + homeMean * model.rho;
            else if (i === 1 && j === 0) weight *= 1 + awayMean * model.rho;
            else if (i === 1 && j === 1) weight *= 1 - model.rho;
            if (weight < 0) weight = 0;
        }
        total += weight;
        if (i > j) homeWin += weight; else if (i === j) draw += weight; else awayWin += weight;
        if (i + j >= 3) over += weight;
        if (i > 0 && j > 0) both += weight;
    }
    return { home: homeWin / total, draw: draw / total, away: awayWin / total, over25: over / total, btts: both / total,
        homeMean, awayMean, homeWeight: home.weight, awayWeight: away.weight };
}

// A team needs about this many recent matches (after age weighting) before a pick is saved.
const MINIMUM_WEIGHT = 3;

// The saved-prediction shape used by football-service.js, or null when a team is too new.
// Pass `fitted` to reuse ratings already fitted for the same competition and moment.
function estimateStrength(match, history, at = Date.now(), fitted = null) {
    const model = fitted || fitRatings(history, at);
    const chances = predictMatch(model, match.homeId, match.awayId);
    if (Math.min(chances.homeWeight, chances.awayWeight) < MINIMUM_WEIGHT) return null;
    const round = value => Math.round(value * 1000) / 10;
    const probabilities = { HOME: round(chances.home), DRAW: round(chances.draw), AWAY: round(chances.away) };
    const pick = Object.keys(probabilities).sort((a, b) => probabilities[b] - probabilities[a])[0];
    const binary = (value, yes, no) => ({ pick: value >= 0.5 ? yes : no,
        probabilities: { [yes]: round(value), [no]: Math.round((100 - round(value)) * 10) / 10 }, outcome: 'PENDING' });
    return { pick, probabilities, markets: { goals25: binary(chances.over25, 'OVER', 'UNDER'), btts: binary(chances.btts, 'YES', 'NO') },
        homeSamples: Math.round(chances.homeWeight), awaySamples: Math.round(chances.awayWeight), model: 'team-strength-v1',
        explanation: `Team-strength ratings from ${model.matches} matches in this competition, weighted towards the most recent, with home advantage. Expected goals: ${chances.homeMean.toFixed(2)} to ${chances.awayMean.toFixed(2)}.` };
}

module.exports = { fitRatings, predictMatch, estimateStrength, DEFAULTS, MINIMUM_WEIGHT };
