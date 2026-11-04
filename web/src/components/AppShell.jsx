import React, { useEffect, useRef, useState } from 'react';
import { getPageTitle } from './navigation.js';
import MobileNavigation from './MobileNavigation.jsx';
import NavigationIcon from './NavigationIcon.jsx';
import Sidebar from './Sidebar.jsx';
import SiteFooter from './SiteFooter.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import './app-shell.css';

export default function AppShell({ page, session, darkMode, onToggleTheme, onSignOut, children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  const [moreOpen, setMoreOpen] = useState(false);
  const sidebarPreferenceChanged = useRef(false);
  const signedIn = Boolean(session.user || session.admin);

  useEffect(() => {
    setMoreOpen(false);
  }, [page]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [moreOpen]);

  useEffect(() => {
    const tablet = window.matchMedia('(max-width: 1023px)');
    const syncSidebar = () => {
      if (!sidebarPreferenceChanged.current) setSidebarCollapsed(tablet.matches);
    };
    tablet.addEventListener('change', syncSidebar);
    return () => tablet.removeEventListener('change', syncSidebar);
  }, []);

  const accountHref = signedIn ? 'account.html' : 'login.html';

  return <div className={`app-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
    <Sidebar page={page} session={session} collapsed={sidebarCollapsed} onToggle={() => {
      sidebarPreferenceChanged.current = true;
      setSidebarCollapsed(value => !value);
    }} />
    <div className="app-shell-main">
      <header className="site-header app-header">
        <div className="app-header-identity">
          <a className="brand app-mobile-brand" href="index.html" aria-label="Emmy-Bet dashboard">
            <span className="brand-mark" aria-hidden="true">E</span>
          </a>
          <h1 className="app-current-page-title">{getPageTitle(page)}</h1>
        </div>
        <div className="app-header-actions">
          <ThemeToggle darkMode={darkMode} onToggle={onToggleTheme} />
          <a className="app-header-account" href={accountHref} aria-label={signedIn ? 'Open my account' : 'Log in'}>
            <NavigationIcon name="account" /><span>{signedIn ? 'Account' : 'Log in'}</span>
          </a>
          <button className="app-header-more" type="button" aria-expanded={moreOpen}
            aria-controls="mobile-more-navigation" onClick={() => setMoreOpen(value => !value)}>
            <NavigationIcon name="more" /><span>Menu</span>
          </button>
          {signedIn && <button className="app-header-signout" type="button" onClick={onSignOut}>
            {session.admin ? 'Exit owner session' : 'Sign out'}
          </button>}
          {!signedIn && <a className="btn btn-primary app-header-trial" href="free-trial.html">Start free trial</a>}
        </div>
      </header>
      <div className="app-main-content" id="main-content">{children}</div>
      <SiteFooter session={session} onSignOut={onSignOut} />
    </div>
    <MobileNavigation page={page} session={session} moreOpen={moreOpen}
      onToggleMore={() => setMoreOpen(value => !value)} onCloseMore={() => setMoreOpen(false)} onSignOut={onSignOut} />
  </div>;
}
