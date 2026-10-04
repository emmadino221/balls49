import React, { useMemo, useState } from 'react';

const strategies = [
  { id: 'betzero', label: 'BetZero', odds: 1.65, type: 'odds' },
  { id: 'bet49', label: 'Bet49 · single number', odds: 7.8, type: 'odds' },
  { id: 'rainbow', label: 'Rainbow Color', odds: 1.5, type: 'odds' },
  { id: 'hilo', label: 'High / Low · 2×', odds: 2, multiplier: 2, type: 'multiplier' },
  { id: 'hilo140', label: 'High / Low · 1.4× progression', odds: 2, multiplier: 1.4, type: 'multiplier' },
  { id: 'totalColor', label: 'Total Color · 3-way', odds: 3.8, costFactor: 3, type: 'totalColor' },
  { id: 'totalColor2', label: 'Total Color · 2-way', odds: 3.8, costFactor: 2, type: 'totalColor2' },
  { id: 'custom', label: 'Custom odds', odds: 2, type: 'custom' },
];

const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const naira = value => `₦${Number(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const FIRST_DETAIL_ROWS = 100;
const LAST_DETAIL_ROWS = 20;

function buildSequence(strategy, baseStake, steps, customOdds) {
  const firstBets = [];
  const lastBets = [];
  let totalCost = 0;
  let nextBet = baseStake;
  let largestStake = 0;
  let calculatedSteps = 0;
  let overflow = false;
  let overflowAtStep = null;
  const odds = strategy.type === 'custom' ? customOdds : strategy.odds;
  const targetProfit = baseStake * (odds - 1);

  if (!Number.isFinite(baseStake) || baseStake < 0.01 || !Number.isFinite(odds) || odds <= 1) {
    return { bets: [], total: 0, odds, calculatedSteps: 0, largestStake: 0, overflow: false, invalidStake: true };
  }

  for (let step = 1; step <= steps; step += 1) {
    if (!Number.isFinite(totalCost) || !Number.isFinite(nextBet)) {
      overflow = true;
      overflowAtStep = step;
      break;
    }
    let bet;
    let profit;
    let exposure;

    if (strategy.type === 'multiplier') {
      bet = roundMoney(nextBet);
      profit = roundMoney((bet * 2) - (totalCost + bet));
      exposure = bet;
      nextBet = bet * strategy.multiplier;
    } else if (strategy.type === 'totalColor' || strategy.type === 'totalColor2') {
      const twoWay = strategy.type === 'totalColor2';
      bet = step === 1 ? baseStake : twoWay ? (totalCost + baseStake) / 1.8 : totalCost / 0.8;
      bet = roundMoney(bet);
      exposure = bet * strategy.costFactor;
      profit = roundMoney(twoWay
        ? (step === 1 ? (bet * 3.8) - (bet * 2) : baseStake)
        : (step === 1 ? (bet * 3.8) - (bet * 3) : 0));
    } else {
      const stepProfitTarget = strategy.id === 'bet49'
        ? targetProfit + ((step - 1) * baseStake)
        : targetProfit;
      bet = step === 1 ? baseStake : (totalCost + stepProfitTarget) / (odds - 1);
      bet = roundMoney(bet);
      exposure = bet;
      profit = roundMoney(stepProfitTarget);
    }

    if (!Number.isFinite(bet) || !Number.isFinite(exposure) || bet < 0 || exposure < 0) {
      overflow = true;
      overflowAtStep = step;
      break;
    }
    totalCost += exposure;
    calculatedSteps = step;
    largestStake = Math.max(largestStake, bet);
    const row = { step, bet, exposure: roundMoney(exposure), cumulativeRisk: roundMoney(totalCost), profit };
    if (step <= FIRST_DETAIL_ROWS) {
      firstBets.push(row);
    } else {
      lastBets.push(row);
      if (lastBets.length > LAST_DETAIL_ROWS) lastBets.shift();
    }
    if (!Number.isFinite(totalCost)) {
      overflow = true;
      overflowAtStep = step;
      break;
    }
  }

  const omittedRows = Math.max(0, calculatedSteps - firstBets.length - lastBets.length);
  const bets = omittedRows > 0
    ? [...firstBets, { gap: omittedRows }, ...lastBets]
    : [...firstBets, ...lastBets];
  return { bets, total: roundMoney(totalCost), odds, calculatedSteps, largestStake, overflow, overflowAtStep, invalidStake: false };
}

export default function CalculatorPage() {
  const [strategyId, setStrategyId] = useState('betzero');
  const [baseStake, setBaseStake] = useState('500');
  const [steps, setSteps] = useState('5');
  const [capital, setCapital] = useState('10000');
  const [customOdds, setCustomOdds] = useState('2');
  const strategy = strategies.find(item => item.id === strategyId) || strategies[0];
  const parsedStake = Number(baseStake);
  const safeStake = Number.isFinite(parsedStake) ? Math.max(0, parsedStake) : 0;
  const parsedSteps = Number(steps);
  const safeSteps = Number.isSafeInteger(parsedSteps) ? Math.max(1, parsedSteps) : 1;
  const safeCapital = Math.max(0, Number(capital) || 0);
  const safeOdds = Math.min(1000, Math.max(1.01, Number(customOdds) || 1.01));
  const result = useMemo(
    () => buildSequence(strategy, safeStake, safeSteps, safeOdds),
    [strategy, safeStake, safeSteps, safeOdds],
  );
  const riskPercent = safeCapital > 0 ? (result.total / safeCapital) * 100 : null;

  return (
    <main className="page-wrap calculator-page">
      <section className="page-intro">
        <span className="overline">MARTINGALE PLANNER</span>
        <h1>Plan your stake sequence.</h1>
        <p>Estimate a market-specific stake sequence and total exposure. This planner does not place bets or control extension automation.</p>
      </section>

      <section className="calculator-layout" aria-label="Martingale calculator">
        <form className="calculator-inputs" onSubmit={event => event.preventDefault()}>
          <div className="calculator-card-heading">
            <span className="overline">YOUR SETUP</span>
            <h2>Choose a strategy</h2>
          </div>

          <label className="calculator-field">
            <span>Strategy</span>
            <select value={strategyId} onChange={event => setStrategyId(event.target.value)}>
              {strategies.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <div className="calculator-field-row">
            <label className="calculator-field">
              <span>Starting stake (₦)</span>
              <input type="number" min="0.01" step="0.01" value={baseStake} onChange={event => setBaseStake(event.target.value)} inputMode="decimal" />
            </label>
            <label className="calculator-field">
              <span>Number of steps</span>
              <input type="number" min="1" step="1" value={steps} onChange={event => setSteps(event.target.value)} inputMode="numeric" />
            </label>
          </div>
          {strategy.type === 'custom' && (
            <label className="calculator-field">
              <span>Decimal odds</span>
              <input type="number" min="1.01" max="1000" step="0.01" value={customOdds} onChange={event => setCustomOdds(event.target.value)} inputMode="decimal" />
            </label>
          )}
          <label className="calculator-field">
            <span>Available capital (₦)</span>
            <input type="number" min="0" step="0.01" value={capital} onChange={event => setCapital(event.target.value)} inputMode="decimal" />
          </label>
          <p className="calculator-input-note">The capital amount is only used to compare against the sequence total.</p>
        </form>

        <aside className="calculator-summary" aria-live="polite">
          <div className="calculator-card-heading">
            <span className="overline">SEQUENCE SUMMARY</span>
            <h2>{strategy.label}</h2>
          </div>
          <div className="calculator-total-label">Total risk across {result.calculatedSteps} of {safeSteps} requested {safeSteps === 1 ? 'step' : 'steps'}</div>
          <strong className="calculator-total">{naira(result.total)}</strong>
          {result.invalidStake && <p className="calculator-risk-alert" role="status">Enter a base stake of at least ₦0.01 to calculate this sequence.</p>}
          <div className="calculator-summary-stats">
            <div><span>Starting stake</span><strong>{naira(safeStake)}</strong></div>
            <div><span>Largest calculated step stake</span><strong>{naira(result.largestStake)}</strong></div>
            <div><span>Capital used</span><strong>{riskPercent === null ? 'Add capital' : `${riskPercent.toFixed(1)}%`}</strong></div>
          </div>
          {result.overflow && <p className="calculator-risk-alert" role="status">The sequence exceeded the calculator’s numeric range at Step {result.overflowAtStep}. Showing the calculable portion.</p>}
          {riskPercent !== null && riskPercent > 80 && (
            <p className="calculator-risk-alert" role="status">This sequence is more than 80% of the capital entered.</p>
          )}
          <p className="calculator-summary-note">A sequence total is the amount required to place every listed step after losses. It is not a promise of recovery or profit.</p>
        </aside>
      </section>

      <section className="calculator-results" aria-labelledby="sequence-heading">
        <div className="calculator-results-heading">
          <div><span className="overline">STEP-BY-STEP</span><h2 id="sequence-heading">Your sequence</h2></div>
          <span className="calculator-odds-chip">{result.odds}× payout odds</span>
        </div>
        <div className="calculator-table-scroll">
          <table className="calculator-table">
            <thead><tr><th scope="col">Step</th><th scope="col">Stake</th><th scope="col">Exposure this step</th><th scope="col">Cumulative risk</th><th scope="col">Calculated result if won</th></tr></thead>
            <tbody>{result.bets.map(item => item.gap
              ? <tr key="omitted-steps"><td colSpan="5" className="calculator-omitted-steps">… {item.gap.toLocaleString()} intermediate steps omitted from the table …</td></tr>
              : <tr key={item.step}>
                <th scope="row">{String(item.step).padStart(2, '0')}</th>
                <td>{naira(item.bet)}</td>
                <td>{naira(item.exposure)}</td>
                <td>{naira(item.cumulativeRisk)}</td>
                <td className={item.profit >= 0 ? 'calculator-profit' : 'calculator-loss'}>{item.profit < 0 ? '−' : '+'}{naira(Math.abs(item.profit))}</td>
              </tr>
            )}</tbody>
          </table>
        </div>
      </section>

      <aside className="calculator-disclaimer">
        <strong>For planning only</strong>
        <p>Martingale staking can require rapidly increasing amounts and can lose the full sequence. This website calculator uses its own market formulas; its Bet49 profit target increases per loss and can differ from the extension’s Bet49 automation progression. Actual returns can differ because of game rules, limits, rounding, or losses. Past results do not predict future draws.</p>
      </aside>
    </main>
  );
}
