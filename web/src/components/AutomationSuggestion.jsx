import React, { useState } from 'react';
import { apiRequest } from '../auth';

const markets = ['betzero','bet49','rainbow','hilo','totalColor','totalColor2','totalColor1'];
export default function AutomationSuggestion({ control, disabled, onApply }) {
  const query = new URLSearchParams(window.location.search);
  const game = query.get('suggestion');
  const base = Number(query.get('base'));
  const limit = Number(query.get('window'));
  const [preview,setPreview] = useState(null), [error,setError] = useState(''), [loading,setLoading] = useState(false);
  if (!game) return null;
  const valid = [...markets,'unified'].includes(game) && Number.isSafeInteger(base) && base >= 1 && base <= 50000 && [50,100,200,500,1000].includes(limit);
  async function review() {
    setLoading(true); setError(''); setPreview(null);
    try {
      if (!valid) throw new Error('Choose a supported game and a whole-naira base stake from 1 to 50,000 on Suggestions.');
      const data = await apiRequest(`/public-suggestions?limit=${limit}`);
      const market = data.markets.find(m => m.key === game);
      if (market?.gameplay?.status !== 'candidate') throw new Error('This game needs a supported history-based plan before it can be transferred. Review Suggestions again.');
      const rule = market.gameplay;
      setPreview({ name:market.name, steps:Math.min(12,Math.max(rule.training.worstPlayedRun,rule.validation.worstPlayedRun)+1), entry:rule.waitLosses+1, pause:rule.pauseLosses, revision:data.revision, at:Date.now(), draws:data.draws });
    } catch(e) { setError(e.message); } finally { setLoading(false); }
  }
  async function apply() {
    setLoading(true); setError('');
    try {
      const status = await apiRequest('/public-suggestions-status');
      if (status.revision !== preview.revision || Date.now()-preview.at > 600000) throw new Error('History changed. Preview the latest plan again before applying.');
      const session = await apiRequest('/account/automation');
      const current = session.control;
      if (!current || current.controller !== 'website' || current.running || current.busy) throw new Error('Use website control, stop automation and finish the active execution or recovery sequence before applying.');
      if (current.revision !== control.revision) throw new Error('Session changed. Wait for the dashboard to refresh and try again.');
      const setup = JSON.parse(JSON.stringify(current.settings));
      setup.unifiedMode = game === 'unified';
      setup.enabledGames = Object.fromEntries(markets.map(id=>[id,game==='unified'?id!=='totalColor1':id===game]));
      for (const id of markets) if (setup.enabledGames[id]) { setup.stakes[id]=base; setup.gameSteps[id]=preview.steps; }
      setup.sniperSettings = Object.fromEntries([...markets,'unified'].map(id=>[id,{enabled:id===game,step:id===game?preview.entry:0,resetLosses:id===game?preview.pause:0}]));
      Object.assign(setup,{flatBetting:false,bzRbRollover:false,hiloRollover:false,tc3Rollover:false,weightedStaking:false,hiloMultiplier:2,tc1ProfitMode:'fixed'});
      setup.summaryModelMarkets = {u4:false,color:false,sum:false,totalColor:false};
      onApply(setup,current.revision);
    } catch(e) { setError(e.message); } finally { setLoading(false); }
  }
  return <section className="content-card automation-suggestion">
    <h2>Strategy suggestion preview</h2>
    <p>Transfer your selected game plan into the setup form. Nothing is saved or started automatically.</p>
    <button type="button" className="btn btn-secondary" disabled={loading||disabled} onClick={review}>Preview latest suggestion</button>
    {error&&<p role="alert">{error}</p>}
    {preview&&<>
      <dl className="resource-facts"><div><dt>Game</dt><dd>{preview.name}</dd></div><div><dt>Base per selection</dt><dd>NGN {base.toLocaleString()}</dd></div><div><dt>Maximum steps</dt><dd>{preview.steps}</dd></div><div><dt>Sniper entry step</dt><dd>{preview.entry}</dd></div><div><dt>Sniper reset after losses</dt><dd>{preview.pause}</dd></div><div><dt>Draws reviewed</dt><dd>{preview.draws}</dd></div></dl>
      <p>{game==='unified'?'Enables Unified with all supported games except Winning Color.':'Enables only this game in individual mode.'} Uses recovery stakes, fixed Winning Color profit and 2x High/Low. Turns off rollover, flat betting, summary filters and weighted staking. Your stop loss, take profit, circuit breaker and shadow settings are kept.</p>
      <p>The live engine calculates actual stakes. Its sniper follows prediction-history steps, so entry and pause behavior can differ from the suggestion's played-bet example. This does not copy the illustrated reserve into your loss limit.</p>
      <button type="button" className="btn btn-primary" disabled={loading||disabled||control?.running||control?.busy||control?.controller!=='website'} onClick={apply}>Apply preview to setup form</button>
      <p>Then review Game setup and press Save settings. An active recovery sequence must finish or be explicitly reset first.</p>
    </>}
    <a href="suggestions.html">Choose another suggestion</a>
  </section>;
}
