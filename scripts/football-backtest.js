'use strict';
// Read-only backtest for the real football models. It changes nothing on the site.
//
// It replays past seasons match by match. For every match it predicts using only matches
// played before that day, then scores the prediction against what happened. It compares:
//   - the model the site used until now (last ten matches per team);
//   - the team-strength model in football-model.js, with and without earlier seasons;
//   - bookmaker odds, as the yardstick.
//
// Data: season files from football-data.co.uk (free), one CSV per league and season.
//   node scripts/football-backtest.js <folder> --download     fetch the files, then run
//   node scripts/football-backtest.js <folder>                run on files already there
//   add --tune to search the model settings on the older seasons first
const fs = require('fs'), path = require('path');
const { estimate } = require('../football-service');
const { fitRatings, predictMatch, DEFAULTS } = require('../football-model');

const LEAGUES = { E0: 'Premier League', SP1: 'La Liga', D1: 'Bundesliga', I1: 'Serie A', F1: 'Ligue 1' };
const SEASONS = ['2122', '2223', '2324', '2425', '2526', '2627'];
const TEST_SEASONS = ['2526', '2627'];   // never used for tuning
const DAY = 86400000;

async function download(folder) {
    fs.mkdirSync(folder, { recursive: true });
    for (const season of SEASONS) for (const league of Object.keys(LEAGUES)) {
        const file = path.join(folder, `${season}_${league}.csv`);
        const response = await fetch(`https://www.football-data.co.uk/mmz4281/${season}/${league}.csv`);
        if (!response.ok) { console.log(`  could not fetch ${season} ${league}: HTTP ${response.status}`); continue; }
        fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    }
}

function load(folder) {
    const matches = [];
    for (const season of SEASONS) for (const league of Object.keys(LEAGUES)) {
        const file = path.join(folder, `${season}_${league}.csv`);
        if (!fs.existsSync(file)) continue;
        const lines = fs.readFileSync(file, 'latin1').replace(/^﻿|^ï»¿/, '').split(/\r?\n/).filter(Boolean);
        const header = lines[0].split(','), column = name => header.indexOf(name);
        const number = (cells, name) => { const value = parseFloat(cells[column(name)]); return Number.isFinite(value) && value > 1 ? value : null; };
        for (const line of lines.slice(1)) {
            const cells = line.split(',');
            const date = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(cells[column('Date')] || '');
            const homeGoals = parseInt(cells[column('FTHG')], 10), awayGoals = parseInt(cells[column('FTAG')], 10);
            if (!date || !Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) continue;
            const time = Date.UTC(date[3].length === 2 ? 2000 + Number(date[3]) : Number(date[3]), Number(date[2]) - 1, Number(date[1]), 15);
            const odds = ['H', 'D', 'A'].map(side => number(cells, `Avg${side}`) || number(cells, `B365${side}`));
            const goalsOdds = [number(cells, 'Avg>2.5') || number(cells, 'B365>2.5'), number(cells, 'Avg<2.5') || number(cells, 'B365<2.5')];
            matches.push({ id: matches.length + 1, league, season, time, kickoff: new Date(time).toISOString(), status: 'FINISHED',
                homeId: `${league}:${cells[column('HomeTeam')]}`, awayId: `${league}:${cells[column('AwayTeam')]}`, homeGoals, awayGoals,
                odds: odds.every(Boolean) ? odds : null, goalsOdds: goalsOdds.every(Boolean) ? goalsOdds : null });
        }
    }
    return matches.sort((a, b) => a.time - b.time || a.id - b.id);
}

const clip = value => Math.max(1e-6, Math.min(1 - 1e-6, value));
function score(p, match) {
    const result = match.homeGoals > match.awayGoals ? 0 : match.homeGoals === match.awayGoals ? 1 : 2;
    const outcome = [p.home, p.draw, p.away];
    const over = match.homeGoals + match.awayGoals >= 3, both = match.homeGoals > 0 && match.awayGoals > 0;
    const top = outcome.indexOf(Math.max(...outcome));
    return {
        result, top, topChance: outcome[top], resultLoss: -Math.log(clip(outcome[result])), resultHit: top === result,
        goalsLoss: p.over25 == null ? null : -Math.log(clip(over ? p.over25 : 1 - p.over25)), goalsHit: p.over25 == null ? null : (p.over25 >= 0.5) === over,
        bothLoss: p.btts == null ? null : -Math.log(clip(both ? p.btts : 1 - p.btts)), bothHit: p.btts == null ? null : (p.btts >= 0.5) === both
    };
}

