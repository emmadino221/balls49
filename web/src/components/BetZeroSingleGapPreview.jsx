import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../auth';
import { suggestGap } from '../gap-suggestion';

// Independent market history. Never route the single-number rollover through Bet49 settings.
export default function BetZeroSingleGapPreview({ records, level, loading, autoRefresh, snapshotAt, onBusy }) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  const [calculated, setCalculated] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const calculate = () => {
    setCalculated(true);
    setEstimate(suggestGap(records, 'betzeroSingle', level));
  };
  useEffect(() => {
    if (!loading && (calculated || autoRefresh)) {
      setEstimate(suggestGap(records, 'betzeroSingle', level));
    }
  }, [records, level, loading, autoRefresh, snapshotAt, calculated]);
  async function apply() {
    if (lock.current || !estimate?.qualified || loading) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const { control: c } = await apiRequest('/account/automation');
      if (!c || c.controller !== 'website' || c.running || c.busy) throw new Error('Use website control, stop automation and let outstanding bets settle first.');
      const saved = c.settings?.rollover;
      if (!saved?.enabled || !(saved.baseStake > 0)) throw new Error('Enable BetZero Single rollover and save its base stake on Automation first.');
      if (c.rollover?.sourcePolicy !== 'SINGLE_WIN_OWN_GAPS_V1') throw new Error('The server must finish its old run and support independent Single rollover before applying this level.');
      if (!window.confirm(`Use BetZero Single loss level ${estimate.level} for rollover windows (about ${estimate.length} draws in this sample)? The server recalculates from its own Single history. Changing the level resets rollover to step 1 and waits for a fresh Single WIN. Base stake and loss-step limit are preserved. Automation stays stopped.`)) return;
      const settings = { ...c.settings, rollover: { ...saved, gapLosses: estimate.level } };
      await apiRequest('/account/automation/command', { method: 'POST', body: JSON.stringify({ action: 'save', revision: c.revision, settings }) });
      const next = await apiRequest('/account/automation');
      if (next.control?.settings?.rollover?.gapLosses !== estimate.level) throw new Error('Saved level did not match. Reload Automation before starting.');
      setMessage(`Saved loss level ${estimate.level} for BetZero Single rollover. Automation remains stopped. Review its settings before starting.`);
    } catch (error) { setMessage(error.message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="content-card gap-suggestion">
    <span className="overline">BETZERO SINGLE HISTORY</span>
    <h2>Estimate its own playing window</h2>
    <p>Uses BetZero Single WIN/LOSS results only. A win means its selected number was absent. Selected loss level: {level}.</p>
    <button type="button" className="btn btn-primary" disabled={loading || busy} onClick={calculate}>Calculate playing window</button>
    {estimate && <div role="status">
      {estimate.qualified ? <>
        <h3>{estimate.length} draws per estimated window</h3>
        <div className="gap-selected-stats">
          <div><span>Average gap</span><strong>{estimate.average.toFixed(1)} <small>draws</small></strong></div>
          <div><span>Historical gaps</span><strong>{estimate.samples}</strong></div>
          <div><span>Loss level</span><strong>{estimate.level}</strong></div>
          <div><span>History through</span><strong>#{estimate.last}</strong></div>
        </div>
        <button type="button" className="btn btn-secondary" disabled={loading || busy} onClick={apply}>{busy ? 'Saving...' : 'Apply to Single rollover'}</button>
      </> : <p>{estimate.reason}</p>}
    </div>}
    <p>Calculation is read-only. Apply changes only the rollover gap level after confirmation. A fresh BetZero Single WIN starts a run; after collection or a loss it waits for another Single WIN. The window uses its own gap average, rounded up. SKIPs count toward the window without a bet. A historical average does not predict the next result.</p>
    <p>Older results retain the single number actually recorded under the earlier selection rule. They are not replayed using today's Lab rule.</p>
    {message && <p role="status">{message}</p>}
    <a href="automation.html#rollover">Open BetZero Single rollover settings</a>
  </section>;
}
