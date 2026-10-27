import React, { useEffect, useRef, useState } from 'react';
import { PageRenderer, getPageName } from './router.jsx';
import { apiRequest } from './auth.js';

const navLinks = [
  { path: 'index.html', page: 'home', label: 'Home' },
  { label: 'Predictions', id: 'predictions', children: [
    { path: 'predictions.html', page: 'predictions', label: '49ja predictions' },
    { path: 'football.html', page: 'football', label: 'Football' },
    { path: 'free-trial.html', page: 'free-trial', label: '49ja free trial' }
  ] },
  { label: 'Tools & history', id: 'tools', children: [
    { path: 'history.html', page: 'history', label: '49ja history' },
    { path: 'analysis.html', page: 'analysis', label: '49ja analysis' },
    { path: 'calculator.html', page: 'calculator', label: 'Calculator' },
    { path: 'suggestions.html', page: 'suggestions', label: 'Strategy suggestions' }
  ] },
  { label: 'Learn', id: 'learn', children: [
    { path: 'guide.html', page: 'guide', label: 'Guide' },
    { path: 'videos.html', page: 'videos', label: 'Videos' }
  ] },
  { path: 'pricing.html', page: 'pricing', label: 'Pricing' },
  { label: 'More', id: 'more', children: [
    { path: 'about.html', page: 'about', label: 'About' },
    { path: 'contact.html', page: 'contact', label: 'Contact' }
  ] }
];

