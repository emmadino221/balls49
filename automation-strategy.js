'use strict';

const { historySuggestions } = require('./site-content');
const crypto = require('crypto');
const games = { betzero: 'u4', bet49: 'bet49', rainbow: 'color', hilo: 'sum', totalColor: 'totalColor', totalColor2: 'totalColor2', totalColor1: 'totalColor1' };
const economics = { u4: [1.65, 1], bet49: [7.8, 6], color: [1.5, 1], sum: [2, 1], totalColor: [3.8, 3], totalColor2: [3.8, 2], totalColor1: [3.8, 1] };
const unifiedGames = ['u4', 'color', 'sum', 'totalColor'];
const fail = message => Object.assign(new Error(message), { status: 409 });
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fresh = () => ({ observed: 0, waiting: true, active: false, batch: 0, attempts: 0, deficit: 0 });
function current(s) { return s.config.suggestionStrategy; }
function enabled(s) { return s.automationControl?.controller === 'website' && !current(s)?.needsReview && current(s); }
function recovery(s) { return !current(s)?.needsReview && Object.values(current(s)?.lanes || {}).some(l => l.deficit > 0 || l.attempts > 0); }

function reserve(key, base, steps) {
    const choices = key === 'unified' ? unifiedGames : [games[key]];
    let lost = 0;
    for (let i = 0; i < steps; i++) {
        let cost = 0;
        for (const k of choices) {
            const [odds, count] = economics[k];
            const stake = i ? Math.ceil((lost + base * (odds - count)) / (odds - count)) : base;
            if (stake > 50000) return Infinity;
            cost = Math.max(cost, stake * count);
        }
        lost += cost;
    }
    return lost;
}

