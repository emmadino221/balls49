import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth.js';
import AuthLayout from './AuthLayout.jsx';

export default function VerifyEmailPage() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [loading, setLoading] = useState(true);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!token) {
      setMessage('This verification link is missing or invalid. Request a new email and try again.');
      setLoading(false);
      return () => { active = false; };
    }
    apiRequest(`/auth/verification-status?token=${encodeURIComponent(token)}`)
      .then(result => {
        if (!active) return;
        setRequiresPassword(result.requiresPassword);
        setName(result.name || '');
      })
      .catch(error => {
        if (active) setMessage(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    if (requiresPassword && password !== form.get('confirm-password')) {
      setMessage('The passwords do not match.');
      setBusy(false);
      return;
    }
    try {
      await apiRequest('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      window.location.href = 'predictions.html';
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      mode="login"
      eyebrow="EMAIL VERIFICATION"
      title={loading ? 'Checking your link…' : requiresPassword ? 'Finish creating your account.' : 'Confirm your email address.'}
      description={name ? `Welcome${requiresPassword ? `, ${name}` : ''}. Verify this email address to secure your account.` : 'Confirm that you own this email address to continue.'}
    >
      {loading
        ? <p className="auth-verification-status" role="status">Checking your verification link…</p>
        : message && !requiresPassword
          ? <div className="auth-verification-message">
              <p className="auth-feedback" role="alert">{message}</p>
              <a className="btn btn-secondary" href="login.html">Go to sign in</a>
            </div>
          : <form className="auth-form auth-form-professional" onSubmit={submit}>
              {requiresPassword && <>
                <p className="auth-verification-status">You opened the verification link. Choose a password to finish setting up your account.</p>
                <label htmlFor="verify-password">Create password</label>
                <input id="verify-password" name="password" type="password" autoComplete="new-password" minLength="10" placeholder="At least 10 characters" required />
                <label htmlFor="verify-confirm-password">Confirm password</label>
                <input id="verify-confirm-password" name="confirm-password" type="password" autoComplete="new-password" minLength="10" placeholder="Enter the password again" required />
              </>}
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Verifying…' : requiresPassword ? 'Verify email and create account' : 'Verify email and sign in'}
              </button>
              {message && <p className="auth-feedback" role="alert">{message}</p>}
            </form>}
    </AuthLayout>
  );
}
