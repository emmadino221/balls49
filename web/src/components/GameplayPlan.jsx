import React, { useState } from 'react';

const ECONOMICS = { betzero: [1.65, 1], rainbow: [1.5, 1], hilo: [2, 1], totalColor: [3.8, 3], totalColor2: [3.8, 2], totalColor1: [3.8, 1], bet49: [7.8, 6] };
const money = n => `NGN ${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const rate = n => n == null ? '--' : `${n}%`;

export default function GameplayPlan({ markets, game, onGameChange }) {
  const [base, setBase] = useState('50');
  const market = markets.find(m => m.key === game);
  if (!market) return null;
  const plan = market.gameplay, economics = ECONOMICS[game];
  const validBase = Number.isFinite(Number(base)) && Number(base) >= 1 && Number(base) <= 1000000;
  const supported = plan?.status === 'candidate';
  const hasRule = Number.isInteger(plan?.waitLosses);
  const worst = hasRule ? Math.max(plan.training.worstPlayedRun, plan.validation.worstPlayedRun) : 0;
  // One extra attempt after the observed recovery run. This is a display bound, not a risk guarantee.
  const steps = Math.min(12, worst + 1), rows = [];
  if (validBase && economics && hasRule) {
    const [odds, count] = economics, target = Number(base) * (odds - count);
    let lost = 0;
    for (let i = 0; i < steps; i++) {
      const stake = i === 0 ? Number(base) : Math.ceil((lost + target) / (odds - count));
      const total = stake * count;
      lost += total;
      rows.push({ step: i + 1, stake, total, reserve: lost });
    }
  }
  return <section className="content-card gameplay-plan">
    <span className="overline">YOUR GAMEPLAY PLAN</span><h2>When to enter. When to pause. What to reserve.</h2>
    <div className="resource-toolbar"><label>Game<select value={game} onChange={e => onGameChange(e.target.value)}>{markets.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}</select></label><label>Base stake (NGN, per selection)<input type="number" min="1" max="1000000" step="any" value={base} onChange={e => setBase(e.target.value)} /></label></div>
    {!validBase && <p role="alert">Enter a base stake between NGN 1 and NGN 1,000,000.</p>}
    <p className="insight-suggestion"><strong>{supported ? 'Candidate plan to review' : 'Observe longer before adopting a plan'}</strong><br />{plan?.reason || 'Waiting for the server to provide gameplay history.'}</p>
    {hasRule && <>
      {!supported && <p>The rule below is shown for inspection only; it has not met the history checks.</p>}
      <div className="resource-grid gameplay-rules">
        <article><h3>1. Enter</h3><p>{plan.waitLosses === 0 ? 'Start on the next eligible prediction after an observed win.' : `After an observed win, wait for ${plan.waitLosses} consecutive settled losses, then enter the next eligible prediction.`} This corresponds to step {plan.waitLosses + 1} in a fresh win/loss sequence.</p></article>
        <article><h3>2. Pause</h3><p>Pause after {plan.pauseLosses} consecutive losses that you actually played in this batch. Skipped draws do not count as losses.</p></article>
        <article><h3>3. Resume</h3><p>While paused, wait for an observed win, then {plan.waitLosses ? `another ${plan.waitLosses} consecutive losses` : 'the next eligible prediction'}. Keep your recovery amount and played-loss count. A win you did not bet on does not clear your losses.</p></article>
        <article><h3>4. End the sequence</h3><p>An actual fully recovering win returns this illustration to the base stake. If you exhaust the planned reserve, stop and review; do not automatically restart or add funds.</p></article>
      </div>
      <p className="resource-note">Current observed losing run in this window: <strong>{market.currentLosses}</strong>. This is not your personal betting state or a live entry signal. Follow results from a fresh observed win to use the rule.</p>
      <details><summary>Why this entry and pause rule?</summary><p>On the older 70%: {plan.training.wins} wins / {plan.training.losses} losses ({rate(plan.training.winRate)}). On the newer 30%: {plan.validation.wins} wins / {plan.validation.losses} losses ({rate(plan.validation.winRate)}), compared with {rate(plan.baseline.winRate)} for every eligible pick. Worst consecutive played losses across either segment: {worst}, including losses carried across pauses.</p><p>Rules are ranked by older-sample win rate, then shorter losing runs, then sample size. This compares outcomes, not profit or personal affordability.</p></details>
      {economics ? <>
        <h3>Recovery reserve illustration</h3>
        <p>Fixed base-profit target, {economics[0].toFixed(2)} decimal odds, {economics[1]} selection{economics[1] > 1 ? 's' : ''} per played draw. Assumes one winning selection. {game === 'bet49' && 'Bet49 uses six numbers here as the largest exposure case; live stakes must be recalculated when the count changes.'}</p>
        <p>This illustrates {steps} attempts: the observed played-loss run plus one attempt{worst + 1 > 12 ? ', capped at 12 for display (the observed run is longer)' : ''}. It is not a safe loss limit or the extension settings. Other recovery and rollover modes differ.</p>
        {rows.length > 0 && <><div className="gameplay-reserve"><span>Reserve for all illustrated attempts</span><strong>{money(rows.at(-1).reserve)}</strong><small>You could lose this entire amount. Without a capital or loss budget, this page cannot judge affordability.</small></div><div className="gameplay-table" tabIndex="0" role="region" aria-label="Recovery stake table"><table><thead><tr><th>Attempt</th><th>Per selection</th><th>Total at risk</th><th>Cumulative reserve</th></tr></thead><tbody>{rows.map(r => <tr key={r.step}><td>{r.step}</td><td>{money(r.stake)}</td><td>{money(r.total)}</td><td>{money(r.reserve)}</td></tr>)}</tbody></table></div><p className="resource-note">Each row assumes every earlier played attempt lost. Pauses do not restart the table. Amounts after the first attempt round up to whole naira. Payout limits, partial bets and fees are not simulated.</p></>}
      </> : <p>Unified can switch between games with different odds and costs. Choose its underlying game above for a stake illustration; one fixed Unified recovery table would be misleading.</p>}
    </>}
  </section>;
}