function preview(input, records) {
    if (!Array.isArray(input.games)) throw fail('Select at least one game.');
    const keys = [...new Set(input.games || [])];
    if (!keys.length || keys.length > 7 || keys.some(k => !Object.hasOwn(games, k) && k !== 'unified') || (keys.includes('unified') && keys.length !== 1)) throw fail('Choose individual games, or Unified on its own.');
    const window = Number(input.window);
    if (![50, 100, 200, 500, 1000].includes(window)) throw fail('Choose a supported draw window.');
    const capital = Number(input.capital);
    const capitalMode = input.capitalMode === true;
    const base = Number(input.base);
    if (capitalMode ? !Number.isSafeInteger(capital) || capital < 50 || capital > 10000000 : !Number.isSafeInteger(base) || base < 50 || base > 50000) throw fail(capitalMode ? 'Enter allocated capital from NGN 50 to 10,000,000.' : 'Enter a base stake from NGN 50 to 50,000.');
    const history = historySuggestions(records, window);
    const plans = keys.map(key => {
        const market = history.markets.find(m => m.key === key), rule = market.gameplay;
        if (rule.status !== 'candidate') throw fail(`${market.name}: no eligible suggestion yet. Try a larger draw window or deselect this game.`);
        return { key, name: market.name, waitLosses: rule.waitLosses, pauseLosses: rule.pauseLosses, steps: Math.min(12, Math.max(rule.training.worstPlayedRun, rule.validation.worstPlayedRun) + 1) };
    });
    const totalReserve = amount => plans.reduce((sum, p) => sum + reserve(p.key, amount, p.steps), 0);
    let fitted = base;
    if (capitalMode) {
        let lo = 50, hi = 50000; fitted = 0;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (totalReserve(mid) <= capital) { fitted = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (!fitted) throw fail('Insufficient capital for these recovery plans at the NGN 50 minimum. Select fewer games or review a different window.');
    }
    const required = totalReserve(fitted);
    if (!Number.isFinite(required)) throw fail('A recovery stake exceeds NGN 50,000. Reduce the base stake or choose another plan.');
    const request = { games: keys, window, capitalMode, capital: capitalMode ? capital : 0, base: fitted, autoUpdate: input.autoUpdate === true };
    const result = { request, plans: plans.map(p => ({ ...p, base: fitted, reserve: reserve(p.key, fitted, p.steps) })), reserve: required, draws: history.draws, toDraw: history.toDraw };
    return { ...result, token: hash(result) };
}

function install(s, plan, previous) {
    const config = s.config;
    config.unifiedMode = plan.request.games[0] === 'unified';
    for (const key of Object.values(games)) {
        config.enabledGames[key] = config.unifiedMode ? unifiedGames.includes(key) : plan.request.games.some(g => games[g] === key);
        const p = config.unifiedMode ? plan.plans[0] : plan.plans.find(p => games[p.key] === key);
        if (p) { config.initialStakes[key] = p.base; config.maxSteps[key] = p.steps; }
    }
    for (const key of ['flatBetting', 'weightedStaking', 'bzRbRollover', 'hiloRollover', 'tc3Rollover']) config[key] = false;
    config.dynamicStakePercent = 0;
    config.tc1ProfitMode = 'fixed'; config.hiloMultiplier = 2;
    config.strategyFilters = { u4: 'follow', color: 'follow' };
    config.summaryModelMarkets = { u4: false, color: false, sum: false, totalColor: false };
    for (const key of Object.keys(config.sniperSettings || {})) config.sniperSettings[key] = { enabled: false, step: 0, resetLosses: 0 };
    config.suggestionStrategy = { ...plan, lanes: Object.fromEntries(plan.request.games.map(k => [k, fresh()])), lastObserved: Number(plan.toDraw) || 0, lastSettled: previous?.lastSettled || null, capital: plan.request.capitalMode ? plan.request.capital : null, available: plan.request.capitalMode ? plan.request.capital : null, appliedAt: Date.now(), message: 'Plan saved. Waiting for a fresh win before entry.' };
    // Re-selection starts a new entry observation, never a new execution session.
    if (previous) config.suggestionStrategy.message = 'Settled recovery completed. Latest eligible plan applied.';
}

function observe(s, records) {
    const strategy = enabled(s); if (!strategy) return;
    const ordered = records.filter(r => r.result && Number(r.drawId) > strategy.lastObserved).sort((a, b) => Number(a.drawId) - Number(b.drawId));
    for (const r of ordered) {
        for (const p of strategy.plans) {
            const lane = strategy.lanes[p.key];
            if (Number(r.drawId) !== strategy.lastObserved + 1) { lane.observed = 0; lane.waiting = true; lane.active = false; lane.batch = 0; }
            const result = r.result[p.key];
            if (result === 'WIN') { lane.observed = 0; lane.waiting = false; }
            else if (result === 'LOSS') lane.observed++;
        }
        strategy.lastObserved = Number(r.drawId);
    }
}
function allows(s, key) {
    const strategy = enabled(s); if (!strategy) return null;
    if (strategy.needsReview) return false;
    const external = key === 'unified' ? key : Object.keys(games).find(g => games[g] === key);
    const lane = strategy.lanes[external], plan = strategy.plans.find(p => p.key === external);
    if (!lane || !plan) return false;
    if (lane.attempts >= plan.steps) { s.stats.isHalted = true; s.stats.haltReason = 'Suggested recovery attempts exhausted. Review before restarting.'; return false; }
    return lane.active || (!lane.waiting && lane.observed === plan.waitLosses);
}
function stake(s, key) {
    const strategy = enabled(s); if (!strategy) return null;
    const external = s.config.unifiedMode ? 'unified' : Object.keys(games).find(g => games[g] === key);
    const lane = strategy.lanes[external], plan = strategy.plans.find(p => p.key === external);
    if (!lane || !plan || !economics[key]) return { stake: 0, odds: 0 };
    const [odds, count] = economics[key];
    return { stake: lane.deficit ? Math.ceil((lane.deficit + plan.base * (odds - count)) / (odds - count)) : plan.base, odds };
}

function settle(s, record, details, records) {
    const strategy = current(s);
    if (!strategy || strategy.needsReview || strategy.lastSettled === String(record.drawId)) return;
    const row = s.automationHistory?.find(r => r.drawId === String(record.drawId));
    if (!row || row.games.some(g => !['WIN', 'LOSS'].includes(g.result))) {
        s.stats.isHalted = true; s.stats.haltReason = 'Strategy settlement unavailable. Review the bet slip.'; return;
    }
    let won = false, net = 0;
    for (const game of row.games) {
        const laneKey = s.config.unifiedMode ? 'unified' : game.game;
        const lane = strategy.lanes[laneKey], plan = strategy.plans.find(p => p.key === laneKey);
        if (!lane || !plan) continue;
        const key = games[game.game], odds = Number(details.odds?.[key] || economics[key][0]);
        const hits = game.game === 'bet49' ? (game.selections || []).filter(n => record.result.balls?.includes(n)).length : 1;
        const payout = game.result === 'WIN' ? Math.round(game.unitStake * odds * hits) : 0;
        const profit = payout - game.stake; net += profit;
        lane.deficit = Math.max(0, lane.deficit - profit);
        lane.attempts++;
        if (game.result === 'WIN' && lane.deficit === 0) {
            won = true; lane.attempts = 0; lane.batch = 0; lane.active = false; lane.waiting = false; lane.observed = 0;
        } else {
            lane.batch++; lane.active = true;
            if (lane.batch >= plan.pauseLosses) { lane.active = false; lane.waiting = true; lane.batch = 0; }
        }
    }
    strategy.lastSettled = String(record.drawId);
    if (strategy.available !== null) strategy.available = Math.round((strategy.available + net) * 100) / 100;
    // Mixed draws may win one game while another still needs recovery.
    if (!won || recovery(s)) return;
    if (strategy.available !== null) strategy.capital = Math.floor(strategy.available);
    if (!enabled(s) || s.stats.isHalted || s.betExecutionClaim || s.pendingBetPayload) return;
    if (!strategy.request.autoUpdate && strategy.available === null) { strategy.message = 'Recovery won. Automatic strategy updates are off.'; return; }
    try {
        let next;
        if (strategy.request.autoUpdate) next = preview({ ...strategy.request, capital: strategy.capital }, records);
        else {
            let lo = 50, hi = 50000, base = 0;
            const cost = n => strategy.plans.reduce((sum, p) => sum + reserve(p.key, n, p.steps), 0);
            while (lo <= hi) { const mid = Math.floor((lo + hi) / 2); if (cost(mid) <= strategy.capital) { base = mid; lo = mid + 1; } else hi = mid - 1; }
            if (!base) throw fail('Insufficient capital for the existing plan. Review before restarting.');
            next = { request: { ...strategy.request, capital: strategy.capital, base }, plans: strategy.plans.map(p => ({ ...p, base, reserve: reserve(p.key, base, p.steps) })), reserve: cost(base), draws: strategy.draws, toDraw: record.drawId };
        }
        install(s, next, strategy);
        for (const p of current(s).plans) if (record.result[p.key] === 'WIN') current(s).lanes[p.key].waiting = false;
        if (!strategy.request.autoUpdate) current(s).message = 'Settled recovery completed. Base stake resized; entry rules kept.';
        s.automationControl.revision++;
    } catch (error) {
        // Never increase the old stake or silently pick a different market.
        strategy.message = error.status ? error.message : 'Strategy refresh unavailable.';
        strategy.needsReview = true;
        s.stats.isHalted = true; s.stats.haltReason = strategy.message;
    }
}

function checkExposure(s, payload, exposure) {
    const strategy = enabled(s); if (!strategy) return true;
    const fields = ['stake', 'bet49Stake', 'colorStake', 'sumStake', 'tcStake', 'tc2Stake', 'tc1Stake'];
    let reason = fields.some(k => Number(payload[k] || 0) > 50000) ? 'Suggested stake exceeds the NGN 50,000 limit.' : '';
    if (strategy.available !== null && exposure > strategy.available) reason = 'Insufficient allocated capital for the next bet.';
    if (payload.bet49Stake > 0 && payload.bet49?.length !== 6) reason = 'Bet49 strategy requires six numbers. Review the prediction.';
    if (!reason) return true;
    s.stats.isHalted = true; s.stats.haltReason = reason; s.pendingBetPayload = null;
    return false;
}
module.exports = { preview, install, observe, allows, stake, settle, checkExposure, recovery };
