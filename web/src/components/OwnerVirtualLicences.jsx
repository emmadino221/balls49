import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth.js';

// Owner section: issue, renew and revoke virtual football extension licence keys.
const date = value => value ? new Date(value).toLocaleDateString() : '--';

export default function OwnerVirtualLicences({ users = [] }) {
  const [licences, setLicences] = useState(null);
  const [email, setEmail] = useState('');
  const [months, setMonths] = useState('1');
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function load() {
    try { setLicences((await apiRequest('/admin/virtual-licences')).licences); }
    catch (error) { setNotice(error.message); }
  }
  useEffect(() => { load(); }, []);

  async function issue(event) {
    event.preventDefault();
    setIssued(null);
    const target = email.trim().toLowerCase();
    const renewing = licences?.some(l => l.email === target && l.status !== 'revoked');
    if (!window.confirm(`${renewing ? 'Renew' : 'Issue'} a virtual football licence for ${target} for ${months} ${months === '1' ? 'month' : 'months'}, starting today?${renewing ? ' Their key stays the same.' : ''} Have you confirmed this person through a contact you already trust?`)) return;
    setBusy(true); setNotice('');
    try {
      const result = await apiRequest('/admin/virtual-licence', { method: 'POST', body: JSON.stringify({ action: 'issue', email: target, months, identityConfirmed: true }) });
      setIssued(result);
      setNotice(`${result.email}: virtual football licence active until ${date(result.expiresAt)}.`);
      await load();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  async function revoke(target) {
    if (!window.confirm(`Revoke the virtual football licence for ${target}? Their extension stops on its next check, within a few seconds. A bet already placed still settles on Bet9ja.`)) return;
    setBusy(true); setNotice(''); setIssued(null);
    try { await apiRequest('/admin/virtual-licence', { method: 'POST', body: JSON.stringify({ action: 'revoke', email: target }) }); setNotice(`${target}: licence revoked.`); await load(); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }

  return <>
    <div className="owner-section-title"><span className="overline">VIRTUAL FOOTBALL AUTOMATION</span><h3>Licence keys</h3>
      <p>Issue a key to a registered account. The member's virtual dashboard is linked automatically, and they can show the key there to enter it in the extension.</p></div>
    {notice && <div className="owner-notice" role="status">{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    <form className="auth-form owner-approval-form" onSubmit={issue}>
      <label className="owner-full">Registered email<input type="email" list="owner-virtual-emails" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" required /></label>
      <datalist id="owner-virtual-emails">{users.map(u => <option key={u.email} value={u.email} />)}</datalist>
      <label>Duration<select value={months} onChange={e => setMonths(e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1} {i === 0 ? 'month' : 'months'} ({(i + 1) * 30} days)</option>)}</select></label>
      <div className="owner-form-footer owner-full"><span>The licence starts today. Renewing keeps the member's key.</span><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Issue licence'}</button></div>
    </form>
    {issued && <div className="owner-issued-key auth-form"><label>Virtual football licence key for {issued.email}<input readOnly value={issued.key} onFocus={e => e.target.select()} /></label>
      <small>Share privately. The member enters it in the virtual football extension popup.</small>
      <button type="button" className="btn btn-secondary" onClick={() => setIssued(null)}>Hide key</button></div>}

    <div className="owner-section-title"><h3>Issued licences</h3></div>
    {!licences ? <div className="owner-empty">Loading licences...</div>
      : !licences.length ? <div className="owner-empty">No virtual football licences issued yet.</div>
      : <div className="owner-account-grid">{licences.map(l => <article key={l.email} className="owner-account-card">
          <div className="owner-account-heading"><span className="owner-avatar" aria-hidden="true">{l.email[0].toUpperCase()}</span><div><h4>{l.email}</h4>
            <span className={`owner-badge ${l.status === 'active' ? '' : 'owner-badge-muted'}`}>{l.status === 'active' ? 'Active' : l.status === 'expired' ? 'Expired' : 'Revoked'}</span></div></div>
          <dl><div><dt>Expires</dt><dd>{date(l.expiresAt)}</dd></div><div><dt>Issued</dt><dd>{date(l.issuedAt)}</dd></div><div><dt>Key ends</dt><dd>{l.keyHint ? `…${l.keyHint}` : '--'}</dd></div></dl>
          <div className="owner-account-actions">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setEmail(l.email); setIssued(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{l.status === 'revoked' ? 'Issue new key' : 'Renew'}</button>
            {l.status !== 'revoked' && <button type="button" className="owner-danger-button" disabled={busy} onClick={() => revoke(l.email)}>Revoke</button>}
          </div></article>)}</div>}
  </>;
}
