import React, { useState } from 'react';
import { apiRequest } from '../auth.js';
import AuthLayout from './AuthLayout.jsx';

export default function SignupPage() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest('/auth/signup', { method: 'POST', body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password') }) });
      window.location.href = 'predictions.html';
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <AuthLayout mode="signup" eyebrow="CREATE YOUR ACCOUNT" title="A better start begins here." description="Create an account to explore the Free Trial. Paid plan access is activated after manual approval.">
    <form className="auth-form auth-form-professional" onSubmit={submit}>
      <label htmlFor="signup-name">Full name</label>
      <input id="signup-name" name="name" type="text" placeholder="Your name" autoComplete="name" maxLength="100" required />
      <label htmlFor="signup-email">Email address</label>
      <input id="signup-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required />
      <label htmlFor="signup-password">Create password</label>
      <input id="signup-password" name="password" type="password" placeholder="At least 10 characters" autoComplete="new-password" minLength="10" required />
      <small className="auth-password-hint">Use at least 10 characters to help protect your account.</small>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating account…' : 'Create free account'}</button>
      {message && <p className="auth-feedback" role="alert">{message}</p>}
    </form>
  </AuthLayout>;
}
