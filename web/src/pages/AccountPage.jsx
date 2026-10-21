import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth.js';
import './account.css';

const markets = [
  ['betzero', 'BetZero'], ['bet49', 'Bet49'], ['rainbow', 'Rainbow Color'],
  ['totalColor', 'Total Color (3-way)'], ['totalColor2', 'Total Color (2-way)'],
  ['hilo', 'High / Low'], ['unified', 'Unified'],
];
const planNames = { trial: 'Free Trial', premium: 'Premium', elite: 'Elite' };

export default function AccountPage() {
  const [state, setState] = useState({ loading: true });
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') setRefresh(value => value + 1);
    };
    const timer = setInterval(refreshVisible, 60000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); };
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState(current => current.account ? current : { loading: true });
    async function load() {
      try {
        const result = await apiRequest('/auth/me', { signal: controller.signal });
        if (!result.account) throw new Error('Your account details could not be loaded.');
        if (active) setState({ account: result.account });
      } catch (error) {
        if (!active) return;
        if (error.status !== 401) return setState({ error: error.message });
        try {
          await apiRequest('/admin/preview', { signal: controller.signal });
          if (active) setState({ owner: true });
        } catch (ownerError) {
          if (active) setState(ownerError.status === 401
            ? { signedOut: true } : { error: ownerError.message });
        }
      }
    }
    load();
    return () => { active = false; controller.abort(); };
  }, [refresh]);

  const account = state.account;
  const expiry = Number(account?.expiresAt || account?.plan?.expiresAt) || null;
  const expired = account?.approvalStatus === 'expired' || (expiry && expiry <= Date.now());
  const tier = expired ? 'trial' : account?.plan?.tier || 'trial';
  const paid = tier === 'premium' || tier === 'elite';
  const approved = account?.approvalStatus === 'approved' && !expired;
  const available = paid ? markets.filter(([id]) => tier === 'elite' || account?.plan?.games?.includes(id)) : [];
  const expiryLabel = expiry ? new Date(expiry).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : 'Not scheduled';
  const status = expired ? 'Plan expired' : approved ? 'Approved' : 'Awaiting approval';

  return <main className="page-wrap account-page">
    <section className="page-intro account-intro">
      <span className="overline">YOUR ACCOUNT</span>
      <h1>{account ? `Welcome${account.name ? `, ${account.name}` : ' back'}.` : 'Your membership, at a glance.'}</h1>
      <p>Plan access, available markets, and your next steps in one place.</p>
    </section>

    {state.loading && <section className="content-card" role="status">Loading your account...</section>}
    {state.error && <section className="content-card"><h2>Unable to load your account</h2><p role="alert">{state.error}</p><button className="btn btn-secondary" onClick={() => setRefresh(value => value + 1)}>Try again</button></section>}
    {state.signedOut && <section className="content-card"><h2>Sign in to see your membership</h2><p>Your account details are visible only after you sign in.</p><div className="account-actions"><a className="btn btn-primary" href="login.html">Log in</a><a className="btn btn-secondary" href="signup.html">Create an account</a></div></section>}
    {state.owner && <section className="content-card"><span className="overline">OWNER SESSION</span><h2>Manage your members</h2><p>You are signed in as the owner. Manage approvals and plan previews from your owner controls.</p><a className="btn btn-primary" href="predictions.html">Open owner controls</a></section>}

    {account && <>
      <section className="account-overview" aria-label="Membership overview">
        <article className="content-card account-plan">
          <div className="account-card-heading"><span className="overline">CURRENT ACCESS</span><span className={`account-status${approved ? ' is-approved' : ''}`}>{status}</span></div>
          <h2>{planNames[tier] || 'Free Trial'}</h2>
          <p>{paid ? 'Your approved markets are ready whenever new predictions arrive.' : 'Choose one market per draw. Your free pick appears in the final 10 seconds.'}</p>
          <div className="account-actions"><a className="btn btn-primary" href={paid ? 'predictions.html' : 'free-trial.html'}>{paid ? 'Open predictions' : 'Open free trial'}</a><a className="btn btn-secondary" href="history.html">View results</a></div>
        </article>
        <article className="content-card account-details">
          <h2>Membership details</h2>
          <dl><div><dt>Email</dt><dd>{account.email}</dd></div><div><dt>{expired ? 'Expired on' : 'Access expires'}</dt><dd>{expiryLabel}</dd></div><div><dt>Approved markets</dt><dd>{available.length ? `${available.length} of ${markets.length}` : 'Free trial selection'}</dd></div><div><dt>Telegram predictions</dt><dd>{paid && account.plan?.telegram ? 'Included — contact the owner for access' : 'Not included in current access'}</dd></div></dl>
          <button className="account-refresh" onClick={() => setRefresh(value => value + 1)}>Refresh account details</button>
          <small>Dates are shown in your local time.</small>
        </article>
      </section>

      <section className="content-card account-markets">
        <div className="account-card-heading"><div><span className="overline">YOUR MARKETS</span><h2>{paid ? 'Included in your plan' : 'Explore a free prediction'}</h2></div><a className="account-text-link" href="pricing.html">Compare plans</a></div>
        {paid ? <ul className="account-market-list">{available.map(([id, name]) => <li key={id}><span>{name}</span><span className="account-status is-approved">Approved</span></li>)}</ul> : <p>Free Trial lets you select one market on each draw. Premium unlocks selected games; Elite includes every market.</p>}
        {paid && !available.length && <p>No markets are listed for this plan. Contact the owner to review your approval.</p>}
      </section>

      <section className="account-next-grid" aria-label="Next steps">
        <article className="content-card"><span className="overline">{expired ? 'RENEW YOUR ACCESS' : 'PLAN & RENEWAL'}</span><h2>{expired ? 'Ready to return?' : paid ? 'Keep your membership up to date' : 'Ready for more access?'}</h2><p>{expired ? 'Your paid access has ended. Free Trial remains available while you arrange renewal.' : paid ? 'Your current approval remains valid until its expiry date.' : 'Paid access becomes available after the owner approves your chosen plan.'}</p><p>Upgrades and renewals are handled manually. Review the plans, then arrange approval with the owner. This page does not track payment or renewal requests.</p><a className="account-text-link" href="pricing.html">View plans and renewal options →</a></article>
        <article className="content-card"><span className="overline">MAKE YOURSELF AT HOME</span><h2>Understand each prediction</h2><p>Learn what the labels mean, read past results, and find help when you need it.</p><div className="account-help-links"><a href="guide.html">Read the prediction guide →</a><a href="history.html">Explore prediction history →</a><a href="contact.html">Contact support →</a></div></article>
      </section>
    </>}
  </main>;
}
