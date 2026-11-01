import React from 'react';

export default function SiteFooter({ session, onSignOut }) {
  return <footer className="footer app-site-footer">
    <div className="footer-inner">
      <div className="footer-brand-block">
        <a className="brand footer-brand" href="index.html">
          <span className="brand-mark" aria-hidden="true">E</span><span>emmy<span className="brand-dash">-</span>bet</span>
        </a>
        <p>Clearer information for a more considered betting workflow.</p>
      </div>
      <div className="footer-col">
        <h2>Explore</h2>
        <a href="about.html">About</a>
        <a href="pricing.html">Pricing</a>
        <a href="predictions.html">49ja predictions</a>
        <a href="virtual-football.html">Virtual Football</a>
        <a href="football.html">Football</a>
        <a href="history.html">Prediction history</a>
        <a href="predictions.html#analysis">Prediction analysis</a>
        <a href="guide.html">Prediction guide</a>
        <a href="calculator.html">Martingale calculator</a>
        <a href="suggestions.html">Strategy suggestions</a>
        <a href="videos.html">Video library</a>
      </div>
      <div className="footer-col">
        <h2>Get started</h2>
        <a href="account.html">My account</a>
        <a href="free-trial.html">Free trial</a>
        {session.user || session.admin
          ? <button className="footer-logout" type="button" onClick={onSignOut}>{session.admin ? 'Exit owner session' : 'Sign out'}</button>
          : <a href="login.html">Log in</a>}
        <a href="automation.html">Automation dashboard</a>
        <a href="contact.html">Contact support</a>
        <a href="privacy.html">Privacy policy</a>
        <a href="terms.html">Terms of service</a>
      </div>
    </div>
    <div className="footer-bottom">
      <span>© {new Date().getFullYear()} Emmy-Bet</span>
      <span className="footer-note">Predictions are uncertain. Please bet responsibly.</span>
    </div>
  </footer>;
}
