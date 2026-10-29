import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth.js';
import OwnerSecurity from './OwnerSecurity';
import OwnerVideos from './OwnerVideos';
import './OwnerTools.css';

export default function OwnerTools({ onSession, games }) {
  const [unlocked, setUnlocked] = useState(false);
  const [key, setKey] = useState('');
  const [ownerCode, setOwnerCode] = useState('');
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState('trial');
  const [access, setAccess] = useState('predictions');
  const [issuedKey, setIssuedKey] = useState('');
  const [deletingUser, setDeletingUser] = useState('');
  const [months, setMonths] = useState('1');
  const [gamesSelected, setGamesSelected] = useState(['betzero']);
  const [notice, setNotice] = useState('');
  const [users, setUsers] = useState([]);
  const [section, setSection] = useState('approvals');
  const [search, setSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [activePreview, setActivePreview] = useState('');
  useEffect(() => { if (unlocked) loadUsers(); }, [unlocked]);
  const [resettingStats, setResettingStats] = useState(false);
  useEffect(() => {
    apiRequest('/admin/preview')
      .then(plan => { setUnlocked(true); setActivePreview(plan.tier); onSession('admin', plan); })
      .catch(() => apiRequest('/auth/me')
        .then(() => onSession('account', null))
        .catch(() => onSession('', null)));
  }, []);
  async function login(event) {
    event.preventDefault();
    setSigningIn(true); setNotice('');
    try { await apiRequest('/admin/session', { method: 'POST', body: JSON.stringify({ key, code:ownerCode }) }); window.location.reload(); }
    catch (error) { setNotice(error.message); }
    finally { setSigningIn(false); }
  }
  async function loadUsers() {
    setLoadingUsers(true);
    try { const result = await apiRequest('/admin/users'); setUsers(result.users); setUsersLoaded(true); }
    catch (error) { setNotice(error.message); }
    finally { setLoadingUsers(false); }
  }
  async function deleteUser(userEmail) {
    const confirmed = window.prompt(`Delete ${userEmail}? This removes their website account, signs them out and revokes member extension access. Already placed bets cannot be undone. Type their exact email to confirm.`);
    if (confirmed !== userEmail) return;
    setDeletingUser(userEmail);
    setIssuedKey('');
    try {
      await apiRequest('/admin/delete-user', { method: 'POST', body: JSON.stringify({ email: userEmail, confirmEmail: confirmed }) });
      setNotice(`${userEmail} deleted.`);
      setUsers(current => current.filter(user => user.email !== userEmail));
      if (email === userEmail) setEmail('');
    } catch (error) { setNotice(error.message); }
    finally { setDeletingUser(''); }
  }
  async function approve(event) {
    event.preventDefault();
    setIssuedKey('');
    if (!window.confirm('Have you personally confirmed this person through a phone, WhatsApp, or Telegram contact you already trust?')) return;
    setSaving(true); setNotice('');
    try {
      const result = await apiRequest('/admin/approve', { method: 'POST', body: JSON.stringify({ email, tier, months, access, games: gamesSelected, identityConfirmed: true }) });
      setNotice(`${result.user.email}: ${access} approved for ${months} month(s), starting today.`);
      setIssuedKey(result.extensionKey || '');
      loadUsers();
    } catch (error) { setNotice(error.message); }
    finally { setSaving(false); }
  }
  async function preview(previewTier) {
    try { const result = await apiRequest('/admin/preview', { method: 'POST', body: JSON.stringify({ tier: previewTier, games: gamesSelected }) }); setActivePreview(previewTier); setNotice(`Preview mode: ${previewTier}. The prediction feed now uses that plan.`); onSession('admin', { tier: result.tier, games: result.games }); }
    catch (error) { setNotice(error.message); }
  }
  async function logout() {
    try { await apiRequest('/admin/logout', { method: 'POST' }); }
    catch { /* Reload to re-check the cookie session if the API is unavailable. */ }
    finally { window.location.reload(); }
  }
  async function resetMarketStats() {
    if (!window.confirm('Restart current tracking steps, maximum losing streaks and Summary ENTER/HOLD streaks for every game? History and extension martingale amounts will be kept.')) return;
    setResettingStats(true);
    try {
      const result = await apiRequest('/admin/reset-market-stats', { method: 'POST' });
      setNotice(`Streak tracking restarted ${new Date(result.resetAt).toLocaleString()}. History and extension martingale amounts are preserved. Telegram syncs on the next successful bot feed update.`);
    } catch (error) { setNotice(error.message); }
    finally { setResettingStats(false); }
  }
  const sections = [
    ['approvals', 'Approvals', 'Give users access'],
    ['accounts', 'Accounts', 'Find and manage users'],
    ['predictions', 'Predictions', 'Preview and statistics'],
    ['security', 'Security', 'Authenticator and sessions'],
    ['videos', 'Videos', 'Manage your public library'],
  ];
  const gamePicker = <fieldset className="premium-game-picker owner-game-grid"><legend>Select games</legend>{games.map(game => <label key={game.id}><input type="checkbox" checked={gamesSelected.includes(game.id)} onChange={() => setGamesSelected(current => current.includes(game.id) ? current.filter(id => id !== game.id) : [...current, game.id])} /><span>{game.name}</span></label>)}</fieldset>;
  const visibleUsers = users.filter(user => user.email.toLowerCase().includes(search.trim().toLowerCase()));
  const date = value => value > Date.now() ? new Date(value).toLocaleDateString() : 'Not active';
  if (!unlocked) return <section className="content-card owner-tools owner-console owner-login">
    <div className="owner-login-intro"><span className="overline">PRIVATE WORKSPACE</span><h2>Welcome back, owner.</h2><p>Manage accounts, content, and access from one place.</p><span className="owner-badge">Owner sign-in</span></div>
    <form className="auth-form" onSubmit={login}>
      <label htmlFor="owner-key">Owner key</label><input id="owner-key" type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off" required />
      <label htmlFor="owner-code">Authenticator or recovery code</label><input id="owner-code" value={ownerCode} onChange={e=>setOwnerCode(e.target.value)} autoComplete="one-time-code" maxLength={32} aria-describedby="owner-code-help" />
      <small id="owner-code-help">Required when two-factor authentication is enabled.</small>
      <button className="btn btn-primary" disabled={signingIn}>{signingIn?'Signing in...':'Open owner workspace'}</button>
      {notice&&<p role="status">{notice}</p>}
    </form>
  </section>;
  return <section className="content-card owner-tools owner-console">
    <header className="owner-console-header"><div><span className="overline">OWNER WORKSPACE</span><h2>Your control centre</h2><p>Accounts, access, and content. All in one place.</p></div><button className="btn btn-secondary" type="button" onClick={logout}>Sign out</button></header>
    <div className="owner-metrics" aria-label="Account overview">
      <div><span>Registered accounts</span><strong>{usersLoaded?users.length:'—'}</strong></div>
      <div><span>Approved accounts</span><strong>{usersLoaded?users.filter(u=>u.approvalStatus==='approved').length:'—'}</strong></div>
      <div><span>Active extensions</span><strong>{usersLoaded?users.filter(u=>u.extensionExpiresAt>Date.now()).length:'—'}</strong></div>
    </div>
    <div className="owner-workspace">
      <nav className="owner-navigation" aria-label="Owner sections">{sections.map(([id,label,description],i)=><button type="button" key={id} aria-current={section===id?'page':undefined} aria-controls={`owner-panel-${id}`} onClick={()=>setSection(id)}><span className="owner-nav-number" aria-hidden="true">0{i+1}</span><span><strong>{label}</strong><small>{description}</small></span></button>)}</nav>
      <div className="owner-main">
        {notice&&<div className="owner-notice" role="status">{notice}<button type="button" aria-label="Dismiss notification" onClick={()=>setNotice('')}>×</button></div>}
        <section id="owner-panel-approvals" hidden={section!=='approvals'} aria-label="Approvals">
          <div className="owner-section-title"><span className="overline">USER ACCESS</span><h3>Approve an account</h3><p>Choose what this user can access and for how long.</p></div>
          <form className="auth-form owner-approval-form" onSubmit={approve}>
            <label className="owner-full">Registered email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="user@example.com" required /></label>
            <label>Access<select value={access} onChange={e=>setAccess(e.target.value)}><option value="predictions">Predictions only</option><option value="extension">Extension only</option><option value="both">Predictions + extension</option></select></label>
            <label>Duration<select value={months} onChange={e=>setMonths(e.target.value)}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1} {i===0?'month':'months'}</option>)}</select></label>
            {access!=='extension'&&<label className="owner-full">Prediction plan<select value={tier} onChange={e=>setTier(e.target.value)}><option value="trial">Free Trial</option><option value="premium">Premium</option><option value="elite">Elite</option></select></label>}
            {access!=='extension'&&tier==='premium'&&gamePicker}
            {access!=='predictions'&&<div className="owner-inline-note owner-full"><strong>Extension · NGN 80,000 / 30 days</strong><span>Confirm payment before approving. Prediction fees are separate.</span></div>}
            <div className="owner-form-footer owner-full"><span>Approval starts today.</span><button className="btn btn-primary" disabled={saving}>{saving?'Saving...':'Approve access'}</button></div>
          </form>
          {issuedKey&&<div className="owner-issued-key auth-form"><label>Extension access key<input readOnly value={issuedKey} onFocus={e=>e.target.select()} /></label><small>Share privately with this user.</small><button type="button" className="btn btn-secondary" onClick={()=>setIssuedKey('')}>Hide key</button></div>}
        </section>
        <section id="owner-panel-accounts" hidden={section!=='accounts'} aria-label="Accounts">
          <div className="owner-section-title"><span className="overline">MEMBER DIRECTORY</span><h3>Your accounts</h3><p>Find a user to update their access or remove their account.</p></div>
          <div className="owner-account-toolbar auth-form"><label>Search by email<input type="search" value={search} placeholder="Find an account..." onChange={e=>setSearch(e.target.value)} /></label><button className="btn btn-secondary" type="button" onClick={loadUsers} disabled={loadingUsers}>{loadingUsers?'Loading...':'Refresh'}</button></div>
          {!usersLoaded?<div className="owner-empty">{loadingUsers?'Loading accounts...':'Accounts could not be loaded. Select Refresh to try again.'}</div>:<>
            <p className="owner-result-count">{visibleUsers.length} of {users.length} accounts</p>
            {!visibleUsers.length&&<div className="owner-empty">{search?'No accounts match this email.':'New registrations will appear here.'}</div>}
            <div className="owner-account-grid">{visibleUsers.map(user=><article key={user.email} className="owner-account-card"><div className="owner-account-heading"><span className="owner-avatar" aria-hidden="true">{user.email[0].toUpperCase()}</span><div><h4>{user.email}</h4><span className={`owner-badge ${user.approvalStatus==='approved'?'':'owner-badge-muted'}`}>{user.approvalStatus==='approved'?'Approved':user.approvalStatus==='expired'?'Plan expired':'Pending approval'}</span></div></div><dl><div><dt>Prediction plan</dt><dd>{user.plan?.tier||'trial'}</dd></div><div><dt>Prediction expiry</dt><dd>{date(user.expiresAt)}</dd></div><div><dt>Extension expiry</dt><dd>{date(user.extensionExpiresAt)}</dd></div></dl><div className="owner-account-actions"><button type="button" className="btn btn-secondary" onClick={()=>{setEmail(user.email);setIssuedKey('');setSection('approvals');}}>Manage access</button><button type="button" className="owner-danger-button" disabled={!!deletingUser} onClick={()=>deleteUser(user.email)}>{deletingUser===user.email?'Deleting...':'Delete user'}</button></div></article>)}</div>
          </>}
        </section>
        <section id="owner-panel-predictions" hidden={section!=='predictions'} aria-label="Prediction controls">
          <div className="owner-section-title"><span className="overline">PREDICTION CONTROLS</span><h3>Preview the member experience</h3><p>View the feed with a selected plan. This applies only to your owner session.</p></div>
          <div className="owner-preview-actions">{[['trial','Free Trial'],['premium','Premium'],['elite','Elite']].map(([id,label])=><button key={id} className="btn btn-secondary" type="button" aria-pressed={activePreview===id} onClick={()=>preview(id)}>{label}</button>)}</div>
          <details className="owner-preview-games"><summary>Choose games for Premium preview</summary><div className="auth-form">{gamePicker}</div><p>Choose games, then select Premium above to apply.</p></details>
          <div className="owner-reset-card"><span className="overline">STATISTICS</span><h3>Restart prediction streaks</h3><p>Resets tracking steps, maximum losses, and Summary ENTER/HOLD streaks for all games. History and extension martingale amounts stay saved. The website and Telegram synchronize on the next successful feed update.</p><button className="btn btn-secondary" type="button" onClick={resetMarketStats} disabled={resettingStats}>{resettingStats?'Restarting...':'Reset all prediction streaks'}</button></div>
        </section>
        <section id="owner-panel-security" hidden={section!=='security'} aria-label="Owner security"><OwnerSecurity /></section>
        <section id="owner-panel-videos" hidden={section!=='videos'} aria-label="Video library"><OwnerVideos /></section>
      </div>
    </div>
  </section>;
}
