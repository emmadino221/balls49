import React from 'react';
import { moreNavigation, primaryNavigation, isNavigationItemActive } from './navigation.js';
import NavigationIcon from './NavigationIcon.jsx';

const mobileItems = primaryNavigation.slice(0, 4);

export default function MobileNavigation({ page, session, moreOpen, onToggleMore, onCloseMore, onSignOut }) {
  const signedIn = Boolean(session.user || session.admin);
  const moreItems = [
    ...primaryNavigation.slice(4),
    ...moreNavigation,
  ];

  return <>
    {moreOpen && <button className="app-mobile-backdrop" type="button" onClick={onCloseMore}
      aria-label="Close more navigation" />}
    <nav className="app-mobile-more" id="mobile-more-navigation" aria-label="More destinations" hidden={!moreOpen}>
      <div className="app-mobile-more-heading"><strong>More</strong><button type="button" onClick={onCloseMore} aria-label="Close more navigation">×</button></div>
      <div className="app-mobile-more-links">
        {moreItems.map(item => {
          const active = isNavigationItemActive(item, page);
          return <a key={item.path} href={item.path} className={active ? 'is-active' : ''}
            aria-current={active ? 'page' : undefined} onClick={onCloseMore}>{item.label}</a>;
        })}
        {signedIn
          ? <button className="app-mobile-signout" type="button" onClick={onSignOut}>{session.admin ? 'Exit owner session' : 'Sign out'}</button>
          : <a href="login.html" onClick={onCloseMore}>Log in</a>}
      </div>
      <a className="app-mobile-account-cta" href={signedIn ? 'account.html' : 'free-trial.html'} onClick={onCloseMore}>
        {signedIn ? 'My account' : 'Start free trial'}
      </a>
    </nav>
    <nav className="app-mobile-bottom-nav" aria-label="Primary navigation">
      {mobileItems.map(item => {
        const active = isNavigationItemActive(item, page);
        return <a key={item.path} href={item.path} className={active ? 'is-active' : ''}
          aria-current={active ? 'page' : undefined}>
          <NavigationIcon name={item.icon} /><span>{item.label === 'Dashboard' ? 'Home' : item.label === 'Real Football' ? 'Football' : item.label === '49ja Casino' ? '49ja' : 'Virtual'}</span>
        </a>;
      })}
      <button type="button" className={moreOpen ? 'is-active' : ''} aria-expanded={moreOpen}
        aria-controls="mobile-more-navigation" onClick={onToggleMore}>
        <NavigationIcon name="more" /><span>More</span>
      </button>
    </nav>
  </>;
}
