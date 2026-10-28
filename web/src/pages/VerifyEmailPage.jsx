import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth.js';
import AuthLayout from './AuthLayout.jsx';
import './verify-email.css';
function saved(key) { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } }
function save(key, value) { try { sessionStorage.setItem(key, value); } catch { /* Storage is optional. */ } }
export default function VerifyEmailPage() {
  const [challenge, setChallenge] = useState(() => {
    const fragment = window.location.hash.slice(1);
    return /^[a-f0-9]{64}$/.test(fragment) ? fragment : saved('emmy-verification-challenge');
  });
  const [email, setEmail] = useState(() => saved('emmy-verification-email'));
  const [code, setCode] = useState(''), [message, setMessage] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [success, setSuccess] = useState(false), [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (challenge) save('emmy-verification-challenge', challenge);
    // Keep the challenge out of copied URLs after opening the email link.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, [challenge]);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(n => n - 1), 1000); return () => clearTimeout(timer); }, [cooldown]);
  async function verify(event) {
    event.preventDefault(); setMessage(''); setNotice('');
    const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('confirm-password')) return setMessage('The passwords do not match.');
    if (!challenge) return setMessage('Open the link in your latest email or request a new code below.');
    setBusy(true);
    try {
      await apiRequest('/auth/verify-email', { method: 'POST', body: JSON.stringify({ challenge, code, password: form.get('password') }) });
      setSuccess(true); setCode('');
      try { sessionStorage.removeItem('emmy-verification-challenge'); sessionStorage.removeItem('emmy-verification-email'); } catch { /* Optional storage. */ }
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  async function resend(event) {
    event.preventDefault(); setBusy(true); setMessage(''); setNotice('');
    try {
      const result = await apiRequest('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) });
      setChallenge(result.challenge); setCode(''); save('emmy-verification-email', email);
      setCooldown(60); setNotice(result.message);
    } catch (error) { setMessage(error.message); if (error.status === 429) setCooldown(60); }
    finally { setBusy(false); }
  }
  return <AuthLayout mode="signup" eyebrow="VERIFY YOUR EMAIL" title={success ? 'Welcome to Emmy-Bet.' : 'Check your inbox.'} description={success ? 'Your email is verified and your account is ready.' : 'Enter the six-digit code from your latest email and choose a password. Your code expires after 10 minutes.'}>
    {success ? <div className="auth-success-message" role="status"><h2>You are all set.</h2><p>We will also send you a welcome email. Paid plans still need owner approval.</p><a className="btn btn-primary" href="account.html">Open my account</a><p>If your browser asks you to sign in again, use your new password.</p></div> : <>
      <div className="verification-steps" aria-label="Signup progress"><span>Email</span><strong>Verify &amp; secure</strong><span>Ready</span></div>
      <form className="auth-form auth-form-professional" onSubmit={verify}>
        <label htmlFor="verification-code">Verification code</label>
        <input className="verification-code" id="verification-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" placeholder="000000" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0,6))} required />
        <label htmlFor="verification-password">Choose a password</label>
        <input id="verification-password" name="password" type="password" autoComplete="new-password" minLength="10" maxLength="1024" placeholder="At least 10 characters" required />
        <label htmlFor="verification-confirm">Confirm password</label>
        <input id="verification-confirm" name="confirm-password" type="password" autoComplete="new-password" minLength="10" maxLength="1024" required />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait...' : 'Verify and create account'}</button>
      </form>
      <details className="verification-resend" open={!challenge}><summary>Need a new code?</summary><p>Check your spam folder first. A new code replaces the previous one.</p><form className="auth-form" onSubmit={resend}><label htmlFor="resend-email">Signup email</label><input id="resend-email" type="email" autoComplete="email" maxLength="254" value={email} onChange={e => setEmail(e.target.value)} required /><button className="btn btn-secondary" disabled={busy || cooldown > 0}>{cooldown ? `Wait ${cooldown}s` : 'Resend code'}</button></form></details>
      {message && <p className="auth-feedback" role="alert">{message}</p>}
      {notice && <p role="status">{notice}</p>}
    </>}
  </AuthLayout>;
}
