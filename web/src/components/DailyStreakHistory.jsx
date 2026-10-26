import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth';

export default function DailyStreakHistory({ markets }) {
  const [day, setDay] = useState(''), [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    async function load() {
      try {
        const response = await apiRequest(`/public-daily-streaks${day ? `?day=${encodeURIComponent(day)}` : ''}`);
        if (active) { setData(response); setError(''); }
      } catch (e) { if (active) setError(e.message); }
      finally { if (active) setLoading(false); }
    }
    load();
    const timer = setInterval(load, 60000);
    return () => { active = false; clearInterval(timer); };
  }, [day]);
  return <section className="content-card daily-streak-history">
    <div className="resource-toolbar"><div><span className="overline">PAST DAYS</span><h2>Daily worst losing streaks</h2></div>
      {data?.dates?.length > 0 && <label>Date (Nigeria time)<select value={day || data.dates[0]} onChange={e => setDay(e.target.value)}>{data.dates.map(date => <option key={date} value={date}>{date}</option>)}</select></label>}
    </div>
    <p>Each day starts at midnight in Nigeria. These daily records stay available after history is cleared.</p>
    {loading && <p role="status">Loading daily records...</p>}
    {error && <p role="alert">Could not refresh daily records: {error}</p>}
    {!loading && !error && !data?.selected && <p>No past-day records yet. Records begin with available history; previously deleted results cannot be restored.</p>}
    {data?.selected && <>
      <p className="resource-note">{data.selected.day} · {data.selected.draws} recorded settled draws. Counts use the date each result was validated. Days with missing data may be incomplete.</p>
      <div className="market-analytics-grid">{markets.map(m => {
        const stats = data.selected.markets[m.id];
        const samples = stats ? stats.wins + stats.losses : 0;
        return <article className="content-card" key={m.id}><h3>{m.label}</h3><span>Worst losing streak</span><h2>{samples ? `${stats.worstLosses} ${stats.worstLosses === 1 ? 'loss' : 'losses'}` : '--'}</h2><small>{samples ? `${stats.wins} wins / ${stats.losses} losses` : 'No settled picks'}</small></article>;
      })}</div>
      <p className="resource-note">Skips preserve a losing run. A win ends it. Runs start fresh each day. Owner streak resets do not erase these daily records.</p>
    </>}
  </section>;
}
