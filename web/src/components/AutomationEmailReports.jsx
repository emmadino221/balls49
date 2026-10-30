import React, { useState } from 'react';
import { apiRequest } from '../auth';

export default function AutomationEmailReports({ settings, onSaved }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [interval, setInterval] = useState(settings.interval);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await apiRequest('/account/automation/command', { method: 'POST', body: JSON.stringify({ action: 'email-reports', enabled, interval: Number(interval) }) });
      onSaved(result.emailReports);
      setMessage(enabled ? 'Email schedule saved. Counting starts from now.' : 'Progress emails turned off.');
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  return <section className="content-card automation-email-reports">
    <span className="overline">STAY UPDATED</span><h2>Email progress reports</h2>
    <p>Receive your session profit/loss, balance, record and worst losing streak at your verified account email.</p>
    <form onSubmit={save}>
      <label className="automation-check"><input type="checkbox" role="switch" checked={enabled} disabled={busy || (!settings.eligible && !settings.enabled) || (!settings.configured && !settings.enabled)} onChange={e => setEnabled(e.target.checked)} />Email reports {enabled ? 'ON' : 'OFF'}</label>
      <div className="automation-fields"><label>Send after every N settled played draws<input type="number" min="1" max="10000" step="1" required value={interval} disabled={busy} onChange={e => setInterval(e.target.value)} /></label></div>
      <button type="submit" className="btn btn-secondary" disabled={busy}>{busy ? 'Saving...' : 'Save email schedule'}</button>
    </form>
    {!settings.eligible && <p>Sign in with a verified member account with active extension access to enable reports. Owner-only sign-in has no recipient email.</p>}
    {!settings.configured && <p>Email delivery needs to be configured by the owner.</p>}
    <p className="automation-help">Skipped draws are excluded. Runs with the dashboard closed. Saving restarts the interval count; resetting execution starts a new count. Delayed intervals may be combined into one report.</p>
    {settings.lastSent && <p>Last report accepted by email provider: {new Date(settings.lastSent).toLocaleString()}</p>}
    {settings.pending && <p>Report queued for delivery.</p>}
    {settings.error && <p role="status">{settings.error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
