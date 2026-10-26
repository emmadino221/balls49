import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../auth';
import GameplayPlan from '../components/GameplayPlan';
export default function SuggestionsPage() {
  const [game, setGame] = useState('betzero');
  const [base, setBase] = useState('50'), [autoRefresh, setAutoRefresh] = useState(false);
  const revision = useRef(null), loadedRequest = useRef(null);
  const [limit, setLimit] = useState(100), [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true, timer;
    const requestKey = `${limit}:${refresh}`;
    async function load() {
      if (!active) return;
      setLoading(true);
      try {
        const result = await apiRequest(`/public-suggestions?limit=${limit}`);
        if (active) { setData(result); revision.current = result.revision; loadedRequest.current = requestKey; setError(''); }
      } catch (e) { if (active) setError(e.message); }
      finally { if (active) setLoading(false); }
    }
    async function poll() {
      if (!active || !autoRefresh) return;
      try {
        const status = await apiRequest('/public-suggestions-status');
        if (active) {
          if (status.revision !== revision.current || loadedRequest.current !== requestKey) await load();
          else setError('');
        }
      } catch (e) { if (active) setError(e.message); }
      finally { if (active && autoRefresh) timer = setTimeout(poll, 3000); }
    }
    async function start() {
      if (loadedRequest.current !== requestKey) await load();
      else setLoading(false);
      if (active && autoRefresh) poll();
    }
    start();
    return () => { active = false; clearTimeout(timer); };
  }, [limit, refresh, autoRefresh]);
  return <main className="page-wrap resource-page suggestions-page">
    <section className="page-intro"><span className="overline">OPEN TO EVERYONE</span><h1>Simple game plans.</h1><p>Choose your game and base stake. Review when to enter, pause and resume.</p></section>
    <section className="content-card resource-toolbar"><div><h2>Recent history</h2></div><label>Draw window<select value={limit} onChange={e => setLimit(Number(e.target.value))}>{[50,100,200,500,1000].map(n => <option key={n} value={n}>Last {n} draws</option>)}</select></label><button className="btn btn-secondary" onClick={() => setRefresh(n => n + 1)} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</button><button type="button" className="btn btn-secondary suggestions-auto-toggle" role="switch" aria-checked={autoRefresh} aria-label="Refresh after each settled draw" onClick={() => setAutoRefresh(value => !value)}>Auto refresh: {autoRefresh ? 'ON' : 'OFF'}</button></section>
    <p className="resource-note">{autoRefresh ? 'Updates after each new settled result. Your base stake stays unchanged.' : 'Auto refresh is off. Press Refresh when you want the latest plan.'}</p>
    {error && <p className="content-card" role="alert">Could not refresh results: {error}{data ? ' Showing the last loaded snapshot.' : ''}</p>}
    {loading && <p role="status">Reading completed draws...</p>}
    {data && <><p className="resource-note">{data.draws} of {data.requested} requested draws available{data.fromDraw ? ` - #${data.fromDraw} to #${data.toDraw}` : ''}. Updated {new Date(data.generatedAt).toLocaleTimeString()}.{data.lastSettledAt && ` Latest result: ${new Date(data.lastSettledAt).toLocaleString()}.`}</p>
    {data.draws > 0 && <GameplayPlan markets={data.markets} game={game} onGameChange={setGame} base={base} onBaseChange={setBase} />}
    {!data.draws ? <section className="content-card"><h2>Waiting for fresh results</h2><p>Suggestions will appear as draws settle. Daily history resets can temporarily leave this page empty.</p></section> : <details className="content-card resource-method"><summary>View selected game statistics</summary><div className="resource-grid">{data.markets.filter(m => m.key === game).map(m => <article className="content-card insight-card" key={m.key}><span className="overline">{m.samples < 50 ? 'BUILDING SAMPLE' : 'HISTORY REVIEW'}</span><h2>{m.name}</h2><div className="insight-rate">{m.winRate === null ? '--' : `${m.winRate}%`}<span>observed win rate</span></div><dl className="resource-facts"><div><dt>Wins / losses</dt><dd>{m.wins} / {m.losses}</dd></div><div><dt>Settled picks</dt><dd>{m.samples}</dd></div><div><dt>Skipped / unavailable</dt><dd>{m.skipped}</dd></div><div><dt>Current losing run</dt><dd>{m.currentLosses}</dd></div><div><dt>Worst losing run</dt><dd>{m.worstLosses}</dd></div></dl><p className="insight-suggestion">{m.suggestion}</p>{m.gaps > 0 && <p className="resource-note">{m.gaps} gaps in draw history. Losing runs restart after each gap.</p>}</article>)}</div></details>}
    <details className="content-card resource-method"><summary>How history is reviewed</summary><p>Win rate uses wins divided by settled wins and losses. Skips are excluded. Losing runs carry across skips, but stop at missing draw IDs. All streaks shown here belong to the selected window, not the lifetime Telegram tracking period.</p><p>Entry rules compare waits of 0 to 4 losses and pauses after 1 to 3 played losses. Selection uses the oldest 70% of this window, requiring 30 played examples; the newer 30% requires at least 15. Both segments start fresh. Repeatedly changing windows can overfit the results. Monetary tables are separate illustrations, not a simulation of historical profit. Older results may reflect earlier prediction rules. The worst recorded run is not a limit on future losses.</p><a className="btn btn-secondary" href="history.html">Explore results</a></details></>}
  </main>;
}
