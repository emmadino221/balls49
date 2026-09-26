import React from 'react';

export default function AuthLayout({ mode, eyebrow, title, description, children }) {
  const isSignup = mode === 'signup';
  return (
    <main className="auth-page-wrap">
      <section className="auth-shell" aria-label={isSignup ? 'Create an Emmy-Bet account' : 'Sign in to Emmy-Bet'}>
        <aside className="auth-brand-panel">
          <a className="brand auth-brand" href="index.html" aria-label="Emmy-Bet home"><span className="brand-mark">E</span><span>emmy<span className="brand-dash">-</span>bet</span></a>
          <div className="auth-brand-copy">
            <span className="auth-panel-kicker">CLEAR PICKS. INFORMED CHOICES.</span>
            <h2>{isSignup ? 'Start with a clearer view.' : 'Welcome back.'}</h2>
            <p>{isSignup ? 'Create your account to explore the free trial and follow your plan when it is approved.' : 'Sign in to see your account access and the prediction markets available to you.'}</p>
            <div className="auth-benefit-list"><span><i>✓</i>Live prediction updates</span><span><i>✓</i>Market history and results</span><span><i>✓</i>Plan access managed by the site owner</span></div>
          </div>
          <div className="auth-panel-bottom"><span className="auth-status-dot" /> Account access is protected</div>
        </aside>
        <div className="auth-form-panel">
          <div className="auth-form-heading"><span className="overline">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
          {children}
          <p className="auth-switch-link">{isSignup ? 'Already have an account?' : 'New to Emmy-Bet?'} <a href={isSignup ? 'login.html' : 'signup.html'}>{isSignup ? 'Log in' : 'Create an account'}</a></p>
          <p className="auth-approval-note">Paid plans are activated after manual approval by the site owner.</p>
        </div>
      </section>
    </main>
  );
}
