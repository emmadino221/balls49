import React from 'react';

// BetZero Single Number Rollover: the saved 1-Number BetZero Lab selection at 1.10, rolled over draw by draw.
const ODDS = 1.1;
const money = n => n == null ? '--' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(n);
const ballColor = n => Number(n) === 49 ? 'yellow' : Number(n) % 3 === 1 ? 'red' : Number(n) % 3 === 2 ? 'blue' : 'green';
// The worker rolls each return down to whole naira.
export function ladder(start, length) {
  const stakes = [];
  let stake = start;
  for (let i = 0; i < length; i++) { stakes.push(stake); stake = Math.floor(stake * ODDS); }
  return { stakes, collect: length ? Math.round(stakes[length - 1] * ODDS * 100) / 100 : start };
}
const PHASE = { WAITING: 'Waiting for an eligible prediction', PLAYING: 'Rolling over', PAUSED: 'Paused' };
const RESULT = { COMPLETE: 'Collected', LOST: 'Lost', STOPPED: 'Ended early' };

function Ladder({ start, length, played, number }) {
  const { stakes, collect } = ladder(start, length);
  const top = collect || 1;
  return <div className="ro-ladder" role="img" aria-label={`Stake ladder: ${stakes.map(money).join(', ')}, collect ${money(collect)}. ${played} of ${length} draws done.`}>
    {stakes.map((stake, i) => <div key={i} className={`ro-rung${i < played ? ' is-done' : i === played ? ' is-next' : ''}`}>
      <span className="ro-rung-bar" style={{ '--h': `${Math.max(14, stake / top * 100)}%` }}>{i === played && number != null && <i className={`ba-ball is-sm is-${ballColor(number)}`}>{number}</i>}</span>
      <b>{money(stake)}</b><small>Draw {i + 1}</small>
    </div>)}
    <div className="ro-rung is-collect"><span className="ro-rung-bar" style={{ '--h': '100%' }} /><b>{money(collect)}</b><small>Collect</small></div>
  </div>;
}

const lossSteps = c => Number(c?.lossSteps ?? (c?.maxDoublings != null ? Number(c.maxDoublings) + 1 : 4));

