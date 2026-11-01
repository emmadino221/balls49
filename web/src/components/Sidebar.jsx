import React from 'react';
import { primaryNavigation, isNavigationItemActive } from './navigation.js';
import NavigationIcon from './NavigationIcon.jsx';

function NavigationLink({ item, page, collapsed }) {
  const active = isNavigationItemActive(item, page);
  return <a className={`app-sidebar-link${active ? ' is-active' : ''}`} href={item.path}
    aria-current={active ? 'page' : undefined} title={collapsed ? item.label : undefined}>
    <NavigationIcon name={item.icon} />
    <span>{item.label}</span>
  </a>;
}

export default function Sidebar({ page, collapsed, onToggle }) {
  return <aside className={`app-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="Workspace navigation">
    <div className="app-sidebar-brand-row">
      <a className="brand app-sidebar-brand" href="index.html" aria-label="Emmy-Bet dashboard">
        <span className="brand-mark" aria-hidden="true">E</span>
        <span className="app-sidebar-brand-name">emmy<span className="brand-dash">-</span>bet</span>
      </a>
      <button className="app-sidebar-toggle" type="button" onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
        <NavigationIcon name="collapse" />
      </button>
    </div>
    <p className="app-sidebar-section-label">Workspace</p>
    <nav className="app-sidebar-nav" aria-label="Main navigation">
      {primaryNavigation.slice(0, 6).map(item => <NavigationLink key={item.path} item={item} page={page} collapsed={collapsed} />)}
    </nav>
    <p className="app-sidebar-section-label app-sidebar-account-label">Account</p>
    <nav className="app-sidebar-nav" aria-label="Account and settings">
      {primaryNavigation.slice(6).map(item => <NavigationLink key={item.path} item={item} page={page} collapsed={collapsed} />)}
    </nav>
    <div className="app-sidebar-bottom">
      <span className="app-sidebar-version">Emmy-Bet Pro</span>
    </div>
  </aside>;
}
