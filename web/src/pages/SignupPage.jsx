import React, { useState } from 'react';
import { apiRequest } from '../auth.js';
import AuthLayout from './AuthLayout.jsx';

export default function SignupPage() {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [accountCreated, setAccountCreated] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    if (password !== form.get('confirm-password')) {
      setMessage('The passwords do not match.');
      setBusy(false);
      return;
    }
    const submittedEmail = String(form.get('email') || '').trim();
    setEmail(submittedEmail);
    try {
      await apiRequest('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          email: submittedEmail,
          password
        })
      });
      setAccountCreated(true);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <AuthLayout
    mode="signup"
    eyebrow="CREATE YOUR ACCOUNT"
    title={accountCreated ? 'Your request is submitted.' : 'A better start begins here.'}
    description="The site owner confirms each new account through a separate, trusted contact method before granting access."
  >
    {accountCreated
      ? <div className="auth-success-message" role="status">
          <h2>Waiting for owner confirmation</h2>
          <p>Your request for <strong>{email}</strong> is saved but cannot sign in yet. The site owner must first confirm your identity through a contact method they already know.</p>
        </div>
      : <form className="auth-form auth-form-professional" onSubmit={submit}>
          <label htmlFor="signup-name">Full name</label>
          <input id="signup-name" name="name" type="text" placeholder="Your name" autoComplete="name" maxLength="100" required />
          <label htmlFor="signup-email">Email address</label>
          <input id="signup-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" maxLength="254" value={email} onChange={event => setEmail(event.target.value)} required />
          <label htmlFor="signup-password">Password</label>
          <input id="signup-password" name="password" type="password" placeholder="At least 10 characters" autoComplete="new-password" minLength="10" maxLength="1024" required />
          <label htmlFor="signup-confirm-password">Confirm password</label>
          <input id="signup-confirm-password" name="confirm-password" type="password" placeholder="Enter the password again" autoComplete="new-password" minLength="10" maxLength="1024" required />
          <small className="auth-password-hint">Your account stays locked until the site owner confirms you through a trusted contact method.</small>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
          {message && <p className="auth-feedback" role="alert">{message}</p>}
        </form>}
  </AuthLayout>;
}