// The model the site used until now, fed only the current season as it is on the live site.
function baseline(match, seasonHistory) {
    const result = estimate(match, seasonHistory);
    if (!result) return null;
    return { home: result.probabilities.HOME / 100, draw: result.probabilities.DRAW / 100, away: result.probabilities.AWAY / 100,
        over25: result.markets.goals25.probabilities.OVER / 100, btts: result.markets.btts.probabilities.YES / 100 };
}

function bookmaker(match) {
    if (!match.odds) return null;
    const inverse = match.odds.map(o => 1 / o), total = inverse[0] + inverse[1] + inverse[2];
    const goals = match.goalsOdds ? (1 / match.goalsOdds[0]) / (1 / match.goalsOdds[0] + 1 / match.goalsOdds[1]) : null;
    return { home: inverse[0] / total, draw: inverse[1] / total, away: inverse[2] / total, over25: goals, btts: null };
}

// Walk forward one match day at a time. `models` maps a name to (match, context) => chances or null.
function replay(matches, seasons, models) {
    const rows = [];
    for (const league of Object.keys(LEAGUES)) {
        const all = matches.filter(m => m.league === league);
        let day = null, context = null;
        for (const match of all) {
            if (!seasons.includes(match.season)) continue;
            if (match.time !== day) {
                day = match.time;
                const earlier = all.filter(m => m.time < day);
                context = { earlier, season: earlier.filter(m => m.season === match.season), cache: {} };
            }
            const row = { match, predictions: {} };
            for (const [name, model] of Object.entries(models)) row.predictions[name] = model(match, context);
            rows.push(row);
        }
    }
    return rows;
}

function strength(options, { seasonOnly = false, minimum = 0 } = {}) {
    const key = JSON.stringify([options, seasonOnly]);
    return (match, context) => {
        const history = seasonOnly ? context.season : context.earlier;
        const fitted = context.cache[key] || (context.cache[key] = fitRatings(history, match.time, options));
        const p = predictMatch(fitted, match.homeId, match.awayId);
        return Math.min(p.homeWeight, p.awayWeight) < minimum ? null : p;
    };
}

const percent = value => (value == null || !Number.isFinite(value) ? '   -  ' : `${(value * 100).toFixed(1).padStart(5)}%`);
function summarise(rows, name) {
    const scored = rows.map(row => row.predictions[name] && score(row.predictions[name], row.match)).filter(Boolean);
    const mean = (key, filter = () => true) => { const values = scored.filter(s => s[key] != null && filter(s)).map(s => Number(s[key])); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; };
    return { count: scored.length, resultLoss: mean('resultLoss'), resultHit: mean('resultHit'), drawShare: mean('top', () => true) == null ? null : scored.filter(s => s.top === 1).length / Math.max(1, scored.length),
        goalsLoss: mean('goalsLoss'), goalsHit: mean('goalsHit'), bothLoss: mean('bothLoss'), bothHit: mean('bothHit') };
}

function table(title, rows, names) {
    console.log(`\n${title} (${rows.length} matches)`);
    console.log(`  ${'model'.padEnd(36)} ${'matches'.padStart(7)}  ${'1X2 loss'.padStart(8)} ${'1X2 right'.padStart(9)}  ${'O/U loss'.padStart(8)} ${'O/U right'.padStart(9)}  ${'BTTS loss'.padStart(9)} ${'BTTS right'.padStart(10)}`);
    for (const name of names) {
        const s = summarise(rows, name), loss = value => (value == null ? '    -   ' : value.toFixed(4).padStart(8));
        console.log(`  ${name.padEnd(36)} ${String(s.count).padStart(7)}  ${loss(s.resultLoss)} ${percent(s.resultHit).padStart(9)}  ${loss(s.goalsLoss)} ${percent(s.goalsHit).padStart(9)}  ${loss(s.bothLoss).padStart(9)} ${percent(s.bothHit).padStart(10)}`);
    }
}

function thresholds(rows, name) {
    console.log(`\n  ${name}: match-result picks by how sure the model is`);
    console.log(`  ${'top chance at least'.padEnd(22)} ${'picks'.padStart(6)} ${'share'.padStart(7)} ${'right'.padStart(7)} ${'avg odds'.padStart(9)} ${'return per 1'.padStart(13)}`);
    const scored = rows.filter(row => row.predictions[name]).map(row => ({ ...score(row.predictions[name], row.match), odds: row.match.odds }));
    for (const floor of [0, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70]) {
        const kept = scored.filter(s => s.topChance >= floor);
        if (kept.length < 30) continue;
        const priced = kept.filter(s => s.odds);
        const returned = priced.reduce((sum, s) => sum + (s.resultHit ? s.odds[s.top] : 0), 0) / Math.max(1, priced.length);
        const average = priced.reduce((sum, s) => sum + s.odds[s.top], 0) / Math.max(1, priced.length);
        console.log(`  ${percent(floor).padEnd(22)} ${String(kept.length).padStart(6)} ${percent(kept.length / scored.length).padStart(7)} ${percent(kept.filter(s => s.resultHit).length / kept.length).padStart(7)} ${average.toFixed(2).padStart(9)} ${returned.toFixed(3).padStart(13)}`);
    }
}

