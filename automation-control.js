"use strict";
const strategy = require('./automation-strategy');
const { getTotalColorOutcome } = require('./total-color');
const { presetSessionBusy } = require('./preset-history');
const aliases = { u4: 'betzero', bet49: 'bet49', color: 'rainbow', sum: 'hilo', totalColor: 'totalColor', totalColor2: 'totalColor2', totalColor1: 'totalColor1' };
const fail = message => Object.assign(new Error(message), { status: 409 });
function state(s) { return s.automationControl ||= { controller: 'extension', revision: 0, executorAt: 0, executorToken: '' }; }
function stop(s, reason = 'Stopped by user') { s.stats.isHalted = true; s.stats.haltReason = reason; if (!s.betExecutionClaim) s.pendingBetPayload = null; s.failedBetRecovery = null; }
function guard(s) { const c = state(s); if (c.controller === 'website' && !s.stats.isHalted && Date.now() - c.executorAt > 15000) stop(s, 'Extension connection expired. Reconnect Bet9ja, then start again.'); }
function heartbeat(s, token) { const c = state(s); if (/^[a-f0-9]{32}$/.test(token) && (!c.executorToken || c.executorToken === token || Date.now() - c.executorAt > 15000)) { c.executorToken = token; c.executorAt = Date.now(); } }
function settings(s) {
 const out = { stakes: {}, gameSteps: {}, enabledGames: {} };
 for (const [key, name] of Object.entries(aliases)) { out.stakes[name] = s.config.initialStakes[key]; out.gameSteps[name] = s.config.maxSteps[key]; out.enabledGames[name] = !!s.config.enabledGames[key]; }
 for (const key of ['takeProfit','stopLoss','hiloMultiplier','tc1ProfitMode','flatBetting','unifiedMode','sniperSettings','summaryModelMarkets','summaryModelTargets','bzRbRollover','hiloRollover','tc3Rollover','tc3RolloverTarget','cbMaxLosses','cbCooldown','shadowMode','weightedStaking']) out[key] = s.config[key];
 return out;
}
function view(s) { guard(s); const c = state(s); return { suggestionStrategy: s.config.suggestionStrategy || null, controller: c.controller, revision: c.revision, resetAt: c.resetAt || null, online: Date.now() - c.executorAt < 15000, lastSeen: c.executorAt || null, running: !s.stats.isHalted, reason: s.stats.haltReason || (s.lastBetDetails ? 'Waiting for settlement' : s.pendingBetPayload ? 'Bet queued' : 'Waiting for next eligible draw'), settings: settings(s), busy: presetSessionBusy(s) || strategy.recovery(s), balanceAt: s.stats.balanceAt || null, liveBalance: s.stats.balanceAt ? s.stats.liveAccountBalance : null, virtualBalance: s.stats.virtualBalance, profit: s.stats.totalReturned, wins: s.stats.wins, losses: s.stats.losses, steps: Object.fromEntries(Object.entries(s.martingaleState).map(([key,value]) => [aliases[key] || key, (s.config.unifiedMode ? s.masterState.step : value.localStep)])), history: s.automationHistory || [] }; }
function normalize(input) {
 const out = {};
 for (const [field,max] of [['stakes',50000],['gameSteps',1000]]) { out[field] = {}; for (const key of Object.values(aliases)) { const n = Number(input[field]?.[key]); if (!Number.isSafeInteger(n) || n < 0 || n > max) throw fail(`Invalid ${field} for ${key}.`); out[field][key] = n; } }
 out.enabledGames = {}; for (const key of Object.values(aliases)) out.enabledGames[key] = input.enabledGames?.[key] === true;
 for (const [field,min,max] of [['takeProfit',0,10000000],['stopLoss',-10000000,0],['cbMaxLosses',0,50],['cbCooldown',0,300],['tc3RolloverTarget',2,10]]) { const n = Number(input[field] ?? (field === 'tc3RolloverTarget' ? 3 : 0)); if (!Number.isSafeInteger(n) || n < min || n > max) throw fail(`Invalid ${field}.`); out[field] = n; }
 out.hiloMultiplier = Number(input.hiloMultiplier); if (![1.4,2].includes(out.hiloMultiplier)) throw fail('Choose a supported High/Low multiplier.');
 out.tc1ProfitMode = input.tc1ProfitMode === 'accumulating' ? 'accumulating' : 'fixed';
 for (const key of ['flatBetting','unifiedMode','bzRbRollover','hiloRollover','tc3Rollover','shadowMode','weightedStaking']) out[key] = input[key] === true;
 if (out.unifiedMode && out.enabledGames.totalColor1) throw fail('Winning Color requires individual mode.');
 out.sniperSettings = {};
 for (const key of [...Object.values(aliases),'unified']) { const v = input.sniperSettings?.[key] || {}; const step = Number(v.step || 0), resetLosses = Number(v.resetLosses || 0); if (!Number.isInteger(step) || step < 0 || step > 10 || !Number.isInteger(resetLosses) || resetLosses < 0 || resetLosses > 50 || (v.enabled && (!step || !resetLosses))) throw fail('Sniper needs step 1-10 and reset losses 1-50.'); out.sniperSettings[key] = { enabled: v.enabled === true, step, resetLosses }; }
 out.summaryModelMarkets = {}; out.summaryModelTargets = {};
 for (const key of ['u4','color','sum','totalColor']) { out.summaryModelMarkets[key] = input.summaryModelMarkets?.[key] === true; out.summaryModelTargets[key] = input.summaryModelTargets?.[key] === 'HOLD' ? 'HOLD' : 'ENTER'; }
 return out;
}
function command(s, cfg, busy, records = []) {
 const c = state(s), action = cfg.dashboardAction;
 if (!action) { if (c.controller === 'website') { if (cfg.running === false) { stop(s); c.revision++; return { done: true }; } throw fail('Website controls this session. Stop or switch back to extension control first.'); } return null; }
 if (action === 'stop') { stop(s); c.revision++; return { done: true }; }
 if (action === 'extension') { stop(s); if (s.config.suggestionStrategy) s.config.suggestionStrategy.needsReview = true; c.controller = 'extension'; c.revision++; return { done: true }; }
 if (cfg.revision !== c.revision) throw fail('Settings changed. Refresh the dashboard before continuing.');
 if (action === 'website') { stop(s); c.controller = 'website'; c.revision++; return { done: true }; }
 if (c.controller !== 'website') throw fail('Switch to website control first.');
 if (action === 'strategy-preview' || action === 'strategy-apply') {
  const plan = strategy.preview(cfg.settings || {}, records);
  if (action === 'strategy-preview') return { done: true, result: { preview: plan } };
  if (!s.stats.isHalted || busy || strategy.recovery(s)) throw fail('Stop and finish recovery before applying a suggestion.');
  if (cfg.settings?.token !== plan.token) throw fail('History or settings changed. Preview the plan again.');
  strategy.install(s, plan); c.revision++;
  return { done: true };
 }
 if (action === 'start') { if (s.config.suggestionStrategy?.needsReview) throw fail('Review and reapply the strategy after resetting execution.'); if (Date.now() - c.executorAt > 10000) throw fail('Open Bet9ja with the updated extension connected first.'); if (s.betExecutionClaim || s.lastBetDetails) throw fail('Wait for the placed bet to settle.'); if (!Object.keys(aliases).some(k => s.config.enabledGames[k] && s.config.initialStakes[k] > 0)) throw fail('Enable a game and save a stake first.'); c.revision++; return { config: { running: true } }; }
 if (action === 'save') { if (!s.stats.isHalted || busy) throw fail('Stop and finish the active recovery sequence before changing settings. Progression is preserved.'); const config = normalize(cfg.settings || {}); if (strategy.recovery(s)) throw fail('Finish the suggested recovery before changing settings.'); delete s.config.suggestionStrategy; c.revision++; return { config: { ...config, running: false } }; }
 throw fail('Unknown dashboard action.');
}
function record(s, drawId, details, prediction) {
 const rows = details.games.map(key => {
  const selections = key === 'bet49' ? details.bet49Numbers : details.colorSelections?.[key] || prediction?.[aliases[key]];
  const count = key === 'bet49' ? selections.length : key === 'totalColor' ? details.colorSelections?.totalColor.length ?? 3 : key === 'totalColor2' ? details.colorSelections?.totalColor2.length ?? 2 : 1;
  return { game: aliases[key] || key, unitStake: details.stakes[key], stake: details.stakes[key] * count, selections, result: 'PENDING' };
 });
 s.automationHistory ||= []; s.automationHistory = [{ drawId: String(drawId), at: Date.now(), games: rows }, ...s.automationHistory.filter(r => r.drawId !== String(drawId))].slice(0,100);
}
function settle(s, record) {
 const row = s.automationHistory?.find(r => r.drawId === String(record.drawId)); if (!row) return;
 for (const game of row.games) {
  if (game.game === 'bet49') game.result = (game.selections || []).some(n => record.result.balls?.includes(n)) ? 'WIN' : 'LOSS';
  else if (['totalColor','totalColor2'].includes(game.game) && Array.isArray(game.selections)) game.result = game.selections.includes(getTotalColorOutcome(record.result.balls)) ? 'WIN' : 'LOSS';
  else game.result = record.result[game.game] || 'UNKNOWN';
 }
}
module.exports = { state, stop, guard, heartbeat, view, settings, command, record, settle };