export default function AutomationRollover({ control, draft, onChange, onSave, disabled, draftStale }) {
  const r = control?.rollover;
  if (!r) return <section className="content-card ro-panel"><h2>BetZero Single Number Rollover</h2><p className="automation-help">The betting worker has not been updated for the rollover yet. Update it, then reload this page.</p></section>;
  const draftRollover = draft?.rollover || { enabled: false, baseStake: 0, lossSteps: 4 };
  const { maxDoublings: _old, ...settings } = { ...draftRollover, lossSteps: lossSteps(draftRollover) };
  const savedSteps = lossSteps(r?.settings);
  const set = (name, value) => onChange({ ...settings, [name]: value });
  const run = r.run, plan = r.plan;
  const number = plan && !plan.skip ? plan.number : null;
  const stepCount = Math.max(1, Number(settings.lossSteps) || 1);
  const startStakes = Array.from({ length: Math.min(6, stepCount) }, (_, i) => Math.ceil((Number(settings.baseStake) || 0) * (Number(settings.recoveryMultiplier) || 2) ** i));
  return <section className="ro-panel" aria-labelledby="ro-title">
    <div className="ro-stage">
      <div className="ro-head">
        <div><span className="overline">SPECIAL MARKET</span><h2 id="ro-title">BetZero Single Number Rollover</h2>
          <p>The saved 1-Number BetZero Lab selection at {ODDS.toFixed(2)}: it wins when that number does not come out. Every eligible prediction can start a run. Each win rolls the whole return into the next draw until the window ends.</p></div>
        <span className={`ro-phase is-${r.phase.toLowerCase()}`}><i aria-hidden="true" />{run ? `Draw ${Math.min(run.played + 1, run.length)} of ${run.length}` : PHASE[r.phase] || r.phase}</span>
      </div>
      {run && run.sourcePolicy !== 'SINGLE_CONTINUOUS_WIN_GAPS_V3' && <p className="automation-help">This run retains its previously sized window. Independent BetZero Single windows begin after this run ends; old triggers are discarded.</p>}
      <p className="ro-reason" role="status">{r.settings.enabled ? r.reason : 'Off. Turn it on below and save.'}</p>
      {run
        ? <Ladder start={run.stakeStart} length={run.length} played={run.played} number={number} />
        : r.phase === 'PAUSED'
          ? <div className="ro-idle"><p>All {savedSteps} loss steps lost. Save the rollover settings to start again from step 1 at <b>{money(r.settings.baseStake)}</b>.</p></div>
          : <div className="ro-idle"><p>Next run is step {r.doublings + 1} of {savedSteps} at <b>{money(r.nextStartStake)}</b>{r.doublings ? ` (${(r.settings.recoveryMultiplier ?? 2) ** r.doublings}x after ${r.doublings} ${r.doublings === 1 ? 'loss' : 'losses'})` : ''}, on the next eligible BetZero Single prediction{r.estimate ? `, and plays about ${r.estimate.length} draws` : ''}.</p></div>}
      <dl className="ro-facts">
        <div><dt>{run ? 'Window length' : 'Next window'}</dt><dd>{run ? `${run.length} draws` : r.estimate ? `${r.estimate.length} draws` : '--'}<small>{(run?.windowMode === 'manual' || (!run && r.estimate?.mode === 'manual')) ? 'Manual draw count' : run ? `BetZero Single average gap ${run.average.toFixed(1)} (${run.samples} gaps)` : r.estimate ? `BetZero Single average gap ${r.estimate.average.toFixed(1)} (${r.estimate.samples} gaps), recalculated at the start` : 'Needs two BetZero Single gaps at the selected win level'}</small></dd></div>
        <div><dt>Gap win level</dt><dd>{run?.gapLosses ?? r.settings.gapLosses ?? 1}</dd><small>BetZero Single results only</small></div>
        <div><dt>Starting stake</dt><dd>{money(run ? run.stakeStart : r.nextStartStake)}<small>{r.phase === 'PAUSED' ? `All ${savedSteps} steps lost` : `Loss step ${r.doublings + 1} of ${savedSteps}`}</small></dd></div>
        <div><dt>On the table</dt><dd>{run ? money(run.stake) : '--'}<small>{run ? `${run.bets} ${run.bets === 1 ? 'bet' : 'bets'} placed` : 'No run'}</small></dd></div>
        <div><dt>Rollover profit</dt><dd className={r.profit > 0 ? 'ba-pos' : r.profit < 0 ? 'ba-neg' : ''}>{money(r.profit)}<small>{r.completed} collected / {r.lost} lost</small></dd></div>
      </dl>
    </div>

    <form className="content-card ro-settings" onSubmit={e => { e.preventDefault(); onSave(); }}>
      <div className="automation-section-title"><div><span className="overline">YOUR ROLLOVER</span><h2>Rollover settings</h2></div></div>
      {draftStale && <p className="automation-help">The session has changed since this form loaded. Reload saved settings on the Settings tab before saving.</p>}
      <fieldset disabled={disabled}>
        <label className="automation-check"><input type="checkbox" checked={!!settings.enabled} onChange={e => set('enabled', e.target.checked)} /><strong>Play BetZero Single Number Rollover</strong></label>
        <div className="automation-fields">
          <label>Base stake (NGN)<input type="number" min="0" max="50000" step="1" value={settings.baseStake ?? 0} onChange={e => set('baseStake', Number(e.target.value))} /></label>
          <label>Window calculation<select value={settings.windowMode ?? 'automatic'} onChange={e => set('windowMode', e.target.value)}><option value="automatic">Automatic winning-streak gap</option><option value="manual">Manual draw count</option></select></label>
          {settings.windowMode === 'manual' && <label>Draws per rollover (1-100)<input type="number" min="1" max="100" step="1" value={settings.manualDraws ?? 10} onChange={e => set('manualDraws', Number(e.target.value))} /></label>}
          <label>Gap win level (1-100)<input type="number" min="1" max="100" step="1" value={settings.gapLosses ?? 1} onChange={e => set('gapLosses', Number(e.target.value))} /></label>
          <label>Recovery multiplier (default ?2)<input type="text" inputMode="decimal" value={settings.recoveryMultiplier ?? 2} onChange={e => set('recoveryMultiplier', e.target.value)} /></label>
          <label>Loss steps (1-20)<input type="number" min="1" max="20" step="1" value={settings.lossSteps} onChange={e => set('lossSteps', Number(e.target.value))} /></label>
        </div>
        {Number(settings.baseStake) > 0 && <p className="automation-help">Each lost run uses the next eligible prediction with a starting stake multiplied by {settings.recoveryMultiplier ?? 2}: {startStakes.map(money).join(' → ')}{stepCount > 6 ? ' → …' : ''}. Step {stepCount} plays {money(Math.ceil(Number(settings.baseStake) * (Number(settings.recoveryMultiplier) || 2) ** (stepCount - 1)))}; only a loss there pauses the rollover. A collected run returns to step 1 at {money(Number(settings.baseStake))}.</p>}
        <button className="btn btn-primary" disabled={draftStale}>Save rollover settings (keep paused)</button>
      </fieldset>
      <p className="automation-help">Saving also saves the rest of this page's settings, and only works while automation is stopped. Changing these settings starts the rollover over from the base stake. Draws where BetZero Single has no valid Lab number are not bet but count toward the window. Every bet can lose; a loss loses the whole rolled amount.</p>
    </form>

    <section className="content-card automation-history"><div className="automation-section-title"><div><span className="overline">PAST RUNS</span><h2>Rollover runs</h2></div><span className="automation-caption">Latest {r.history.length} &middot; newest first</span></div>
      {!r.history.length ? <div className="automation-empty"><h3>No runs yet</h3><p>Runs appear here once the rollover has played.</p></div>
        : <div className="automation-table" tabIndex="0" role="region" aria-label="Rollover runs"><table><thead><tr><th>Draws</th><th>Number</th><th>Window</th><th>Started with</th><th>Collected</th><th>Profit</th><th>Result</th></tr></thead>
          <tbody>{r.history.map(h => <tr key={`${h.start}-${h.end}`}><td data-label="Draws">#{h.start}–#{h.end}</td><td data-label="Number">{h.number ? <i className={`ba-ball is-sm is-${ballColor(h.number)}`}>{h.number}</i> : '--'}</td><td data-label="Window">{h.played} of {h.length}</td><td data-label="Started with">{money(h.stakeStart)}</td><td data-label="Collected">{money(h.collected)}</td><td data-label="Profit" className={h.profit > 0 ? 'ba-pos' : h.profit < 0 ? 'ba-neg' : ''}>{money(h.profit)}</td><td data-label="Result"><span className={`outcome-badge ${h.result === 'COMPLETE' ? 'win' : h.result === 'LOST' ? 'loss' : 'pending'}`}>{RESULT[h.result] || h.result}</span></td></tr>)}</tbody></table></div>}
    </section>
  </section>;
}
