import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth';
export default function SuggestionsPage() {
  const [limit, setLimit] = useState(100), [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try { const result = await apiRequest(`/public-suggestions?limit=${limit}`); if (active) { setData(result); setError(''); } }
      catch (e) { if (active) setError(e.message); }
      finally { if (active) setLoading(false); }
    }
    setLoading(true); setData(null); load(); const timer = setInterval(load, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [limit, refresh]);
  return <main className="page-wrap resource-page">
    <section className="page-intro"><span className="overline">OPEN TO EVERYONE</span><h1>Understand the history.<br />Make informed decisions.</h1><p>Automatic strategy suggestions from completed results. Powered by transparent rules, with no external AI service.</p></section>
    <section className="content-card resource-toolbar"><div><h2>Strategy suggestions</h2><p>Review patterns across the available history.</p></div><label>Draw window<select value={limit} onChange={e => setLimit(Number(e.target.value))}>{[50,100,200,500,1000].map(n => <option key={n} value={n}>Last {n} draws</option>)}</select></label><button className="btn btn-secondary" onClick={() => setRefresh(n => n + 1)} disabled={loading}>Refresh</button></section>
    <p className="resource-note">Historical win rates are not future probabilities or profit estimates. Games have different odds and costs. These suggestions never change your automation or reveal live paid predictions.</p>
    {error && <p className="content-card" role="alert">Could not refresh results: {error}{data ? ' Showing the last loaded snapshot.' : ''}</p>}
    {loading && <p role="status">Reading completed draws...</p>}
    {data && <><p className="resource-note">{data.draws} of {data.requested} requested draws available{data.fromDraw ? ` ? #${data.fromDraw} to #${data.toDraw}` : ''}. Updated {new Date(data.generatedAt).toLocaleTimeString()}.{data.lastSettledAt && ` Latest result: ${new Date(data.lastSettledAt).toLocaleString()}.`}</p>
    {!data.draws ? <section className="content-card"><h2>Waiting for fresh results</h2><p>Suggestions will appear as draws settle. Daily history resets can temporarily leave this page empty.</p></section> : <div className="resource-grid">{data.markets.map(m => <article className="content-card insight-card" key={m.key}><span className="overline">{m.samples < 50 ? 'BUILDING SAMPLE' : 'HISTORY REVIEW'}</span><h2>{m.name}</h2><div className="insight-rate">{m.winRate === null ? '--' : `${m.winRate}%`}<span>observed win rate</span></div><dl className="resource-facts"><div><dt>Wins / losses</dt><dd>{m.wins} / {m.losses}</dd></div><div><dt>Settled picks</dt><dd>{m.samples}</dd></div><div><dt>Skipped / unavailable</dt><dd>{m.skipped}</dd></div><div><dt>Current losing run</dt><dd>{m.currentLosses}</dd></div><div><dt>Worst losing run</dt><dd>{m.worstLosses}</dd></div></dl><p className="insight-suggestion">{m.suggestion}</p>{m.gaps > 0 && <p className="resource-note">{m.gaps} gaps in draw history. Losing runs restart after each gap.</p>}</article>)}</div>}
    <section className="content-card resource-method"><h2>How to read these suggestions</h2><p>Win rate uses wins divided by settled wins and losses. Skips are excluded. Losing runs carry across skips, but stop at missing draw IDs. All streaks shown here belong to the selected window, not the lifetime Telegram tracking period.</p><p>At least 50 settled picks are required for a general review suggestion. Older results may reflect earlier prediction rules. The worst recorded run is not a limit on future losses.</p><a className="btn btn-secondary" href="history.html">Explore results</a></section></>}
  </main>;
}
