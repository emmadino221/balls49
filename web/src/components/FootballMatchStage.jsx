import React, { useEffect, useState } from 'react';
import TeamCrest from './TeamCrest';

const MARKETS = [['match', 'Match result'], ['over', 'Over 2.5'], ['under', 'Under 2.5'], ['yes', 'BTTS Yes'], ['no', 'BTTS No']];
const kickoffText = value => new Date(value).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function clock(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  return `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

// Averages over the team's recent matches sent with the fixture (at most ten).
function summarise(games) {
  if (!games?.length) return null;
  const count = games.length;
  return {
    count,
    scored: games.reduce((sum, game) => sum + game.scored, 0) / count,
    conceded: games.reduce((sum, game) => sum + game.conceded, 0) / count,
    over: games.filter(game => game.scored + game.conceded >= 3).length / count * 100,
    both: games.filter(game => game.scored > 0 && game.conceded > 0).length / count * 100,
  };
}

function FormChips({ games }) {
  const recent = (games || []).slice(0, 5).reverse();
  if (!recent.length) return null;
  return <span className="rfx-form" role="img" aria-label={`Last ${recent.length} results, oldest first: ${recent.map(game => game.result).join(' ')}`}>
    {recent.map(game => <i key={game.kickoff} className={`rfx-form-${game.result.toLowerCase()}`}>{game.result}</i>)}
  </span>;
}

function Bars({ title, options, pick }) {
  return <div className="rfx-bars">
    <h4>{title}</h4>
    {options.map(([key, label, value]) => {
      const bounded = Math.max(0, Math.min(100, value));
      return <div className={`rfx-bar${key === pick ? ' is-pick' : ''}`} key={key}>
        <span>{label}</span>
        <div className="rfx-bar-track" role="meter" aria-label={`${label} estimate`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={bounded}><i style={{ width: `${bounded}%` }} /></div>
        <strong>{value}%</strong>
      </div>;
    })}
  </div>;
}

function CompareRow({ label, home, away, format, lowerIsBetter }) {
  const known = home !== null && away !== null;
  const homeLeads = known && (lowerIsBetter ? home < away : home > away);
  const awayLeads = known && (lowerIsBetter ? away < home : away > home);
  return <div className="rfx-compare-row">
    <b className={homeLeads ? 'is-leading' : ''}>{home === null ? '—' : format(home)}</b>
    <span>{label}</span>
    <b className={awayLeads ? 'is-leading' : ''}>{away === null ? '—' : format(away)}</b>
  </div>;
}

function FormList({ id, name, games }) {
  const recent = (games || []).slice(0, 5);
  return <div className="rfx-formlist">
    <h4><TeamCrest id={id} name={name} size="sm" />{name}</h4>
    {recent.length
      ? <ul>{recent.map(game => <li key={game.kickoff}>
          <i className={`rfx-form-${game.result.toLowerCase()}`}>{game.result}</i>
          <span className="rfx-formlist-venue">{game.atHome ? 'vs' : 'at'}</span>
          <TeamCrest id={game.opponentId} name={game.opponent} size="sm" />
          <span className="rfx-formlist-name">{game.opponent}</span>
          <b>{game.atHome ? `${game.scored} – ${game.conceded}` : `${game.conceded} – ${game.scored}`}</b>
        </li>)}</ul>
      : <p>No finished matches loaded for this team yet.</p>}
  </div>;
}

function pickSummary(prediction) {
  if (!prediction || prediction.outcome !== 'PENDING') return [];
  const chips = [[prediction.pick === 'HOME' ? '1' : prediction.pick === 'AWAY' ? '2' : 'X', prediction.probabilities[prediction.pick]]];
  const goals = prediction.markets?.goals25, both = prediction.markets?.btts;
  if (goals) chips.push([goals.pick === 'OVER' ? 'Over 2.5' : 'Under 2.5', goals.probabilities[goals.pick]]);
  if (both) chips.push([both.pick === 'YES' ? 'BTTS Yes' : 'BTTS No', both.probabilities[both.pick]]);
  return chips;
}

export default function FootballMatchStage({ matches, stale, leagueName }) {
  const [selected, setSelected] = useState(null), [market, setMarket] = useState('match'), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const index = Math.max(0, matches.findIndex(m => m.id === selected));
  const match = matches[index];
  if (!match) return <section className="football-stage-empty"><h2>No upcoming fixtures</h2><p>There are no loaded matches for this league in the next seven days. Choose another league or check again later.</p></section>;
  const prediction = match.prediction;
  const started = Date.parse(match.kickoff) <= now;
  const active = prediction && prediction.outcome === 'PENDING' && !started && ['SCHEDULED', 'TIMED'].includes(match.status);
  let label = 'No pick', probability = null, strongest = false;
  if (active) {
    if (market === 'match') {
      label = prediction.pick === 'HOME' ? `${match.home} to win` : prediction.pick === 'AWAY' ? `${match.away} to win` : 'Draw';
      probability = prediction.probabilities[prediction.pick]; strongest = true;
    } else {
      const key = market === 'over' || market === 'under' ? 'goals25' : 'btts';
      const choice = { over: 'OVER', under: 'UNDER', yes: 'YES', no: 'NO' }[market];
      const saved = prediction.markets?.[key];
      label = { over: 'Over 2.5 goals', under: 'Under 2.5 goals', yes: 'Both teams to score', no: 'Not both teams to score' }[market];
      probability = saved?.probabilities?.[choice] ?? null;
      strongest = saved?.pick === choice;
    }
  }
  const available = typeof probability === 'number' && Number.isFinite(probability);
  // How match-result picks at each level did in scripts/football-backtest.js (two held-out seasons).
  const tested = market === 'match' && active && prediction.model === 'team-strength-v1' && available
    ? (probability >= 60 ? 'Strong pick: in our test on past seasons, picks this sure were right about 3 times in 4.'
      : probability >= 50 ? 'Fair pick: in our test on past seasons, picks at this level were right a little under 6 times in 10.'
        : 'Close match: in our test on past seasons, picks this unsure were right less than half the time.') : null;
  const noPick = started ? 'Kickoff reached. Check Results for settlement.' : prediction?.outcome === 'VOID'
    ? 'Saved pick voided after a fixture change.' : !['SCHEDULED', 'TIMED'].includes(match.status)
      ? 'This fixture is not currently scheduled for play.' : active
        ? 'This market was not included in the original saved prediction.' : 'Not enough recent results, or no prediction saved before the cutoff.';
  const homeForm = summarise(match.form?.home), awayForm = summarise(match.form?.away);
  const hasForm = !!(homeForm || awayForm);
  const oneDecimal = value => value.toFixed(1), whole = value => `${Math.round(value)}%`;

  return <>
    <section className="rfx-stage" aria-label="Football match prediction">
      <header className="rfx-stage-top">
        <div><span className="rfx-kicker">Fixture spotlight · {leagueName}</span><p>{kickoffText(match.kickoff)} · your time</p></div>
        <span className={`rfx-state${started ? ' is-started' : ''}`}><i aria-hidden="true" />{started ? 'In progress' : 'Pre-match'}</span>
      </header>
      {stale && <p className="rfx-notice" role="status">Data may be out of date. The countdown uses the last known kickoff.</p>}

      <div className="rfx-matchup">
        <div className="rfx-team">
          <TeamCrest id={match.homeId} name={match.home} size="lg" />
          <h2>{match.home}</h2><span className="rfx-team-role">Home</span>
          <FormChips games={match.form?.home} />
        </div>
        <div className="rfx-center">
          <span>{started ? 'Match status' : 'Kickoff in'}</span>
          <strong>{started ? 'Started' : clock(Date.parse(match.kickoff) - now)}</strong>
          {matches.length > 1 && <small>Fixture {index + 1} of {matches.length}</small>}
        </div>
        <div className="rfx-team">
          <TeamCrest id={match.awayId} name={match.away} size="lg" />
          <h2>{match.away}</h2><span className="rfx-team-role">Away</span>
          <FormChips games={match.form?.away} />
        </div>
      </div>

      <div className="rfx-pick">
        <div className="rfx-tabs" role="group" aria-label="Prediction market">{MARKETS.map(([id, name]) => <button type="button" key={id} aria-pressed={market === id} onClick={() => setMarket(id)}>{name}</button>)}</div>
        <div className="rfx-pick-panel">
          {available
            ? <>
                <div className="rfx-pick-copy"><small>{strongest ? 'Model pick for this market' : 'Estimate for this outcome'}</small><strong>{label}</strong>
                  <span>{tested || (strongest ? 'The highest estimate in this market.' : 'Not the model’s pick: the other outcome has the higher estimate.')}</span></div>
                <div className="rfx-ring" style={{ '--estimate': Math.max(0, Math.min(100, probability)) }} role="img" aria-label={`Model estimate ${probability} percent`}><strong>{Math.round(probability)}<i>%</i></strong></div>
              </>
            : <div className="rfx-pick-copy"><small>{started ? 'Started' : 'No pick'}</small><span>{noPick}</span></div>}
        </div>
      </div>

      {(active || hasForm) && <div className="rfx-analysis">
        {active && <section className="rfx-block">
          <h3>Model estimates</h3>
          <Bars title="Match result" pick={prediction.pick} options={[['HOME', match.home, prediction.probabilities.HOME], ['DRAW', 'Draw', prediction.probabilities.DRAW], ['AWAY', match.away, prediction.probabilities.AWAY]]} />
          {prediction.markets?.goals25 && <Bars title="Goals 2.5" pick={prediction.markets.goals25.pick} options={[['OVER', 'Over', prediction.markets.goals25.probabilities.OVER], ['UNDER', 'Under', prediction.markets.goals25.probabilities.UNDER]]} />}
          {prediction.markets?.btts && <Bars title="Both teams score" pick={prediction.markets.btts.pick} options={[['YES', 'Yes', prediction.markets.btts.probabilities.YES], ['NO', 'No', prediction.markets.btts.probabilities.NO]]} />}
        </section>}
        {hasForm && <section className="rfx-block">
          <h3>Recent matches compared</h3>
          <div className="rfx-compare-head"><TeamCrest id={match.homeId} name={match.home} size="sm" /><small>Last {Math.max(homeForm?.count || 0, awayForm?.count || 0)} league matches</small><TeamCrest id={match.awayId} name={match.away} size="sm" /></div>
          <CompareRow label="Goals scored per match" home={homeForm?.scored ?? null} away={awayForm?.scored ?? null} format={oneDecimal} />
          <CompareRow label="Goals conceded per match" home={homeForm?.conceded ?? null} away={awayForm?.conceded ?? null} format={oneDecimal} lowerIsBetter />
          <CompareRow label="Matches with 3+ goals" home={homeForm?.over ?? null} away={awayForm?.over ?? null} format={whole} />
          <CompareRow label="Matches where both scored" home={homeForm?.both ?? null} away={awayForm?.both ?? null} format={whole} />
        </section>}
        {hasForm && <section className="rfx-block">
          <h3>Last five matches</h3>
          <FormList id={match.homeId} name={match.home} games={match.form?.home} />
          <FormList id={match.awayId} name={match.away} games={match.form?.away} />
        </section>}
      </div>}

      <p className="rfx-caption">{active && <>{prediction.explanation} Saved {new Date(prediction.generatedAt).toLocaleString()} and not changed afterwards. </>}90 minutes plus stoppage time. Estimates are experimental, not bookmaker odds or guarantees.</p>
    </section>

    {matches.length > 1 && <section className="rfx-fixtures" aria-labelledby="rfx-fixtures-title">
      <div className="rfx-section-head"><div><span className="rfx-kicker">Next seven days</span><h2 id="rfx-fixtures-title">Upcoming fixtures</h2></div><span className="rfx-count">{matches.length} fixtures</span></div>
      <div className="rfx-fixture-list">
        {matches.map(m => {
          const chips = pickSummary(m.prediction);
          return <button type="button" key={m.id} className="rfx-fixture" aria-pressed={m.id === match.id} onClick={() => setSelected(m.id)}>
            <span className="rfx-fixture-time">{kickoffText(m.kickoff)}</span>
            <span className="rfx-fixture-teams">
              <span><TeamCrest id={m.homeId} name={m.home} size="sm" />{m.home}</span>
              <span><TeamCrest id={m.awayId} name={m.away} size="sm" />{m.away}</span>
            </span>
            <span className="rfx-chips">{chips.length
              ? chips.map(([name, value]) => <span className="rfx-chip" key={name}>{name} <b>{Math.round(value)}%</b></span>)
              : <span className="rfx-chip is-muted">No pick</span>}</span>
          </button>;
        })}
      </div>
    </section>}
  </>;
}
