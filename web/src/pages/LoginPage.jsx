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
    try {
      await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
      window.location.href = 'predictions.html';
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
    </form>
  </AuthLayout>;
}
