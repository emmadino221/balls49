import '../../balls49-extension/tc1-staking.js';

export const simulationGames = [
  ['betzero', 'BetZero', 1.65], ['bet49', 'Bet49', 7.8], ['rainbow', 'Rainbow', 1.5],
  ['hilo', 'High / Low', 2], ['totalColor', 'Total Color 3-way', 3.8],
  ['totalColor2', 'Total Color 2-way', 3.8], ['totalColor1', 'Winning Color', 3.8],
];
const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
const numbers = v => (Array.isArray(v) ? v : v == null ? [] : [v]).map(Number);
const validNumbers = a => a.length > 0 && new Set(a).size === a.length && a.every(n => Number.isInteger(n) && n >= 1 && n <= 49);

export function simulateHistory(records, game, base, mode) {
  const odds = simulationGames.find(g => g[0] === game)?.[2];
  if (!odds || !Number.isFinite(base) || base < 1 || base > 1000000) throw new Error('Enter a base stake between 1 and 1,000,000.');
  const sorted = [...new Map(records.map(r => [String(r.drawId), r])).values()].sort((a,b) => Number(a.drawId) - Number(b.drawId));
  const result = { rows: [], staked: 0, returned: 0, net: 0, largest: 0, maxDrawdown: 0, funding: 0, wins: 0, losses: 0, skipped: 0, worst: 0, stop: '', available: sorted.length };
  let cycleLoss = 0, step = 1, run = 0, peak = 0, target = null, previous = null;
  for (const record of sorted) {
    const id = Number(record.drawId);
    if (!Number.isSafeInteger(id) || (previous !== null && id !== previous + 1)) { result.stop = `Missing or invalid draw before #${record.drawId}. Replay stopped to preserve an accurate progression.`; break; }
    previous = id;
    const outcome = record.result?.[game];
    if (outcome === 'SKIP') { result.skipped++; result.rows.push({ id, outcome, step, stake: 0, cost: 0, payout: 0, net: result.net, count: 0 }); continue; }
    if (!['WIN','LOSS'].includes(outcome)) { result.stop = `Draw #${id} has no settled result for this game. Replay stopped.`; break; }
    let count = game === 'totalColor' ? 3 : game === 'totalColor2' ? 2 : 1;
    let hits = outcome === 'WIN' ? 1 : 0;
    if (game === 'bet49') {
      const picks = numbers(record.predicted?.bet49), balls = numbers(record.result?.balls);
      if (!validNumbers(picks) || picks.length > 6 || balls.length !== 6 || !validNumbers(balls)) { result.stop = `Bet49 selections or result numbers are incomplete at #${id}. Replay stopped.`; break; }
      count = picks.length;
      hits = picks.filter(n => balls.includes(n)).length;
      if ((hits > 0) !== (outcome === 'WIN')) { result.stop = `Bet49 result disagrees with the recorded numbers at #${id}. Replay stopped.`; break; }
      if (target === null) target = base * (odds - count);
    }
    let stake = base;
    if (game === 'bet49') stake = Math.ceil((cycleLoss + target) / (odds - count));
    else if (game === 'totalColor1') stake = globalThis.TC1Staking.nextStake(base, cycleLoss, step - 1, mode);
    else if (step > 1) {
      if (game === 'hilo') stake = money(base * Math.pow(mode === '1.4' ? 1.4 : 2, step - 1));
      else if (game === 'totalColor') stake = money(cycleLoss / .8);
      else if (game === 'totalColor2') stake = money((cycleLoss + base) / 1.8);
      else stake = money((cycleLoss + base * (odds - 1)) / (odds - 1));
    }
    const cost = money(stake * count), payout = money(stake * odds * hits);
    if (![stake, cost, payout, result.staked + cost, result.returned + payout].every(n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100) || stake <= 0) { result.stop = `Stake exceeded reliable calculation limits at #${id}. Replay stopped.`; break; }
    result.funding = Math.max(result.funding, money(cost - result.net));
    result.staked = money(result.staked + cost); result.returned = money(result.returned + payout);
    result.net = money(result.returned - result.staked); result.largest = Math.max(result.largest, cost);
    peak = Math.max(peak, result.net); result.maxDrawdown = Math.max(result.maxDrawdown, money(peak - result.net));
    result.rows.push({ id, outcome, step, stake, count, cost, payout, net: result.net });
    if (outcome === 'WIN') { result.wins++; cycleLoss = 0; step = 1; run = 0; target = null; }
    else { result.losses++; cycleLoss = money(cycleLoss + cost); step++; run++; result.worst = Math.max(result.worst, run); }
  }
  result.unrecovered = cycleLoss;
  return result;
}
