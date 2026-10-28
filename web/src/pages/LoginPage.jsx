import React, { useState } from 'react';
import { apiRequest } from '../auth.js';
import AuthLayout from './AuthLayout.jsx';

export default function LoginPage() {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    const submittedEmail = String(form.get('email') || '').trim();
    setEmail(submittedEmail);
    try {
      await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email: submittedEmail, password: form.get('password') }) });
      try {
        await apiRequest('/auth/me');
      } catch (sessionError) {
        if (sessionError.status === 401) {
          throw new Error('Sign-in succeeded, but your browser did not retain the session. Open the current website address directly in your browser and try again.');
        }
        throw sessionError;
      }
      window.location.href = 'account.html';
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <AuthLayout mode="login" eyebrow="MEMBER ACCESS" title="Sign in to your account" description="Pick up where you left off and view the plan access attached to your account.">
    <form className="auth-form auth-form-professional" onSubmit={submit}>
      <label htmlFor="login-email">Email address</label>
      <input id="login-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
      <label htmlFor="login-password">Password</label>
      <input id="login-password" name="password" type="password" placeholder="Enter your password" autoComplete="current-password" required />
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {message && <p className="auth-feedback" role="alert">{message}</p>}
      <p className="auth-password-hint">Need to verify your email? <a href="verify-email.html">Enter or request a code</a>.</p>
    </form>
  </AuthLayout>;
}
