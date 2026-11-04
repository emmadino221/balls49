export const primaryNavigation = [
  { path: 'index.html', page: 'home', label: 'Dashboard', icon: 'home' },
  { path: 'virtual-football.html', page: 'virtual-football', label: 'Virtual Football', icon: 'virtual' },
  { path: 'football.html', page: 'football', label: 'Real Football', icon: 'football' },
  { path: 'predictions.html', page: 'predictions', label: '49ja Casino', icon: 'casino' },
  { path: 'history.html', page: 'history', label: 'Prediction History', icon: 'history' },
  { path: 'virtual-results.html', page: 'virtual-results', label: 'Virtual Results', icon: 'history' },
  { path: 'predictions.html#analysis', page: 'predictions', hash: 'analysis', label: 'Performance Analytics', icon: 'analytics' },
  { path: 'account.html', page: 'account', label: 'Account', icon: 'account' },
  { path: 'automation.html', page: 'automation', label: 'Automation & Settings', icon: 'settings' },
];

export const moreNavigation = [
  { path: 'free-trial.html', page: 'free-trial', label: '49ja free trial' },
  { path: 'pricing.html', page: 'pricing', label: 'Pricing' },
  { path: 'guide.html', page: 'guide', label: 'Prediction guide' },
  { path: 'calculator.html', page: 'calculator', label: 'Martingale calculator' },
  { path: 'suggestions.html', page: 'suggestions', label: 'Strategy suggestions' },
  { path: 'videos.html', page: 'videos', label: 'Video library' },
  { path: 'about.html', page: 'about', label: 'About' },
  { path: 'contact.html', page: 'contact', label: 'Contact support' },
  { path: 'privacy.html', page: 'privacy', label: 'Privacy policy' },
  { path: 'terms.html', page: 'terms', label: 'Terms of service' },
];

export const adminNavigation = [
  { path: 'betzero-lab.html', page: 'betzero-lab', label: 'BetZero Testing Lab', icon: 'analytics' },
];

const pageTitles = {
  about: 'About',
  account: 'Account',
  analysis: 'Performance Analytics',
  automation: 'Automation & Settings',
  'betzero-lab': 'BetZero Strategy Lab',
  calculator: 'Martingale Calculator',
  contact: 'Contact',
  football: 'Real Football',
  'free-trial': '49ja Free Trial',
  guide: 'Prediction Guide',
  history: 'Prediction History',
  home: 'Dashboard',
  login: 'Log in',
  pricing: 'Pricing',
  predictions: window.location.hash === '#analysis' ? 'Performance Analytics' : '49ja Casino',
  privacy: 'Privacy Policy',
  signup: 'Create account',
  suggestions: 'Strategy Suggestions',
  terms: 'Terms of Service',
  'verify-email': 'Verify email',
  'virtual-football': 'Virtual Football',
  'virtual-results': 'Virtual Football Results',
  videos: 'Video Library',
};

export function isNavigationItemActive(item, page) {
  if (item.hash) return page === item.page && window.location.hash === `#${item.hash}`;
  if (page === 'predictions' && item.page === 'predictions') return window.location.hash !== '#analysis';
  return page === item.page;
}

export function getPageTitle(page) {
  return pageTitles[page] || 'Emmy-Bet';
}