export default function App() {
  const page = getPageName();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);
  const navRef = useRef(null);
  const [session, setSession] = useState({ checking: true, user: null, admin: false });
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const savedTheme = localStorage.getItem('emmy-bet-theme');
      return savedTheme === null ? true : savedTheme === 'dark';
    } catch { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem('emmy-bet-theme', darkMode ? 'dark' : 'light'); }
    catch { /* Theme preference is optional. */ }
  }, [darkMode]);

  useEffect(() => {
    let active = true;
    // Remove legacy browser-readable tokens left by older versions of the site.
    try {
      localStorage.removeItem('balls49-admin-token');
      localStorage.removeItem('balls49-account-token');
    } catch { /* Cookie-based sign-in does not depend on browser storage. */ }
    apiRequest('/admin/preview')
      .then(() => { if (active) setSession({ checking: false, user: null, admin: true }); })
      .catch(() => apiRequest('/auth/me')
        .then(result => { if (active) setSession({ checking: false, user: result.account, admin: false }); })
        .catch(() => { if (active) setSession({ checking: false, user: null, admin: false }); }));
    return () => { active = false; };
  }, []);

  async function signOut() {
    const route = session.admin ? '/admin/logout' : '/auth/logout';
    try { await apiRequest(route, { method: 'POST' }); }
    catch { /* Clear the visible signed-in state even if the API is unavailable. */ }
    setSession({ checking: false, user: null, admin: false });
    setMenuOpen(false);
    window.location.href = 'index.html';
  }

  useEffect(() => { setMenuOpen(false); setOpenGroup(null); }, [page]);
  useEffect(() => {
    const outside = event => { if (!navRef.current?.contains(event.target)) setOpenGroup(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  const closeNavigation = () => { setMenuOpen(false); setOpenGroup(null); };
  const navLink = item => <a key={item.path} className={page === item.page ? 'active' : ''} href={item.path}
    aria-current={page === item.page ? 'page' : undefined} onClick={closeNavigation}>{item.label}</a>;


  return (
    <div className={`site${darkMode ? ' dark-theme' : ''}${page === 'home' ? ' home-site' : ' cinematic-site'}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <a className="brand" href="index.html" aria-label="Emmy-Bet home">
          <span className="brand-mark" aria-hidden="true">E</span>
          <span>emmy<span className="brand-dash">-</span>bet</span>
        </a>

        <button
          className={`menu-toggle${menuOpen ? ' is-open' : ''}`}
          type="button"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => { setMenuOpen(open => !open); setOpenGroup(null); }}
        >
          <span /><span /><span />
        </button>

        <nav ref={navRef} id="primary-navigation" className={`main-nav grouped-nav${menuOpen ? ' is-open' : ''}`} aria-label="Main navigation"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              if (openGroup) { navRef.current?.querySelector(`#nav-trigger-${openGroup}`)?.focus(); setOpenGroup(null); }
              else { setMenuOpen(false); document.querySelector('.menu-toggle')?.focus(); }
            }
          }}>
          {navLinks.map(item => item.children ? <div className="nav-group" key={item.id}
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpenGroup(current => current === item.id ? null : current); }}>
            <button id={`nav-trigger-${item.id}`} type="button" className={`nav-group-trigger${item.children.some(child => child.page === page) ? ' active' : ''}`}
              aria-expanded={openGroup === item.id} aria-controls={`nav-panel-${item.id}`}
              onClick={() => setOpenGroup(current => current === item.id ? null : item.id)}>
              {item.label}<span aria-hidden="true">{openGroup === item.id ? '\u2212' : '+'}</span>
            </button>
            <div id={`nav-panel-${item.id}`} className="nav-group-panel" hidden={openGroup !== item.id}>{item.children.map(navLink)}</div>
          </div> : navLink(item))}
          {session.user || session.admin
            ? <button className="mobile-login mobile-logout" type="button" onClick={signOut}>{session.admin ? 'Exit owner session' : 'Sign out'}</button>
            : <a className="mobile-login" href="login.html" onClick={() => setMenuOpen(false)}>Log in</a>}
          <a className="mobile-trial" href={session.user || session.admin ? 'account.html' : 'free-trial.html'} onClick={() => setMenuOpen(false)} aria-current={page === 'account' ? 'page' : undefined}>{session.user || session.admin ? 'My account' : 'Start free trial'}</a>
        </nav>

        <div className="header-actions">
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setDarkMode((dark) => !dark)}
            aria-label={`Switch to ${darkMode ? 'light' : 'dark'} theme`}
          >
            <span aria-hidden="true">{darkMode ? '☼' : '◐'}</span>
            <span className="theme-toggle-label">{darkMode ? 'Light' : 'Dark'}</span>
          </button>
          {session.user || session.admin
            ? <button className="header-login header-logout" type="button" onClick={signOut}>{session.admin ? 'Exit owner session' : 'Sign out'}</button>
            : <a className="header-login" href="login.html">{session.checking ? '…' : 'Log in'}</a>}
          <a className="btn btn-primary header-cta" href={session.user || session.admin ? 'account.html' : 'free-trial.html'} aria-current={page === 'account' ? 'page' : undefined}>{session.user || session.admin ? 'My account' : 'Start free trial'}</a>
        </div>
      </header>

      <div id="main-content">
        <PageRenderer page={page} />
      </div>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand-block">
            <a className="brand footer-brand" href="index.html">
              <span className="brand-mark" aria-hidden="true">E</span><span>emmy-bet</span>
            </a>
            <p>Clearer information for a more considered betting workflow.</p>
          </div>
          <div className="footer-col">
            <h2>Explore</h2>
            <a href="about.html">About</a>
            <a href="pricing.html">Pricing</a>
            <a href="predictions.html">49ja predictions</a>
            <a href="football.html">Football</a>
            <a href="history.html">Prediction history</a>
            <a href="analysis.html">Prediction analysis</a>
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
              ? <button className="footer-logout" type="button" onClick={signOut}>{session.admin ? 'Exit owner session' : 'Sign out'}</button>
              : <a href="login.html">Log in</a>}
            <a href="contact.html">Contact support</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Emmy-Bet</span>
          <span className="footer-note">Predictions are uncertain. Please bet responsibly.</span>
        </div>
      </footer>
    </div>
  );
}
