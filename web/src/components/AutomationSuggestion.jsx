import React, { useState } from 'react';
import { apiRequest } from '../auth';

const markets = [['betzero','BetZero'],['bet49','Bet49'],['rainbow','Rainbow'],['hilo','High / Low'],['totalColor','Total Color 3-way'],['totalColor2','Total Color 2-way'],['totalColor1','Winning Color'],['unified','Unified']];
const money = value => `NGN ${Number(value).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
export default function AutomationSuggestion({ control, disabled, onSaved }) {
  const query = new URLSearchParams(window.location.search);
  const saved = control.suggestionStrategy;
  const [input,setInput] = useState(() => saved?.request || { games: [markets.some(([id]) => id === query.get('suggestion')) ? query.get('suggestion') : 'betzero'], window: Number(query.get('window')) || 100, base: Math.max(50, Number(query.get('base')) || 50), capitalMode: true, capital: '', autoUpdate: false });
  const [preview,setPreview] = useState(null), [error,setError] = useState(''), [loading,setLoading] = useState(false);
  const locked = disabled || loading || control.controller !== 'website' || control.running || control.busy;
  function change(key,value) { setInput(s => ({...s,[key]:value})); setPreview(null); setError(''); }
  function select(id,checked) {
    change('games', id === 'unified' ? checked ? ['unified'] : [] : checked ? [...input.games.filter(g => g !== 'unified'),id] : input.games.filter(g => g !== id));
  }
  async function submit(apply) {
    setLoading(true); setError('');
    try {
      if (apply && !window.confirm('Save this reviewed strategy and its capital allocation? Automation stays stopped. Press Start separately when ready.')) return;
      const result = await apiRequest('/account/automation/command', { method:'POST', body:JSON.stringify({ action:apply?'strategy-apply':'strategy-preview', revision:control.revision, settings:{...input,token:apply?preview.token:undefined} }) });
      if (apply) { setPreview(null); await onSaved(); }
      else setPreview(result.preview);
    } catch(e) { setError(e.message); setPreview(null); } finally { setLoading(false); }
  }
  return <section className="content-card automation-suggestion">
    <span className="overline">FOR AUTOMATION MEMBERS</span><h2>Suggested strategies</h2>
    <p>Choose one or more games. Preview the complete entry, pause and recovery plan before saving.</p>
    {saved && <div className="automation-notice" role="status"><strong>{saved.request.autoUpdate?'Auto strategy: ON':'Auto strategy: OFF'}</strong><p>{saved.message}</p>{saved.capital !== null && <p>Allocated capital: {money(saved.capital)} ? Available after settled bets: {money(saved.available)}</p>}<p>{saved.plans.map(p => `${p.name}: ${money(p.base)} per selection`).join(' ? ')}</p>{saved.needsReview && <p>Review and reapply a plan before starting.</p>}</div>}
    <fieldset disabled={locked}>
      <legend>Select games</legend>
      <div className="strategy-game-options">{markets.map(([id,label]) => <label className="automation-check" key={id}><input type="checkbox" checked={input.games.includes(id)} onChange={e=>select(id,e.target.checked)} />{label}</label>)}</div>
      <p className="automation-help">Multiple games share one capital allocation. Unified runs alone and follows its supported market selection.</p>
      <div className="automation-fields">
        <label>Review history<select value={input.window} onChange={e=>change('window',Number(e.target.value))}>{[50,100,200,500,1000].map(n=><option key={n} value={n}>Last {n} draws</option>)}</select></label>
        <label>Stake setup<select value={input.capitalMode?'capital':'base'} onChange={e=>change('capitalMode',e.target.value==='capital')}><option value="capital">Calculate from my capital</option><option value="base">Enter my base stake</option></select></label>
        {input.capitalMode ? <label>Allocated capital (NGN)<input type="number" min="50" max="10000000" step="1" value={input.capital} onChange={e=>change('capital',e.target.value)} placeholder="Enter your automation budget" /></label> : <label>Base per selection (NGN)<input type="number" min="50" max="50000" step="1" value={input.base} onChange={e=>change('base',e.target.value)} /></label>}
      </div>
      <label className="automation-check"><input type="checkbox" role="switch" checked={input.autoUpdate} onChange={e=>change('autoUpdate',e.target.checked)} />Update suggested rules after a settled recovery win</label>
      <p className="automation-help">Capital sizing recalculates after recovery completes, using net results including earlier losses. New rules apply only within your selected games, after every active recovery finishes. Stops and loss limits stay in force.</p>
      <button type="button" className="btn btn-secondary" onClick={()=>submit(false)}>Preview latest plans</button>
    </fieldset>
    {locked && <p className="automation-help">Switch to website control, stop automation and finish recovery to edit plans.</p>}
    {error && <p role="alert" className="automation-warning">{error}</p>}
    {preview && <div className="strategy-preview"><h3>Your proposed setup</h3><p>{preview.draws} draws reviewed ? Combined planned reserve: <strong>{money(preview.reserve)}</strong></p><div className="automation-game-grid">{preview.plans.map(p=><article className="content-card" key={p.key}><h3>{p.name}</h3><dl className="resource-facts"><div><dt>Base per selection</dt><dd>{money(p.base)}</dd></div><div><dt>Entry</dt><dd>{p.waitLosses ? `After ${p.waitLosses} observed losses` : 'After a win'}</dd></div><div><dt>Pause</dt><dd>After {p.pauseLosses} played losses</dd></div><div><dt>Recovery attempts</dt><dd>{p.steps}</dd></div><div><dt>Planned reserve</dt><dd>{money(p.reserve)}</dd></div></dl><p>After a pause, wait for a win and repeat entry. Unplayed wins do not erase recovery losses.</p></article>)}</div><p>This entire reserve can be lost. Existing stop loss, take profit and circuit breaker limits may stop earlier. Saving turns off rollover, weighted stakes, flat betting and separate sniper filters so this complete plan controls entry and stakes.</p><button type="button" className="btn btn-primary" disabled={locked} onClick={()=>submit(true)}>Save these plans ? keep paused</button></div>}
    <p className="automation-help">Keep Bet9ja and the extension connected. Plans continue with the dashboard closed. If new history has no eligible plan, automatic updates pause automation for review.</p>
  </section>;
}
