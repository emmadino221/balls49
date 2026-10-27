import React, { useEffect, useState } from 'react';

export default function FootballCombinations({ data }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!data) return null;
  // Do not keep presenting a list after a stalled browser feed or near kickoff.
  const fresh = now - data.generatedAt < 120000;
  return <section className="football-combinations" aria-labelledby="combination-title">
    <span className="overline">ACROSS ALL SIX LEAGUES</span><h2 id="combination-title">Model-ranked combinations</h2>
    <p>One outcome per match, chosen by its highest saved model estimate. Separate lists of 3, 5, 10 and 20 matches for the next seven days.</p>
    <div className="football-combination-grid">{data.lists.map(list => {
      const selections = fresh ? list.selections.filter(p => Date.parse(p.kickoff) > now + 15 * 60000) : [];
      return <article className="content-card football-combination-card" key={list.size}>
        <header><h3>{list.size}-match combination</h3><span>{selections.length}/{list.size} available</span></header>
        {selections.length < list.size && <p className="resource-note">{fresh ? 'Incomplete: not enough eligible matches in this list.' : 'Waiting for updated selections.'}</p>}
        <ol>{selections.map(p => <li key={p.id}><div className="combination-match"><strong>{p.home} vs {p.away}</strong><span>{p.probability}%<small>model estimate</small></span></div><p>{p.market}: <strong>{p.label}</strong></p><small>{p.league} · {new Date(p.kickoff).toLocaleString()}</small></li>)}</ol>
      </article>;
    })}</div>
    <details><summary>How these lists are selected</summary><p>Each match compares the saved home/draw/away, Over/Under 2.5 and BTTS estimates available for it. The highest estimate is selected, then matches are ranked. Older predictions may only include match result. Ties use market order, then earlier kickoff and match ID. Matches less than 15 minutes from kickoff, changed fixtures, and unavailable or stale feeds are excluded.</p><p>Lists overlap: the top three can also appear in the larger lists. These lists refresh and are not saved tickets. Individual predictions remain in Results. Percentages are experimental, not proven accuracy or betting odds; they do not indicate the chance of the whole combination winning. More matches increase the chance that at least one selection loses.</p></details>
  </section>;
}
