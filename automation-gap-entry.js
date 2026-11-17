"use strict";
const markets = { u4:'betzero', bet49:'bet49', color:'rainbow', sum:'hilo', totalColor:'totalColor', totalColor2:'totalColor2', totalColor1:'totalColor1' };
const fields = { u4:'stake', bet49:'bet49Stake', color:'colorStake', sum:'sumStake', totalColor:'tcStake', totalColor2:'tc2Stake', totalColor1:'tc1Stake' };
const enabled = s => Object.values(s.config.gapEntry || {}).some(v => v?.enabled);
function normalize(input = {}) {
  const output = {};
  for (const market of Object.values(markets)) {
    const value = input[market] || {}, losses = Number(value.losses ?? 3);
    if (!Number.isSafeInteger(losses) || losses < 1 || losses > 100) throw Object.assign(new Error('Gap entry needs a loss threshold between 1 and 100.'), { status: 400 });
    output[market] = { enabled: value.enabled === true, losses };
  }
  return output;
}
const MIN_GAPS = 2;
const MAX_GAPS = 100;
function sample() { return { run: 0, known: false, lastOccurrence: null, gaps: [] }; }
function advance(history, id, outcome, threshold) {
  let trigger = null;
  if (outcome === 'WIN') { history.run = 0; history.known = true; }
  if (outcome === 'LOSS') {
    history.run++;
    if (history.known && history.run === threshold) {
      const gap = history.lastOccurrence === null ? null : id - history.lastOccurrence;
      const average = history.gaps.length >= MIN_GAPS ? history.gaps.reduce((a,b) => a+b,0)/history.gaps.length : null;
      // Freeze the decision before this new occurrence is added to the sample.
      trigger = { at: id, previous: history.lastOccurrence, gap, average, samples: history.gaps.length,
        qualified: average !== null && gap !== null && gap >= average };
      if (gap !== null) history.gaps = [...history.gaps, gap].slice(-MAX_GAPS);
      history.lastOccurrence = id;
    }
  }
  return trigger;
}
function seed(records, market, threshold) {
  let history = sample(), lastSeen = 0;
  for (const r of [...records].sort((a,b) => Number(a.drawId)-Number(b.drawId))) {
    const id = Number(r.drawId), outcome = r.result?.[market];
    if (!Number.isSafeInteger(id) || id <= lastSeen) continue;
    if (!['WIN','LOSS','SKIP'].includes(outcome)) break;
    if (lastSeen && id !== lastSeen+1) history = sample();
    advance(history, id, outcome, threshold); lastSeen = id;
  }
  return { history, lastSeen };
}
function configure(s, config, records) {
  s.gapEntryState ||= {};
  for (const [key, market] of Object.entries(markets)) {
    const prior = s.config.gapEntry?.[market], next = config[market];
    if (next.enabled && (!s.gapEntryState[key] || prior?.losses !== next.losses || !prior?.enabled)) {
      const old = s.gapEntryState[key];
      const seeded = seed(records, market, next.losses);
      s.gapEntryState[key] = { policy: 'AVERAGE_GAP_AND_LOSS_V1', ...seeded,
        losses: seeded.history.run, waitingWin: Boolean(old?.waitingWin), ready: false,
        reserved: old?.reserved || null, reservedSettled: old?.reservedSettled || false,
        outcomes: Object.fromEntries(records.filter(r => Number(r.drawId) <= seeded.lastSeen && Number(r.drawId) > seeded.lastSeen-200 && r.result?.[market]).map(r => [r.drawId,r.result[market]])) };
    }
  }
  s.config.gapEntry = config;
}
function observe(s, records) {
  if (!enabled(s)) return;
  const ordered = [...records].sort((a,b) => Number(a.drawId)-Number(b.drawId));
  s.gapEntryState ||= {};
  for (const [key, market] of Object.entries(markets)) {
    const cfg = s.config.gapEntry?.[market];
    if (!cfg?.enabled) continue;
    const st = s.gapEntryState[key];
    if (!st || st.paused || st.policy !== 'AVERAGE_GAP_AND_LOSS_V1') continue;
    for (const record of ordered) {
      const id = Number(record.drawId), result = record.result?.[market];
      if (!Number.isSafeInteger(id) || id < 1) continue;
      if (id <= st.lastSeen) {
        if (st.outcomes[id] && result && st.outcomes[id] !== result) { st.paused = 'A previously observed result changed. Review and reset the stopped session.'; st.ready = false; break; }
        continue;
      }
      if (!['WIN','LOSS','SKIP'].includes(result)) break;
      if (id !== st.lastSeen + 1) { st.history = sample(); st.ready = false; st.waitingWin = true; st.trigger = null; }
      st.lastSeen = id; st.outcomes[id] = result;
      for (const seen of Object.keys(st.outcomes)) if (Number(seen) < id - 200) delete st.outcomes[seen];
      const trigger = advance(st.history, id, result, cfg.losses);
      st.losses = st.history.run;
      if (result === 'WIN') { st.ready = false; st.waitingWin = false; st.trigger = null; }
      if (trigger) { st.trigger = trigger; st.ready = !st.waitingWin && trigger.qualified; }
      if (Number(st.reserved) === id) st.reservedSettled = true;
    }
  }
}
function reason(s, key, target) {
  const cfg = s.config.gapEntry?.[markets[key]];
  if (!cfg?.enabled) return null;
  const st = s.gapEntryState?.[key];
  if (s.automationControl?.controller !== 'website' || s.config.unifiedMode) return 'Gap entry requires website control and individual mode.';
  if (s.config.suggestionStrategy || s.config.shadowMode || s.config.bzRbRollover || s.config.hiloRollover || s.config.tc3Rollover) return 'Gap entry requires manual individual settings without shadow or rollover modes.';
  if (!st || st.policy !== 'AVERAGE_GAP_AND_LOSS_V1') return 'Gap entry state is unavailable. Save settings while stopped.';
  if (st.paused) return st.paused;
  if (s.lastBetDetails || s.betExecutionClaim || (st.reserved && !st.reservedSettled)) return 'Gap entry: waiting for execution and settlement.';
  if (!Number.isSafeInteger(Number(target)) || st.lastSeen !== Number(target)-1) return 'Gap entry: waiting for the preceding prediction result.';
  if (st.waitingWin) return 'Gap entry: trigger used; waiting for a fresh prediction WIN.';
  if (!st.ready && st.trigger) return st.trigger.average === null ? `Gap entry: need ${MIN_GAPS} completed historical gaps before a new trigger.` : `Gap entry: this occurrence gap (${st.trigger.gap} draws) was below its prior average (${st.trigger.average.toFixed(1)}); waiting for a fresh streak.`;
  if (!st.ready) return `Gap entry: ${st.losses}/${cfg.losses} consecutive prediction losses.`;
  return null;
}
function payloadKeys(payload) { return Object.keys(fields).filter(key => Number(payload?.[fields[key]]) > 0); }
function claim(s, payload, existingClaim) {
  const target = Number(payload.drawId);
  const keys = payloadKeys(payload).filter(key => s.config.gapEntry?.[markets[key]]?.enabled);
  for (const key of keys) {
    const st = s.gapEntryState?.[key];
    if (existingClaim && Number(existingClaim.drawId) === target && st?.reserved === target && !st.paused) continue;
    const blocked = reason(s, key, target);
    if (blocked) return blocked;
  }
  for (const key of keys) {
    const st = s.gapEntryState[key];
    if (st.reserved === target) continue;
    st.reserved = target; st.reservedSettled = false; st.ready = false; st.waitingWin = true;
  }
  return null;
}
function view(s) {
  return Object.fromEntries(Object.entries(markets).filter(([,market]) => s.config.gapEntry?.[market]?.enabled).map(([key,market]) => {
    const st = s.gapEntryState?.[key];
    return [market, { averageGap: st?.trigger ? st.trigger.average : (st?.history?.gaps?.length >= MIN_GAPS ? st.history.gaps.reduce((a,b)=>a+b,0)/st.history.gaps.length : null), gapSamples: st?.trigger?.samples ?? st?.history?.gaps?.length ?? 0, occurrenceGap: st?.trigger?.gap ?? null, previousOccurrence: st?.trigger?.previous ?? st?.history?.lastOccurrence ?? null, losses: st?.losses || 0, threshold: s.config.gapEntry[market].losses,
      phase: !st ? 'Save settings to initialize' : st.paused ? 'Paused: result correction' : st.reserved && !st.reservedSettled ? 'Waiting for settlement' : st.waitingWin ? 'Waiting for fresh WIN' : st.ready ? 'Gap + streak qualified: ready' : st.trigger ? st.trigger.average === null ? 'Insufficient historical gaps' : 'Gap too short: waiting for a fresh streak' : 'Counting losses and historical gaps' }];
  }));
}
module.exports = { normalize, configure, observe, reason, claim, enabled, view };
