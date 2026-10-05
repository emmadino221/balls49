import React, { useState } from 'react';
import { apiRequest } from '../auth.js';
import AuthLayout from './AuthLayout.jsx';

export default function SignupPage() {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const submittedEmail = String(form.get('email') || '').trim();
      await apiRequest('/auth/signup', { method: 'POST', body: JSON.stringify({ name: form.get('name'), email: submittedEmail }) });
      setEmail(submittedEmail);
      setVerificationSent(true);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <AuthLayout mode="signup" eyebrow="CREATE YOUR ACCOUNT" title="A better start begins here." description="Create an account to explore the Free Trial. Paid plan access is activated after manual approval.">
    {verificationSent
      ? <div className="auth-verification-message" role="status">
          <span className="auth-verification-icon" aria-hidden="true">✉</span>
          <h2>Check your inbox</h2>
          <p>We sent a verification link to <strong>{email}</strong>. Open it to verify your email and create your password. The link expires in 24 hours.</p>
          <a className="btn btn-secondary" href="login.html">Continue to sign in</a>
        </div>
      : <form className="auth-form auth-form-professional" onSubmit={submit}>
          <label htmlFor="signup-name">Full name</label>
          <input id="signup-name" name="name" type="text" placeholder="Your name" autoComplete="name" maxLength="100" required />
          <label htmlFor="signup-email">Email address</label>
          <input id="signup-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" maxLength="254" required />
          <small className="auth-password-hint">We’ll email you a link to verify this address before you set your password.</small>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending verification…' : 'Continue with email'}</button>
          {message && <p className="auth-feedback" role="alert">{message}</p>}
        </form>}
  </AuthLayout>;
}
