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
    <span className="overline">YOUR GAME PLAN</span><h2>Choose a game. See your plan.</h2>
    <div className="resource-toolbar"><label>Game<select value={game} onChange={e => onGameChange(e.target.value)}>{markets.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}</select></label><label>Base stake per selection (NGN)<input type="number" min="1" max="1000000" step="any" value={base} onChange={e => setBase(e.target.value)} /></label></div>
    {!validBase && <p role="alert">Enter a stake from NGN 1 to NGN 1,000,000.</p>}
    <p className="insight-suggestion"><strong>{supported ? 'History-based plan to review' : plan?.status === 'weaker' ? 'This plan did not improve newer results' : 'More results needed'}</strong>{!supported && <><br />Observe longer. Any plan below is an illustration only.</>}</p>
    {hasRule && <>
      <div className="resource-grid gameplay-rules">
        <article><h3>1. Enter</h3><strong>{plan.waitLosses ? `After ${plan.waitLosses} losses in a row` : 'After a result wins'}</strong><p>Count from a fresh win. Play the next available pick. Entry step: {plan.waitLosses + 1}.</p></article>
        <article><h3>2. Pause</h3><strong>After {plan.pauseLosses} played {plan.pauseLosses === 1 ? 'loss' : 'losses'} in a row</strong><p>Count only bets you placed in this batch.</p></article>
        <article><h3>3. Resume</h3><strong>Wait for a win, then repeat entry</strong><p>Continue with your next recovery stake, not the base stake.</p></article>
        <article><h3>4. Stop</h3><strong>When your planned reserve runs out</strong><p>Stop and review. A fully recovering bet win starts a new base-stake sequence.</p></article>
      </div>
      {economics ? <>
        {rows.length > 0 && <><div className="gameplay-reserve"><span>Illustrated reserve for {steps} attempts</span><strong>{money(rows.at(-1).reserve)}</strong><small>This entire amount can be lost. It is not a safe budget.</small></div>
        <h3>Your stake amounts</h3><p>{economics[1]} selection{economics[1] > 1 ? 's' : ''} per draw. {game === 'bet49' && 'Uses 6 numbers; recalculate if the number count changes.'} Move down one row after each played loss.</p>
        <div className="gameplay-table" tabIndex="0" role="region" aria-label="Recovery stake table"><table><thead><tr><th>Attempt</th><th>Each selection</th><th>Total stake</th><th>Reserve so far</th></tr></thead><tbody>{rows.map(r => <tr key={r.step}><td>{r.step}</td><td>{money(r.stake)}</td><td>{money(r.total)}</td><td>{money(r.reserve)}</td></tr>)}</tbody></table></div>
        {worst + 1 > 12 && <p>Only 12 attempts shown. The historical losing run was longer.</p>}</>}
      </> : <p>For Unified stake amounts, select the game it picks. Each game has different odds.</p>}
      <details><summary>Why this plan?</summary><p>{plan.reason}</p><p>Older results: {plan.training.wins} wins / {plan.training.losses} losses ({rate(plan.training.winRate)}). Newer results: {plan.validation.wins} wins / {plan.validation.losses} losses ({rate(plan.validation.winRate)}). Playing every eligible pick on newer results: {rate(plan.baseline.winRate)}.</p><p>Worst played losing run: {worst}, including losses across pauses. Current observed run in this window: {market.currentLosses}. This is not your personal betting state or a live entry signal.</p><p>Rules are ranked by older-sample win rate, then shorter losing runs, then sample size. This compares results, not profit.</p></details>
      <details><summary>How the amounts work</summary><p>The table uses a fixed base-profit target and one winning selection at {economics ? economics[0].toFixed(2) : "variable"} odds. It shows the historical played-loss run plus one attempt, capped at 12. It does not use your capital or personal loss budget.</p><p>Every row assumes earlier played attempts lost. Pauses and unplayed wins do not reset recovery. Skipped draws do not count as losses. Later stakes round up to whole naira. Fees, payout limits, partial bets and rollover modes are not included. These amounts do not change your extension settings.</p></details>
    </>}
    <p className="resource-note">Past results do not guarantee future wins. No bets or settings are changed here.</p>
  </section>;
}