function calibration(rows, name) {
    console.log(`\n  ${name}: does a stated chance come true that often? (all three match-result outcomes)`);
    const buckets = new Map();
    for (const row of rows) {
        const p = row.predictions[name]; if (!p) continue;
        const result = row.match.homeGoals > row.match.awayGoals ? 0 : row.match.homeGoals === row.match.awayGoals ? 1 : 2;
        [p.home, p.draw, p.away].forEach((chance, index) => {
            const bucket = Math.min(8, Math.floor(chance * 10));
            const entry = buckets.get(bucket) || { count: 0, stated: 0, hits: 0 };
            entry.count++; entry.stated += chance; entry.hits += index === result ? 1 : 0; buckets.set(bucket, entry);
        });
    }
    for (const bucket of [...buckets.keys()].sort((a, b) => a - b)) {
        const entry = buckets.get(bucket);
        if (entry.count >= 50) console.log(`    said about ${percent(entry.stated / entry.count)}: happened ${percent(entry.hits / entry.count)}  (${entry.count} cases)`);
    }
}

function tune(matches) {
    const seasons = SEASONS.filter(s => !TEST_SEASONS.includes(s)).slice(1); // the first season is warm-up only
    console.log(`\nTuning on seasons ${seasons.join(', ')} (the test seasons ${TEST_SEASONS.join(', ')} are not touched)`);
    let best = null;
    for (const halfLifeDays of [120, 240, 365, 540]) for (const prior of [3, 6, 10, 16]) for (const rho of [0, -0.05, -0.1]) {
        const options = { halfLifeDays, prior, rho };
        const rows = replay(matches, seasons, { model: strength(options) });
        const s = summarise(rows, 'model'), total = s.resultLoss + s.goalsLoss + s.bothLoss;
        if (!best || total < best.total) best = { options, total, s };
        console.log(`  half-life ${String(halfLifeDays).padStart(3)}  prior ${String(prior).padStart(2)}  rho ${rho.toFixed(2).padStart(5)}  1X2 ${s.resultLoss.toFixed(4)}  O/U ${s.goalsLoss.toFixed(4)}  BTTS ${s.bothLoss.toFixed(4)}  total ${total.toFixed(4)}`);
    }
    console.log(`  best: ${JSON.stringify(best.options)}`);
    return best.options;
}

(async () => {
    const folder = process.argv[2];
    if (!folder) { console.log('Usage: node scripts/football-backtest.js <folder> [--download] [--tune]'); process.exit(1); }
    if (process.argv.includes('--download')) { console.log('Downloading season files...'); await download(folder); }
    const matches = load(folder);
    console.log(`Loaded ${matches.length} matches: ${Object.values(LEAGUES).join(', ')}; seasons ${SEASONS.join(', ')}`);
    if (matches.length < 2000) { console.log('Too few matches. Run with --download first.'); process.exit(1); }
    const options = process.argv.includes('--tune') ? tune(matches) : {};
    const settings = { ...DEFAULTS, ...options };
    console.log(`\nStrength model settings: half-life ${settings.halfLifeDays} days, prior ${settings.prior}, rho ${settings.rho}`);

    const names = { old: 'current site model (last 10)', season: 'strength model, this season only', full: 'strength model + earlier seasons', odds: 'bookmaker odds' };
    const rows = replay(matches, TEST_SEASONS, {
        [names.old]: (match, context) => baseline(match, context.season),
        [names.season]: strength(options, { seasonOnly: true }),
        [names.full]: strength(options),
        [names.odds]: bookmaker
    });
    console.log('\nLower loss is better; "right" is how often the most likely outcome happened.');
    table(`A. Every match of the test seasons ${TEST_SEASONS.join(' and ')}`, rows, Object.values(names));
    const common = rows.filter(row => row.predictions[names.old]);
    table('B. Only matches the current site model could predict (5+ matches per team this season)', common, Object.values(names));
    for (const league of Object.keys(LEAGUES)) table(`   ${LEAGUES[league]}`, common.filter(row => row.match.league === league), Object.values(names));
    console.log('\nC. Publishing only the surer picks (matches from B)');
    for (const name of [names.old, names.full, names.odds]) thresholds(common, name);
    console.log('\nD. Calibration (matches from B)');
    for (const name of [names.old, names.full]) calibration(common, name);
    console.log('\nDone. Nothing was changed.');
})();
