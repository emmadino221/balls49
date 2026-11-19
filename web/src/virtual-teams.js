// Virtual league clubs: three-letter code from the feed -> full name and bundled crest.
const crestFiles = import.meta.glob('./assets/crests/*.png', { eager: true, import: 'default' });
export const TEAM_NAMES = {
  ARS: 'Arsenal', ASV: 'Aston Villa', BOU: 'Bournemouth', BRI: 'Brighton', BRN: 'Burnley',
  CHE: 'Chelsea', COV: 'Coventry City', CRY: 'Crystal Palace', EVE: 'Everton', FOR: 'Nottingham Forest',
  FUL: 'Fulham', HLL: 'Hull City', IPS: 'Ipswich Town', LEE: 'Leeds United', LIV: 'Liverpool',
  MNC: 'Manchester City', MNU: 'Manchester United', NWC: 'Newcastle United', SUN: 'Sunderland', TOT: 'Tottenham Hotspur',
};

export function teamInfo(code) {
  const key = String(code || '').trim().toUpperCase();
  return { code: key || '?', name: TEAM_NAMES[key] || key || 'Unknown', crest: crestFiles[`./assets/crests/${key}.png`] || null };
}
