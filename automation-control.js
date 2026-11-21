"use strict";
const strategy = require('./automation-strategy');
const gapEntry = require('./automation-gap-entry');
const rollover = require('./betzero-rollover');
const { getTotalColorOutcome } = require('./total-color');
const { presetSessionBusy } = require('./preset-history');
const aliases = { u4: 'betzero', bet49: 'bet49', color: 'rainbow', sum: 'hilo', totalColor: 'totalColor', totalColor1: 'totalColor1' };
const fail = message => Object.assign(new Error(message), { status: 409 });
// The website and the extension share one saved setup. The session always runs with the
// website's safeguards (one connected executor, stop when it disconnects); either side may save.
function state(s) { const c = s.automationControl ||= { controller: 'website', revision: 0, executorAt: 0, executorToken: '' }; c.controller = 'website'; return c; }
function stop(s, reason = 'Stopped by user') { s.stats.isHalted = true; s.stats.haltReason = reason; if (!s.betExecutionClaim) s.pendingBetPayload = null; s.failedBetRecovery = null; }
function guard(s) { const c = state(s); if (c.controller === 'website' && !s.stats.isHalted && Date.now() - c.executorAt > 15000) stop(s, 'Extension connection expired. Reconnect Bet9ja, then start again.'); }
function heartbeat(s, token) { const c = state(s); if (/^[a-f0-9]{32}$/.test(token) && (!c.executorToken || c.executorToken === token || Date.now() - c.executorAt > 15000)) { c.executorToken = token; c.executorAt = Date.now(); } }
function settings(s) {
 const out = { stakes: {}, gameSteps: {}, enabledGames: {} };
 for (const [key, name] of Object.entries(aliases)) { out.stakes[name] = s.config.initialStakes[key]; out.gameSteps[name] = s.config.maxSteps[key]; out.enabledGames[name] = !!s.config.enabledGames[key]; }
 for (const key of ['takeProfit','stopLoss','hiloMultiplier','tc1ProfitMode','bet49ProfitMode','flatBetting','unifiedMode','gapEntry','sniperSettings','summaryModelMarkets','summaryModelTargets','bzRbRollover','hiloRollover','tc3Rollover','tc3RolloverTarget','cbMaxLosses','cbCooldown','shadowMode','weightedStaking']) out[key] = s.config[key];
 out.rollover = { ...rollover.config(s) };
 return out;
}
function view(s) { guard(s); const c = state(s); return { rollover: rollover.view(s), gapEntry: gapEntry.view(s), suggestionStrategy: s.config.suggestionStrategy || null, controller: c.controller, revision: c.revision, resetAt: c.resetAt || null, online: Date.now() - c.executorAt < 15000, lastSeen: c.executorAt || null, running: !s.stats.isHalted, reason: s.stats.haltReason || (s.lastBetDetails ? 'Waiting for settlement' : s.pendingBetPayload ? 'Bet queued' : 'Waiting for next eligible draw'), settings: settings(s), busy: presetSessionBusy(s) || strategy.recovery(s), balanceAt: s.stats.balanceAt || null, liveBalance: s.stats.balanceAt ? s.stats.liveAccountBalance : null, virtualBalance: s.stats.virtualBalance, profit: s.stats.totalReturned, settledDraws: s.stats.settledDraws || 0, currentLossStreak: s.stats.currentLossStreak || 0, maxLossStreak: s.stats.maxLossStreak || 0, wins: s.stats.wins, losses: s.stats.losses, steps: Object.fromEntries(Object.entries(s.martingaleState).map(([key,value]) => [aliases[key] || key, (s.config.unifiedMode ? s.masterState.step : value.localStep)])), history: s.automationHistory || [] }; }
// Settings that cannot work together. Checked on every save, from the website or the extension,
// so neither can store a combination that silently stops a game or makes two bets cancel out.
// c: { gapEntry, shadowMode, cbMaxLosses, cbCooldown, bzRbRollover, hiloRollover, tc3Rollover, enabledGames, rollover }
function conflict(c) {
 const gap = Object.values(c.gapEntry || {}).some(v => v?.enabled);
 if (gap && (c.shadowMode || c.bzRbRollover || c.hiloRollover || c.tc3Rollover)) return 'Gap playing windows cannot be used with Shadow mode or the BetZero / Rainbow, High / Low or 3-way rollovers: a game with gap windows would never play. Turn those off, or turn gap windows off.';
 if (c.shadowMode && !(Number(c.cbMaxLosses) > 0)) return 'Shadow mode needs Circuit-breaker losses above 0: it starts after that many losses in a row, so with 0 it never starts.';
 if (Number(c.cbMaxLosses) > 0 && !c.shadowMode && !(Number(c.cbCooldown) > 0)) return 'The circuit breaker needs Cooldown draws above 0 (or Shadow mode on): with 0 cooldown draws it never pauses anything.';
 if (c.enabledGames?.bet49 && c.rollover?.enabled) return 'Bet49 and the BZ Single Rollover bet the same number in opposite ways (Bet49 needs it drawn, the rollover needs it not drawn), so one of them always loses. Turn one of them off.';
 return null;
}
function normalize(input) {
 // Total Color 2-way and Unified are retired. The dashboard sends back whatever settings()
 // returned, including an old enabled flag the page has no control for, so a save switches
 // them off rather than refusing (which left no way to clear them).
 input = { ...input, unifiedMode: false, enabledGames: { ...(input.enabledGames || {}), totalColor2: false } };
 const out = {};
 for (const [field,max] of [['stakes',50000],['gameSteps',1000]]) { out[field] = {}; for (const key of Object.values(aliases)) { const n = Number(input[field]?.[key]); if (!Number.isSafeInteger(n) || n < 0 || n > max) throw fail(`Invalid ${field} for ${key}.`); out[field][key] = n; } }
 out.enabledGames = {}; for (const key of Object.values(aliases)) out.enabledGames[key] = input.enabledGames?.[key] === true;
 for (const [field,min,max] of [['takeProfit',0,10000000],['stopLoss',-10000000,0],['cbMaxLosses',0,50],['cbCooldown',0,300],['tc3RolloverTarget',2,10]]) { const n = Number(input[field] ?? (field === 'tc3RolloverTarget' ? 3 : 0)); if (!Number.isSafeInteger(n) || n < min || n > max) throw fail(`Invalid ${field}.`); out[field] = n; }
 out.hiloMultiplier = Number(input.hiloMultiplier); if (![1.4,2].includes(out.hiloMultiplier)) throw fail('Choose a supported High/Low multiplier.');
 out.tc1ProfitMode = input.tc1ProfitMode === 'accumulating' ? 'accumulating' : 'fixed';
 out.bet49ProfitMode = input.bet49ProfitMode === 'accumulating' ? 'accumulating' : 'fixed';
 for (const key of ['flatBetting','unifiedMode','bzRbRollover','hiloRollover','tc3Rollover','shadowMode','weightedStaking']) out[key] = input[key] === true;
 out.sniperSettings = {};
 for (const key of [...Object.values(aliases),'unified']) { const v = input.sniperSettings?.[key] || {}; const step = Number(v.step || 0), resetLosses = Number(v.resetLosses || 0); if (!Number.isInteger(step) || step < 0 || step > 10 || !Number.isInteger(resetLosses) || resetLosses < 0 || resetLosses > 50 || (v.enabled && (!step || !resetLosses))) throw fail('Sniper needs step 1-10 and reset losses 1-50.'); out.sniperSettings[key] = { enabled: v.enabled === true, step, resetLosses }; }
 out.gapEntry = gapEntry.normalize(input.gapEntry);
 if (Object.values(out.gapEntry).some(v => v.enabled && v.policy !== 'CONTINUOUS_GAP_WINDOWS_V2')) throw fail('Review and confirm continuous gap windows on the updated website before saving.');
 out.rollover = rollover.normalize(input.rollover || {});
 const problem = conflict(out); if (problem) throw fail(problem);
 out.summaryModelMarkets = {}; out.summaryModelTargets = {};
 for (const key of ['u4','color','sum','totalColor']) { out.summaryModelMarkets[key] = input.summaryModelMarkets?.[key] === true; out.summaryModelTargets[key] = input.summaryModelTargets?.[key] === 'HOLD' ? 'HOLD' : 'ENTER'; }
 return out;
}
// A placed bet the bot is still waiting on (or a bet slip being confirmed).
function unsettled(s) { return Boolean(s.pendingBetPayload || s.betExecutionClaim || s.lastBetDetails || s.failedBetRecovery || s.balanceVerification?.pendingWinSync); }
function command(s, cfg, busy, records = []) {
 const c = state(s), action = cfg.dashboardAction;
 if (!action) {
  // From the extension. Start/stop needs nothing more; a settings save must be based on the
  // settings it last loaded, so it never overwrites a newer save from the website.
  if (cfg.running === false && Object.keys(cfg).every(key => key === 'running' || key === 'revision')) { stop(s); c.revision++; return { done: true }; }
  const saving = Object.keys(cfg).some(key => key !== 'running' && key !== 'revision');
  if (saving && Number(cfg.revision) !== c.revision)
   throw fail('These settings were changed on the website since the extension loaded them. The latest settings are now shown: make your change again and save.');
  if (saving) {
   // The same check as a website save, on the settings as they would be after this save.
   const pick = key => cfg[key] !== undefined ? cfg[key] : s.config[key];
   const problem = conflict({ gapEntry: s.config.gapEntry, shadowMode: pick('shadowMode'), cbMaxLosses: pick('cbMaxLosses'), cbCooldown: pick('cbCooldown'),
    bzRbRollover: pick('bzRbRollover'), hiloRollover: pick('hiloRollover'), tc3Rollover: pick('tc3Rollover'),
    enabledGames: { bet49: cfg.enabledGames?.bet49 !== undefined ? cfg.enabledGames.bet49 === true : !!s.config.enabledGames?.bet49 },
    rollover: cfg.rollover !== undefined ? rollover.normalize(cfg.rollover) : rollover.config(s) });
   if (problem) throw fail(problem);
  }
  return null;
 }
 if (action === 'stop') { stop(s); c.revision++; return { done: true }; }
 // Old pages and extensions still send these; there is only one shared control now.
 if (action === 'extension' || action === 'website') return { done: true };
 if (cfg.revision !== c.revision) throw fail('Settings changed. Refresh the dashboard before continuing.');
 if (action === 'strategy-preview' || action === 'strategy-apply') {
  if (action === 'strategy-apply' && gapEntry.enabled(s)) throw fail('Disable gap entry in manual Settings before applying automatic suggestions.');
  const plan = strategy.preview(cfg.settings || {}, records);
  if (action === 'strategy-preview') return { done: true, result: { preview: plan } };
  if (!s.stats.isHalted || busy || strategy.recovery(s)) throw fail('Stop and finish recovery before applying a suggestion.');
  if (cfg.settings?.token !== plan.token) throw fail('History or settings changed. Preview the plan again.');
  strategy.install(s, plan); c.revision++;
  return { done: true };
 }
 if (action === 'start') { if (s.config.suggestionStrategy?.needsReview) throw fail('Review and reapply the strategy after resetting execution.'); if (Date.now() - c.executorAt > 10000) throw fail('Open Bet9ja with the updated extension connected first.'); if (s.betExecutionClaim || s.lastBetDetails) throw fail('Wait for the placed bet to settle.'); if (!rollover.enabled(s) && !Object.keys(aliases).some(k => s.config.enabledGames[k] && s.config.initialStakes[k] > 0)) throw fail('Enable a game or the rollover and save a stake first.'); c.revision++; return { config: { running: true } }; }
 // Saving needs automation stopped and no placed bet still waiting to settle. A game partway
 // through a recovery (step 2 and up) does not block it: that can only finish by playing, so
 // blocking it meant settings could never be saved without resetting. Progression is kept.
 if (action === 'save') { if (!s.stats.isHalted || unsettled(s)) throw fail('Stop automation and let the last placed bet settle before changing settings. Progression is preserved.'); const config = normalize(cfg.settings || {}); if (strategy.recovery(s)) throw fail('Finish the suggested recovery before changing settings.'); gapEntry.configure(s, config.gapEntry, records); rollover.configure(s, config.rollover); delete config.rollover; delete s.config.suggestionStrategy; c.revision++; return { config: { ...config, running: false } }; }
 throw fail('Unknown dashboard action.');
}
function record(s, drawId, details, prediction) {
 const rows = details.games.map(key => {
  const selections = key === 'bet49' ? details.bet49Numbers : details.colorSelections?.[key] || prediction?.[aliases[key]];
  const count = key === 'bet49' ? selections.length : key === 'totalColor' ? details.colorSelections?.totalColor.length ?? 3 : key === 'totalColor2' ? details.colorSelections?.totalColor2.length ?? 2 : 1;
  return { game: aliases[key] || key, unitStake: details.stakes[key], stake: details.stakes[key] * count, selections, result: 'PENDING' };
 });
 if (details.rollover) rows.push({ game: 'betzeroSingle', unitStake: details.rollover.stake, stake: details.rollover.stake, selections: [details.rollover.number], result: 'PENDING' });
 s.automationHistory ||= []; s.automationHistory = [{ drawId: String(drawId), at: Date.now(), games: rows }, ...s.automationHistory.filter(r => r.drawId !== String(drawId))].slice(0,100);
}
function settle(s, record) {
 const row = s.automationHistory?.find(r => r.drawId === String(record.drawId)); if (!row) return;
 for (const game of row.games) {
  if (game.game === 'betzeroSingle') game.result = (game.selections || []).some(n => record.result.balls?.includes(n)) ? 'LOSS' : 'WIN';
  else if (game.game === 'bet49') game.result = (game.selections || []).some(n => record.result.balls?.includes(n)) ? 'WIN' : 'LOSS';
  else if (['totalColor','totalColor2'].includes(game.game) && Array.isArray(game.selections)) game.result = game.selections.includes(getTotalColorOutcome(record.result.balls)) ? 'WIN' : 'LOSS';
  else game.result = record.result[game.game] || 'UNKNOWN';
 }
}
module.exports = { state, stop, guard, heartbeat, view, settings, command, record, settle, conflict };
