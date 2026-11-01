import React from 'react';

const paths = {
  account: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.1 3.2-5 7-5s6.3 1.9 7 5" /></>,
  analytics: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 3-4 3 2 5-7" /></>,
  casino: <><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1" /><circle cx="15" cy="15" r="1" /><path d="m15 9 .01 0M9 15l.01 0" /></>,
  collapse: <path d="m14 6-6 6 6 6" />,
  football: <><circle cx="12" cy="12" r="9" /><path d="m9 9 3-2 3 2v4l-3 2-3-2zM9 9 5.5 8M15 9l3.5-1M9 13l-2 4M15 13l2 4M12 7V3" /></>,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.2 1-1.4 2.4-1.5-.6a7.8 7.8 0 0 1-1.5.9l-.3 1.6h-2.8l-.3-1.6a7.8 7.8 0 0 1-1.5-.9l-1.5.6-1.4-2.4 1.2-1a7 7 0 0 1 0-1.8l-1.2-1 1.4-2.4 1.5.6a7.8 7.8 0 0 1 1.5-.9l.3-1.6h2.8l.3 1.6a7.8 7.8 0 0 1 1.5.9l1.5-.6 1.4 2.4-1.2 1a7 7 0 0 1-.1 1.7Z" transform="translate(-1 -1)" /></>,
  virtual: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16M9 5v5m6-5v5M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h.01M15 17h.01" /></>,
};

export default function NavigationIcon({ name, className = '' }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {paths[name] || paths.more}
  </svg>;
}
