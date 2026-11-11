import React, { useEffect, useState } from 'react';
import { apiRequest } from '../auth.js';
import './welcome-panel.css';

export default function WelcomePanel() {
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    apiRequest('/auth/me', { signal: controller.signal })
      .then(result => { if (active) setAccount(result.account || null); })
      .catch(() => {})
      .finally(() => { if (active) setAccountLoading(false); });
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, []);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(now);
  return <section className="welcome-dashboard page-container" aria-label="Welcome">
    <div className="welcome-banner">
      <div className="welcome-copy">
        <p className="welcome-time"><span aria-hidden="true" />{greeting} &middot; {date} Lagos</p>
        <h1 aria-busy={accountLoading}>{accountLoading
          ? <span className="welcome-greeting-skeleton" role="status" aria-label="Loading your welcome message" />
          : <>{account ? 'Welcome back' : 'Welcome to emmy-bet'}{account?.name ? <>,<br /><span className="welcome-name">{account.name}.</span></> : '.'}</>}</h1>
        <p>Your picks, results and game insights. All in one place.</p>
        <div className="welcome-actions"><a className="btn btn-primary" href="predictions.html">View 49ja predictions</a><a className="btn btn-secondary" href={account ? 'account.html' : 'free-trial.html'}>{account ? 'My account' : 'Start free trial'}</a></div>
      </div>
      <aside className="welcome-feature">
        <span className="overline">49JA / TRACK RECORD</span>
        <div className="welcome-ball-art" aria-hidden="true"><span>4</span><span className="is-blue">11</span><span className="is-green">21</span><span>34</span><span className="is-blue">38</span><span className="is-yellow">49</span></div>
        <h2>Every draw tells a story.</h2>
        <p>Explore settled results, market performance and daily streak records.</p>
        <a href="history.html">Explore result history &rarr;</a>
      </aside>
    </div>
    <section className="home-destinations" aria-labelledby="home-destinations-title">
      <div className="home-destinations-heading">
        <div><span className="overline">YOUR ANALYTICS WORKSPACE</span><h2 id="home-destinations-title">Explore the platform</h2></div>
        <p>Choose a workspace to view its available predictions, fixtures, and recorded results.</p>
      </div>
      <div className="welcome-shortcuts">
        {[
          ['01', '49ja Casino', 'Eight number, color, and range markets.', 'predictions.html', 'casino'],
          ['02', 'Real Football', 'Pre-match fixtures, picks, and combinations.', 'football.html', 'football'],
          ['03', 'Virtual Football', 'Browse the virtual football prediction feed.', 'virtual-football.html', 'virtual'],
          ['04', 'Prediction History', 'Review recorded picks beside draw results.', 'history.html', 'history'],
          ['05', 'Game plans', 'Explore suggestions based on recorded history.', 'suggestions.html', 'plans'],
        ].map(([number, title, text, href, type]) => <a className={`home-destination-card home-destination-${type}`} key={href} href={href} data-reveal style={{ '--reveal-index': Number(number) - 1 }}>
          <span className="home-destination-number">{number}</span>
          <span className="home-destination-arrow" aria-hidden="true">↗</span>
          <span className="home-destination-kind">{type === 'casino' ? 'CASINO MARKETS' : type === 'football' || type === 'virtual' ? 'FOOTBALL' : type === 'history' ? 'TRACK RECORD' : 'STRATEGY'}</span>
          <h3>{title}</h3>
          <p>{text}</p>
          <strong>Open workspace <span aria-hidden="true">→</span></strong>
        </a>)}
      </div>
    </section>
  </section>;
}
