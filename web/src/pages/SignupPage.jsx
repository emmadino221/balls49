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

    try {
      const submittedEmail = String(form.get('email') || '').trim();
      await apiRequest('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          email: submittedEmail,
          password
        })
      });
      setEmail(submittedEmail);
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
    title={accountCreated ? 'Your account is ready.' : 'A better start begins here.'}
    description="Create an account with your email and password. Prediction access is activated after owner approval."
  >
    {accountCreated
      ? <div className="auth-success-message" role="status">
          <h2>Waiting for owner approval</h2>
          <p>Your account for <strong>{email}</strong> has been created. You can sign in now; prediction access will be available after the site owner approves your account.</p>
          <a className="btn btn-primary" href="predictions.html">Continue to predictions</a>
        </div>
      : <form className="auth-form auth-form-professional" onSubmit={submit}>
          <label htmlFor="signup-name">Full name</label>
          <input id="signup-name" name="name" type="text" placeholder="Your name" autoComplete="name" maxLength="100" required />
          <label htmlFor="signup-email">Email address</label>
          <input id="signup-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" maxLength="254" required />
          <label htmlFor="signup-password">Password</label>
          <input id="signup-password" name="password" type="password" placeholder="At least 10 characters" autoComplete="new-password" minLength="10" maxLength="1024" required />
          <label htmlFor="signup-confirm-password">Confirm password</label>
          <input id="signup-confirm-password" name="confirm-password" type="password" placeholder="Enter the password again" autoComplete="new-password" minLength="10" maxLength="1024" required />
          <small className="auth-password-hint">Your account will be listed in the owner tools for manual access approval.</small>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
          {message && <p className="auth-feedback" role="alert">{message}</p>}
        </form>}
  </AuthLayout>;
}
