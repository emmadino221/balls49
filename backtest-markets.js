'use strict';

// Offline analysis only: never import bot.js (it starts services and automation).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { applyPreviousDrawRule, singleColorPrediction } = require('./total-color');
const { predictHighLow } = require('./high-low');
const { predictBetZero } = require('./betzero');

const args = process.argv.slice(2);
if (args.includes('--help')) {
    console.log('node backtest-markets.js [--draws draws.json] [--out report.json]\nUses 100 warm-up draws; reserves the newest 30% of eligible draws for holdout. No bets, network calls or bot startup.');
    process.exit(0);
}
const options = {};
for (let i = 0; i < args.length; i += 2) {
    if (!['--draws', '--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
        throw new Error('Invalid arguments. Use --help.');
    }
    options[args[i]] = args[i + 1];
}
const input = path.resolve(options['--draws'] || path.join(__dirname, 'draws.json'));
const raw = fs.readFileSync(input, 'utf8');
const parsed = JSON.parse(raw);
const rows = Array.isArray(parsed) ? parsed : parsed.data?.draws || parsed.draws;
if (!Array.isArray(rows)) throw new Error('Expected an array of draws, or {draws: []}/{data: {draws: []}}.');
const color = n => n === 49 ? 'yellow' : ['red', 'blue', 'green'][(n - 1) % 3];
const byId = new Map();
let invalid = 0, duplicates = 0;
for (const row of rows) {
    const id = Number(row?.id);
    const nums = typeof row?.dr === 'string' ? row.dr.split(',').map(Number) : [];
    if (!Number.isSafeInteger(id) || id <= 0 || nums.length !== 6 || new Set(nums).size !== 6
        || nums.some(n => !Number.isInteger(n) || n < 1 || n > 49)) { invalid++; continue; }
    const signature = [...nums].sort((a, b) => a - b).join(',');
    if (byId.has(id)) {
        if (byId.get(id).signature !== signature) throw new Error(`Conflicting results for draw ${id}; resolve the input before analysis.`);
        duplicates++; continue;
    }
    byId.set(id, { id, nums, signature, dr: nums.join(','), total: nums.reduce((s, n) => s + n, 0) });
}
const draws = [...byId.values()].sort((a, b) => a.id - b.id);
// Read the current generator itself to avoid maintaining a stale copy of its rules.
const source = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
const start = source.indexOf('function computePredictions(');
const end = source.indexOf('\nfunction processUpdates', start);
if (start < 0 || end <= start) throw new Error('Cannot locate the current prediction generator.');
const generator = source.slice(start, end);
const replayPredictions = [];
const context = vm.createContext({ getBallColor: color, applyPreviousDrawRule, singleColorPrediction,
    predictHighLow, predictBetZero, predictionLog: replayPredictions,
    getBet49Prediction: () => null }); // Bet49 is outside this comparison; no persistent target state.
vm.runInContext(generator, context, { timeout: 1000 });

const candidates = [
    ['BetZero', 'Current', p => p.current.betzeroStatus === 'ACTIVE' ? p.current.unlikely4.map(n => n.number) : null],
    ['BetZero', 'Least frequent 100', p => p.ranked(false)],
    ['BetZero', 'Most frequent 100', p => p.ranked(true)],
    ['BetZero', 'Fixed 1,2,3,4', () => [1, 2, 3, 4]],
    ['Rainbow', 'Current', p => p.current.rainbowStatus === 'ACTIVE' ? p.current.topColor.name : null],
    ...['red', 'blue', 'green'].map(c => ['Rainbow', `Fixed ${c}`, () => c]),
    ['Rainbow', 'Most 2+ ball outcomes 100', p => p.bestRainbow]
];
const eligible = [];
for (let i = 100; i < draws.length; i++) {
    // Require an uninterrupted 100-draw lookback and its following target.
    if (draws[i].id - draws[i - 100].id === 100) eligible.push(i);
}
if (eligible.length < 20) throw new Error('Need at least 20 evaluable draws following 100 consecutive valid history draws.');
const split = Math.floor(eligible.length * 0.7);
const fresh = () => ({ draws: 0, picks: 0, wins: 0, losses: 0, skipped: 0, currentLosses: 0, worstLosses: 0 });
const stats = Object.fromEntries(['development', 'holdout'].map(phase => [phase, candidates.map(() => fresh())]));
let previousId = null;
eligible.forEach((index, position) => {
    const actual = draws[index];
    const history = draws.slice(index - 100, index).reverse();
    const current = context.computePredictions({ data: { draws: history } }, null, null, null, null, null, actual.id);
    replayPredictions.push({ drawId: actual.id, predicted: {
        betzero: current.betzeroStatus === 'ACTIVE' ? current.unlikely4.map(n => n.number) : []
    } });
    const counts = Array(50).fill(0);
    const successes = { red: 0, blue: 0, green: 0 };
    for (const draw of history) {
        draw.nums.forEach(n => counts[n]++);
        for (const c of Object.keys(successes)) if (draw.nums.filter(n => color(n) === c).length >= 2) successes[c]++;
    }
    const ranked = descending => Array.from({ length: 49 }, (_, i) => i + 1)
        .sort((a, b) => (descending ? counts[b] - counts[a] : counts[a] - counts[b]) || a - b).slice(0, 4);
    const bestRainbow = Object.keys(successes).sort((a, b) => successes[b] - successes[a])[0];
    const phase = position < split ? 'development' : 'holdout';
    candidates.forEach(([market, , choose], k) => {
        const s = stats[phase][k];
        if (previousId !== null && actual.id !== previousId + 1) s.currentLosses = 0;
        s.draws++;
        const pick = choose({ current, ranked, bestRainbow });
        if (pick === null) { s.skipped++; return; }
        const won = market === 'BetZero' ? pick.every(n => !actual.nums.includes(n))
            : actual.nums.filter(n => color(n) === pick).length >= 2;
        s.picks++;
        if (won) { s.wins++; s.currentLosses = 0; }
        else { s.losses++; s.currentLosses++; s.worstLosses = Math.max(s.worstLosses, s.currentLosses); }
    });
    previousId = actual.id;
});
const report = {
    generatedAt: new Date().toISOString(),
    generatorSha256: crypto.createHash('sha256').update(generator).digest('hex'),
    inputSha256: crypto.createHash('sha256').update(raw).digest('hex'),
    data: { validDraws: draws.length, invalid, duplicates, warmup: 100, eligible: eligible.length,
        excludedAfterWarmup: Math.max(0, draws.length - 100 - eligible.length) },
    methodology: 'Rules fixed before replay. Oldest 70% development, newest 30% holdout. Each target uses only earlier draws. Skips preserve a loss run; missing-ID gaps and phase boundaries reset it. No ML/summary/sniper gates, stakes, payouts or live execution simulated. Historical results do not establish a future advantage; do not repeatedly tune against holdout.',
    phases: {}
};
for (const phase of ['development', 'holdout']) {
    const ids = eligible.slice(phase === 'development' ? 0 : split, phase === 'development' ? split : undefined);
    report.phases[phase] = { firstDraw: draws[ids[0]].id, lastDraw: draws[ids.at(-1)].id,
        results: candidates.map(([market, strategy], k) => {
            const { currentLosses, ...s } = stats[phase][k];
            return { market, strategy, ...s, winRate: s.picks ? +(100 * s.wins / s.picks).toFixed(2) : null,
                coverage: +(100 * s.picks / s.draws).toFixed(2) };
        }) };
    console.log(`\n${phase.toUpperCase()} (${report.phases[phase].firstDraw}–${report.phases[phase].lastDraw})`);
    console.table(report.phases[phase].results);
}
console.log(report.methodology);
console.log('Data quality:', report.data);
if (options['--out']) {
    // Exclusive creation prevents overwriting runtime data or a prior report.
    fs.writeFileSync(path.resolve(options['--out']), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log('Report saved:', path.resolve(options['--out']));
}
