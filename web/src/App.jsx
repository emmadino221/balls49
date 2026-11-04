import React, { useEffect, useState } from 'react';
import { PageRenderer, getPageName } from './router.jsx';
import { apiRequest } from './auth.js';
import AppShell from './components/AppShell.jsx';

function prefersDarkTheme() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export default function App() {
  const page = getPageName();
  const [session, setSession] = useState({ checking: true, user: null, admin: false });
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const savedTheme = localStorage.getItem('emmy-bet-theme');
      if (savedTheme === 'dark') return true;
      if (savedTheme === 'light') return false;
    } catch { /* Fall back to the operating system theme. */ }
    return prefersDarkTheme();
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
    window.location.href = 'index.html';
  }

  return (
    <div className={`site${darkMode ? ' dark-theme' : ''}${page === 'home' ? ' home-site' : ' cinematic-site'}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <AppShell page={page} session={session} darkMode={darkMode}
        onToggleTheme={() => setDarkMode(dark => !dark)} onSignOut={signOut}>
        <PageRenderer page={page} session={session} />
      </AppShell>
    </div>
  );
}
