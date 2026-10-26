'use strict';
const MARKETS = { betzero: 'BetZero', bet49: 'Bet49', rainbow: 'Rainbow 2+', totalColor: 'Total Color 3-way', totalColor2: 'Total Color 2-way', totalColor1: 'Winning Color', hilo: 'High / Low', unified: 'Unified' };
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
            winRate: samples ? Math.round(wins / samples * 1000) / 10 : null, gaps, suggestion };
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
