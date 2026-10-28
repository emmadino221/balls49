import React, { useState } from 'react';
import { apiRequest } from '../auth.js';
import AuthLayout from './AuthLayout.jsx';

export default function SignupPage() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim();
    try {
      const result = await apiRequest('/auth/signup', { method: 'POST', body: JSON.stringify({ name: form.get('name'), email }) });
      try { sessionStorage.setItem('emmy-verification-email', email); } catch { /* Email link also opens verification. */ }
      window.location.href = `verify-email.html#${result.challenge}`;
    } catch (error) { setMessage(error.message); setBusy(false); }
  }
  return <AuthLayout mode="signup" eyebrow="CREATE YOUR ACCOUNT" title="Start with your email." description="We will email you a six-digit code. Verify it, then choose your password to finish creating your account.">
    <form className="auth-form auth-form-professional" onSubmit={submit}>
      <label htmlFor="signup-name">Full name</label>
      <input id="signup-name" name="name" type="text" placeholder="Your name" autoComplete="name" maxLength="100" required />
      <label htmlFor="signup-email">Email address</label>
      <input id="signup-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" maxLength="254" required />
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending code...' : 'Send verification code'}</button>
      <small className="auth-password-hint">Already requested a code? <a href="verify-email.html">Continue verification</a>.</small>
      {message && <p className="auth-feedback" role="alert">{message}</p>}
    </form>
  </AuthLayout>;
}
