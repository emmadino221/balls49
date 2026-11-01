import React from 'react';

export default function ThemeToggle({ darkMode, onToggle }) {
  return <button className="theme-toggle app-theme-toggle" type="button" onClick={onToggle}
    aria-label={`Switch to ${darkMode ? 'light' : 'dark'} theme`}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {darkMode
        ? <><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>
        : <path d="M20.2 15.1A8.4 8.4 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" />}
    </svg>
    <span>{darkMode ? 'Light' : 'Dark'}</span>
  </button>;
}
