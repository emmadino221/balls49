'use strict';
const MARKETS = { betzero: 'BetZero', bet49: 'Bet49', rainbow: 'Rainbow 2+', totalColor: 'Total Color 3-way', totalColor2: 'Total Color 2-way', totalColor1: 'Winning Color', hilo: 'High / Low', unified: 'Unified' };
function replayEntryPolicy(records, key, waitLosses, pauseLosses) {
    let observedLosses = 0, active = false, waitingForWin = false, batchLosses = 0;
    let wins = 0, losses = 0, playedRun = 0, worstPlayedRun = 0, pauses = 0, previous = null;
    for (const record of records) {
        const id = Number(record.drawId);
        if (previous !== null && id !== previous + 1) {
            observedLosses = 0; active = false; waitingForWin = false; batchLosses = 0; playedRun = 0;
        }
        previous = id;
        const outcome = record.result[key];
        if (!['WIN', 'LOSS'].includes(outcome)) continue;
        // Entry uses only outcomes BEFORE this draw, never this draw's result.
        if (!active && !waitingForWin && observedLosses === waitLosses) active = true;
        if (active) {
            if (outcome === 'WIN') { wins++; playedRun = 0; batchLosses = 0; active = false; }
            else {
                losses++; playedRun++; batchLosses++; worstPlayedRun = Math.max(worstPlayedRun, playedRun);
                if (batchLosses >= pauseLosses) { active = false; waitingForWin = true; batchLosses = 0; pauses++; }
            }
        }
        if (outcome === 'WIN') { observedLosses = 0; waitingForWin = false; }
        else observedLosses++;
    }
    return { wins, losses, bets: wins + losses, winRate: wins + losses ? Math.round(wins / (wins + losses) * 1000) / 10 : null, worstPlayedRun, pauses };
}
function gameplayReview(records, key) {
    const split = Math.floor(records.length * 0.7);
    const training = records.slice(0, split), validation = records.slice(split);
    const baseline = replayEntryPolicy(validation, key, 0, Number.MAX_SAFE_INTEGER);
    const candidates = [];
    for (let waitLosses = 0; waitLosses <= 4; waitLosses++) for (let pauseLosses = 1; pauseLosses <= 3; pauseLosses++) {
        const sample = replayEntryPolicy(training, key, waitLosses, pauseLosses);
        if (sample.bets >= 30) candidates.push({ waitLosses, pauseLosses, training: sample });
    }
    candidates.sort((a, b) => b.training.winRate - a.training.winRate
        || a.training.worstPlayedRun - b.training.worstPlayedRun || b.training.bets - a.training.bets);
    if (!candidates.length) return { status: 'insufficient', reason: 'Need more settled history: no entry/pause rule has 30 played examples in the older 70%.' };
    const selected = candidates[0];
    const check = replayEntryPolicy(validation, key, selected.waitLosses, selected.pauseLosses);
    return { ...selected, validation: check, baseline,
        status: check.bets < 15 ? 'insufficient' : check.winRate < baseline.winRate ? 'weaker' : 'candidate',
        reason: check.bets < 15 ? 'The selected rule has fewer than 15 played examples in the newer 30%. Observe longer.'
            : check.winRate < baseline.winRate ? 'The rule performed worse than playing every active pick on newer history. Do not treat it as an improvement.'
            : 'This rule passed the sample checks and matched or exceeded the baseline win rate on newer history. It is a candidate to review, not a proven advantage.' };
}
function historySuggestions(records, limit) {
    const seen = new Set();
    const settled = records.filter(r => r?.result && Number.isSafeInteger(Number(r.drawId)))
        .sort((a, b) => Number(b.drawId) - Number(a.drawId)).filter(r => {
            if (seen.has(String(r.drawId))) return false;
            seen.add(String(r.drawId)); return true;
        }).slice(0, limit).reverse();
    const markets = Object.entries(MARKETS).map(([key, name]) => {
        let wins = 0, losses = 0, skipped = 0, run = 0, worst = 0, previous = null, gaps = 0;
        for (const r of settled) {
            if (previous !== null && Number(r.drawId) !== previous + 1) { run = 0; gaps++; }
            previous = Number(r.drawId);
            if (r.result[key] === 'WIN') { wins++; run = 0; }
            else if (r.result[key] === 'LOSS') { losses++; run++; worst = Math.max(worst, run); }
            else skipped++;
        }
        const samples = wins + losses;
        const suggestion = samples < 50 ? 'Keep observing: fewer than 50 settled picks are available.'
            : run >= 3 ? 'Review the current losing run before making a decision. A loss does not make a win due.'
            : skipped > settled.length / 2 ? 'This market often waits. Treat skipped draws as no prediction, not a loss.'
            : 'Use these results to review consistency. Compare several windows before changing your settings.';
        return { key, name, wins, losses, skipped, samples, currentLosses: run, worstLosses: worst,
            winRate: samples ? Math.round(wins / samples * 1000) / 10 : null, gaps, suggestion, gameplay: gameplayReview(settled, key) };
    });
    return { generatedAt: new Date().toISOString(), draws: settled.length, requested: limit,
        fromDraw: settled[0]?.drawId || null, toDraw: settled.at(-1)?.drawId || null,
        lastSettledAt: settled.at(-1)?.settledAt || settled.at(-1)?.timestamp || null, markets };
}
function youtubeId(value) {
    let url;
    try { url = new URL(String(value)); } catch { throw new Error('Enter a valid YouTube link.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use an HTTPS YouTube link.');
    const host = url.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be') id = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
        id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(shorts|embed|live)\/([^/]+)\/?$/.exec(url.pathname)?.[2];
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) throw new Error('Use a YouTube watch, share, Shorts, or live video link.');
    return id;
}
module.exports = { historySuggestions, youtubeId };
