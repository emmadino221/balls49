import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth.js';
import './welcome-panel.css';

export default function WelcomePanel() {
  const [account, setAccount] = useState(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/auth/me', { signal: controller.signal }).then(result => setAccount(result.account || null)).catch(() => {});
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(now);
  return <section className="welcome-dashboard page-container" aria-label="Welcome">
    <div className="welcome-banner">
      <div className="welcome-copy">
        <p className="welcome-time"><span aria-hidden="true" />{greeting} &middot; {date} Lagos</p>
        <h1>{account ? 'Welcome back' : 'Welcome to emmy-bet'}{account?.name ? <>,<br />{account.name}.</> : '.'}</h1>
        <p>Your picks, results and game insights. All in one place.</p>
        <div className="welcome-actions"><a className="btn btn-primary" href="predictions.html">View 49ja predictions</a><a className="btn btn-secondary" href={account ? 'account.html' : 'free-trial.html'}>{account ? 'My account' : 'Start free trial'}</a></div>
      </div>
      <aside className="welcome-feature">
        <span className="overline">49JA / TRACK RECORD</span>
        <div className="welcome-ball-art" aria-hidden="true"><span>4</span><span>9</span></div>
        <h2>Every draw tells a story.</h2>
        <p>Explore settled results, market performance and daily streak records.</p>
        <a href="history.html">Explore result history &rarr;</a>
      </aside>
    </div>
    <div className="welcome-shortcuts">
      {[['01', '49ja predictions', 'Number, color and range markets.', 'predictions.html'], ['02', 'Football', 'Pre-match picks and combinations.', 'football.html'], ['03', 'Game plans', 'Suggestions from recorded history.', 'suggestions.html']].map(([number, title, text, href]) => <a key={href} href={href}><span>{number}</span><h2>{title}</h2><p>{text}</p><strong>Open &rarr;</strong></a>)}
    </div>
  </section>;
}
