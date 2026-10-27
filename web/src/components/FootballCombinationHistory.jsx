import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth';

const label = value => ({ WIN: 'Won', LOSS: 'Lost', VOID: 'Void', PENDING: 'Pending' }[value] || 'Pending');
export default function FootballCombinationHistory() {
  const [offset, setOffset] = useState(0), [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true, timer;
    setData(null); setError('');
    async function load() {
      try { const result = await apiRequest(`/public-football-combinations?offset=${offset}`); if (active) { setData(result); setError(''); } }
      catch (e) { if (active) setError(e.message); }
      finally { if (active) timer = setTimeout(load, 60000); }
    }
    load(); return () => { active = false; clearTimeout(timer); };
  }, [offset]);
  return <section className="football-combinations"><h2>Saved combination results</h2>
    <p>Official lists saved by the owner. Selections stay fixed; results update as final scores arrive.</p>
    {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">Loading saved combinations...</p>}
    {data && <>{!data.total && <p>No combinations saved yet.</p>}<div className="football-combination-grid">{data.tickets.map(ticket => <article className="content-card football-combination-card" key={ticket.id}>
      <header><h3>{ticket.size}-match combination</h3><strong>{label(ticket.result)}</strong></header>
      <p><small>Saved {new Date(ticket.createdAt).toLocaleString()} · #{ticket.id.slice(0, 8)}</small></p>
      <details><summary>View {ticket.size} selections</summary><ol>{ticket.selections.map(p => <li key={p.id}>
        <div className="combination-match"><strong>{p.home} vs {p.away}</strong><span>{label(p.result)}</span></div>
        <p>{p.market}: <strong>{p.label}</strong></p><small>{p.league} · {new Date(p.kickoff).toLocaleString()}{p.score ? ` · Score ${p.score}` : ''}</small>
      </li>)}</ol></details>
    </article>)}</div>
    {data.total > 20 && <div className="football-tabs"><button className="btn btn-secondary" disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 20))}>Previous</button><span>Page {Math.floor(offset / 20) + 1} of {Math.ceil(data.total / 20)}</span><button className="btn btn-secondary" disabled={offset + 20 >= data.total} onClick={() => setOffset(n => n + 20)}>Next</button></div>}
    </>}
    <p className="resource-note">One losing selection makes the list Lost. Otherwise it stays Pending until all matches settle. All remaining selections must win; void selections are excluded. An entirely void list is Void. These are tracked selections, not bookmaker tickets or payout records.</p>
  </section>;
}
